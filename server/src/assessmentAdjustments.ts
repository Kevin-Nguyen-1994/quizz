import { db } from './db';
import { AssignmentServiceError } from './assignmentService';
import type {
  AdjustmentReasonCode,
  AdjustmentScope,
  AdjustmentSource,
  DbAssignmentAnswerAdjustment,
  DbAssignmentAttempt,
  DbAssignmentQuestion,
  DbAttemptAnswer,
  JwtPayload,
} from './types';

export interface EffectiveAnswerResult {
  attemptId: number;
  assignmentQuestionId: number;
  originalStatus: 'answered' | 'timed_out' | 'not_answered';
  originalIsCorrect: number | null;
  originalScore: number;
  effectiveIsCorrect: number | null;
  effectiveScore: number;
  isAdjusted: boolean;
  adjustmentId: number | null;
  adjustmentBatchId: number | null;
}

export interface AdjustmentTarget {
  attemptId: number;
  adjustedIsCorrect: boolean | null;
  adjustedScore: number;
}

export interface ApplyAdjustmentInput {
  assignmentId: number;
  assignmentQuestionId: number;
  scope: AdjustmentScope;
  reasonCode: AdjustmentReasonCode;
  reasonText: string;
  source: AdjustmentSource;
  adjudicationPayload?: unknown;
  targets: AdjustmentTarget[];
  /** Leaf adjustment ids seen by the preview.  Prevents a stale screen branching history. */
  expectedCurrentAdjustmentIds?: Record<string, number | null>;
  supersedesBatchId?: number | null;
  /** When supplied, resolving this appeal is part of the same transaction. */
  appealId?: number;
}

export interface AcceptedVariantPreview {
  attemptId: number;
  adjustmentId: number | null;
}

function normalizedSubmittedText(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) value = parsed.join(' ');
  } catch {
    // Some question types persist a single plain-text response.
  }
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi-VN') || null;
}

function acceptedVariants(payload: unknown): Set<string> {
  if (!payload || typeof payload !== 'object') return new Set();
  const values = (payload as { acceptedVariants?: unknown }).acceptedVariants;
  if (!Array.isArray(values)) return new Set();
  return new Set(values.filter((value): value is string => typeof value === 'string').map((value) => normalizedSubmittedText(value)).filter((value): value is string => Boolean(value)));
}

export function effectiveResultKey(attemptId: number, assignmentQuestionId: number): string {
  return `${attemptId}:${assignmentQuestionId}`;
}

function actorName(actor: JwtPayload): string {
  return actor.username?.trim() || (actor.role === 'super_admin' ? 'Super admin' : `User #${actor.id}`);
}

export function effectiveAttemptScore(attempt: DbAssignmentAttempt): number {
  return attempt.effective_total_score ?? attempt.total_score;
}

export function effectiveAttemptCorrectCount(attempt: DbAssignmentAttempt): number {
  return attempt.effective_correct_count ?? attempt.correct_count;
}

/**
 * Loads only terminal adjustment records.  A leaf is authoritative because
 * every subsequent adjudication points at the prior leaf via supersedes id.
 */
export async function loadEffectiveAdjustmentMap(
  attemptIds: number[],
): Promise<Map<string, DbAssignmentAnswerAdjustment>> {
  if (!attemptIds.length) return new Map();
  const placeholders = attemptIds.map(() => '?').join(',');
  const rows = await db.all<DbAssignmentAnswerAdjustment[]>(
    `SELECT aa.* FROM assignment_answer_adjustments aa
     WHERE aa.attempt_id IN (${placeholders})
       AND NOT EXISTS (
         SELECT 1 FROM assignment_answer_adjustments successor
         WHERE successor.supersedes_adjustment_id = aa.id
       )`,
    attemptIds,
  );
  const result = new Map<string, DbAssignmentAnswerAdjustment>();
  for (const row of rows) result.set(effectiveResultKey(row.attempt_id, row.assignment_question_id), row);
  return result;
}

export function resolveEffectiveAnswerResult(
  attemptId: number,
  questionId: number,
  answer: DbAttemptAnswer | undefined,
  adjustment: DbAssignmentAnswerAdjustment | undefined,
): EffectiveAnswerResult {
  const originalStatus = answer?.status ?? 'not_answered';
  const originalIsCorrect = answer?.is_correct ?? null;
  const originalScore = answer?.score ?? 0;
  return {
    attemptId,
    assignmentQuestionId: questionId,
    originalStatus,
    originalIsCorrect,
    originalScore,
    effectiveIsCorrect: adjustment?.adjusted_is_correct ?? originalIsCorrect,
    effectiveScore: adjustment?.adjusted_score ?? originalScore,
    isAdjusted: Boolean(adjustment),
    adjustmentId: adjustment?.id ?? null,
    adjustmentBatchId: adjustment?.batch_id ?? null,
  };
}

export async function effectiveResultsForAttempts(
  attempts: DbAssignmentAttempt[],
  answers: DbAttemptAnswer[],
  questions: DbAssignmentQuestion[],
): Promise<Map<string, EffectiveAnswerResult>> {
  const adjustments = await loadEffectiveAdjustmentMap(attempts.map((attempt) => attempt.id));
  const answersByKey = new Map(
    answers.map((answer) => [effectiveResultKey(answer.attempt_id, answer.assignment_question_id), answer]),
  );
  const results = new Map<string, EffectiveAnswerResult>();
  for (const attempt of attempts) {
    for (const question of questions) {
      const resultKey = effectiveResultKey(attempt.id, question.id);
      results.set(
        resultKey,
        resolveEffectiveAnswerResult(
          attempt.id,
          question.id,
          answersByKey.get(resultKey),
          adjustments.get(resultKey),
        ),
      );
    }
  }
  return results;
}

/** Only answered responses matching a newly accepted textual variant qualify. */
export async function previewAcceptedVariantTargets(
  assignmentId: number,
  assignmentQuestionId: number,
  adjudicationPayload: unknown,
): Promise<AcceptedVariantPreview[]> {
  const variants = acceptedVariants(adjudicationPayload);
  if (!variants.size) throw new AssignmentServiceError('At least one accepted answer variant is required');
  const rows = await db.all<DbAttemptAnswer[]>(
    `SELECT aa.* FROM attempt_answers aa
     JOIN assignment_attempts at ON at.id = aa.attempt_id
     WHERE at.assignment_id = ? AND aa.assignment_question_id = ?
       AND at.status IN ('completed','expired') AND aa.status = 'answered'`,
    [assignmentId, assignmentQuestionId],
  );
  const current = await loadEffectiveAdjustmentMap(rows.map((row) => row.attempt_id));
  return rows
    .filter((row) => variants.has(normalizedSubmittedText(row.chosen_text) ?? ''))
    .map((row) => ({
      attemptId: row.attempt_id,
      adjustmentId: current.get(effectiveResultKey(row.attempt_id, assignmentQuestionId))?.id ?? null,
    }));
}

async function assertOwnedAssignment(actor: JwtPayload, assignmentId: number): Promise<void> {
  const assignment = await db.get<{ owner_kind: string; owner_id: number | null }>(
    'SELECT owner_kind, owner_id FROM assignments WHERE id = ?',
    [assignmentId],
  );
  if (!assignment || (actor.role !== 'super_admin' && !(assignment.owner_kind === 'user' && assignment.owner_id === actor.id))) {
    throw new AssignmentServiceError('Assignment not found', 404);
  }
}

async function assertNoActiveAttempt(assignmentId: number): Promise<void> {
  const active = await db.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM assignment_attempts WHERE assignment_id = ? AND status = 'in_progress'",
    [assignmentId],
  );
  if ((active?.count ?? 0) > 0) {
    throw new AssignmentServiceError(
      'Cannot regrade while an attempt is in progress',
      409,
      'ASSIGNMENT_REGRADING_BLOCKED_ACTIVE_ATTEMPTS',
    );
  }
}

async function recomputeEffectiveAttempt(attemptId: number): Promise<void> {
  const attempt = await db.get<DbAssignmentAttempt>('SELECT * FROM assignment_attempts WHERE id = ?', [attemptId]);
  if (!attempt) throw new AssignmentServiceError('Attempt not found', 404);
  const questions = await db.all<DbAssignmentQuestion[]>(
    'SELECT * FROM assignment_questions WHERE assignment_id = ? ORDER BY order_index',
    [attempt.assignment_id],
  );
  const answers = await db.all<DbAttemptAnswer[]>('SELECT * FROM attempt_answers WHERE attempt_id = ?', [attemptId]);
  const results = await effectiveResultsForAttempts([attempt], answers, questions);
  let score = 0;
  let correct = 0;
  for (const question of questions) {
    const result = results.get(effectiveResultKey(attemptId, question.id));
    if (!result) continue;
    score += result.effectiveScore;
    if (result.effectiveIsCorrect === 1) correct++;
  }
  await db.run(
    'UPDATE assignment_attempts SET effective_total_score = ?, effective_correct_count = ?, results_adjusted_at_ms = ? WHERE id = ?',
    [score, correct, Date.now(), attemptId],
  );
}

/** Applies a pre-previewed adjustment atomically. Original answers/caches are never modified. */
export async function applyResultAdjustment(
  actor: JwtPayload,
  input: ApplyAdjustmentInput,
): Promise<{ batchId: number; affectedAttemptIds: number[] }> {
  const reasonText = input.reasonText.trim();
  if (!reasonText) throw new AssignmentServiceError('Adjustment reason is required');
  if (!input.targets.length) throw new AssignmentServiceError('At least one adjustment target is required');
  await db.run('BEGIN IMMEDIATE');
  try {
    await assertOwnedAssignment(actor, input.assignmentId);
    await assertNoActiveAttempt(input.assignmentId);
    const question = await db.get<DbAssignmentQuestion>(
      'SELECT * FROM assignment_questions WHERE id = ? AND assignment_id = ?',
      [input.assignmentQuestionId, input.assignmentId],
    );
    if (!question) throw new AssignmentServiceError('Question not found', 404);
    const linkedAppeal = input.appealId === undefined ? undefined : await db.get<{ id: number; attempt_id: number; status: string }>(
      'SELECT id, attempt_id, status FROM assignment_answer_appeals WHERE id = ? AND assignment_id = ? AND assignment_question_id = ?',
      [input.appealId, input.assignmentId, input.assignmentQuestionId],
    );
    if (input.appealId !== undefined && (!linkedAppeal || linkedAppeal.status === 'resolved')) {
      throw new AssignmentServiceError('Appeal already resolved', 409, 'APPEAL_ALREADY_RESOLVED');
    }
    if (input.scope === 'individual' && input.targets.length !== 1) {
      throw new AssignmentServiceError('Individual adjustment requires exactly one target');
    }
    let targets = input.targets;
    if (input.scope === 'question_regrade' && input.reasonCode === 'MISSING_ACCEPTED_ANSWER') {
      const accepted = await previewAcceptedVariantTargets(
        input.assignmentId,
        input.assignmentQuestionId,
        input.adjudicationPayload,
      );
      targets = accepted.map((target) => ({
        attemptId: target.attemptId,
        adjustedIsCorrect: true,
        adjustedScore: question.base_score,
      }));
      if (!targets.length) throw new AssignmentServiceError('No answered response matches the accepted variants');
    }
    if (input.scope === 'full_credit_all') {
      const eligibleAttempts = await db.all<DbAssignmentAttempt[]>(
        "SELECT * FROM assignment_attempts WHERE assignment_id = ? AND status IN ('completed','expired')",
        [input.assignmentId],
      );
      targets = eligibleAttempts.map((attempt) => ({
        attemptId: attempt.id,
        adjustedIsCorrect: true,
        adjustedScore: question.base_score,
      }));
      if (!targets.length) throw new AssignmentServiceError('No completed or expired attempts to regrade');
    }
    const targetIds = [...new Set(targets.map((target) => target.attemptId))];
    if (linkedAppeal && !targetIds.includes(linkedAppeal.attempt_id)) {
      throw new AssignmentServiceError('Linked appeal attempt must be included in the adjustment');
    }
    const placeholders = targetIds.map(() => '?').join(',');
    const attempts = await db.all<DbAssignmentAttempt[]>(
      `SELECT * FROM assignment_attempts WHERE assignment_id = ? AND id IN (${placeholders})`,
      [input.assignmentId, ...targetIds],
    );
    if (attempts.length !== targetIds.length) throw new AssignmentServiceError('Invalid adjustment target');
    const answers = await db.all<DbAttemptAnswer[]>(
      `SELECT * FROM attempt_answers WHERE assignment_question_id = ? AND attempt_id IN (${placeholders})`,
      [input.assignmentQuestionId, ...targetIds],
    );
    const answerByAttempt = new Map(answers.map((answer) => [answer.attempt_id, answer]));
    const current = await loadEffectiveAdjustmentMap(targetIds);
    const batch = await db.run(
      `INSERT INTO assignment_answer_adjustment_batches
       (assignment_id,assignment_question_id,scope,reason_code,reason_text,source,adjudication_payload_json,actor_id,actor_role,actor_name_snapshot,created_at_ms,supersedes_batch_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.assignmentId,
        input.assignmentQuestionId,
        input.scope,
        input.reasonCode,
        reasonText,
        input.source,
        input.adjudicationPayload === undefined ? null : JSON.stringify(input.adjudicationPayload),
        actor.id,
        actor.role,
        actorName(actor),
        Date.now(),
        input.supersedesBatchId ?? null,
      ],
    );
    const batchId = Number(batch.lastID);
    for (const target of targets) {
      if (!Number.isInteger(target.adjustedScore) || target.adjustedScore < 0 || target.adjustedScore > question.base_score) {
        throw new AssignmentServiceError('Invalid adjusted score');
      }
      const resultKey = effectiveResultKey(target.attemptId, input.assignmentQuestionId);
      const answer = answerByAttempt.get(target.attemptId);
      const previous = current.get(resultKey);
      const expected = input.expectedCurrentAdjustmentIds?.[String(target.attemptId)];
      if ((expected ?? null) !== (previous?.id ?? null)) {
        throw new AssignmentServiceError('Adjustment state has changed; refresh the preview', 409, 'ADJUSTMENT_STALE_PREVIEW');
      }
      const attempt = attempts.find((candidate) => candidate.id === target.attemptId) as DbAssignmentAttempt;
      const originalStatus = answer?.status ?? 'not_answered';
      const originalIsCorrect = answer?.is_correct ?? null;
      const originalScore = answer?.score ?? 0;
      const beforeIsCorrect = previous?.adjusted_is_correct ?? originalIsCorrect;
      const beforeScore = previous?.adjusted_score ?? originalScore;
      const inserted = await db.run(
        `INSERT INTO assignment_answer_adjustments
         (batch_id,assignment_id,assignment_question_id,attempt_id,answer_id,user_id,original_status,original_is_correct,original_score,before_effective_is_correct,before_effective_score,adjusted_is_correct,adjusted_score,supersedes_adjustment_id,created_at_ms)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [batchId,input.assignmentId,input.assignmentQuestionId,target.attemptId,answer?.id ?? null,attempt.user_id,originalStatus,originalIsCorrect,originalScore,beforeIsCorrect,beforeScore,target.adjustedIsCorrect === null ? null : Number(target.adjustedIsCorrect),target.adjustedScore,previous?.id ?? null,Date.now()],
      );
      // SQLite's single writer transaction plus leaf check prevents concurrent branches.
      if (previous) {
        const children = await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM assignment_answer_adjustments WHERE supersedes_adjustment_id = ?', [previous.id]);
        if ((children?.count ?? 0) !== 1) throw new AssignmentServiceError('Adjustment history conflict', 409, 'ADJUSTMENT_HISTORY_CONFLICT');
      }
      if (!inserted.lastID) throw new AssignmentServiceError('Could not create adjustment');
    }
    for (const attemptId of targetIds) await recomputeEffectiveAttempt(attemptId);
    if (linkedAppeal) {
      const now = Date.now();
      const resolved = await db.run(
        `UPDATE assignment_answer_appeals
         SET status = 'resolved', resolution_outcome = 'adjusted', linked_adjustment_batch_id = ?,
             resolved_at_ms = ?, updated_at_ms = ?, resolved_by_actor_id = ?, resolved_by_actor_role = ?, resolved_by_actor_name_snapshot = ?
         WHERE id = ? AND status IN ('pending','in_review')`,
        [batchId, now, now, actor.id, actor.role, actorName(actor), linkedAppeal.id],
      );
      if (resolved.changes !== 1) throw new AssignmentServiceError('Appeal already resolved', 409, 'APPEAL_ALREADY_RESOLVED');
    }
    await db.run('COMMIT');
    return { batchId, affectedAttemptIds: targetIds };
  } catch (error) {
    await db.run('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
