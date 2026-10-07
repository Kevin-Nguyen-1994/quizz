import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from './db';
import {
  normalizeQuestionContent,
  type StoredQuestionContent,
  storedQuestionValues,
} from './questionContent';
import { CS_V2_TOPIC_CATEGORY } from './questionBankCatalog';
import { withImmediateTransaction } from './transactions';
import type { QuestionCompetency, QuestionDifficulty, QuizQuestion } from './types';

interface SourceOption {
  id: string;
  text: string;
}

interface SourceQuestion {
  id: string;
  minimum_level: string;
  topic: string | null;
  competency: { code: QuestionCompetency; label_vi?: string };
  type: 'single_choice' | 'multiple_choice' | 'fill_blank' | 'ordering' | 'true_false';
  difficulty: { code: QuestionDifficulty; label_vi?: string };
  critical: boolean;
  prompt: string;
  options: SourceOption[];
  answer: {
    correct_option_id?: string;
    correct_option_ids?: string[];
    correct_order?: string[];
    accepted_answers?: string[];
    normalization?: unknown;
  };
  explanation: string | null;
  legal: unknown;
  timing: { recommended_seconds: number; enforced_per_question: boolean };
  presentation: unknown;
  scoring: { points: number };
}

interface SourceBank {
  schema_version: string;
  bank_id: string;
  bank_version: string;
  language?: string;
  source_file?: string;
  question_count: number;
  questions: SourceQuestion[];
}

export interface QuestionBankImportResult {
  dryRun: boolean;
  bankId: string;
  bankVersion: string;
  schemaVersion: string;
  sourceHash: string;
  questionCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  conflictCount: number;
  errorCount: number;
  categories: Record<string, number>;
  levels: Record<string, number>;
  types: Record<string, number>;
  difficulties: Record<string, number>;
  conflicts: Array<{ sourceQuestionId: string; existingRevision: number }>;
}

export class QuestionBankImportError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function validateSourceQuestion(question: SourceQuestion, seen: Set<string>): void {
  if (!question.id || seen.has(question.id)) {
    throw new QuestionBankImportError(`Duplicate or missing source question id: ${question.id}`);
  }
  seen.add(question.id);
  if (question.minimum_level !== 'CS1' && question.minimum_level !== 'CS2') {
    throw new QuestionBankImportError(`${question.id}: unsupported minimum_level`);
  }
  if (!question.topic?.trim() || !CS_V2_TOPIC_CATEGORY.has(question.topic)) {
    throw new QuestionBankImportError(`${question.id}: topic has no approved category mapping`);
  }
  if (!['easy', 'medium', 'hard'].includes(question.difficulty?.code)) {
    throw new QuestionBankImportError(`${question.id}: invalid difficulty`);
  }
  if (
    !['must_remember', 'know_where_to_lookup', 'application'].includes(question.competency?.code)
  ) {
    throw new QuestionBankImportError(`${question.id}: invalid competency`);
  }
  if (!question.prompt?.trim()) throw new QuestionBankImportError(`${question.id}: empty prompt`);
  if (
    !Number.isInteger(question.timing?.recommended_seconds) ||
    question.timing.recommended_seconds < 1
  ) {
    throw new QuestionBankImportError(`${question.id}: invalid recommended_seconds`);
  }
  if (!Number.isFinite(question.scoring?.points) || question.scoring.points < 0) {
    throw new QuestionBankImportError(`${question.id}: invalid source points`);
  }
  const optionIds = question.options.map((option) => option.id);
  if (
    new Set(optionIds).size !== optionIds.length ||
    question.options.some((option) => !option.id || !option.text?.trim())
  ) {
    throw new QuestionBankImportError(`${question.id}: invalid options`);
  }
  if (
    (question.type === 'single_choice' || question.type === 'true_false') &&
    !optionIds.includes(question.answer.correct_option_id ?? '')
  ) {
    throw new QuestionBankImportError(`${question.id}: invalid correct_option_id`);
  }
  if (question.type === 'multiple_choice') {
    const correct = question.answer.correct_option_ids;
    if (
      !Array.isArray(correct) ||
      correct.length === 0 ||
      new Set(correct).size !== correct.length ||
      correct.some((id) => !optionIds.includes(id))
    ) {
      throw new QuestionBankImportError(`${question.id}: invalid correct_option_ids`);
    }
  }
  if (question.type === 'ordering') {
    const order = question.answer.correct_order;
    if (
      !Array.isArray(order) ||
      order.length !== optionIds.length ||
      new Set(order).size !== optionIds.length ||
      order.some((id) => !optionIds.includes(id))
    ) {
      throw new QuestionBankImportError(`${question.id}: invalid correct_order`);
    }
  }
  if (
    question.type === 'fill_blank' &&
    (!Array.isArray(question.answer.accepted_answers) ||
      question.answer.accepted_answers.some((answer) => !answer?.trim()))
  ) {
    throw new QuestionBankImportError(`${question.id}: invalid accepted_answers`);
  }
}

function adaptQuestion(question: SourceQuestion): QuizQuestion {
  const optionById = new Map(question.options.map((option) => [option.id, option.text]));
  const base = {
    text: question.prompt,
    baseScore: Math.round(question.scoring.points * 500),
    timeSec: question.timing.recommended_seconds,
    explanation: question.explanation ?? undefined,
    tags: [],
  };
  if (question.type === 'single_choice' || question.type === 'true_false') {
    const options = question.options.map((option) => option.text);
    return {
      ...base,
      questionType: question.type === 'single_choice' ? 'multiple_choice' : 'true_false',
      options,
      correctIndex: question.options.findIndex(
        (option) => option.id === question.answer.correct_option_id,
      ),
    };
  }
  if (question.type === 'multiple_choice') {
    const correctIds = new Set(question.answer.correct_option_ids);
    return {
      ...base,
      questionType: 'multi_select',
      options: question.options.map((option) => option.text),
      correctIndex: 0,
      correctIndices: question.options
        .map((option, index) => (correctIds.has(option.id) ? index : -1))
        .filter((index) => index >= 0),
    };
  }
  if (question.type === 'fill_blank') {
    return {
      ...base,
      questionType: 'fill_blank',
      options: [],
      correctIndex: 0,
      blanks: [question.answer.accepted_answers ?? []],
    };
  }
  const correctOrder = question.answer.correct_order ?? [];
  return {
    ...base,
    questionType: 'ordering',
    options: correctOrder.map((id) => optionById.get(id) as string),
    correctIndex: 0,
  };
}

function sourceMetadata(question: SourceQuestion): string {
  return JSON.stringify({
    legal: question.legal,
    presentation: question.presentation,
    sourcePoints: question.scoring.points,
    sourceType: question.type,
    timing: {
      enforcedPerQuestion: question.timing.enforced_per_question,
      normalization: question.answer.normalization ?? null,
    },
  });
}

export async function readSourceQuestionBank(filename: string): Promise<{
  bank: SourceBank;
  sourceHash: string;
  sourceFilename: string;
}> {
  const raw = await fs.readFile(filename);
  let bank: SourceBank;
  try {
    bank = JSON.parse(raw.toString('utf8')) as SourceBank;
  } catch {
    throw new QuestionBankImportError('Question Bank source is not valid JSON');
  }
  if (
    !bank.bank_id ||
    !bank.bank_version ||
    !bank.schema_version ||
    !Array.isArray(bank.questions)
  ) {
    throw new QuestionBankImportError('Question Bank header is incomplete');
  }
  if (bank.question_count !== bank.questions.length) {
    throw new QuestionBankImportError('Declared question_count does not match the source array');
  }
  const seen = new Set<string>();
  bank.questions.forEach((question) => {
    validateSourceQuestion(question, seen);
  });
  return { bank, sourceHash: sha256(raw), sourceFilename: path.basename(filename) };
}

export async function importSourceQuestionBank(
  filename: string,
  options: { dryRun?: boolean; applyUpdates?: boolean } = {},
): Promise<QuestionBankImportResult> {
  const { bank, sourceHash, sourceFilename } = await readSourceQuestionBank(filename);
  const categories = await db.all<Array<{ id: number; code: string }>>(
    'SELECT id, code FROM question_categories',
  );
  const levels = await db.all<Array<{ id: number; code: string }>>(
    'SELECT id, code FROM employee_levels',
  );
  const categoryByCode = new Map(categories.map((category) => [category.code, category.id]));
  const levelByCode = new Map(levels.map((level) => [level.code, level.id]));
  const result: QuestionBankImportResult = {
    dryRun: options.dryRun === true,
    bankId: bank.bank_id,
    bankVersion: bank.bank_version,
    schemaVersion: bank.schema_version,
    sourceHash,
    questionCount: bank.questions.length,
    insertedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    conflictCount: 0,
    errorCount: 0,
    categories: {},
    levels: {},
    types: {},
    difficulties: {},
    conflicts: [],
  };

  const prepared: Array<{
    source: SourceQuestion;
    categoryId: number;
    levelId: number;
    content: StoredQuestionContent;
    contentHash: string;
    existing: { id: number; source_content_hash: string; revision: number } | undefined;
    metadata: string;
  }> = [];
  for (const source of bank.questions) {
    const categoryCode = CS_V2_TOPIC_CATEGORY.get(source.topic as string) as string;
    const categoryId = categoryByCode.get(categoryCode);
    const levelId = levelByCode.get(source.minimum_level);
    if (!categoryId || !levelId) {
      throw new QuestionBankImportError(`${source.id}: category or employee level is missing`);
    }
    const content = normalizeQuestionContent(adaptQuestion(source));
    const contentHash = sha256(JSON.stringify(source));
    const existing = await db.get<{ id: number; source_content_hash: string; revision: number }>(
      `SELECT id, source_content_hash, revision FROM bank_questions
       WHERE source_bank_id = ? AND source_question_id = ?`,
      [bank.bank_id, source.id],
    );
    if (!existing) result.insertedCount += 1;
    else if (existing.source_content_hash === contentHash) result.skippedCount += 1;
    else if (options.applyUpdates) result.updatedCount += 1;
    else {
      result.conflictCount += 1;
      result.conflicts.push({ sourceQuestionId: source.id, existingRevision: existing.revision });
    }
    increment(result.categories, categoryCode);
    increment(result.levels, source.minimum_level);
    increment(result.types, content.question_type);
    increment(result.difficulties, source.difficulty.code);
    prepared.push({
      source,
      categoryId,
      levelId,
      content,
      contentHash,
      existing,
      metadata: sourceMetadata(source),
    });
  }

  if (options.dryRun) return result;
  if (result.conflictCount > 0) {
    throw new QuestionBankImportError(
      'Import contains changed source questions; rerun with explicit update confirmation',
      result,
    );
  }

  const completed = await db.get<{ id: number }>(
    `SELECT id FROM question_bank_imports
     WHERE bank_id = ? AND bank_version = ? AND source_hash = ?`,
    [bank.bank_id, bank.bank_version, sourceHash],
  );
  if (completed && result.insertedCount === 0 && result.updatedCount === 0) return result;

  await withImmediateTransaction(async (database) => {
    const now = Date.now();
    const importRow = await database.run(
      `INSERT INTO question_bank_imports (
         bank_id, bank_version, schema_version, source_hash, source_filename, imported_at_ms,
         inserted_count, updated_count, skipped_count, conflict_count, error_count, summary_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      bank.bank_id,
      bank.bank_version,
      bank.schema_version,
      sourceHash,
      sourceFilename,
      now,
      result.insertedCount,
      result.updatedCount,
      result.skippedCount,
      JSON.stringify({
        questionCount: result.questionCount,
        categories: result.categories,
        levels: result.levels,
        types: result.types,
        difficulties: result.difficulties,
      }),
    );
    const importId = Number(importRow.lastID);
    for (const item of prepared) {
      if (!item.existing) {
        await database.run(
          `INSERT INTO bank_questions (
             source_bank_id, source_question_id, source_bank_version, source_content_hash,
             last_import_id, text, options, correct_index, correct_indices, base_score, time_sec,
             image_url, explanation, range_min, range_max, question_type, correct_answer,
             media_url, media_type, blanks, geo, matches, tags, category_id, topic,
             minimum_level_id, difficulty, competency_code, critical, recommended_seconds,
             source_metadata_json, is_enabled, revision, created_at_ms, updated_at_ms
           ) VALUES (${Array.from({ length: 35 }, () => '?').join(', ')})`,
          bank.bank_id,
          item.source.id,
          bank.bank_version,
          item.contentHash,
          importId,
          ...storedQuestionValues(item.content),
          item.categoryId,
          item.source.topic,
          item.levelId,
          item.source.difficulty.code,
          item.source.competency.code,
          item.source.critical ? 1 : 0,
          item.source.timing.recommended_seconds,
          item.metadata,
          1,
          1,
          now,
          now,
        );
      } else if (item.existing.source_content_hash !== item.contentHash && options.applyUpdates) {
        await database.run(
          `UPDATE bank_questions SET
             source_bank_version = ?, source_content_hash = ?, last_import_id = ?,
             text = ?, options = ?, correct_index = ?, correct_indices = ?, base_score = ?,
             time_sec = ?, image_url = ?, explanation = ?, range_min = ?, range_max = ?,
             question_type = ?, correct_answer = ?, media_url = ?, media_type = ?, blanks = ?,
             geo = ?, matches = ?, tags = ?, category_id = ?, topic = ?, minimum_level_id = ?,
             difficulty = ?, competency_code = ?, critical = ?, recommended_seconds = ?,
             source_metadata_json = ?, revision = revision + 1, updated_at_ms = ?
           WHERE id = ?`,
          bank.bank_version,
          item.contentHash,
          importId,
          ...storedQuestionValues(item.content),
          item.categoryId,
          item.source.topic,
          item.levelId,
          item.source.difficulty.code,
          item.source.competency.code,
          item.source.critical ? 1 : 0,
          item.source.timing.recommended_seconds,
          item.metadata,
          now,
          item.existing.id,
        );
      } else {
        await database.run(
          `UPDATE bank_questions
           SET source_bank_version = ?, last_import_id = ?
           WHERE id = ?`,
          bank.bank_version,
          importId,
          item.existing.id,
        );
      }
    }
  });
  return result;
}
