import crypto from 'node:crypto';
import type { Database } from 'sqlite';
import { buildParticipantQuestionDto, type ParticipantQuestionDto } from './assignmentPayload';
import {
  type AssignmentGrade,
  type AssignmentSubmission,
  gradeAssignmentAnswer,
  getAssignmentQuestionOrder,
  InvalidAssignmentAnswerError,
  mixAssignmentSeed,
} from './assignmentScoring';
import { db } from './db';
import { parseLatLng } from './questionScoring';
import type {
  AssignmentAudienceMode,
  AssignmentResultPolicy,
  AssignmentReviewPolicy,
  DbAssignment,
  DbAssignmentAttempt,
  DbAssignmentMember,
  DbAssignmentQuestion,
  DbQuestion,
  DbQuiz,
  DbUser,
  JwtPayload,
  QuestionType,
} from './types';

export class AssignmentServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

function userLoginName(user: DbUser): string {
  return user.login_name?.trim() || user.email?.trim() || `user-${user.id}`;
}

export interface AssignmentDraftInput {
  quizId: number;
  title: string;
  audienceMode?: AssignmentAudienceMode;
  opensAtMs?: number;
  deadlineAtMs?: number | null;
  maxAttempts?: number;
  resultPolicy?: AssignmentResultPolicy;
  reviewPolicy?: AssignmentReviewPolicy;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
}

export interface ParticipantAttemptState {
  assignment: {
    id: number;
    title: string;
    status: DbAssignment['status'];
    opensAtMs: number;
    deadlineAtMs: number | null;
    maxAttempts: number;
  };
  attempt: {
    id: number;
    attemptNumber: number;
    status: DbAssignmentAttempt['status'];
    currentQuestionIndex: number;
    startedAtMs: number;
    completedAtMs: number | null;
    elapsedTimeMs: number | null;
    activeAnsweringTimeMs: number;
    totalScore?: number;
    correctCount?: number;
  };
  reviewAvailable: boolean;
  question: ParticipantQuestionDto | null;
}

type AssignmentActor = Pick<JwtPayload, 'id' | 'role'>;

const AUDIENCE_MODES = new Set<AssignmentAudienceMode>(['members', 'open']);
const RESULT_POLICIES = new Set<AssignmentResultPolicy>(['highest_score', 'latest_completed']);
const REVIEW_POLICIES = new Set<AssignmentReviewPolicy>(['after_deadline', 'after_close']);
const QUESTION_TYPES = new Set<QuestionType>([
  'multiple_choice',
  'true_false',
  'open_text',
  'multi_select',
  'closest_to',
  'fill_blank',
  'ordering',
  'geo',
  'matching',
]);

// sqlite's wrapper exposes one connection. Serialising assignment transactions
// prevents overlapping BEGIN calls in-process; BEGIN IMMEDIATE plus constraints
// still provides database-level protection if another process accesses the DB.
let transactionTail: Promise<void> = Promise.resolve();

async function withAssignmentTransaction<T>(work: (database: Database) => Promise<T>): Promise<T> {
  let release = () => {};
  const previous = transactionTail;
  transactionTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    await db.run('BEGIN IMMEDIATE');
    try {
      const result = await work(db);
      await db.run('COMMIT');
      return result;
    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }
  } finally {
    release();
  }
}

function ownsAssignment(actor: AssignmentActor, assignment: DbAssignment): boolean {
  return (
    actor.role === 'super_admin' ||
    (assignment.owner_kind === 'user' && assignment.owner_id === actor.id)
  );
}

async function requireOwnedAssignment(
  database: Database,
  actor: AssignmentActor,
  assignmentId: number,
): Promise<DbAssignment> {
  const assignment = await database.get<DbAssignment>('SELECT * FROM assignments WHERE id = ?', [
    assignmentId,
  ]);
  if (!assignment || !ownsAssignment(actor, assignment)) {
    throw new AssignmentServiceError('Assignment not found', 404);
  }
  return assignment;
}

async function requireAccessibleQuiz(
  database: Database,
  actor: AssignmentActor,
  quizId: number,
): Promise<DbQuiz> {
  const quiz = await database.get<DbQuiz>('SELECT * FROM quizzes WHERE id = ?', [quizId]);
  const accessible =
    quiz &&
    (actor.role === 'super_admin' || (quiz.owner_kind === 'user' && quiz.owner_id === actor.id));
  if (!accessible) throw new AssignmentServiceError('Quiz not found', 404);
  return quiz;
}

function requireFiniteInteger(value: unknown, label: string, minimum?: number): number {
  if (!Number.isInteger(value) || (minimum !== undefined && (value as number) < minimum)) {
    throw new AssignmentServiceError(`${label} is invalid`);
  }
  return value as number;
}

function validateDraftInput(input: AssignmentDraftInput): Required<AssignmentDraftInput> {
  const now = Date.now();
  const title = input.title?.trim();
  if (!title) throw new AssignmentServiceError('title is required');
  const quizId = requireFiniteInteger(input.quizId, 'quizId', 1);
  const opensAtMs = input.opensAtMs ?? now;
  requireFiniteInteger(opensAtMs, 'opensAtMs', 0);
  const deadlineAtMs = input.deadlineAtMs ?? null;
  if (deadlineAtMs !== null) {
    requireFiniteInteger(deadlineAtMs, 'deadlineAtMs', 0);
    if (deadlineAtMs <= opensAtMs) {
      throw new AssignmentServiceError('deadlineAtMs must be later than opensAtMs');
    }
  }
  const maxAttempts = requireFiniteInteger(input.maxAttempts ?? 1, 'maxAttempts', 1);
  const audienceMode = input.audienceMode ?? 'members';
  const resultPolicy = input.resultPolicy ?? 'highest_score';
  const reviewPolicy = input.reviewPolicy ?? 'after_deadline';
  if (!AUDIENCE_MODES.has(audienceMode)) {
    throw new AssignmentServiceError('audienceMode is invalid');
  }
  if (!RESULT_POLICIES.has(resultPolicy)) {
    throw new AssignmentServiceError('resultPolicy is invalid');
  }
  if (!REVIEW_POLICIES.has(reviewPolicy)) {
    throw new AssignmentServiceError('reviewPolicy is invalid');
  }
  return {
    quizId,
    title,
    audienceMode,
    opensAtMs,
    deadlineAtMs,
    maxAttempts,
    resultPolicy,
    reviewPolicy,
    shuffleQuestions: input.shuffleQuestions ?? true,
    shuffleOptions: input.shuffleOptions ?? true,
  };
}

export async function createDraftAssignment(
  actor: AssignmentActor,
  input: AssignmentDraftInput,
): Promise<DbAssignment> {
  const normalized = validateDraftInput(input);
  return withAssignmentTransaction(async (database) => {
    await requireAccessibleQuiz(database, actor, normalized.quizId);
    const now = Date.now();
    const result = await database.run(
      `INSERT INTO assignments (
        quiz_id, owner_kind, owner_id, title, audience_mode, opens_at_ms,
        deadline_at_ms, max_attempts, result_policy, review_policy,
        shuffle_questions, shuffle_options, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      normalized.quizId,
      actor.role === 'super_admin' ? 'admin' : 'user',
      actor.role === 'super_admin' ? null : actor.id,
      normalized.title,
      normalized.audienceMode,
      normalized.opensAtMs,
      normalized.deadlineAtMs,
      normalized.maxAttempts,
      normalized.resultPolicy,
      normalized.reviewPolicy,
      normalized.shuffleQuestions ? 1 : 0,
      normalized.shuffleOptions ? 1 : 0,
      now,
      now,
    );
    return (await database.get<DbAssignment>('SELECT * FROM assignments WHERE id = ?', [
      result.lastID,
    ])) as DbAssignment;
  });
}

export async function updateDraftAssignment(
  actor: AssignmentActor,
  assignmentId: number,
  patch: Partial<AssignmentDraftInput>,
): Promise<DbAssignment> {
  return withAssignmentTransaction(async (database) => {
    const current = await requireOwnedAssignment(database, actor, assignmentId);
    if (current.status !== 'draft') {
      throw new AssignmentServiceError('Only draft assignments can be updated', 409);
    }
    const normalized = validateDraftInput({
      quizId: patch.quizId ?? (current.quiz_id as number),
      title: patch.title ?? current.title,
      audienceMode: patch.audienceMode ?? current.audience_mode,
      opensAtMs: patch.opensAtMs ?? current.opens_at_ms,
      deadlineAtMs: patch.deadlineAtMs === undefined ? current.deadline_at_ms : patch.deadlineAtMs,
      maxAttempts: patch.maxAttempts ?? current.max_attempts,
      resultPolicy: patch.resultPolicy ?? current.result_policy,
      reviewPolicy: patch.reviewPolicy ?? current.review_policy,
      shuffleQuestions:
        patch.shuffleQuestions === undefined
          ? current.shuffle_questions === 1
          : patch.shuffleQuestions,
      shuffleOptions:
        patch.shuffleOptions === undefined ? current.shuffle_options === 1 : patch.shuffleOptions,
    });
    await requireAccessibleQuiz(database, actor, normalized.quizId);
    await database.run(
      `UPDATE assignments SET quiz_id = ?, title = ?, audience_mode = ?, opens_at_ms = ?,
       deadline_at_ms = ?, max_attempts = ?, result_policy = ?, review_policy = ?,
       shuffle_questions = ?, shuffle_options = ?, updated_at_ms = ? WHERE id = ?`,
      normalized.quizId,
      normalized.title,
      normalized.audienceMode,
      normalized.opensAtMs,
      normalized.deadlineAtMs,
      normalized.maxAttempts,
      normalized.resultPolicy,
      normalized.reviewPolicy,
      normalized.shuffleQuestions ? 1 : 0,
      normalized.shuffleOptions ? 1 : 0,
      Date.now(),
      assignmentId,
    );
    return (await database.get<DbAssignment>('SELECT * FROM assignments WHERE id = ?', [
      assignmentId,
    ])) as DbAssignment;
  });
}

export async function setAssignmentMembers(
  actor: AssignmentActor,
  assignmentId: number,
  userIds: number[],
): Promise<DbAssignmentMember[]> {
  const uniqueUserIds = [...new Set(userIds)];
  if (uniqueUserIds.some((id) => !Number.isInteger(id) || id < 1)) {
    throw new AssignmentServiceError('userIds contains an invalid id');
  }
  return withAssignmentTransaction(async (database) => {
    const assignment = await requireOwnedAssignment(database, actor, assignmentId);
    if (assignment.status !== 'draft') {
      throw new AssignmentServiceError('Members can only be changed on a draft assignment', 409);
    }
    const users: DbUser[] = [];
    for (const userId of uniqueUserIds) {
      const user = await database.get<DbUser>('SELECT * FROM users WHERE id = ?', [userId]);
      if (!user) throw new AssignmentServiceError(`User ${userId} not found`, 404);
      users.push(user);
    }
    await database.run('DELETE FROM assignment_members WHERE assignment_id = ?', [assignmentId]);
    const now = Date.now();
    for (const user of users) {
      const displayName = user.play_display_name?.trim() || user.username;
      await database.run(
        `INSERT INTO assignment_members
          (assignment_id, user_id, login_name_snapshot, display_name_snapshot, email_snapshot, assigned_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
        assignmentId,
        user.id,
        userLoginName(user),
        displayName,
        user.email ?? '',
        now,
      );
    }
    return database.all<DbAssignmentMember[]>(
      'SELECT * FROM assignment_members WHERE assignment_id = ? ORDER BY display_name_snapshot',
      [assignmentId],
    );
  });
}

function parseJsonArray(raw: string | null | undefined, label: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '');
    if (!Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new AssignmentServiceError(`Question has invalid ${label}`);
  }
}

function validateSnapshotQuestion(question: DbQuestion): void {
  if (!question.text.trim()) throw new AssignmentServiceError('Question text is required');
  if (!QUESTION_TYPES.has(question.question_type)) {
    throw new AssignmentServiceError(`Unsupported question type: ${question.question_type}`);
  }
  if (!Number.isInteger(question.base_score) || question.base_score < 0) {
    throw new AssignmentServiceError('Question base_score is invalid');
  }
  if (!Number.isInteger(question.time_sec) || question.time_sec < 1) {
    throw new AssignmentServiceError('Question time_sec is invalid');
  }
  const options = parseJsonArray(question.options, 'options');
  if (options.some((option) => typeof option !== 'string')) {
    throw new AssignmentServiceError('Question options must be strings');
  }

  if (question.question_type === 'multiple_choice' || question.question_type === 'true_false') {
    if (
      options.length < 2 ||
      !Number.isInteger(question.correct_index) ||
      question.correct_index < 0 ||
      question.correct_index >= options.length
    ) {
      throw new AssignmentServiceError('Choice question has an invalid answer key');
    }
  } else if (question.question_type === 'multi_select') {
    const correct = parseJsonArray(question.correct_indices, 'correct_indices');
    if (
      correct.length === 0 ||
      correct.some(
        (index) =>
          !Number.isInteger(index) || (index as number) < 0 || (index as number) >= options.length,
      )
    ) {
      throw new AssignmentServiceError('Multi-select question has an invalid answer key');
    }
  } else if (question.question_type === 'open_text') {
    if (!question.correct_answer?.trim()) {
      throw new AssignmentServiceError('Open-text question has no answer key');
    }
  } else if (question.question_type === 'fill_blank') {
    const blanks = parseJsonArray(question.blanks, 'blanks');
    if (
      blanks.length === 0 ||
      blanks.some(
        (accepted) =>
          !Array.isArray(accepted) ||
          accepted.length === 0 ||
          accepted.some((answer) => typeof answer !== 'string' || !answer.trim()),
      )
    ) {
      throw new AssignmentServiceError('Fill-blank question has an invalid answer key');
    }
  } else if (question.question_type === 'ordering') {
    if (options.length < 2) throw new AssignmentServiceError('Ordering question needs two items');
  } else if (question.question_type === 'matching') {
    const matches = parseJsonArray(question.matches, 'matches');
    if (
      options.length < 2 ||
      matches.length !== options.length ||
      matches.some((match) => typeof match !== 'string')
    ) {
      throw new AssignmentServiceError('Matching question has an invalid answer key');
    }
  } else if (question.question_type === 'closest_to') {
    const min = question.range_min;
    const max = question.range_max;
    const correct = Number.parseInt(question.correct_answer ?? '', 10);
    if (
      min === null ||
      max === null ||
      min >= max ||
      Number.isNaN(correct) ||
      correct < min ||
      correct > max
    ) {
      throw new AssignmentServiceError('Closest-to question has an invalid range or answer');
    }
  } else if (question.question_type === 'geo' && !parseLatLng(question.geo)) {
    throw new AssignmentServiceError('Geo question has an invalid answer key');
  }
}

async function generateUniqueAccessCode(database: Database): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = crypto.randomBytes(12).toString('base64url');
    const existing = await database.get('SELECT id FROM assignments WHERE access_code = ?', [code]);
    if (!existing) return code;
  }
  throw new AssignmentServiceError('Could not generate a unique access code', 500);
}

export async function publishAssignment(
  actor: AssignmentActor,
  assignmentId: number,
): Promise<DbAssignment> {
  return withAssignmentTransaction(async (database) => {
    const assignment = await requireOwnedAssignment(database, actor, assignmentId);
    if (assignment.status !== 'draft') {
      throw new AssignmentServiceError('Only draft assignments can be published', 409);
    }
    if (!assignment.quiz_id) throw new AssignmentServiceError('Source quiz no longer exists', 409);
    if (assignment.deadline_at_ms !== null && assignment.deadline_at_ms <= Date.now()) {
      throw new AssignmentServiceError('Assignment deadline has already passed', 409);
    }
    await requireAccessibleQuiz(database, actor, assignment.quiz_id);
    const questions = await database.all<DbQuestion[]>(
      'SELECT * FROM questions WHERE quiz_id = ? ORDER BY order_index',
      [assignment.quiz_id],
    );
    if (questions.length === 0) throw new AssignmentServiceError('Quiz has no questions');
    questions.forEach(validateSnapshotQuestion);

    if (assignment.audience_mode === 'members') {
      const memberCount = await database.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM assignment_members WHERE assignment_id = ? AND user_id IS NOT NULL',
        [assignmentId],
      );
      if (!memberCount?.count) {
        throw new AssignmentServiceError('A members-only assignment needs at least one member');
      }
    }

    // Refresh identity snapshots at publication time.
    const members = await database.all<DbAssignmentMember[]>(
      'SELECT * FROM assignment_members WHERE assignment_id = ?',
      [assignmentId],
    );
    for (const member of members) {
      if (!member.user_id)
        throw new AssignmentServiceError('An assigned user no longer exists', 409);
      const user = await database.get<DbUser>('SELECT * FROM users WHERE id = ?', [member.user_id]);
      if (!user) throw new AssignmentServiceError('An assigned user no longer exists', 409);
      await database.run(
        `UPDATE assignment_members
         SET login_name_snapshot = ?, display_name_snapshot = ?, email_snapshot = ?
         WHERE id = ?`,
        userLoginName(user),
        user.play_display_name?.trim() || user.username,
        user.email ?? '',
        member.id,
      );
    }

    await database.run('DELETE FROM assignment_questions WHERE assignment_id = ?', [assignmentId]);
    for (const question of questions) {
      await database.run(
        `INSERT INTO assignment_questions (
          assignment_id, source_question_id, text, options, correct_index, correct_indices,
          base_score, time_sec, order_index, image_url, explanation, range_min, range_max,
          question_type, correct_answer, media_url, media_type, blanks, geo, matches, tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        assignmentId,
        question.id,
        question.text,
        question.options,
        question.correct_index,
        question.correct_indices,
        question.base_score,
        question.time_sec,
        question.order_index,
        question.image_url,
        question.explanation,
        question.range_min,
        question.range_max,
        question.question_type,
        question.correct_answer,
        question.media_url,
        question.media_type,
        question.blanks,
        question.geo,
        question.matches,
        question.tags,
      );
    }

    const now = Date.now();
    const accessCode = await generateUniqueAccessCode(database);
    await database.run(
      `UPDATE assignments SET status = 'published', access_code = ?, published_at_ms = ?,
       updated_at_ms = ? WHERE id = ?`,
      accessCode,
      now,
      now,
      assignmentId,
    );
    return (await database.get<DbAssignment>('SELECT * FROM assignments WHERE id = ?', [
      assignmentId,
    ])) as DbAssignment;
  });
}

export async function listAssignmentsForAdmin(actor: AssignmentActor): Promise<unknown[]> {
  const ownerFilter =
    actor.role === 'super_admin' ? '' : "WHERE a.owner_kind = 'user' AND a.owner_id = ?";
  return db.all(
    `SELECT a.*,
       q.title as quiz_title,
       (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignment_id = a.id) as question_count,
       (SELECT COUNT(*) FROM assignment_members m WHERE m.assignment_id = a.id) as member_count,
       (SELECT COUNT(*) FROM assignment_attempts t WHERE t.assignment_id = a.id) as attempt_count,
       (SELECT COUNT(DISTINCT t.user_id) FROM assignment_attempts t
          WHERE t.assignment_id = a.id) as started_count,
       (SELECT COUNT(DISTINCT t.user_id) FROM assignment_attempts t
          WHERE t.assignment_id = a.id AND t.status = 'completed') as completed_count
     FROM assignments a LEFT JOIN quizzes q ON q.id = a.quiz_id ${ownerFilter}
     ORDER BY a.created_at_ms DESC`,
    ...(actor.role === 'super_admin' ? [] : [actor.id]),
  );
}

export async function getAssignmentForAdmin(
  actor: AssignmentActor,
  assignmentId: number,
): Promise<{
  assignment: DbAssignment & { quiz_title: string | null; question_count: number };
  questions: DbAssignmentQuestion[];
  members: unknown[];
}> {
  const assignment = await requireOwnedAssignment(db, actor, assignmentId);
  const quiz = assignment.quiz_id
    ? await db.get<{ title: string }>('SELECT title FROM quizzes WHERE id = ?', [
        assignment.quiz_id,
      ])
    : undefined;
  const questions = await db.all<DbAssignmentQuestion[]>(
    'SELECT * FROM assignment_questions WHERE assignment_id = ? ORDER BY order_index',
    [assignmentId],
  );
  const sourceQuestionCount =
    assignment.status === 'draft' && assignment.quiz_id
      ? await db.get<{ count: number }>(
          'SELECT COUNT(*) as count FROM questions WHERE quiz_id = ?',
          [assignment.quiz_id],
        )
      : undefined;
  const members = await db.all(
    `SELECT m.*,
       (SELECT COUNT(*) FROM assignment_attempts t
          WHERE t.assignment_id = m.assignment_id AND t.user_id = m.user_id) as attempt_count,
       (SELECT COUNT(*) FROM assignment_attempts t
          WHERE t.assignment_id = m.assignment_id AND t.user_id = m.user_id
            AND t.status = 'completed') as completed_count
     FROM assignment_members m WHERE m.assignment_id = ?
     ORDER BY m.display_name_snapshot`,
    [assignmentId],
  );
  const attempts = await db.all<DbAssignmentAttempt[]>(
    `SELECT * FROM assignment_attempts WHERE assignment_id = ?
     ORDER BY user_id, attempt_number DESC`,
    [assignmentId],
  );
  const selectedAttempts = new Map<number, DbAssignmentAttempt>();
  for (const attempt of attempts) {
    if (attempt.user_id === null) continue;
    const selected = selectedAttempts.get(attempt.user_id);
    if (!selected) {
      selectedAttempts.set(attempt.user_id, attempt);
      continue;
    }
    if (selected.status === 'in_progress') continue;
    if (attempt.status === 'in_progress') {
      selectedAttempts.set(attempt.user_id, attempt);
      continue;
    }
    if (assignment.result_policy === 'highest_score') {
      const candidateCompleted = attempt.status === 'completed';
      const selectedCompleted = selected.status === 'completed';
      if (
        (candidateCompleted && !selectedCompleted) ||
        (candidateCompleted &&
          selectedCompleted &&
          (attempt.total_score > selected.total_score ||
            (attempt.total_score === selected.total_score &&
              (attempt.completed_at_ms ?? 0) > (selected.completed_at_ms ?? 0))))
      ) {
        selectedAttempts.set(attempt.user_id, attempt);
      }
    }
  }
  const membersWithProgress = (members as Array<Record<string, unknown>>).map((member) => {
    const attempt = selectedAttempts.get(member.user_id as number);
    return {
      ...member,
      participant_status: attempt?.status ?? 'not_started',
      attempt_id: attempt?.id ?? null,
      started_at_ms: attempt?.started_at_ms ?? null,
      completed_at_ms: attempt?.completed_at_ms ?? null,
      correct_count: attempt?.correct_count ?? null,
      total_score: attempt?.total_score ?? null,
    };
  });
  return {
    assignment: {
      ...assignment,
      quiz_title: quiz?.title ?? null,
      question_count:
        assignment.status === 'draft' ? (sourceQuestionCount?.count ?? 0) : questions.length,
    },
    questions,
    members: membersWithProgress,
  };
}

async function expireInProgressAttempts(
  database: Database,
  assignmentId: number,
  nowMs: number,
): Promise<void> {
  await database.run(
    `UPDATE assignment_attempts SET
       status = 'expired', completed_at_ms = ?, last_activity_at_ms = ?,
       current_question_started_at_ms = NULL,
       correct_count = (SELECT COUNT(*) FROM attempt_answers aa
         WHERE aa.attempt_id = assignment_attempts.id AND aa.is_correct = 1),
       total_score = COALESCE((SELECT SUM(aa.score) FROM attempt_answers aa
         WHERE aa.attempt_id = assignment_attempts.id), 0)
     WHERE assignment_id = ? AND status = 'in_progress'`,
    nowMs,
    nowMs,
    assignmentId,
  );
}

export async function closeAssignment(
  actor: AssignmentActor,
  assignmentId: number,
): Promise<DbAssignment> {
  return withAssignmentTransaction(async (database) => {
    const assignment = await requireOwnedAssignment(database, actor, assignmentId);
    if (assignment.status === 'draft') {
      throw new AssignmentServiceError('A draft assignment cannot be closed', 409);
    }
    if (assignment.status === 'archived') {
      throw new AssignmentServiceError('Archived assignments cannot be closed', 409);
    }
    const now = Date.now();
    const activeAttempts = await database.all<DbAssignmentAttempt[]>(
      "SELECT * FROM assignment_attempts WHERE assignment_id = ? AND status = 'in_progress'",
      [assignmentId],
    );
    for (const attempt of activeAttempts) {
      await reconcileAttempt(database, assignment, attempt, now);
    }
    await expireInProgressAttempts(database, assignmentId, now);
    await database.run(
      "UPDATE assignments SET status = 'closed', updated_at_ms = ? WHERE id = ?",
      now,
      assignmentId,
    );
    return (await database.get<DbAssignment>('SELECT * FROM assignments WHERE id = ?', [
      assignmentId,
    ])) as DbAssignment;
  });
}

async function requireParticipantAssignmentByCode(
  database: Database,
  accessCode: string,
  userId: number,
): Promise<{ assignment: DbAssignment; member: DbAssignmentMember | null }> {
  const assignment = await database.get<DbAssignment>(
    'SELECT * FROM assignments WHERE access_code = ?',
    [accessCode],
  );
  if (!assignment || assignment.status === 'draft' || assignment.status === 'archived') {
    throw new AssignmentServiceError('Assignment not found', 404);
  }
  const member =
    (await database.get<DbAssignmentMember>(
      'SELECT * FROM assignment_members WHERE assignment_id = ? AND user_id = ?',
      [assignment.id, userId],
    )) ?? null;
  if (assignment.audience_mode === 'members' && !member) {
    throw new AssignmentServiceError('Assignment not found', 404);
  }
  return { assignment, member };
}

function isReviewAvailable(assignment: DbAssignment, nowMs: number): boolean {
  if (assignment.status === 'closed') return true;
  return (
    assignment.review_policy === 'after_deadline' &&
    assignment.deadline_at_ms !== null &&
    nowMs >= assignment.deadline_at_ms
  );
}

export async function lookupParticipantAssignment(
  accessCode: string,
  userId: number,
  nowMs = Date.now(),
): Promise<unknown> {
  return withAssignmentTransaction(async (database) => {
    const { assignment } = await requireParticipantAssignmentByCode(database, accessCode, userId);
    let active = await database.get<DbAssignmentAttempt>(
      `SELECT * FROM assignment_attempts
       WHERE assignment_id = ? AND user_id = ? AND status = 'in_progress'`,
      [assignment.id, userId],
    );
    if (active) active = await reconcileAttempt(database, assignment, active, nowMs);

    const questionCount = await database.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM assignment_questions WHERE assignment_id = ?',
      [assignment.id],
    );
    const attempts = await database.all<DbAssignmentAttempt[]>(
      `SELECT * FROM assignment_attempts WHERE assignment_id = ? AND user_id = ?
       ORDER BY attempt_number DESC`,
      [assignment.id, userId],
    );
    const latest = active ?? attempts[0] ?? null;
    const attemptsUsed = attempts.length;
    const withinWindow =
      assignment.status === 'published' &&
      nowMs >= assignment.opens_at_ms &&
      (assignment.deadline_at_ms === null || nowMs < assignment.deadline_at_ms);
    return {
      id: assignment.id,
      title: assignment.title,
      status: assignment.status,
      opensAtMs: assignment.opens_at_ms,
      deadlineAtMs: assignment.deadline_at_ms,
      maxAttempts: assignment.max_attempts,
      attemptsUsed,
      questionCount: questionCount?.count ?? 0,
      participantStatus: latest?.status ?? 'not_started',
      attemptId: latest?.id ?? null,
      startedAtMs: latest?.started_at_ms ?? null,
      completedAtMs: latest?.completed_at_ms ?? null,
      canResume: latest?.status === 'in_progress',
      canStart:
        withinWindow && latest?.status !== 'in_progress' && attemptsUsed < assignment.max_attempts,
      reviewAvailable: isReviewAvailable(assignment, nowMs),
    };
  });
}

async function getPresentedQuestions(
  database: Database,
  assignment: DbAssignment,
  attempt: DbAssignmentAttempt,
): Promise<DbAssignmentQuestion[]> {
  const questions = await database.all<DbAssignmentQuestion[]>(
    'SELECT * FROM assignment_questions WHERE assignment_id = ? ORDER BY order_index',
    [assignment.id],
  );
  const order = getAssignmentQuestionOrder(
    questions.length,
    assignment.id,
    attempt.id,
    assignment.shuffle_questions === 1,
  );
  return order.map((index) => questions[index]);
}

async function finalizeAttempt(
  database: Database,
  attempt: DbAssignmentAttempt,
  status: 'completed' | 'expired',
  nowMs: number,
): Promise<DbAssignmentAttempt> {
  const totals = await database.get<{ correct_count: number; total_score: number }>(
    `SELECT COUNT(CASE WHEN is_correct = 1 THEN 1 END) as correct_count,
      COALESCE(SUM(score), 0) as total_score
     FROM attempt_answers WHERE attempt_id = ?`,
    [attempt.id],
  );
  await database.run(
    `UPDATE assignment_attempts SET status = ?, completed_at_ms = ?, last_activity_at_ms = ?,
       current_question_started_at_ms = NULL, correct_count = ?, total_score = ? WHERE id = ?`,
    status,
    nowMs,
    nowMs,
    totals?.correct_count ?? 0,
    totals?.total_score ?? 0,
    attempt.id,
  );
  return (await database.get<DbAssignmentAttempt>(
    'SELECT * FROM assignment_attempts WHERE id = ?',
    [attempt.id],
  )) as DbAssignmentAttempt;
}

async function reconcileAttempt(
  database: Database,
  assignment: DbAssignment,
  attempt: DbAssignmentAttempt,
  nowMs: number,
  knownPresentedQuestions?: DbAssignmentQuestion[],
): Promise<DbAssignmentAttempt> {
  if (attempt.status !== 'in_progress') return attempt;
  if (assignment.status === 'closed') {
    return finalizeAttempt(database, attempt, 'expired', nowMs);
  }
  const questions =
    knownPresentedQuestions ?? (await getPresentedQuestions(database, assignment, attempt));
  const question = questions[attempt.current_question_index];
  if (assignment.deadline_at_ms !== null && nowMs >= assignment.deadline_at_ms) {
    // Preserve a genuine per-question timeout that happened before the overall
    // deadline, but never start the next unseen question after the deadline.
    if (
      question &&
      attempt.current_question_started_at_ms !== null &&
      attempt.current_question_started_at_ms + question.time_sec * 1000 <= assignment.deadline_at_ms
    ) {
      await database.run(
        `INSERT OR IGNORE INTO attempt_answers (
          attempt_id, assignment_question_id, status, is_correct, score,
          question_started_at_ms, response_time_ms, answered_at_ms
        ) VALUES (?, ?, 'timed_out', 0, 0, ?, ?, ?)`,
        attempt.id,
        question.id,
        attempt.current_question_started_at_ms,
        question.time_sec * 1000,
        attempt.current_question_started_at_ms + question.time_sec * 1000,
      );
    }
    return finalizeAttempt(database, attempt, 'expired', assignment.deadline_at_ms);
  }
  if (!question) return finalizeAttempt(database, attempt, 'completed', nowMs);
  if (attempt.current_question_started_at_ms === null) {
    await database.run(
      'UPDATE assignment_attempts SET current_question_started_at_ms = ?, last_activity_at_ms = ? WHERE id = ?',
      nowMs,
      nowMs,
      attempt.id,
    );
    return {
      ...attempt,
      current_question_started_at_ms: nowMs,
      last_activity_at_ms: nowMs,
    };
  }
  const limitMs = question.time_sec * 1000;
  if (nowMs - attempt.current_question_started_at_ms < limitMs) return attempt;

  await database.run(
    `INSERT OR IGNORE INTO attempt_answers (
      attempt_id, assignment_question_id, status, is_correct, score,
      question_started_at_ms, response_time_ms, answered_at_ms
    ) VALUES (?, ?, 'timed_out', 0, 0, ?, ?, ?)`,
    attempt.id,
    question.id,
    attempt.current_question_started_at_ms,
    limitMs,
    nowMs,
  );
  const nextIndex = attempt.current_question_index + 1;
  if (nextIndex >= questions.length) {
    return finalizeAttempt(database, attempt, 'completed', nowMs);
  }
  await database.run(
    `UPDATE assignment_attempts SET current_question_index = ?,
      current_question_started_at_ms = ?, last_activity_at_ms = ? WHERE id = ?`,
    nextIndex,
    nowMs,
    nowMs,
    attempt.id,
  );
  return {
    ...attempt,
    current_question_index: nextIndex,
    current_question_started_at_ms: nowMs,
    last_activity_at_ms: nowMs,
  };
}

async function buildAttemptState(
  database: Database,
  assignment: DbAssignment,
  attempt: DbAssignmentAttempt,
  nowMs: number,
): Promise<ParticipantAttemptState> {
  const activeTime = await database.get<{ total: number }>(
    'SELECT COALESCE(SUM(response_time_ms), 0) as total FROM attempt_answers WHERE attempt_id = ?',
    [attempt.id],
  );
  let question: ParticipantQuestionDto | null = null;
  if (attempt.status === 'in_progress') {
    const questions = await getPresentedQuestions(database, assignment, attempt);
    const current = questions[attempt.current_question_index];
    if (current) {
      question = buildParticipantQuestionDto(
        assignment,
        attempt,
        current,
        attempt.current_question_index,
        questions.length,
        nowMs,
      );
    }
  }
  const final = attempt.status !== 'in_progress';
  const reviewAvailable = isReviewAvailable(assignment, nowMs);
  return {
    assignment: {
      id: assignment.id,
      title: assignment.title,
      status: assignment.status,
      opensAtMs: assignment.opens_at_ms,
      deadlineAtMs: assignment.deadline_at_ms,
      maxAttempts: assignment.max_attempts,
    },
    attempt: {
      id: attempt.id,
      attemptNumber: attempt.attempt_number,
      status: attempt.status,
      currentQuestionIndex: attempt.current_question_index,
      startedAtMs: attempt.started_at_ms,
      completedAtMs: attempt.completed_at_ms,
      elapsedTimeMs:
        attempt.completed_at_ms === null ? null : attempt.completed_at_ms - attempt.started_at_ms,
      activeAnsweringTimeMs: activeTime?.total ?? 0,
      ...(final && reviewAvailable
        ? { totalScore: attempt.total_score, correctCount: attempt.correct_count }
        : {}),
    },
    reviewAvailable,
    question,
  };
}

async function requireParticipantAttempt(
  database: Database,
  attemptId: number,
  userId: number,
): Promise<{ assignment: DbAssignment; attempt: DbAssignmentAttempt }> {
  const attempt = await database.get<DbAssignmentAttempt>(
    'SELECT * FROM assignment_attempts WHERE id = ? AND user_id = ?',
    [attemptId, userId],
  );
  if (!attempt) throw new AssignmentServiceError('Attempt not found', 404);
  const assignment = await database.get<DbAssignment>('SELECT * FROM assignments WHERE id = ?', [
    attempt.assignment_id,
  ]);
  if (!assignment) throw new AssignmentServiceError('Assignment not found', 404);
  return { assignment, attempt };
}

export async function startOrResumeAttempt(
  accessCode: string,
  userId: number,
  nowMs = Date.now(),
): Promise<ParticipantAttemptState> {
  return withAssignmentTransaction(async (database) => {
    const { assignment, member: existingMember } = await requireParticipantAssignmentByCode(
      database,
      accessCode,
      userId,
    );
    const active = await database.get<DbAssignmentAttempt>(
      `SELECT * FROM assignment_attempts
       WHERE assignment_id = ? AND user_id = ? AND status = 'in_progress'`,
      [assignment.id, userId],
    );
    if (active) {
      const reconciled = await reconcileAttempt(database, assignment, active, nowMs);
      return buildAttemptState(database, assignment, reconciled, nowMs);
    }

    const used = await database.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM assignment_attempts WHERE assignment_id = ? AND user_id = ?',
      [assignment.id, userId],
    );
    if ((used?.count ?? 0) >= assignment.max_attempts) {
      const latest = await database.get<DbAssignmentAttempt>(
        `SELECT * FROM assignment_attempts WHERE assignment_id = ? AND user_id = ?
         ORDER BY attempt_number DESC LIMIT 1`,
        [assignment.id, userId],
      );
      if (latest) return buildAttemptState(database, assignment, latest, nowMs);
      throw new AssignmentServiceError('No attempts remaining', 409);
    }
    if (assignment.status !== 'published') {
      throw new AssignmentServiceError('Assignment is not open', 409);
    }
    if (nowMs < assignment.opens_at_ms) {
      throw new AssignmentServiceError('Assignment has not opened yet', 409);
    }
    if (assignment.deadline_at_ms !== null && nowMs >= assignment.deadline_at_ms) {
      throw new AssignmentServiceError('Assignment deadline has passed', 409);
    }

    const user = await database.get<DbUser>('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) throw new AssignmentServiceError('User not found', 404);
    let member = existingMember;
    if (!member && assignment.audience_mode === 'open') {
      const result = await database.run(
        `INSERT INTO assignment_members
          (assignment_id, user_id, login_name_snapshot, display_name_snapshot, email_snapshot, assigned_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
        assignment.id,
        user.id,
        userLoginName(user),
        user.play_display_name?.trim() || user.username,
        user.email ?? '',
        nowMs,
      );
      member = (await database.get<DbAssignmentMember>(
        'SELECT * FROM assignment_members WHERE id = ?',
        [result.lastID],
      )) as DbAssignmentMember;
    }
    if (!member) throw new AssignmentServiceError('Assignment not found', 404);

    const attemptNumber = (used?.count ?? 0) + 1;
    const result = await database.run(
      `INSERT INTO assignment_attempts (
        assignment_id, assignment_member_id, user_id, participant_login_name, participant_name, participant_email,
        attempt_number, status, current_question_index, current_question_started_at_ms,
        started_at_ms, last_activity_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress', 0, ?, ?, ?)`,
      assignment.id,
      member.id,
      user.id,
      member.login_name_snapshot || userLoginName(user),
      member.display_name_snapshot,
      member.email_snapshot || '',
      attemptNumber,
      nowMs,
      nowMs,
      nowMs,
    );
    const attempt = (await database.get<DbAssignmentAttempt>(
      'SELECT * FROM assignment_attempts WHERE id = ?',
      [result.lastID],
    )) as DbAssignmentAttempt;
    return buildAttemptState(database, assignment, attempt, nowMs);
  });
}

export async function getParticipantAttemptState(
  attemptId: number,
  userId: number,
  nowMs = Date.now(),
): Promise<ParticipantAttemptState> {
  return withAssignmentTransaction(async (database) => {
    const { assignment, attempt } = await requireParticipantAttempt(database, attemptId, userId);
    const reconciled = await reconcileAttempt(database, assignment, attempt, nowMs);
    return buildAttemptState(database, assignment, reconciled, nowMs);
  });
}

/**
 * Finalize stale in-progress attempts once the assignment deadline has passed.
 * Reporting calls this once before its batch reads so an admin does not see
 * attempts stuck as in-progress merely because the participant never reopened
 * the browser. It intentionally does nothing before the deadline, because a
 * report view must never start the next unseen question's timer.
 */
export async function reconcileAssignmentDeadlineForReport(
  actor: AssignmentActor,
  assignmentId: number,
  nowMs = Date.now(),
): Promise<void> {
  await withAssignmentTransaction(async (database) => {
    const assignment = await requireOwnedAssignment(database, actor, assignmentId);
    if (assignment.deadline_at_ms === null || nowMs < assignment.deadline_at_ms) return;
    const activeAttempts = await database.all<DbAssignmentAttempt[]>(
      "SELECT * FROM assignment_attempts WHERE assignment_id = ? AND status = 'in_progress'",
      [assignmentId],
    );
    const questions = await database.all<DbAssignmentQuestion[]>(
      'SELECT * FROM assignment_questions WHERE assignment_id = ? ORDER BY order_index',
      [assignmentId],
    );
    for (const attempt of activeAttempts) {
      const order = getAssignmentQuestionOrder(
        questions.length,
        assignment.id,
        attempt.id,
        assignment.shuffle_questions === 1,
      );
      await reconcileAttempt(
        database,
        assignment,
        attempt,
        nowMs,
        order.map((index) => questions[index]),
      );
    }
  });
}

export async function submitAssignmentAnswer(
  attemptId: number,
  userId: number,
  questionId: number,
  submission: AssignmentSubmission,
  nowMs = Date.now(),
): Promise<
  ParticipantAttemptState & { accepted: boolean; duplicate?: boolean; timedOut?: boolean }
> {
  return withAssignmentTransaction(async (database) => {
    const loaded = await requireParticipantAttempt(database, attemptId, userId);
    let attempt = await reconcileAttempt(database, loaded.assignment, loaded.attempt, nowMs);
    const existing = await database.get(
      'SELECT id, status FROM attempt_answers WHERE attempt_id = ? AND assignment_question_id = ?',
      [attempt.id, questionId],
    );
    if (existing) {
      const state = await buildAttemptState(database, loaded.assignment, attempt, nowMs);
      return {
        ...state,
        accepted: false,
        duplicate: true,
        timedOut: (existing as { status: string }).status === 'timed_out',
      };
    }
    if (attempt.status !== 'in_progress') {
      return {
        ...(await buildAttemptState(database, loaded.assignment, attempt, nowMs)),
        accepted: false,
      };
    }
    const questions = await getPresentedQuestions(database, loaded.assignment, attempt);
    const question = questions[attempt.current_question_index];
    if (!question || question.id !== questionId) {
      throw new AssignmentServiceError('Question is not the current question', 409);
    }
    const startedAt = attempt.current_question_started_at_ms;
    if (startedAt === null) throw new AssignmentServiceError('Question timer is unavailable', 409);
    const responseTimeMs = Math.max(0, nowMs - startedAt);
    if (responseTimeMs >= question.time_sec * 1000) {
      attempt = await reconcileAttempt(database, loaded.assignment, attempt, nowMs);
      return {
        ...(await buildAttemptState(database, loaded.assignment, attempt, nowMs)),
        accepted: false,
        timedOut: true,
      };
    }

    const shuffleSeed = mixAssignmentSeed(loaded.assignment.id, attempt.id);
    let grade: AssignmentGrade;
    try {
      grade = gradeAssignmentAnswer(
        question,
        submission,
        shuffleSeed,
        loaded.assignment.shuffle_options === 1,
      );
    } catch (error) {
      if (error instanceof InvalidAssignmentAnswerError) {
        throw new AssignmentServiceError(error.message);
      }
      throw error;
    }
    await database.run(
      `INSERT INTO attempt_answers (
        attempt_id, assignment_question_id, status, chosen_index, chosen_indices,
        chosen_text, is_correct, score, question_started_at_ms, response_time_ms, answered_at_ms
      ) VALUES (?, ?, 'answered', ?, ?, ?, ?, ?, ?, ?, ?)`,
      attempt.id,
      question.id,
      grade.answer.chosenIndex,
      grade.answer.chosenIndices === null ? null : JSON.stringify(grade.answer.chosenIndices),
      grade.answer.chosenText,
      grade.isCorrect ? 1 : 0,
      grade.score,
      startedAt,
      responseTimeMs,
      nowMs,
    );

    const nextIndex = attempt.current_question_index + 1;
    if (nextIndex >= questions.length) {
      attempt = await finalizeAttempt(database, attempt, 'completed', nowMs);
    } else {
      await database.run(
        `UPDATE assignment_attempts SET current_question_index = ?,
         current_question_started_at_ms = ?, last_activity_at_ms = ?,
         correct_count = correct_count + ?, total_score = total_score + ? WHERE id = ?`,
        nextIndex,
        nowMs,
        nowMs,
        grade.isCorrect ? 1 : 0,
        grade.score,
        attempt.id,
      );
      attempt = {
        ...attempt,
        current_question_index: nextIndex,
        current_question_started_at_ms: nowMs,
        last_activity_at_ms: nowMs,
        correct_count: attempt.correct_count + (grade.isCorrect ? 1 : 0),
        total_score: attempt.total_score + grade.score,
      };
    }
    return {
      ...(await buildAttemptState(database, loaded.assignment, attempt, nowMs)),
      accepted: true,
    };
  });
}

export async function timeoutAssignmentQuestion(
  attemptId: number,
  userId: number,
  nowMs = Date.now(),
): Promise<ParticipantAttemptState & { timedOut: boolean }> {
  return withAssignmentTransaction(async (database) => {
    const { assignment, attempt } = await requireParticipantAttempt(database, attemptId, userId);
    const beforeIndex = attempt.current_question_index;
    const reconciled = await reconcileAttempt(database, assignment, attempt, nowMs);
    if (reconciled.status === 'in_progress' && reconciled.current_question_index === beforeIndex) {
      throw new AssignmentServiceError('Question time has not expired', 409);
    }
    return {
      ...(await buildAttemptState(database, assignment, reconciled, nowMs)),
      timedOut: true,
    };
  });
}

export async function completeAssignmentAttempt(
  attemptId: number,
  userId: number,
  nowMs = Date.now(),
): Promise<ParticipantAttemptState> {
  return withAssignmentTransaction(async (database) => {
    const { assignment, attempt } = await requireParticipantAttempt(database, attemptId, userId);
    const reconciled = await reconcileAttempt(database, assignment, attempt, nowMs);
    const completed =
      reconciled.status === 'in_progress'
        ? await finalizeAttempt(database, reconciled, 'completed', nowMs)
        : reconciled;
    return buildAttemptState(database, assignment, completed, nowMs);
  });
}
