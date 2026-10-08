import crypto from 'node:crypto';
import type { Database } from 'sqlite';
import { db } from './db';
import {
  MIN_QUESTION_TIME_SECONDS,
  resolveEffectiveQuestionTime,
  type EffectiveQuestionTimeSource,
} from './questionTiming';
import { withImmediateTransaction } from './transactions';
import type {
  DbAssignment,
  DbBankQuestion,
  DbQuiz,
  DbQuizGenerationRule,
  JwtPayload,
  QuestionType,
  QuizGenerationRuleInput,
} from './types';

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

export class QuestionGenerationError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface NormalizedGenerationRule {
  categoryId: number | null;
  minimumLevelId: number | null;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  questionType: QuestionType | null;
  critical: number | null;
  questionCount: number;
  pointsOverride: number | null;
  recommendedSecondsOverride: number | null;
  sortOrder: number;
}

export interface BankSelectionCandidate extends DbBankQuestion {
  category_code: string;
  category_name: string;
  minimum_level_code: string;
}

export interface SelectedBankQuestion {
  rule: DbQuizGenerationRule;
  question: BankSelectionCandidate;
  orderIndex: number;
  effectiveScore: number;
  effectiveTimeSec: number;
  effectiveTimeSource: EffectiveQuestionTimeSource;
}

export interface PoolRuleStatus {
  ruleId: number;
  requiredCount: number;
  availableCount: number;
  status: 'ok' | 'insufficient';
}

export interface ResolvedQuestionSelection {
  seed: string;
  poolFingerprint: string;
  selectionFingerprint: string;
  blueprintRevision: number;
  rules: PoolRuleStatus[];
  selected: SelectedBankQuestion[];
  totalQuestions: number;
  totalScore: number;
  recommendedTotalSeconds: number;
}

function integer(value: unknown, label: string, minimum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new QuestionGenerationError(`${label} is invalid`);
  }
  return value as number;
}

function nullableInteger(value: unknown, label: string, minimum: number): number | null {
  if (value === undefined || value === null) return null;
  return integer(value, label, minimum);
}

export function normalizeGenerationRules(
  rules: QuizGenerationRuleInput[] | undefined,
): NormalizedGenerationRule[] {
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new QuestionGenerationError('A bank-generated quiz needs at least one generation rule');
  }
  return rules.map((rule, index) => {
    const difficulty = rule.difficulty ?? null;
    if (difficulty !== null && !['easy', 'medium', 'hard'].includes(difficulty)) {
      throw new QuestionGenerationError(`Rule ${index + 1} has an invalid difficulty`);
    }
    const questionType = rule.questionType ?? null;
    if (questionType !== null && !QUESTION_TYPES.has(questionType)) {
      throw new QuestionGenerationError(`Rule ${index + 1} has an invalid question type`);
    }
    return {
      categoryId: nullableInteger(rule.categoryId, 'categoryId', 1),
      minimumLevelId: nullableInteger(rule.minimumLevelId, 'minimumLevelId', 1),
      difficulty,
      questionType,
      critical:
        rule.critical === undefined || rule.critical === null ? null : rule.critical ? 1 : 0,
      questionCount: integer(rule.questionCount, 'questionCount', 1),
      pointsOverride: nullableInteger(rule.pointsOverride, 'pointsOverride', 0),
      recommendedSecondsOverride: nullableInteger(
        rule.recommendedSecondsOverride,
        'recommendedSecondsOverride',
        MIN_QUESTION_TIME_SECONDS,
      ),
      sortOrder: rule.sortOrder === undefined ? index : integer(rule.sortOrder, 'sortOrder', 0),
    };
  });
}

function dimensionIntersects<T>(left: T | null, right: T | null): boolean {
  return left === null || right === null || left === right;
}

function rulesOverlap(left: NormalizedGenerationRule, right: NormalizedGenerationRule): boolean {
  return (
    dimensionIntersects(left.categoryId, right.categoryId) &&
    dimensionIntersects(left.minimumLevelId, right.minimumLevelId) &&
    dimensionIntersects(left.difficulty, right.difficulty) &&
    dimensionIntersects(left.questionType, right.questionType) &&
    dimensionIntersects(left.critical, right.critical)
  );
}

export async function validateGenerationRuleSet(
  database: Database,
  rules: NormalizedGenerationRule[],
): Promise<void> {
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (rule.categoryId !== null) {
      const category = await database.get<{ is_active: number }>(
        'SELECT is_active FROM question_categories WHERE id = ?',
        [rule.categoryId],
      );
      if (!category) throw new QuestionGenerationError(`Rule ${index + 1} category does not exist`);
      if (category.is_active !== 1) {
        throw new QuestionGenerationError(
          `Rule ${index + 1} category is inactive`,
          409,
          'QUESTION_CATEGORY_INACTIVE',
        );
      }
    }
    if (rule.minimumLevelId !== null) {
      const level = await database.get<{ is_active: number }>(
        'SELECT is_active FROM employee_levels WHERE id = ?',
        [rule.minimumLevelId],
      );
      if (!level) throw new QuestionGenerationError(`Rule ${index + 1} level does not exist`);
      if (level.is_active !== 1) {
        throw new QuestionGenerationError(
          `Rule ${index + 1} level is inactive`,
          409,
          'LEVEL_INACTIVE',
        );
      }
    }
    for (let other = 0; other < index; other += 1) {
      if (rulesOverlap(rule, rules[other])) {
        throw new QuestionGenerationError(
          `Generation rules ${other + 1} and ${index + 1} overlap`,
          409,
          'QUESTION_RULES_OVERLAP',
          { ruleIndexes: [other, index] },
        );
      }
    }
  }
}

export async function insertGenerationRules(
  database: Database,
  quizId: number,
  rules: NormalizedGenerationRule[],
): Promise<void> {
  await validateGenerationRuleSet(database, rules);
  const now = Date.now();
  for (const rule of rules) {
    await database.run(
      `INSERT INTO quiz_generation_rules (
         quiz_id, category_id, minimum_level_id, difficulty, question_type, critical,
         question_count, points_override, recommended_seconds_override, sort_order,
         created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      quizId,
      rule.categoryId,
      rule.minimumLevelId,
      rule.difficulty,
      rule.questionType,
      rule.critical,
      rule.questionCount,
      rule.pointsOverride,
      rule.recommendedSecondsOverride,
      rule.sortOrder,
      now,
      now,
    );
  }
}

function toNormalizedRule(rule: DbQuizGenerationRule): NormalizedGenerationRule {
  return {
    categoryId: rule.category_id,
    minimumLevelId: rule.minimum_level_id,
    difficulty: rule.difficulty,
    questionType: rule.question_type,
    critical: rule.critical,
    questionCount: rule.question_count,
    pointsOverride: rule.points_override,
    recommendedSecondsOverride: rule.recommended_seconds_override,
    sortOrder: rule.sort_order,
  };
}

async function loadRules(database: Database, quizId: number): Promise<DbQuizGenerationRule[]> {
  const rules = await database.all<DbQuizGenerationRule[]>(
    'SELECT * FROM quiz_generation_rules WHERE quiz_id = ? ORDER BY sort_order, id',
    [quizId],
  );
  if (rules.length === 0) {
    throw new QuestionGenerationError(
      'Dynamic quiz has no generation rules',
      409,
      'QUESTION_RULES_MISSING',
    );
  }
  await validateGenerationRuleSet(database, rules.map(toNormalizedRule));
  return rules;
}

async function candidatesForRule(
  database: Database,
  rule: DbQuizGenerationRule,
): Promise<BankSelectionCandidate[]> {
  const where = ['bq.is_enabled = 1', 'qc.is_active = 1'];
  const values: unknown[] = [];
  for (const [column, value] of [
    ['bq.category_id', rule.category_id],
    ['bq.minimum_level_id', rule.minimum_level_id],
    ['bq.difficulty', rule.difficulty],
    ['bq.question_type', rule.question_type],
    ['bq.critical', rule.critical],
  ] as const) {
    if (value !== null) {
      where.push(`${column} = ?`);
      values.push(value);
    }
  }
  return database.all<BankSelectionCandidate[]>(
    `SELECT bq.*, qc.code AS category_code, qc.name AS category_name,
            el.code AS minimum_level_code
     FROM bank_questions bq
     JOIN question_categories qc ON qc.id = bq.category_id
     JOIN employee_levels el ON el.id = bq.minimum_level_id
     WHERE ${where.join(' AND ')}
     ORDER BY bq.id`,
    values,
  );
}

function hash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function candidateRank(
  seed: string,
  quizId: number,
  ruleId: number,
  candidate: BankSelectionCandidate,
): string {
  return crypto
    .createHash('sha256')
    .update(`${seed}|${quizId}|${ruleId}|${candidate.id}|${candidate.revision}`)
    .digest('hex');
}

export async function resolveQuestionSelection(
  database: Database,
  quizId: number,
  seed: string,
): Promise<ResolvedQuestionSelection> {
  const quiz = await database.get<DbQuiz>('SELECT * FROM quizzes WHERE id = ?', [quizId]);
  if (!quiz || quiz.quiz_mode !== 'bank_generated') {
    throw new QuestionGenerationError('Bank-generated quiz not found', 404);
  }
  if (quiz.selection_mode !== 'per_assignment') {
    throw new QuestionGenerationError(
      'Only per-assignment question selection is supported',
      409,
      'QUESTION_SELECTION_MODE_UNSUPPORTED',
    );
  }
  const rules = await loadRules(database, quizId);
  const pools: Array<{ rule: DbQuizGenerationRule; candidates: BankSelectionCandidate[] }> = [];
  const statuses: PoolRuleStatus[] = [];
  for (const rule of rules) {
    const candidates = await candidatesForRule(database, rule);
    pools.push({ rule, candidates });
    statuses.push({
      ruleId: rule.id,
      requiredCount: rule.question_count,
      availableCount: candidates.length,
      status: candidates.length >= rule.question_count ? 'ok' : 'insufficient',
    });
  }
  const poolFingerprint = hash({
    quiz: [quiz.id, quiz.quiz_mode, quiz.selection_mode, quiz.blueprint_revision],
    rules: rules.map((rule) => [
      rule.id,
      rule.category_id,
      rule.minimum_level_id,
      rule.difficulty,
      rule.question_type,
      rule.critical,
      rule.question_count,
      rule.points_override,
      rule.recommended_seconds_override,
      rule.sort_order,
    ]),
    pools: pools.map(({ rule, candidates }) => [
      rule.id,
      candidates.map((candidate) => [
        candidate.id,
        candidate.revision,
        candidate.category_id,
        candidate.category_code,
        candidate.category_name,
        candidate.minimum_level_id,
        candidate.difficulty,
        candidate.question_type,
        candidate.critical,
      ]),
    ]),
  });
  const insufficient = statuses.filter((status) => status.status === 'insufficient');
  if (insufficient.length > 0) {
    throw new QuestionGenerationError(
      'One or more generation rules do not have enough questions',
      409,
      'QUESTION_POOL_INSUFFICIENT',
      { rules: statuses, poolFingerprint },
    );
  }

  const selected: SelectedBankQuestion[] = [];
  const used = new Set<number>();
  for (const { rule, candidates } of pools) {
    const ranked = candidates
      .map((candidate) => ({
        candidate,
        rank: candidateRank(seed, quizId, rule.id, candidate),
      }))
      .sort((left, right) =>
        left.rank === right.rank
          ? left.candidate.id - right.candidate.id
          : left.rank.localeCompare(right.rank),
      );
    for (const { candidate } of ranked.slice(0, rule.question_count)) {
      if (used.has(candidate.id)) {
        throw new QuestionGenerationError(
          'Generation rules selected a duplicate question',
          409,
          'QUESTION_SELECTION_DUPLICATE',
        );
      }
      used.add(candidate.id);
      const effectiveTime = resolveEffectiveQuestionTime(
        candidate,
        rule.recommended_seconds_override,
      );
      selected.push({
        rule,
        question: candidate,
        orderIndex: selected.length,
        effectiveScore: rule.points_override ?? candidate.base_score,
        effectiveTimeSec: effectiveTime.seconds,
        effectiveTimeSource: effectiveTime.source,
      });
    }
  }
  const selectionFingerprint = hash({
    seed,
    poolFingerprint,
    selected: selected.map((item) => [
      item.orderIndex,
      item.rule.id,
      item.question.id,
      item.question.revision,
      item.effectiveScore,
      item.effectiveTimeSec,
    ]),
  });
  return {
    seed,
    poolFingerprint,
    selectionFingerprint,
    blueprintRevision: quiz.blueprint_revision,
    rules: statuses,
    selected,
    totalQuestions: selected.length,
    totalScore: selected.reduce((sum, item) => sum + item.effectiveScore, 0),
    recommendedTotalSeconds: selected.reduce((sum, item) => sum + item.effectiveTimeSec, 0),
  };
}

export async function validateQuestionPool(quizId: number): Promise<{
  rules: PoolRuleStatus[];
  poolFingerprint?: string;
}> {
  try {
    const resolved = await resolveQuestionSelection(db, quizId, 'pool-validation');
    return { rules: resolved.rules, poolFingerprint: resolved.poolFingerprint };
  } catch (error) {
    if (error instanceof QuestionGenerationError && error.code === 'QUESTION_POOL_INSUFFICIENT') {
      const details = error.details as { rules: PoolRuleStatus[]; poolFingerprint: string };
      return { rules: details.rules, poolFingerprint: details.poolFingerprint };
    }
    throw error;
  }
}

export async function createAssignmentQuestionPreview(
  actor: Pick<JwtPayload, 'id' | 'role'>,
  assignmentId: number,
): Promise<ResolvedQuestionSelection> {
  if (actor.role !== 'super_admin') {
    throw new QuestionGenerationError('Question preview requires super administrator access', 403);
  }
  return withImmediateTransaction(async (database) => {
    const assignment = await database.get<DbAssignment>('SELECT * FROM assignments WHERE id = ?', [
      assignmentId,
    ]);
    if (!assignment || assignment.status !== 'draft' || !assignment.quiz_id) {
      throw new QuestionGenerationError('Draft assignment not found', 404);
    }
    const seed = crypto.randomBytes(16).toString('hex');
    const resolved = await resolveQuestionSelection(database, assignment.quiz_id, seed);
    await database.run('DELETE FROM assignment_question_previews WHERE assignment_id = ?', [
      assignmentId,
    ]);
    const preview = await database.run(
      `INSERT INTO assignment_question_previews (
         assignment_id, quiz_id, blueprint_revision, generation_seed, pool_fingerprint,
         selection_fingerprint, total_questions, total_score, recommended_total_seconds,
         created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      assignmentId,
      assignment.quiz_id,
      resolved.blueprintRevision,
      resolved.seed,
      resolved.poolFingerprint,
      resolved.selectionFingerprint,
      resolved.totalQuestions,
      resolved.totalScore,
      resolved.recommendedTotalSeconds,
      Date.now(),
    );
    for (const item of resolved.selected) {
      await database.run(
        `INSERT INTO assignment_question_preview_items (
           preview_id, order_index, rule_id, bank_question_id, bank_question_revision,
           effective_score, effective_time_sec
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        preview.lastID,
        item.orderIndex,
        item.rule.id,
        item.question.id,
        item.question.revision,
        item.effectiveScore,
        item.effectiveTimeSec,
      );
    }
    return resolved;
  });
}

export async function verifyAssignmentQuestionPreview(
  database: Database,
  assignment: DbAssignment,
  suppliedFingerprint: string | undefined,
): Promise<ResolvedQuestionSelection> {
  const preview = await database.get<{
    quiz_id: number;
    generation_seed: string;
    pool_fingerprint: string;
    selection_fingerprint: string;
  }>('SELECT * FROM assignment_question_previews WHERE assignment_id = ?', [assignment.id]);
  if (!preview || !suppliedFingerprint) {
    throw new QuestionGenerationError(
      'An approved question preview is required before publishing',
      409,
      'QUESTION_PREVIEW_REQUIRED',
    );
  }
  if (preview.quiz_id !== assignment.quiz_id) {
    throw new QuestionGenerationError(
      'Assignment quiz changed after preview',
      409,
      'QUESTION_POOL_CHANGED',
    );
  }
  const resolved = await resolveQuestionSelection(
    database,
    preview.quiz_id,
    preview.generation_seed,
  );
  if (resolved.poolFingerprint !== preview.pool_fingerprint) {
    throw new QuestionGenerationError(
      'Question pool changed after preview',
      409,
      'QUESTION_POOL_CHANGED',
      { preview: { rules: resolved.rules, poolFingerprint: resolved.poolFingerprint } },
    );
  }
  if (
    suppliedFingerprint !== preview.selection_fingerprint ||
    resolved.selectionFingerprint !== preview.selection_fingerprint
  ) {
    throw new QuestionGenerationError(
      'Question selection changed after preview',
      409,
      'QUESTION_SELECTION_CHANGED',
    );
  }
  const storedItems = await database.all<
    Array<{
      order_index: number;
      rule_id: number;
      bank_question_id: number;
      bank_question_revision: number;
      effective_score: number;
      effective_time_sec: number;
    }>
  >(
    `SELECT order_index, rule_id, bank_question_id, bank_question_revision,
            effective_score, effective_time_sec
     FROM assignment_question_preview_items
     WHERE preview_id = (SELECT id FROM assignment_question_previews WHERE assignment_id = ?)
     ORDER BY order_index`,
    [assignment.id],
  );
  const recomputed = resolved.selected.map((item) => [
    item.orderIndex,
    item.rule.id,
    item.question.id,
    item.question.revision,
    item.effectiveScore,
    item.effectiveTimeSec,
  ]);
  const stored = storedItems.map((item) => [
    item.order_index,
    item.rule_id,
    item.bank_question_id,
    item.bank_question_revision,
    item.effective_score,
    item.effective_time_sec,
  ]);
  if (JSON.stringify(stored) !== JSON.stringify(recomputed)) {
    throw new QuestionGenerationError(
      'Stored question preview no longer matches the deterministic selection',
      409,
      'QUESTION_SELECTION_CHANGED',
    );
  }
  return resolved;
}
