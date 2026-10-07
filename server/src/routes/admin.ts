import { type Request, type Response, Router } from 'express';
import { deleteAvatarByUrl, saveAvatarsFromDataUrls } from '../avatars';
import { config, saveConfig, toPublicConfig } from '../config';
import { db, getRankedPlayers } from '../db';
import { EmployeeLevelError, requireActiveEmployeeLevel } from '../employeeLevels';
import { getMetricsSnapshot } from '../metrics';
import { getRequestUser, requireAuth, requireSuperAdmin } from '../middleware';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../passwords';
import { normalizeQuestionContent, QuestionContentError } from '../questionContent';
import {
  insertGenerationRules,
  normalizeGenerationRules,
  QuestionGenerationError,
  validateQuestionPool,
} from '../questionGeneration';
import { terminateSessionById } from '../socket/sessionLifecycle';
import { withImmediateTransaction } from '../transactions';
import type {
  DbQuestion,
  DbQuiz,
  DbSession,
  QuizImportPayload,
  QuizQuestion,
  QuizTranslationPayload,
  ThemeId,
} from '../types';
import { THEME_IDS } from '../types';
import { normalizeImageUrl, normalizeOptionalText, parseQuestionRow } from '../utils';

export const adminRouter = Router();

// ─── Auth ─────────────────────────────────────────────────────────────────────

// Super-admin login: POST /api/auth/login (tries admin username first, then user email).

adminRouter.post('/logout', (_req, res) => {
  res.clearCookie('adminToken');
  res.json({ ok: true });
});

adminRouter.get('/me', requireAuth, async (req, res) => {
  const user = getRequestUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (user.role === 'super_admin') {
    return res.json({
      ok: true,
      role: 'super_admin',
      username: user.username,
      isSuperAdmin: true,
    });
  }
  const row = await db.get<{ username: string }>('SELECT username FROM users WHERE id = ?', [
    user.id,
  ]);
  res.json({
    ok: true,
    role: 'user',
    username: row?.username ?? user.username,
    isSuperAdmin: false,
  });
});

// ─── Admin Management (super admin only) ────────────────────────────────────

adminRouter.get('/admins', requireSuperAdmin, async (_req, res) => {
  const admins = await db.all('SELECT id, username, created_at, last_password_change FROM admins');
  res.json({ admins });
});

adminRouter.post('/admins/:id/reset-password', requireSuperAdmin, async (req, res) => {
  const { newPassword } = req.body as { newPassword?: string };
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: 'newPassword must be at least 6 characters' });
  }
  const hash = await hashPassword(newPassword);
  const result = await db.run(
    'UPDATE admins SET password_hash = ?, last_password_change = datetime("now") WHERE id = ?',
    [hash, req.params.id],
  );
  if (result.changes === 0) return res.status(404).json({ error: 'Admin not found' });
  res.json({ success: true });
});

// ─── Metrics (super admin only — capacity/load monitoring) ───────────────────

adminRouter.get('/metrics', requireSuperAdmin, async (_req, res) => {
  res.json(await getMetricsSnapshot());
});

// ─── Config (super admin only — branding + global settings) ──────────────────

adminRouter.get('/config', requireAuth, (_req, res) => {
  res.json(toPublicConfig());
});

adminRouter.put('/config', requireSuperAdmin, (req: Request, res: Response) => {
  const allowed = [
    'appName',
    'appSubtitle',
    'questionTimeSec',
    'defaultBaseScore',
    'speedBonusMax',
    'speedBonusMin',
    'maxPlayersPerSession',
    'showLeaderboardAfterQuestion',
    'streakBonusEnabled',
    'streakMinimum',
    'streakBonusBase',
    'resultsAutoAdvanceSec',
    'chooseQuizMaker',
  ];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      (config as unknown as Record<string, unknown>)[key] = req.body[key];
    }
  }
  saveConfig(config);
  res.json({ ok: true });
});

// ─── Avatars (admin bulk upload) ────────────────────────────────────────────────

adminRouter.post('/avatars/bulk', requireSuperAdmin, (req: Request, res: Response) => {
  const { dataUrls } = req.body as { dataUrls?: unknown };
  if (!Array.isArray(dataUrls) || dataUrls.length === 0) {
    return res.status(400).json({ error: 'dataUrls array is required' });
  }

  const urls = saveAvatarsFromDataUrls(dataUrls.filter((u): u is string => typeof u === 'string'));

  if (urls.length === 0) {
    return res.status(400).json({ error: 'No valid images provided' });
  }

  res.status(201).json({ urls });
});

adminRouter.delete('/avatars', requireSuperAdmin, (req: Request, res: Response) => {
  const { url } = req.body as { url?: unknown };
  if (typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'url is required' });
  }
  if (!deleteAvatarByUrl(url.trim())) {
    return res.status(404).json({ error: 'Avatar not found' });
  }
  res.json({ ok: true });
});

// ─── Ownership helpers ──────────────────────────────────────────────────────

function isSuperAdmin(req: Request): boolean {
  return getRequestUser(req)?.role === 'super_admin';
}

function currentUserId(req: Request): number | null {
  const user = getRequestUser(req);
  return user?.role === 'user' ? user.id : null;
}

/** Returns true if the requester may operate on the given quiz. */
async function canAccessQuiz(req: Request, quiz: DbQuiz): Promise<boolean> {
  if (isSuperAdmin(req)) return true;
  if (quiz.owner_kind === 'user' && quiz.owner_id === currentUserId(req)) return true;
  return false;
}

// ─── Quizzes ──────────────────────────────────────────────────────────────────

/** Insert one quiz question row (shared by quiz create + update). */
async function insertQuestion(
  database: typeof db,
  quizId: number | string | undefined,
  q: QuizQuestion,
  orderIndex: number,
): Promise<void> {
  const content = normalizeQuestionContent(q);
  await database.run(
    'INSERT INTO questions (quiz_id, text, options, correct_index, base_score, time_sec, order_index, image_url, question_type, correct_answer, correct_indices, explanation, range_min, range_max, media_url, media_type, blanks, geo, tags, matches) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    quizId,
    content.text,
    content.options,
    content.correct_index,
    content.base_score,
    content.time_sec,
    orderIndex,
    content.image_url,
    content.question_type,
    content.correct_answer,
    content.correct_indices,
    content.explanation,
    content.range_min,
    content.range_max,
    content.media_url,
    content.media_type,
    content.blanks,
    content.geo,
    content.tags,
    content.matches,
  );
}

adminRouter.get('/quizzes', requireAuth, async (req, res) => {
  if (isSuperAdmin(req)) {
    const quizzes = await db.all<
      Array<
        DbQuiz & {
          owner_email: string | null;
          owner_username: string | null;
        }
      >
    >(`
      SELECT q.*, CASE WHEN q.quiz_mode = 'bank_generated'
        THEN COALESCE(gr.question_count, 0)
        ELSE COUNT(qu.id) END as question_count,
        (SELECT u.email FROM users u WHERE q.owner_kind = 'user' AND q.owner_id = u.id) as owner_email,
        (SELECT u.username FROM users u WHERE q.owner_kind = 'user' AND q.owner_id = u.id) as owner_username
      FROM quizzes q
      LEFT JOIN questions qu ON qu.quiz_id = q.id
      LEFT JOIN (
        SELECT quiz_id, SUM(question_count) AS question_count
        FROM quiz_generation_rules GROUP BY quiz_id
      ) gr ON gr.quiz_id = q.id
      GROUP BY q.id
      ORDER BY COALESCE(
        (SELECT u.email FROM users u WHERE q.owner_kind = 'user' AND q.owner_id = u.id),
        ''
      ), q.created_at DESC
    `);
    return res.json(quizzes);
  }
  const userId = currentUserId(req);
  const quizzes = await db.all<DbQuiz[]>(
    `
      SELECT q.*, CASE WHEN q.quiz_mode = 'bank_generated'
        THEN COALESCE(gr.question_count, 0)
        ELSE COUNT(qu.id) END as question_count
      FROM quizzes q
      LEFT JOIN questions qu ON qu.quiz_id = q.id
      LEFT JOIN (
        SELECT quiz_id, SUM(question_count) AS question_count
        FROM quiz_generation_rules GROUP BY quiz_id
      ) gr ON gr.quiz_id = q.id
      WHERE q.owner_kind = 'user' AND q.owner_id = ?
      GROUP BY q.id
      ORDER BY q.created_at DESC
    `,
    userId,
  );
  res.json(quizzes);
});

adminRouter.get('/quizzes/:id', requireAuth, async (req: Request, res: Response) => {
  const quiz = await db.get<DbQuiz>('SELECT * FROM quizzes WHERE id = ?', req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Not found' });
  if (!(await canAccessQuiz(req, quiz))) {
    return res.status(404).json({ error: 'Not found' });
  }
  const questions = await db.all<DbQuestion[]>(
    'SELECT * FROM questions WHERE quiz_id = ? ORDER BY order_index',
    req.params.id,
  );
  const generationRules =
    quiz.quiz_mode === 'bank_generated'
      ? await db.all(
          'SELECT * FROM quiz_generation_rules WHERE quiz_id = ? ORDER BY sort_order, id',
          req.params.id,
        )
      : [];
  res.json({
    ...quiz,
    questions: questions.map(parseQuestionRow),
    generationRules,
  });
});

/** Validate a client-supplied theme against the allowlist, defaulting to 'default'. */
function normalizeTheme(theme: unknown): ThemeId {
  return THEME_IDS.includes(theme as ThemeId) ? (theme as ThemeId) : 'default';
}

/** The quiz's authoring language (open-ended locale code). Defaults to Vietnamese. */
function normalizeLanguage(language: unknown): string {
  return typeof language === 'string' && language.trim() ? language.trim() : 'vi';
}

async function recommendedLevelId(
  value: unknown,
  fallback: number | null = null,
): Promise<number | null> {
  if (value === undefined) return fallback;
  if (value === null) return null;
  const levelId = Number(value);
  if (!Number.isInteger(levelId) || levelId < 1) {
    throw new EmployeeLevelError('recommendedLevelId is invalid');
  }
  await requireActiveEmployeeLevel(db, levelId);
  return levelId;
}

adminRouter.post('/quizzes', requireAuth, async (req: Request, res: Response) => {
  const body = req.body as QuizImportPayload;
  const quizMode = body.quizMode ?? 'static';
  if (!body.title?.trim()) return res.status(400).json({ error: 'title is required' });
  if (quizMode === 'static' && (!Array.isArray(body.questions) || body.questions.length === 0)) {
    return res.status(400).json({ error: 'A static quiz needs at least one question' });
  }
  if (quizMode === 'bank_generated' && !isSuperAdmin(req)) {
    return res
      .status(403)
      .json({ error: 'Bank-generated quizzes require super administrator access' });
  }
  if (quizMode !== 'static' && quizMode !== 'bank_generated') {
    return res.status(400).json({ error: 'quizMode is invalid' });
  }
  if (body.selectionMode !== undefined && body.selectionMode !== 'per_assignment') {
    return res.status(400).json({ error: 'Only per_assignment selection is supported' });
  }

  // Super admin owns as 'admin' (owner_id NULL); user owns as 'user' with their id.
  const ownerKind = isSuperAdmin(req) ? 'admin' : 'user';
  const ownerId = isSuperAdmin(req) ? null : currentUserId(req);
  let levelId: number | null;
  try {
    levelId = await recommendedLevelId(body.recommendedLevelId);
  } catch (error) {
    if (error instanceof EmployeeLevelError) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    throw error;
  }

  try {
    const rules =
      quizMode === 'bank_generated' ? normalizeGenerationRules(body.generationRules) : [];
    const quizId = await withImmediateTransaction(async (database) => {
      const quizResult = await database.run(
        `INSERT INTO quizzes (
           title, description, cover_image, theme, language, owner_id, owner_kind,
           recommended_level_id, quiz_mode, selection_mode, blueprint_revision
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'per_assignment', 1)`,
        body.title.trim(),
        body.description ?? '',
        normalizeImageUrl(body.coverImage) ?? null,
        normalizeTheme(body.theme),
        normalizeLanguage(body.language),
        ownerId,
        ownerKind,
        levelId,
        quizMode,
      );
      const createdId = Number(quizResult.lastID);
      if (quizMode === 'static') {
        for (let index = 0; index < (body.questions ?? []).length; index += 1) {
          await insertQuestion(database, createdId, (body.questions ?? [])[index], index);
        }
      } else {
        await insertGenerationRules(database, createdId, rules);
      }
      return createdId;
    });
    res.status(201).json({ id: quizId });
  } catch (error) {
    if (error instanceof QuestionContentError || error instanceof QuestionGenerationError) {
      return res.status(error instanceof QuestionGenerationError ? error.statusCode : 400).json({
        error: error.message,
        code: error instanceof QuestionGenerationError ? error.code : undefined,
      });
    }
    throw error;
  }
});

adminRouter.put('/quizzes/:id', requireAuth, async (req: Request, res: Response) => {
  const body = req.body as QuizImportPayload;
  if (!body.title?.trim()) return res.status(400).json({ error: 'title is required' });

  const quiz = await db.get<DbQuiz>('SELECT * FROM quizzes WHERE id = ?', req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Not found' });
  if (!(await canAccessQuiz(req, quiz))) {
    return res.status(404).json({ error: 'Not found' });
  }
  const requestedMode = body.quizMode ?? quiz.quiz_mode;
  if (requestedMode !== quiz.quiz_mode) {
    return res.status(409).json({ error: 'Changing quiz mode after creation is not supported' });
  }
  if (quiz.quiz_mode === 'bank_generated' && !isSuperAdmin(req)) {
    return res
      .status(403)
      .json({ error: 'Bank-generated quizzes require super administrator access' });
  }
  if (
    quiz.quiz_mode === 'static' &&
    (!Array.isArray(body.questions) || body.questions.length === 0)
  ) {
    return res.status(400).json({ error: 'A static quiz needs at least one question' });
  }
  let levelId: number | null;
  try {
    levelId = await recommendedLevelId(body.recommendedLevelId, quiz.recommended_level_id);
  } catch (error) {
    if (error instanceof EmployeeLevelError) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    throw error;
  }

  try {
    const rules =
      quiz.quiz_mode === 'bank_generated' ? normalizeGenerationRules(body.generationRules) : [];
    await withImmediateTransaction(async (database) => {
      await database.run(
        `UPDATE quizzes SET title = ?, description = ?, cover_image = ?, theme = ?,
         language = ?, recommended_level_id = ?,
         blueprint_revision = blueprint_revision + ? WHERE id = ?`,
        body.title.trim(),
        body.description ?? '',
        normalizeImageUrl(body.coverImage) ?? null,
        normalizeTheme(body.theme),
        normalizeLanguage(body.language),
        levelId,
        quiz.quiz_mode === 'bank_generated' ? 1 : 0,
        req.params.id,
      );
      if (quiz.quiz_mode === 'static') {
        await database.run('DELETE FROM questions WHERE quiz_id = ?', req.params.id);
        for (let index = 0; index < (body.questions ?? []).length; index += 1) {
          await insertQuestion(database, quiz.id, (body.questions ?? [])[index], index);
        }
      } else {
        await database.run(
          `DELETE FROM assignment_question_previews
           WHERE assignment_id IN (SELECT id FROM assignments WHERE quiz_id = ?)`,
          quiz.id,
        );
        await database.run('DELETE FROM quiz_generation_rules WHERE quiz_id = ?', req.params.id);
        await insertGenerationRules(database, quiz.id, rules);
      }
    });
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof QuestionContentError || error instanceof QuestionGenerationError) {
      return res.status(error instanceof QuestionGenerationError ? error.statusCode : 400).json({
        error: error.message,
        code: error instanceof QuestionGenerationError ? error.code : undefined,
      });
    }
    throw error;
  }
});

adminRouter.post(
  '/quizzes/:id/generation/validate',
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    try {
      res.json(await validateQuestionPool(Number(req.params.id)));
    } catch (error) {
      if (error instanceof QuestionGenerationError) {
        return res
          .status(error.statusCode)
          .json({ error: error.message, code: error.code, details: error.details });
      }
      throw error;
    }
  },
);

adminRouter.delete('/quizzes/:id', requireAuth, async (req: Request, res: Response) => {
  const quiz = await db.get<DbQuiz>('SELECT * FROM quizzes WHERE id = ?', req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Not found' });
  if (!(await canAccessQuiz(req, quiz))) {
    return res.status(404).json({ error: 'Not found' });
  }
  // Delete sessions first (no ON DELETE CASCADE on sessions.quiz_id)
  await db.run('DELETE FROM sessions WHERE quiz_id = ?', req.params.id);
  await db.run('DELETE FROM quizzes WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// ─── Quiz translations ───────────────────────────────────────────────────────

adminRouter.get('/quizzes/:id/translations', requireAuth, async (req: Request, res: Response) => {
  const quiz = await db.get<DbQuiz>('SELECT * FROM quizzes WHERE id = ?', req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Not found' });
  if (!(await canAccessQuiz(req, quiz))) {
    return res.status(404).json({ error: 'Not found' });
  }
  const rows = await db.all<Array<{ locale: string }>>(
    'SELECT DISTINCT locale FROM question_translations WHERE quiz_id = ?',
    req.params.id,
  );
  res.json({ locales: rows.map((r) => r.locale) });
});

adminRouter.post('/quizzes/:id/translations', requireAuth, async (req: Request, res: Response) => {
  const quiz = await db.get<DbQuiz>('SELECT * FROM quizzes WHERE id = ?', req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Not found' });
  if (!(await canAccessQuiz(req, quiz))) {
    return res.status(404).json({ error: 'Not found' });
  }

  const body = req.body as QuizTranslationPayload;
  const locale = body.locale?.trim();
  if (!locale) return res.status(400).json({ error: 'locale is required' });
  if (!Array.isArray(body.questions) || body.questions.length === 0) {
    return res.status(400).json({ error: 'questions are required' });
  }

  const baseQuestions = await db.all<DbQuestion[]>(
    'SELECT * FROM questions WHERE quiz_id = ? ORDER BY order_index',
    req.params.id,
  );
  if (body.questions.length !== baseQuestions.length) {
    return res.status(400).json({
      error: `Translation has ${body.questions.length} question(s), quiz has ${baseQuestions.length}. They must match in count and order.`,
    });
  }
  for (const tq of body.questions) {
    if (typeof tq.text !== 'string' || !tq.text.trim()) {
      return res.status(400).json({ error: 'Every translated question needs text' });
    }
    if (!Array.isArray(tq.options)) {
      return res.status(400).json({ error: 'Every translated question needs an options array' });
    }
  }

  await db.run('BEGIN');
  try {
    await db.run(
      'DELETE FROM question_translations WHERE quiz_id = ? AND locale = ?',
      req.params.id,
      locale,
    );
    for (let i = 0; i < body.questions.length; i++) {
      const tq = body.questions[i];
      await db.run(
        'INSERT INTO question_translations (quiz_id, locale, order_index, question_type, text, options, matches, explanation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        req.params.id,
        locale,
        i,
        baseQuestions[i].question_type,
        tq.text,
        JSON.stringify(tq.options),
        tq.matches ? JSON.stringify(tq.matches) : null,
        normalizeOptionalText(tq.explanation) ?? null,
      );
    }
    await db.run('COMMIT');
    res.json({ ok: true, locale, questionCount: body.questions.length });
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
});

adminRouter.delete(
  '/quizzes/:id/translations/:locale',
  requireAuth,
  async (req: Request, res: Response) => {
    const quiz = await db.get<DbQuiz>('SELECT * FROM quizzes WHERE id = ?', req.params.id);
    if (!quiz) return res.status(404).json({ error: 'Not found' });
    if (!(await canAccessQuiz(req, quiz))) {
      return res.status(404).json({ error: 'Not found' });
    }
    await db.run(
      'DELETE FROM question_translations WHERE quiz_id = ? AND locale = ?',
      req.params.id,
      req.params.locale,
    );
    res.json({ ok: true });
  },
);

// ─── Sessions ─────────────────────────────────────────────────────────────────

function generatePin(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

adminRouter.post('/sessions', requireAuth, async (req: Request, res: Response) => {
  const { quizId } = req.body as { quizId: number };
  const quiz = await db.get<DbQuiz>('SELECT * FROM quizzes WHERE id = ?', quizId);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  if (quiz.quiz_mode === 'bank_generated') {
    return res.status(409).json({
      error: 'Bank-generated quizzes are not available for Live Game',
      code: 'DYNAMIC_QUIZ_LIVE_GAME_UNSUPPORTED',
    });
  }
  if (!(await canAccessQuiz(req, quiz))) {
    return res.status(404).json({ error: 'Quiz not found' });
  }

  let pin = generatePin();
  while (await db.get("SELECT id FROM sessions WHERE pin = ? AND status != 'finished'", pin)) {
    pin = generatePin();
  }

  // Super admin: hosted_by_user_id = NULL. User: hosted_by_user_id = their id.
  const hostedBy = isSuperAdmin(req) ? null : currentUserId(req);

  const result = await db.run(
    'INSERT INTO sessions (quiz_id, pin, status, hosted_by_user_id) VALUES (?, ?, ?, ?)',
    quizId,
    pin,
    'waiting',
    hostedBy,
  );

  res.status(201).json({ id: result.lastID, pin });
});

adminRouter.get('/sessions', requireAuth, async (req, res) => {
  if (isSuperAdmin(req)) {
    const sessions = await db.all(`
      SELECT s.*, q.title as quiz_title,
        (SELECT COUNT(*) FROM players p WHERE p.session_id = s.id) as player_count,
        u.email as host_email, u.username as host_username
      FROM sessions s
      JOIN quizzes q ON q.id = s.quiz_id
      LEFT JOIN users u ON s.hosted_by_user_id = u.id
      ORDER BY COALESCE(u.email, ''), s.created_at DESC
    `);
    return res.json(sessions);
  }
  const userId = currentUserId(req);
  const sessions = await db.all(
    `
      SELECT s.*, q.title as quiz_title,
        (SELECT COUNT(*) FROM players p WHERE p.session_id = s.id) as player_count
      FROM sessions s
      JOIN quizzes q ON q.id = s.quiz_id
      WHERE s.hosted_by_user_id = ?
      ORDER BY s.created_at DESC
    `,
    userId,
  );
  res.json(sessions);
});

adminRouter.post('/sessions/:id/force-end', requireAuth, async (req: Request, res: Response) => {
  const session = await db.get<DbSession>('SELECT * FROM sessions WHERE id = ?', req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  if (!isSuperAdmin(req) && session.hosted_by_user_id !== currentUserId(req)) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (session.status === 'finished') return res.json({ ok: true, already: true });
  await terminateSessionById(session.id);
  res.json({ ok: true });
});

adminRouter.get('/sessions/:id', requireAuth, async (req: Request, res: Response) => {
  const session = await db.get<DbSession>(
    `SELECT s.*, q.title as quiz_title
    FROM sessions s JOIN quizzes q ON q.id = s.quiz_id
    WHERE s.id = ?`,
    req.params.id,
  );
  if (!session) return res.status(404).json({ error: 'Not found' });
  if (!isSuperAdmin(req) && session.hosted_by_user_id !== currentUserId(req)) {
    return res.status(404).json({ error: 'Not found' });
  }

  const players = await getRankedPlayers(req.params.id as string);

  const questions = await db.all<DbQuestion[]>(
    'SELECT * FROM questions WHERE quiz_id = ? ORDER BY order_index',
    session.quiz_id,
  );

  const answers = await db.all(
    'SELECT a.*, p.username FROM answers a JOIN players p ON p.id = a.player_id WHERE a.session_id = ?',
    req.params.id,
  );

  res.json({
    session,
    players,
    questions: questions.map(parseQuestionRow),
    answers,
  });
});
