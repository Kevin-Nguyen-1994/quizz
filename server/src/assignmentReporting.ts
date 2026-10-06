import type { Database } from 'sqlite';
import { db } from './db';
import { getAssignmentQuestionOrder } from './assignmentScoring';
import {
  AssignmentServiceError,
  getParticipantAttemptState,
  reconcileAssignmentDeadlineForReport,
} from './assignmentService';
import type {
  DbAssignment,
  DbAssignmentAttempt,
  DbAssignmentMember,
  DbAssignmentQuestion,
  DbAttemptAnswer,
  JwtPayload,
} from './types';

type AssignmentActor = Pick<JwtPayload, 'id' | 'role'>;
type ReportResult = 'correct' | 'incorrect' | 'no_answer';

interface ReportingAssignment extends DbAssignment {
  quiz_title: string | null;
  override_count: number;
}

export interface AttemptReportRow {
  id: number;
  attemptNumber: number;
  status: DbAssignmentAttempt['status'];
  isSelected: boolean;
  startedAtMs: number;
  completedAtMs: number | null;
  correct: number;
  incorrect: number;
  noAnswer: number;
  score: number;
  maxScore: number;
  scorePercent: number;
  elapsedTimeMs: number | null;
  activeAnsweringTimeMs: number;
  averageResponseTimeMs: number | null;
}

export interface ParticipantReportRow {
  memberId: number;
  userId: number | null;
  name: string;
  loginName: string;
  email: string | null;
  status: DbAssignmentAttempt['status'] | 'not_started';
  selectedAttemptId: number | null;
  attempts: AttemptReportRow[];
}

export interface QuestionReportRow {
  questionId: number;
  questionNumber: number;
  text: string;
  questionType: DbAssignmentQuestion['question_type'];
  sampleSize: number;
  answered: number;
  correct: number;
  incorrect: number;
  noAnswer: number;
  correctRate: number;
  correctRateAmongAnswered: number | null;
  averageScore: number;
  maxScore: number;
  averageResponseTimeMs: number | null;
  timeLimitSec: number;
}

export interface AssignmentReportDto {
  assignment: {
    id: number;
    title: string;
    quizTitle: string | null;
    status: DbAssignment['status'];
    accessCode: string | null;
    opensAtMs: number;
    deadlineAtMs: number | null;
    maxAttempts: number;
    resultPolicy: DbAssignment['result_policy'];
    reviewPolicy: DbAssignment['review_policy'];
    questionCount: number;
    maxScore: number;
    assignmentKind: DbAssignment['assignment_kind'];
    targetMode: DbAssignment['target_mode'];
    targetLevelCode: string | null;
    targetLevelName: string | null;
    promotionTargetLevelCode: string | null;
    promotionTargetLevelName: string | null;
    overrideCount: number;
  };
  overview: {
    assigned: number;
    notStarted: number;
    inProgress: number;
    completed: number;
    expired: number;
    completionRate: number;
    averageScore: number;
    averageScorePercent: number;
    averageElapsedTimeMs: number | null;
    averageActiveAnsweringTimeMs: number | null;
  };
  participants: ParticipantReportRow[];
  questions: QuestionReportRow[];
}

export interface AttemptQuestionDetail {
  questionId: number;
  questionNumber: number;
  text: string;
  questionType: DbAssignmentQuestion['question_type'];
  submittedAnswer: string;
  correctAnswer: string;
  result: ReportResult;
  score: number;
  maxScore: number;
  responseTimeMs: number | null;
  timeLimitSec: number;
  explanation: string | null;
  answerStatus: DbAttemptAnswer['status'] | 'not_answered';
}

export interface AttemptDetailDto {
  assignment: {
    id: number;
    title: string;
    reviewAvailable: boolean;
  };
  participant: {
    name: string;
    loginName: string;
    email: string | null;
  };
  attempt: AttemptReportRow;
  questions: AttemptQuestionDetail[];
}

interface LoadedReportData {
  assignment: ReportingAssignment;
  questions: DbAssignmentQuestion[];
  members: DbAssignmentMember[];
  attempts: DbAssignmentAttempt[];
  answers: DbAttemptAnswer[];
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function parseArray<T>(raw: string | null | undefined): T[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function ownsAssignment(actor: AssignmentActor, assignment: DbAssignment): boolean {
  return (
    actor.role === 'super_admin' ||
    (assignment.owner_kind === 'user' && assignment.owner_id === actor.id)
  );
}

async function loadOwnedReportData(
  database: Database,
  actor: AssignmentActor,
  assignmentId: number,
): Promise<LoadedReportData> {
  const assignment = await database.get<ReportingAssignment>(
    `SELECT a.*, q.title as quiz_title,
       (SELECT COUNT(*) FROM assignment_target_overrides o WHERE o.assignment_id = a.id) AS override_count
     FROM assignments a
     LEFT JOIN quizzes q ON q.id = a.quiz_id WHERE a.id = ?`,
    [assignmentId],
  );
  if (!assignment || !ownsAssignment(actor, assignment)) {
    throw new AssignmentServiceError('Assignment not found', 404);
  }
  const [questions, members, attempts, answers] = await Promise.all([
    database.all<DbAssignmentQuestion[]>(
      'SELECT * FROM assignment_questions WHERE assignment_id = ? ORDER BY order_index',
      [assignmentId],
    ),
    database.all<DbAssignmentMember[]>(
      'SELECT * FROM assignment_members WHERE assignment_id = ? ORDER BY display_name_snapshot',
      [assignmentId],
    ),
    database.all<DbAssignmentAttempt[]>(
      'SELECT * FROM assignment_attempts WHERE assignment_id = ? ORDER BY user_id, attempt_number',
      [assignmentId],
    ),
    database.all<DbAttemptAnswer[]>(
      `SELECT aa.* FROM attempt_answers aa
       JOIN assignment_attempts at ON at.id = aa.attempt_id
       WHERE at.assignment_id = ?`,
      [assignmentId],
    ),
  ]);
  return { assignment, questions, members, attempts, answers };
}

/** Select the one attempt used by aggregate metrics without hiding other attempts from admins. */
export function selectPrimaryAttempt(
  attempts: DbAssignmentAttempt[],
  policy: DbAssignment['result_policy'],
): DbAssignmentAttempt | null {
  if (attempts.length === 0) return null;
  const completed = attempts.filter((attempt) => attempt.status === 'completed');
  if (completed.length > 0) {
    if (policy === 'latest_completed') {
      return completed.reduce((latest, attempt) =>
        attempt.attempt_number > latest.attempt_number ? attempt : latest,
      );
    }
    return completed.reduce((best, attempt) => {
      if (attempt.total_score !== best.total_score) {
        return attempt.total_score > best.total_score ? attempt : best;
      }
      return attempt.attempt_number > best.attempt_number ? attempt : best;
    });
  }
  const inProgress = attempts.filter((attempt) => attempt.status === 'in_progress');
  const candidates = inProgress.length ? inProgress : attempts;
  return candidates.reduce((latest, attempt) =>
    attempt.attempt_number > latest.attempt_number ? attempt : latest,
  );
}

function answersByAttempt(answers: DbAttemptAnswer[]): Map<number, DbAttemptAnswer[]> {
  const grouped = new Map<number, DbAttemptAnswer[]>();
  for (const answer of answers) {
    const list = grouped.get(answer.attempt_id) ?? [];
    list.push(answer);
    grouped.set(answer.attempt_id, list);
  }
  return grouped;
}

function calculateAttemptMetrics(
  attempt: DbAssignmentAttempt,
  questions: DbAssignmentQuestion[],
  answers: DbAttemptAnswer[],
  isSelected: boolean,
): AttemptReportRow {
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const answered = answers.filter((answer) => answer.status === 'answered');
  const timedOut = answers.filter((answer) => answer.status === 'timed_out');
  const correct = answered.filter((answer) => answer.is_correct === 1).length;
  const incorrect = answered.filter((answer) => answer.is_correct === 0).length;
  const recordedQuestionIds = new Set(answers.map((answer) => answer.assignment_question_id));
  const missingFinalAnswers =
    attempt.status === 'completed' || attempt.status === 'expired'
      ? questions.filter((question) => !recordedQuestionIds.has(question.id)).length
      : 0;
  const activeAnsweringTimeMs = answers.reduce((sum, answer) => {
    if (answer.status === 'timed_out') {
      return sum + (questionById.get(answer.assignment_question_id)?.time_sec ?? 0) * 1000;
    }
    return sum + (answer.response_time_ms ?? 0);
  }, 0);
  const responseTimes = answered.flatMap((answer) =>
    answer.response_time_ms === null ? [] : [answer.response_time_ms],
  );
  const maxScore = questions.reduce((sum, question) => sum + question.base_score, 0);
  const score = answers.reduce((sum, answer) => sum + answer.score, 0);
  return {
    id: attempt.id,
    attemptNumber: attempt.attempt_number,
    status: attempt.status,
    isSelected,
    startedAtMs: attempt.started_at_ms,
    completedAtMs: attempt.completed_at_ms,
    correct,
    incorrect,
    noAnswer: timedOut.length + missingFinalAnswers,
    score,
    maxScore,
    scorePercent: maxScore > 0 ? round((score / maxScore) * 100) : 0,
    elapsedTimeMs:
      attempt.completed_at_ms === null ? null : attempt.completed_at_ms - attempt.started_at_ms,
    activeAnsweringTimeMs,
    averageResponseTimeMs: average(responseTimes),
  };
}

export function buildAssignmentReport(data: LoadedReportData): AssignmentReportDto {
  const { assignment, questions, members, attempts, answers } = data;
  const maxScore = questions.reduce((sum, question) => sum + question.base_score, 0);
  const groupedAnswers = answersByAttempt(answers);
  const attemptsByUser = new Map<number, DbAssignmentAttempt[]>();
  for (const attempt of attempts) {
    if (attempt.user_id === null) continue;
    const list = attemptsByUser.get(attempt.user_id) ?? [];
    list.push(attempt);
    attemptsByUser.set(attempt.user_id, list);
  }
  const selectedByMember = new Map<number, DbAssignmentAttempt | null>();
  const participants = members.map<ParticipantReportRow>((member) => {
    const memberAttempts =
      member.user_id === null ? [] : (attemptsByUser.get(member.user_id) ?? []);
    const selected = selectPrimaryAttempt(memberAttempts, assignment.result_policy);
    selectedByMember.set(member.id, selected);
    return {
      memberId: member.id,
      userId: member.user_id,
      name: member.display_name_snapshot,
      loginName: member.login_name_snapshot?.trim() || member.email_snapshot || '',
      email: member.email_snapshot || null,
      status: selected?.status ?? 'not_started',
      selectedAttemptId: selected?.id ?? null,
      attempts: [...memberAttempts]
        .sort((a, b) => b.attempt_number - a.attempt_number)
        .map((attempt) =>
          calculateAttemptMetrics(
            attempt,
            questions,
            groupedAnswers.get(attempt.id) ?? [],
            attempt.id === selected?.id,
          ),
        ),
    };
  });

  const primaryMetrics = participants.flatMap((participant) =>
    participant.attempts.filter((attempt) => attempt.isSelected),
  );
  const finalMetrics = primaryMetrics.filter(
    (attempt) => attempt.status === 'completed' || attempt.status === 'expired',
  );
  const averageScore = average(finalMetrics.map((attempt) => attempt.score)) ?? 0;
  const averageElapsed = average(
    finalMetrics.flatMap((attempt) =>
      attempt.elapsedTimeMs === null ? [] : [attempt.elapsedTimeMs],
    ),
  );
  const averageActive = average(finalMetrics.map((attempt) => attempt.activeAnsweringTimeMs));

  const answerMaps = new Map<number, Map<number, DbAttemptAnswer>>();
  for (const [attemptId, attemptAnswers] of groupedAnswers) {
    answerMaps.set(
      attemptId,
      new Map(attemptAnswers.map((answer) => [answer.assignment_question_id, answer])),
    );
  }
  const questionRows = questions.map<QuestionReportRow>((question, index) => {
    let sampleSize = 0;
    let answeredCount = 0;
    let correct = 0;
    let incorrect = 0;
    let noAnswer = 0;
    let scoreTotal = 0;
    const responseTimes: number[] = [];
    for (const member of members) {
      const selected = selectedByMember.get(member.id);
      const answer = selected ? answerMaps.get(selected.id)?.get(question.id) : undefined;
      if (answer?.status === 'answered') {
        sampleSize++;
        answeredCount++;
        scoreTotal += answer.score;
        if (answer.is_correct === 1) correct++;
        else incorrect++;
        if (answer.response_time_ms !== null) responseTimes.push(answer.response_time_ms);
      } else if (
        answer?.status === 'timed_out' ||
        (selected && (selected.status === 'completed' || selected.status === 'expired'))
      ) {
        sampleSize++;
        noAnswer++;
      }
    }
    return {
      questionId: question.id,
      questionNumber: index + 1,
      text: question.text,
      questionType: question.question_type,
      sampleSize,
      answered: answeredCount,
      correct,
      incorrect,
      noAnswer,
      correctRate: sampleSize > 0 ? round((correct / sampleSize) * 100) : 0,
      correctRateAmongAnswered: answeredCount > 0 ? round((correct / answeredCount) * 100) : null,
      averageScore: sampleSize > 0 ? round(scoreTotal / sampleSize) : 0,
      maxScore: question.base_score,
      averageResponseTimeMs: average(responseTimes),
      timeLimitSec: question.time_sec,
    };
  });

  const completed = participants.filter((participant) => participant.status === 'completed').length;
  return {
    assignment: {
      id: assignment.id,
      title: assignment.title,
      quizTitle: assignment.quiz_title,
      status: assignment.status,
      accessCode: assignment.access_code,
      opensAtMs: assignment.opens_at_ms,
      deadlineAtMs: assignment.deadline_at_ms,
      maxAttempts: assignment.max_attempts,
      resultPolicy: assignment.result_policy,
      reviewPolicy: assignment.review_policy,
      questionCount: questions.length,
      maxScore,
      assignmentKind: assignment.assignment_kind,
      targetMode: assignment.target_mode,
      targetLevelCode: assignment.target_level_code_snapshot,
      targetLevelName: assignment.target_level_name_snapshot,
      promotionTargetLevelCode: assignment.promotion_target_level_code_snapshot,
      promotionTargetLevelName: assignment.promotion_target_level_name_snapshot,
      overrideCount: assignment.override_count,
    },
    overview: {
      assigned: members.length,
      notStarted: participants.filter((participant) => participant.status === 'not_started').length,
      inProgress: participants.filter((participant) => participant.status === 'in_progress').length,
      completed,
      expired: participants.filter((participant) => participant.status === 'expired').length,
      completionRate: members.length > 0 ? round((completed / members.length) * 100) : 0,
      averageScore: round(averageScore),
      averageScorePercent: maxScore > 0 ? round((averageScore / maxScore) * 100) : 0,
      averageElapsedTimeMs: averageElapsed,
      averageActiveAnsweringTimeMs: averageActive,
    },
    participants,
    questions: questionRows.sort(
      (a, b) => a.correctRate - b.correctRate || a.questionNumber - b.questionNumber,
    ),
  };
}

function formatPoint(raw: string | null): string {
  try {
    const point = JSON.parse(raw ?? '') as { lat?: unknown; lng?: unknown };
    return typeof point.lat === 'number' && typeof point.lng === 'number'
      ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
      : '—';
  } catch {
    return '—';
  }
}

function formatSubmittedAnswer(
  question: DbAssignmentQuestion,
  answer: DbAttemptAnswer | undefined,
): string {
  if (!answer || answer.status === 'timed_out') return '—';
  const options = parseArray<string>(question.options);
  if (question.question_type === 'multiple_choice' || question.question_type === 'true_false') {
    return answer.chosen_index === null ? '—' : (options[answer.chosen_index] ?? '—');
  }
  if (question.question_type === 'multi_select' || question.question_type === 'ordering') {
    return parseArray<number>(answer.chosen_indices)
      .map((index) => options[index] ?? `#${index + 1}`)
      .join(' → ');
  }
  if (question.question_type === 'fill_blank') {
    return parseArray<string>(answer.chosen_text).join(' | ');
  }
  if (question.question_type === 'matching') {
    const matches = parseArray<string>(question.matches);
    return parseArray<number | null>(answer.chosen_indices)
      .map(
        (rightIndex, index) =>
          `${options[index] ?? `#${index + 1}`} → ${rightIndex === null ? '—' : (matches[rightIndex] ?? '—')}`,
      )
      .join(' | ');
  }
  if (question.question_type === 'geo') return formatPoint(answer.chosen_text);
  return answer.chosen_text ?? '—';
}

function formatCorrectAnswer(question: DbAssignmentQuestion): string {
  const options = parseArray<string>(question.options);
  if (question.question_type === 'multiple_choice' || question.question_type === 'true_false') {
    return options[question.correct_index] ?? '—';
  }
  if (question.question_type === 'multi_select') {
    return parseArray<number>(question.correct_indices)
      .map((index) => options[index] ?? `#${index + 1}`)
      .join(', ');
  }
  if (question.question_type === 'fill_blank') {
    return parseArray<string[]>(question.blanks)
      .map((accepted) => accepted.join(' / '))
      .join(' | ');
  }
  if (question.question_type === 'ordering') return options.join(' → ');
  if (question.question_type === 'matching') {
    const matches = parseArray<string>(question.matches);
    return options.map((left, index) => `${left} → ${matches[index] ?? '—'}`).join(' | ');
  }
  if (question.question_type === 'geo') return formatPoint(question.geo);
  return question.correct_answer ?? '—';
}

function resultFor(answer: DbAttemptAnswer | undefined): ReportResult {
  if (!answer || answer.status === 'timed_out') return 'no_answer';
  return answer.is_correct === 1 ? 'correct' : 'incorrect';
}

function buildAttemptDetail(
  assignment: ReportingAssignment,
  questions: DbAssignmentQuestion[],
  attempt: DbAssignmentAttempt,
  answers: DbAttemptAnswer[],
  reviewAvailable: boolean,
): AttemptDetailDto {
  const order = getAssignmentQuestionOrder(
    questions.length,
    assignment.id,
    attempt.id,
    assignment.shuffle_questions === 1,
  );
  const presentedQuestions = order.map((index) => questions[index]);
  const answerByQuestion = new Map(
    answers.map((answer) => [answer.assignment_question_id, answer]),
  );
  return {
    assignment: { id: assignment.id, title: assignment.title, reviewAvailable },
    participant: {
      name: attempt.participant_name,
      loginName: attempt.participant_login_name?.trim() || attempt.participant_email || '',
      email: attempt.participant_email || null,
    },
    attempt: calculateAttemptMetrics(attempt, questions, answers, true),
    questions: presentedQuestions.map((question, index) => {
      const answer = answerByQuestion.get(question.id);
      return {
        questionId: question.id,
        questionNumber: index + 1,
        text: question.text,
        questionType: question.question_type,
        submittedAnswer: formatSubmittedAnswer(question, answer),
        correctAnswer: formatCorrectAnswer(question),
        result: resultFor(answer),
        score: answer?.score ?? 0,
        maxScore: question.base_score,
        responseTimeMs: answer?.status === 'answered' ? answer.response_time_ms : null,
        timeLimitSec: question.time_sec,
        explanation: question.explanation ?? null,
        answerStatus: answer?.status ?? 'not_answered',
      };
    }),
  };
}

export async function getAssignmentReport(
  actor: AssignmentActor,
  assignmentId: number,
): Promise<AssignmentReportDto> {
  await reconcileAssignmentDeadlineForReport(actor, assignmentId);
  return buildAssignmentReport(await loadOwnedReportData(db, actor, assignmentId));
}

export async function getAdminAttemptDetail(
  actor: AssignmentActor,
  assignmentId: number,
  attemptId: number,
): Promise<AttemptDetailDto> {
  await reconcileAssignmentDeadlineForReport(actor, assignmentId);
  const data = await loadOwnedReportData(db, actor, assignmentId);
  const attempt = data.attempts.find((candidate) => candidate.id === attemptId);
  if (!attempt) throw new AssignmentServiceError('Attempt not found', 404);
  return buildAttemptDetail(
    data.assignment,
    data.questions,
    attempt,
    data.answers.filter((answer) => answer.attempt_id === attemptId),
    true,
  );
}

export async function getAdminQuestionDetail(
  actor: AssignmentActor,
  assignmentId: number,
  questionId: number,
): Promise<unknown> {
  await reconcileAssignmentDeadlineForReport(actor, assignmentId);
  const data = await loadOwnedReportData(db, actor, assignmentId);
  const questionIndex = data.questions.findIndex((question) => question.id === questionId);
  if (questionIndex < 0) throw new AssignmentServiceError('Question not found', 404);
  const question = data.questions[questionIndex];
  const groupedAnswers = answersByAttempt(data.answers);
  const attemptsByUser = new Map<number, DbAssignmentAttempt[]>();
  for (const attempt of data.attempts) {
    if (attempt.user_id === null) continue;
    const list = attemptsByUser.get(attempt.user_id) ?? [];
    list.push(attempt);
    attemptsByUser.set(attempt.user_id, list);
  }
  return {
    question: {
      id: question.id,
      questionNumber: questionIndex + 1,
      text: question.text,
      questionType: question.question_type,
      correctAnswer: formatCorrectAnswer(question),
      maxScore: question.base_score,
      timeLimitSec: question.time_sec,
      explanation: question.explanation ?? null,
    },
    participants: data.members.map((member) => {
      const selected = selectPrimaryAttempt(
        member.user_id === null ? [] : (attemptsByUser.get(member.user_id) ?? []),
        data.assignment.result_policy,
      );
      const answer = selected
        ? groupedAnswers
            .get(selected.id)
            ?.find((candidate) => candidate.assignment_question_id === question.id)
        : undefined;
      return {
        memberId: member.id,
        name: member.display_name_snapshot,
        loginName: member.login_name_snapshot?.trim() || member.email_snapshot || '',
        email: member.email_snapshot || null,
        attemptId: selected?.id ?? null,
        attemptNumber: selected?.attempt_number ?? null,
        attemptStatus: selected?.status ?? 'not_started',
        submittedAnswer: formatSubmittedAnswer(question, answer),
        result: resultFor(answer),
        responseTimeMs: answer?.status === 'answered' ? answer.response_time_ms : null,
        score: answer?.score ?? 0,
      };
    }),
  };
}

function reviewIsAvailable(assignment: DbAssignment, nowMs: number): boolean {
  if (assignment.status === 'closed') return true;
  return (
    assignment.review_policy === 'after_deadline' &&
    assignment.deadline_at_ms !== null &&
    nowMs >= assignment.deadline_at_ms
  );
}

export async function getParticipantAttemptReview(
  attemptId: number,
  userId: number,
  nowMs = Date.now(),
): Promise<AttemptDetailDto> {
  let attempt = await db.get<DbAssignmentAttempt>(
    'SELECT * FROM assignment_attempts WHERE id = ? AND user_id = ?',
    [attemptId, userId],
  );
  if (!attempt) throw new AssignmentServiceError('Attempt not found', 404);
  const assignment = await db.get<ReportingAssignment>(
    `SELECT a.*, q.title as quiz_title FROM assignments a
     LEFT JOIN quizzes q ON q.id = a.quiz_id WHERE a.id = ?`,
    [attempt.assignment_id],
  );
  if (!assignment) throw new AssignmentServiceError('Assignment not found', 404);
  if (!reviewIsAvailable(assignment, nowMs)) {
    throw new AssignmentServiceError('Review is not available yet', 403);
  }
  await getParticipantAttemptState(attemptId, userId, nowMs);
  attempt = (await db.get<DbAssignmentAttempt>(
    'SELECT * FROM assignment_attempts WHERE id = ? AND user_id = ?',
    [attemptId, userId],
  )) as DbAssignmentAttempt;
  const [questions, answers] = await Promise.all([
    db.all<DbAssignmentQuestion[]>(
      'SELECT * FROM assignment_questions WHERE assignment_id = ? ORDER BY order_index',
      [assignment.id],
    ),
    db.all<DbAttemptAnswer[]>('SELECT * FROM attempt_answers WHERE attempt_id = ?', [attemptId]),
  ]);
  return buildAttemptDetail(assignment, questions, attempt, answers, true);
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvDate(value: number | null): string {
  return value === null ? '' : new Date(value).toISOString();
}

function resultLabel(result: ReportResult): string {
  if (result === 'correct') return 'Correct';
  if (result === 'incorrect') return 'Incorrect';
  return 'No answer';
}

export async function buildAssignmentCsv(
  actor: AssignmentActor,
  assignmentId: number,
): Promise<{ body: string; filename: string }> {
  await reconcileAssignmentDeadlineForReport(actor, assignmentId);
  const data = await loadOwnedReportData(db, actor, assignmentId);
  const groupedAnswers = answersByAttempt(data.answers);
  const attemptsByUser = new Map<number, DbAssignmentAttempt[]>();
  for (const attempt of data.attempts) {
    if (attempt.user_id === null) continue;
    const list = attemptsByUser.get(attempt.user_id) ?? [];
    list.push(attempt);
    attemptsByUser.set(attempt.user_id, list);
  }
  const headers = [
    'Assignment',
    'Login name',
    'Participant name',
    'Email',
    'Attempt number',
    'Attempt status',
    'Started at',
    'Completed at',
    'Elapsed seconds',
    'Active answering seconds',
    'Question number',
    'Question text',
    'Question type',
    'Submitted answer',
    'Correct answer',
    'Result',
    'Response time ms',
    'Response time seconds',
    'Time limit seconds',
    'Question score',
    'Question max score',
    'Attempt total score',
    'Attempt max score',
    'Attempt score percent',
  ];
  const rows: unknown[][] = [headers];
  for (const member of data.members) {
    const memberAttempts =
      member.user_id === null ? [] : (attemptsByUser.get(member.user_id) ?? []);
    const exportAttempts: Array<DbAssignmentAttempt | null> = memberAttempts.length
      ? [...memberAttempts].sort((a, b) => a.attempt_number - b.attempt_number)
      : [null];
    for (const attempt of exportAttempts) {
      const attemptAnswers = attempt ? (groupedAnswers.get(attempt.id) ?? []) : [];
      const answerMap = new Map(
        attemptAnswers.map((answer) => [answer.assignment_question_id, answer]),
      );
      const metrics = attempt
        ? calculateAttemptMetrics(attempt, data.questions, attemptAnswers, false)
        : null;
      const questionOrder = attempt
        ? getAssignmentQuestionOrder(
            data.questions.length,
            data.assignment.id,
            attempt.id,
            data.assignment.shuffle_questions === 1,
          )
        : data.questions.map((_, index) => index);
      questionOrder.forEach((questionIndex, displayIndex) => {
        const question = data.questions[questionIndex];
        const answer = answerMap.get(question.id);
        rows.push([
          data.assignment.title,
          member.login_name_snapshot?.trim() || member.email_snapshot || '',
          member.display_name_snapshot,
          member.email_snapshot,
          attempt?.attempt_number ?? '',
          attempt?.status ?? 'not_started',
          csvDate(attempt?.started_at_ms ?? null),
          csvDate(attempt?.completed_at_ms ?? null),
          metrics?.elapsedTimeMs === null || metrics?.elapsedTimeMs === undefined
            ? ''
            : round(metrics.elapsedTimeMs / 1000),
          metrics ? round(metrics.activeAnsweringTimeMs / 1000) : 0,
          displayIndex + 1,
          question.text,
          question.question_type,
          formatSubmittedAnswer(question, answer),
          formatCorrectAnswer(question),
          resultLabel(resultFor(answer)),
          answer?.status === 'answered' ? (answer.response_time_ms ?? '') : '',
          answer?.status === 'answered' && answer.response_time_ms !== null
            ? round(answer.response_time_ms / 1000)
            : '',
          question.time_sec,
          answer?.score ?? 0,
          question.base_score,
          metrics?.score ?? 0,
          metrics?.maxScore ?? data.questions.reduce((sum, item) => sum + item.base_score, 0),
          metrics?.scorePercent ?? 0,
        ]);
      });
    }
  }
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
  const slug = data.assignment.title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('đ', 'd')
    .replaceAll('Đ', 'D')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  const filenameDate = new Date(data.assignment.deadline_at_ms ?? Date.now())
    .toISOString()
    .slice(0, 10);
  return {
    body: `\uFEFF${csv}\r\n`,
    filename: `TiL_Quiz_${slug || `Assignment_${data.assignment.id}`}_${filenameDate}.csv`,
  };
}
