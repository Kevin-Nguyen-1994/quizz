import bcrypt from 'bcrypt';
import { type Request, type Response, Router } from 'express';
import { db, getRankedPlayers } from '../db';
import { getRequestUser, requireAuth, signToken } from '../middleware';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../passwords';
import { savePlayProfile } from '../playProfile';
import { getClientIp, LoginFailureLimiter, maskIp } from '../requestSecurity';
import type { DbQuestion, DbSession, DbUser } from '../types';
import { authenticateInternalUser } from '../userAccounts';
import { isUserBanned, parseQuestionRow } from '../utils';

export const authRouter = Router();
const loginLimiter = new LoginFailureLimiter();
const RATE_LIMIT_MESSAGE =
  'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau ít phút.';

function setRateLimitHeaders(res: Response, remaining: number): void {
  res.setHeader('RateLimit-Limit', String(loginLimiter.limit));
  res.setHeader('RateLimit-Remaining', String(remaining));
  res.setHeader('RateLimit-Policy', `${loginLimiter.limit};w=${loginLimiter.windowMs / 1000}`);
}

function rejectRateLimitedLogin(res: Response, clientIp: string): Response {
  const status = loginLimiter.status(clientIp);
  setRateLimitHeaders(res, 0);
  res.setHeader('Retry-After', String(status.retryAfterSeconds));
  if (status.shouldLog) {
    console.warn(
      `[security] timestamp=${new Date().toISOString()} event=login_rate_limit route=/api/auth/login client=${maskIp(clientIp)}`,
    );
    loginLimiter.markLogged(clientIp);
  }
  return res.status(429).json({ error: RATE_LIMIT_MESSAGE });
}

function signUserToken(user: { id: number; username: string }): string {
  return signToken({ id: user.id, role: 'user', username: user.username });
}

/** Super-admin via env credentials or admins table (username match). */
async function trySuperAdminLogin(identifier: string, password: string): Promise<string | null> {
  const envUser = process.env.ADMIN_USERNAME || 'admin';
  const envPass = process.env.ADMIN_PASSWORD;
  if (envPass && identifier === envUser && password === envPass) {
    return signToken({ id: 0, role: 'super_admin', username: envUser });
  }

  const admin = await db.get<{ id: number; username: string; password_hash: string }>(
    'SELECT id, username, password_hash FROM admins WHERE username = ?',
    identifier,
  );
  if (admin && (await bcrypt.compare(password, admin.password_hash))) {
    return signToken({ id: 0, role: 'super_admin', username: admin.username });
  }
  return null;
}

// ─── Register ─────────────────────────────────────────────────────────────────

authRouter.post('/register', (_req: Request, res: Response) => {
  res.status(403).json({ error: 'Self-registration is disabled. Contact an administrator.' });
});

// ─── Login ────────────────────────────────────────────────────────────────────

authRouter.post('/login', async (req: Request, res: Response) => {
  const clientIp = getClientIp(req);
  const initialLimit = loginLimiter.status(clientIp);
  setRateLimitHeaders(res, initialLimit.remaining);
  if (initialLimit.blocked) return rejectRateLimitedLogin(res, clientIp);

  const body = (req.body ?? {}) as {
    identifier?: string;
    loginName?: string;
    email?: string;
    password?: string;
  };
  const identifier = (body.identifier ?? body.loginName ?? body.email ?? '').trim();
  const password = body.password ?? '';

  try {
    const adminToken = await trySuperAdminLogin(identifier, password);
    if (adminToken) {
      loginLimiter.clear(clientIp);
      setRateLimitHeaders(res, loginLimiter.limit);
      return res.json({ token: adminToken });
    }

    const result = await authenticateInternalUser(db, identifier, password);
    if (!result.ok && result.reason === 'invalid_credentials') {
      const limit = loginLimiter.recordFailure(clientIp);
      setRateLimitHeaders(res, limit.remaining);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!result.ok) {
      return res.status(403).json({ error: 'This account has been banned' });
    }
    const { user } = result;
    const token = signUserToken({ id: user.id, username: user.username });
    loginLimiter.clear(clientIp);
    setRateLimitHeaders(res, loginLimiter.limit);
    res.json({ token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// ─── Logout (stateless JWT — client clears token) ─────────────────────────────

authRouter.post('/logout', (_req, res) => {
  res.clearCookie('adminToken');
  res.json({ ok: true });
});

// ─── Me ───────────────────────────────────────────────────────────────────────

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = getRequestUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (user.role === 'super_admin') {
    return res.json({
      ok: true,
      role: 'super_admin',
      id: 0,
      username: user.username,
      loginName: user.username,
      email: null,
    });
  }

  const row = await db.get<DbUser>('SELECT * FROM users WHERE id = ?', user.id);
  if (!row) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (isUserBanned(row.is_banned)) {
    return res.status(403).json({ error: 'This account has been banned' });
  }
  res.json({
    ok: true,
    role: 'user',
    id: row.id,
    username: row.username,
    loginName: row.login_name ?? row.email ?? '',
    email: row.email,
    playDisplayName: row.play_display_name ?? null,
    playAvatar: row.play_avatar ?? null,
  });
});

// ─── Play profile (in-game name + avatar) ─────────────────────────────────────

authRouter.patch('/play-profile', requireAuth, async (req: Request, res: Response) => {
  const user = getRequestUser(req);
  if (!user || user.role !== 'user') {
    return res.status(403).json({ error: 'User accounts only' });
  }

  const { displayName, avatar } = req.body as { displayName?: string; avatar?: string };
  const cleanName = (displayName ?? '').trim().slice(0, 50);
  if (!cleanName) {
    return res.status(400).json({ error: 'Display name is required' });
  }

  const cleanAvatar = typeof avatar === 'string' ? avatar.trim().slice(0, 512) : '';
  await savePlayProfile(user.id, cleanName, cleanAvatar || undefined);
  res.json({
    ok: true,
    playDisplayName: cleanName,
    playAvatar: cleanAvatar || null,
  });
});

// ─── Games the user joined as a player ────────────────────────────────────────

authRouter.get('/play-history', requireAuth, async (req, res) => {
  const user = getRequestUser(req);
  if (!user || user.role !== 'user') {
    return res.status(403).json({ error: 'User accounts only' });
  }

  const rows = await db.all<
    Array<{
      session_id: number;
      pin: string;
      quiz_title: string;
      status: DbSession['status'];
      total_score: number;
      player_count: number;
      rank: number;
      started_at: string | null;
      finished_at: string | null;
      created_at: string;
    }>
  >(
    `
      SELECT
        s.id as session_id,
        s.pin,
        q.title as quiz_title,
        s.status,
        p.total_score,
        (SELECT COUNT(*) FROM players px WHERE px.session_id = s.id) as player_count,
        (
          SELECT COUNT(*) + 1 FROM players p2
          WHERE p2.session_id = s.id AND p2.total_score > p.total_score
        ) as rank,
        s.started_at,
        s.finished_at,
        s.created_at
      FROM players p
      JOIN sessions s ON s.id = p.session_id
      JOIN quizzes q ON q.id = s.quiz_id
      WHERE p.user_id = ?
      ORDER BY COALESCE(s.finished_at, s.started_at, s.created_at) DESC
    `,
    user.id,
  );

  res.json({ games: rows });
});

authRouter.get('/play-history/:sessionId', requireAuth, async (req, res) => {
  const user = getRequestUser(req);
  if (!user || user.role !== 'user') {
    return res.status(403).json({ error: 'User accounts only' });
  }

  const sessionId = Number(req.params.sessionId);
  if (!Number.isFinite(sessionId)) {
    return res.status(400).json({ error: 'Invalid session id' });
  }

  const player = await db.get<{ id: number }>(
    'SELECT id FROM players WHERE session_id = ? AND user_id = ?',
    sessionId,
    user.id,
  );
  if (!player) return res.status(404).json({ error: 'Not found' });

  const session = await db.get<DbSession & { quiz_title: string }>(
    `SELECT s.*, q.title as quiz_title
     FROM sessions s JOIN quizzes q ON q.id = s.quiz_id
     WHERE s.id = ?`,
    sessionId,
  );
  if (!session) return res.status(404).json({ error: 'Not found' });

  const players = await getRankedPlayers(sessionId);
  const myIndex = players.findIndex((p) => p.id === player.id);
  const myRank = myIndex >= 0 ? myIndex + 1 : null;

  // Correct answers only leave the server once the game is actually over —
  // otherwise a player still in the session could read this endpoint (or its
  // raw network response) mid-game and get the full answer key.
  if (session.status !== 'finished') {
    return res.json({
      session,
      myPlayerId: player.id,
      myRank,
      players,
      questions: [],
      answers: [],
    });
  }

  const questions = await db.all<DbQuestion[]>(
    'SELECT * FROM questions WHERE quiz_id = ? ORDER BY order_index',
    session.quiz_id,
  );
  const answers = await db.all(
    'SELECT a.*, p.username FROM answers a JOIN players p ON p.id = a.player_id WHERE a.session_id = ?',
    sessionId,
  );

  res.json({
    session,
    myPlayerId: player.id,
    myRank,
    players,
    questions: questions.map(parseQuestionRow),
    answers,
  });
});

// ─── Change password (user only) ──────────────────────────────────────────────

authRouter.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  const user = getRequestUser(req);
  if (!user || user.role !== 'user') {
    return res
      .status(400)
      .json({ error: 'Super admin password is managed via environment variables' });
  }

  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };

  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  try {
    const row = await db.get<DbUser>('SELECT * FROM users WHERE id = ?', user.id);
    if (!row) {
      return res.status(404).json({ error: 'User not found' });
    }
    const valid = await bcrypt.compare(currentPassword, row.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password incorrect' });
    }
    const hash = await hashPassword(newPassword);
    await db.run(
      'UPDATE users SET password_hash = ?, last_password_change = datetime("now") WHERE id = ?',
      hash,
      user.id,
    );
    res.json({ success: true });
  } catch (error) {
    console.error('User change-password error:', error);
    res.status(500).json({ error: 'Password change failed' });
  }
});
