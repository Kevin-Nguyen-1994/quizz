import crypto from 'node:crypto';
import { type Request, type Response, Router } from 'express';
import { db } from '../db';
import {
  normalizeQuestionContent,
  QuestionContentError,
  storedQuestionValues,
} from '../questionContent';
import { getRequestUser, requireSuperAdmin } from '../middleware';
import { planSmartMix, SmartMixPlanError, type SmartMixRequest } from '../smartMix';
import { MIN_QUESTION_TIME_SECONDS } from '../questionTiming';
import { withImmediateTransaction } from '../transactions';
import type {
  DbBankQuestion,
  QuestionCompetency,
  QuestionDifficulty,
  QuizQuestion,
} from '../types';

export const questionBankRouter = Router();
questionBankRouter.use(requireSuperAdmin);

interface BankQuestionPayload extends QuizQuestion {
  categoryId: number;
  topic: string;
  minimumLevelId: number;
  difficulty?: QuestionDifficulty | null;
  competencyCode?: QuestionCompetency | null;
  critical?: boolean;
  recommendedSeconds?: number | null;
  isEnabled?: boolean;
  sourceMetadata?: unknown;
}

function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new QuestionContentError('Invalid id');
  return id;
}

function parseBankQuestion(row: DbBankQuestion): unknown {
  return {
    ...row,
    options: JSON.parse(row.options),
    correct_indices: row.correct_indices ? JSON.parse(row.correct_indices) : null,
    blanks: row.blanks ? JSON.parse(row.blanks) : null,
    geo: row.geo ? JSON.parse(row.geo) : null,
    matches: row.matches ? JSON.parse(row.matches) : null,
    tags: row.tags ? JSON.parse(row.tags) : null,
    source_metadata: JSON.parse(row.source_metadata_json),
  };
}

async function validateMetadata(database: typeof db, payload: BankQuestionPayload): Promise<void> {
  if (!Number.isInteger(payload.categoryId) || payload.categoryId < 1) {
    throw new QuestionContentError('categoryId is invalid');
  }
  if (!Number.isInteger(payload.minimumLevelId) || payload.minimumLevelId < 1) {
    throw new QuestionContentError('minimumLevelId is invalid');
  }
  if (!payload.topic?.trim()) throw new QuestionContentError('topic is required');
  if (payload.difficulty && !['easy', 'medium', 'hard'].includes(payload.difficulty)) {
    throw new QuestionContentError('difficulty is invalid');
  }
  if (
    payload.competencyCode &&
    !['must_remember', 'know_where_to_lookup', 'application'].includes(payload.competencyCode)
  ) {
    throw new QuestionContentError('competencyCode is invalid');
  }
  if (
    payload.recommendedSeconds !== undefined &&
    payload.recommendedSeconds !== null &&
    (!Number.isInteger(payload.recommendedSeconds) || payload.recommendedSeconds < 1)
  ) {
    throw new QuestionContentError('recommendedSeconds is invalid');
  }
  const sourceMetadata = payload.sourceMetadata;
  if (sourceMetadata && typeof sourceMetadata === 'object' && !Array.isArray(sourceMetadata)) {
    const runtime = (sourceMetadata as Record<string, unknown>).runtime;
    if (runtime && typeof runtime === 'object' && !Array.isArray(runtime)) {
      const override = (runtime as Record<string, unknown>).time_seconds_override;
      if (
        override !== undefined &&
        (!Number.isInteger(override) || (override as number) < MIN_QUESTION_TIME_SECONDS)
      ) {
        throw new QuestionContentError(
          `Question time override must be at least ${MIN_QUESTION_TIME_SECONDS} seconds`,
        );
      }
    }
  }
  const category = await database.get<{ is_active: number }>(
    'SELECT is_active FROM question_categories WHERE id = ?',
    [payload.categoryId],
  );
  if (!category) throw new QuestionContentError('Category not found');
  const level = await database.get<{ id: number }>('SELECT id FROM employee_levels WHERE id = ?', [
    payload.minimumLevelId,
  ]);
  if (!level) throw new QuestionContentError('Employee level not found');
}

function metadataValues(payload: BankQuestionPayload): unknown[] {
  return [
    payload.categoryId,
    payload.topic.trim(),
    payload.minimumLevelId,
    payload.difficulty ?? null,
    payload.competencyCode ?? null,
    payload.critical ? 1 : 0,
    payload.recommendedSeconds ?? null,
    JSON.stringify(payload.sourceMetadata ?? {}),
    payload.isEnabled === false ? 0 : 1,
  ];
}

function handleError(error: unknown, res: Response): void {
  if (error instanceof QuestionContentError) {
    res.status(400).json({ error: error.message });
    return;
  }
  throw error;
}

questionBankRouter.get('/categories', async (_req, res) => {
  res.json({
    categories: await db.all(
      `SELECT qc.*,
         (SELECT COUNT(*) FROM bank_questions bq WHERE bq.category_id = qc.id) AS question_count
       FROM question_categories qc ORDER BY qc.sort_order, qc.id`,
    ),
  });
});

questionBankRouter.post('/categories', async (req, res) => {
  try {
    const body = req.body as { code?: string; name?: string; sortOrder?: number };
    const code = body.code?.trim().toUpperCase();
    const name = body.name?.trim();
    if (!code || !/^[A-Z0-9_]+$/.test(code) || !name) {
      throw new QuestionContentError('A valid code and name are required');
    }
    const now = Date.now();
    const result = await db.run(
      `INSERT INTO question_categories
         (code, name, sort_order, is_active, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, 1, ?, ?)`,
      code,
      name,
      Number.isInteger(body.sortOrder) ? body.sortOrder : 0,
      now,
      now,
    );
    res.status(201).json({ id: result.lastID });
  } catch (error) {
    handleError(error, res);
  }
});

questionBankRouter.put('/categories/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const body = req.body as { name?: string; sortOrder?: number; isActive?: boolean };
    const category = await db.get<{ name: string; sort_order: number; is_active: number }>(
      'SELECT name, sort_order, is_active FROM question_categories WHERE id = ?',
      [id],
    );
    if (!category) return res.status(404).json({ error: 'Category not found' });
    const name = body.name === undefined ? category.name : body.name.trim();
    if (!name) throw new QuestionContentError('Category name is required');
    await db.run(
      `UPDATE question_categories SET name = ?, sort_order = ?, is_active = ?, updated_at_ms = ?
       WHERE id = ?`,
      name,
      body.sortOrder === undefined ? category.sort_order : body.sortOrder,
      body.isActive === undefined ? category.is_active : body.isActive ? 1 : 0,
      Date.now(),
      id,
    );
    res.json({ ok: true });
  } catch (error) {
    handleError(error, res);
  }
});

questionBankRouter.get('/imports', async (_req, res) => {
  res.json({
    imports: await db.all(
      'SELECT * FROM question_bank_imports ORDER BY imported_at_ms DESC, id DESC',
    ),
  });
});

questionBankRouter.post('/smart-mix/plan', async (req, res) => {
  try {
    const body = req.body as SmartMixRequest;
    const categoryIds = [...new Set(body.categoryIds ?? [])];
    const levelIds = [...new Set((body.levelMix ?? []).map((item) => item.minimumLevelId))];
    if (
      categoryIds.length === 0 ||
      levelIds.length === 0 ||
      [...categoryIds, ...levelIds].some((id) => !Number.isInteger(id) || id < 1)
    ) {
      throw new SmartMixPlanError(
        'Nhóm nghiệp vụ hoặc bậc câu hỏi không hợp lệ.',
        'SMART_MIX_INVALID',
      );
    }
    const categoryPlaceholders = categoryIds.map(() => '?').join(', ');
    const levelPlaceholders = levelIds.map(() => '?').join(', ');
    const [categories, levels, counts] = await Promise.all([
      db.all<Array<{ id: number; name: string; is_active: number }>>(
        `SELECT id, name, is_active FROM question_categories
         WHERE id IN (${categoryPlaceholders})`,
        categoryIds,
      ),
      db.all<Array<{ id: number; code: string; is_active: number }>>(
        `SELECT id, code, is_active FROM employee_levels WHERE id IN (${levelPlaceholders})`,
        levelIds,
      ),
      db.all<
        Array<{
          category_id: number;
          minimum_level_id: number;
          critical: number;
          available_count: number;
        }>
      >(
        `SELECT bq.category_id, bq.minimum_level_id, bq.critical,
                COUNT(*) AS available_count
         FROM bank_questions bq
         JOIN question_categories qc ON qc.id = bq.category_id
         WHERE bq.is_enabled = 1 AND qc.is_active = 1
           AND bq.category_id IN (${categoryPlaceholders})
           AND bq.minimum_level_id IN (${levelPlaceholders})
         GROUP BY bq.category_id, bq.minimum_level_id, bq.critical`,
        [...categoryIds, ...levelIds],
      ),
    ]);
    if (
      categories.length !== categoryIds.length ||
      categories.some((item) => item.is_active !== 1)
    ) {
      throw new SmartMixPlanError(
        'Một hoặc nhiều nhóm nghiệp vụ không tồn tại hoặc đã ngừng sử dụng.',
        'SMART_MIX_CATEGORY_INACTIVE',
      );
    }
    if (levels.length !== levelIds.length || levels.some((item) => item.is_active !== 1)) {
      throw new SmartMixPlanError(
        'Một hoặc nhiều bậc nhân viên không tồn tại hoặc đã ngừng sử dụng.',
        'SMART_MIX_LEVEL_INACTIVE',
      );
    }
    const countMap = new Map(
      counts.map((item) => [
        `${item.category_id}:${item.minimum_level_id}:${item.critical}`,
        item.available_count,
      ]),
    );
    const capacities = categories.flatMap((category) =>
      levels.flatMap((level) =>
        [false, true].map((critical) => ({
          categoryId: category.id,
          categoryName: category.name,
          minimumLevelId: level.id,
          minimumLevelCode: level.code,
          critical,
          availableCount:
            countMap.get(`${category.id}:${level.id}:${critical ? 1 : 0}`) ?? 0,
        })),
      ),
    );
    res.json({ plan: planSmartMix(body, capacities) });
  } catch (error) {
    if (error instanceof SmartMixPlanError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
        details: error.details,
      });
    }
    throw error;
  }
});

questionBankRouter.get('/questions', async (req, res) => {
  const where: string[] = ['1 = 1'];
  const values: unknown[] = [];
  const filters: Array<[string, unknown]> = [
    ['bq.category_id', req.query.categoryId],
    ['bq.minimum_level_id', req.query.minimumLevelId],
    ['bq.difficulty', req.query.difficulty],
    ['bq.question_type', req.query.questionType],
    ['bq.critical', req.query.critical],
    ['bq.is_enabled', req.query.isEnabled],
  ];
  for (const [column, value] of filters) {
    if (value !== undefined && value !== '') {
      where.push(`${column} = ?`);
      values.push(value);
    }
  }
  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    where.push('(bq.text LIKE ? OR bq.topic LIKE ? OR bq.source_question_id LIKE ?)');
    const term = `%${req.query.search.trim()}%`;
    values.push(term, term, term);
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const questions = await db.all(
    `SELECT bq.id, bq.source_bank_id, bq.source_question_id, bq.question_type, bq.text,
            bq.topic, bq.difficulty, bq.competency_code, bq.critical, bq.is_enabled,
            bq.revision, bq.updated_at_ms, bq.category_id, bq.minimum_level_id,
            qc.code AS category_code, qc.name AS category_name, el.code AS minimum_level_code
     FROM bank_questions bq
     JOIN question_categories qc ON qc.id = bq.category_id
     JOIN employee_levels el ON el.id = bq.minimum_level_id
     WHERE ${where.join(' AND ')}
     ORDER BY bq.updated_at_ms DESC, bq.id DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset],
  );
  const count = await db.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM bank_questions bq WHERE ${where.join(' AND ')}`,
    values,
  );
  res.json({ questions, total: count?.count ?? 0, limit, offset });
});

questionBankRouter.get('/questions/:id', async (req, res) => {
  try {
    const row = await db.get<DbBankQuestion>('SELECT * FROM bank_questions WHERE id = ?', [
      parseId(req.params.id),
    ]);
    if (!row) return res.status(404).json({ error: 'Bank Question not found' });
    res.json({ question: parseBankQuestion(row) });
  } catch (error) {
    handleError(error, res);
  }
});

questionBankRouter.post('/questions', async (req: Request, res: Response) => {
  try {
    const payload = req.body as BankQuestionPayload;
    const content = normalizeQuestionContent(payload);
    const actor = getRequestUser(req);
    const id = await withImmediateTransaction(async (database) => {
      await validateMetadata(database, payload);
      const now = Date.now();
      const sourceQuestionId = crypto.randomUUID();
      const contentHash = crypto
        .createHash('sha256')
        .update(JSON.stringify({ content, metadata: metadataValues(payload) }))
        .digest('hex');
      const result = await database.run(
        `INSERT INTO bank_questions (
           source_bank_id, source_question_id, source_bank_version, source_content_hash,
           text, options, correct_index, correct_indices, base_score, time_sec, image_url,
           explanation, range_min, range_max, question_type, correct_answer, media_url,
           media_type, blanks, geo, matches, tags, category_id, topic, minimum_level_id,
           difficulty, competency_code, critical, recommended_seconds, source_metadata_json,
           is_enabled, revision, created_at_ms, updated_at_ms
         ) VALUES (${Array.from({ length: 34 }, () => '?').join(', ')})`,
        'til-manual',
        sourceQuestionId,
        'manual',
        contentHash,
        ...storedQuestionValues(content),
        ...metadataValues({
          ...payload,
          sourceMetadata: { ...(payload.sourceMetadata as object), createdBy: actor?.username },
        }),
        1,
        now,
        now,
      );
      return Number(result.lastID);
    });
    res.status(201).json({ id });
  } catch (error) {
    handleError(error, res);
  }
});

questionBankRouter.put('/questions/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const payload = req.body as BankQuestionPayload;
    const content = normalizeQuestionContent(payload);
    await withImmediateTransaction(async (database) => {
      const existing = await database.get<{ id: number }>(
        'SELECT id FROM bank_questions WHERE id = ?',
        [id],
      );
      if (!existing) throw new QuestionContentError('Bank Question not found');
      await validateMetadata(database, payload);
      const contentHash = crypto
        .createHash('sha256')
        .update(JSON.stringify({ content, metadata: metadataValues(payload) }))
        .digest('hex');
      await database.run(
        `UPDATE bank_questions SET
           text = ?, options = ?, correct_index = ?, correct_indices = ?, base_score = ?,
           time_sec = ?, image_url = ?, explanation = ?, range_min = ?, range_max = ?,
           question_type = ?, correct_answer = ?, media_url = ?, media_type = ?, blanks = ?,
           geo = ?, matches = ?, tags = ?, category_id = ?, topic = ?, minimum_level_id = ?,
           difficulty = ?, competency_code = ?, critical = ?, recommended_seconds = ?,
           source_metadata_json = ?, is_enabled = ?, source_content_hash = ?,
           revision = revision + 1, updated_at_ms = ? WHERE id = ?`,
        ...storedQuestionValues(content),
        ...metadataValues(payload),
        contentHash,
        Date.now(),
        id,
      );
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(error, res);
  }
});

questionBankRouter.post('/questions/:id/enabled', async (req, res) => {
  try {
    const enabled = (req.body as { enabled?: unknown }).enabled;
    if (typeof enabled !== 'boolean') throw new QuestionContentError('enabled must be boolean');
    const result = await db.run(
      `UPDATE bank_questions
       SET is_enabled = ?, revision = revision + 1, updated_at_ms = ? WHERE id = ?`,
      enabled ? 1 : 0,
      Date.now(),
      parseId(req.params.id),
    );
    if (result.changes === 0) return res.status(404).json({ error: 'Bank Question not found' });
    res.json({ ok: true });
  } catch (error) {
    handleError(error, res);
  }
});
