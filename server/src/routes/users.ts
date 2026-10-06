import crypto from 'node:crypto';
import { type Request, type Response, Router } from 'express';
import { db } from '../db';
import { changeEmployeeLevel, EmployeeLevelError } from '../employeeLevels';
import { getRequestUser, requireSuperAdmin } from '../middleware';
import type { DbUser } from '../types';
import { createInternalUser, setUserPassword, UserAccountError } from '../userAccounts';

export const usersRouter = Router();

// All routes here are super-admin only.
usersRouter.use(requireSuperAdmin);

// ─── List users ────────────────────────────────────────────────────────────────

usersRouter.get('/', async (_req: Request, res: Response) => {
  const users = await db.all<
    Array<{
      id: number;
      login_name: string;
      email: string | null;
      username: string;
      is_banned: number;
      created_at: string;
      last_password_change: string | null;
      quiz_count: number;
      employee_level_id: number | null;
      employee_level_code: string | null;
      employee_level_name: string | null;
    }>
  >(`
    SELECT u.id, COALESCE(u.login_name, u.email, 'user-' || u.id) as login_name,
      u.email, u.username, u.is_banned, u.created_at, u.last_password_change,
      u.employee_level_id, l.code as employee_level_code, l.name as employee_level_name,
      (SELECT COUNT(*) FROM quizzes q WHERE q.owner_id = u.id AND q.owner_kind = 'user') as quiz_count
    FROM users u
    LEFT JOIN employee_levels l ON l.id = u.employee_level_id
    ORDER BY u.created_at DESC
  `);
  res.json({ users });
});

// ─── Create internal employee account ────────────────────────────────────────

usersRouter.post('/', async (req: Request, res: Response) => {
  try {
    const user = await createInternalUser(db, req.body ?? {});
    res.status(201).json({
      user: {
        id: user.id,
        login_name: user.login_name,
        email: user.email,
        username: user.username,
        is_banned: user.is_banned,
        created_at: user.created_at,
        last_password_change: user.last_password_change,
        quiz_count: 0,
        employee_level_id: user.employee_level_id,
        employee_level_code: null,
        employee_level_name: null,
      },
    });
  } catch (error) {
    if (error instanceof UserAccountError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create employee account' });
  }
});

// ─── Current employee level ──────────────────────────────────────────────────

usersRouter.patch('/:id/level', async (req: Request, res: Response) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  const actor = getRequestUser(req);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const result = await changeEmployeeLevel(actor, userId, req.body ?? {});
    res.json(result);
  } catch (error) {
    if (error instanceof EmployeeLevelError) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    throw error;
  }
});

// ─── Ban / unban ──────────────────────────────────────────────────────────────

usersRouter.post('/:id/ban', async (req: Request, res: Response) => {
  const result = await db.run('UPDATE users SET is_banned = 1 WHERE id = ?', req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

usersRouter.post('/:id/unban', async (req: Request, res: Response) => {
  const result = await db.run('UPDATE users SET is_banned = 0 WHERE id = ?', req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

// ─── Reset password ───────────────────────────────────────────────────────────

usersRouter.post('/:id/reset-password', async (req: Request, res: Response) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  // Allow caller to supply a password, otherwise generate a random one.
  const { newPassword } = (req.body ?? {}) as { newPassword?: string };
  const password = newPassword || crypto.randomBytes(6).toString('base64url').slice(0, 12);
  try {
    if (!(await setUserPassword(db, userId, password))) {
      return res.status(404).json({ error: 'User not found' });
    }
    // Return the generated plaintext once so the super admin can hand it to the user.
    res.json({ ok: true, password });
  } catch (error) {
    if (error instanceof UserAccountError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    throw error;
  }
});

// ─── Delete ──────────────────────────────────────────────────────────────────

usersRouter.delete('/:id', async (req: Request, res: Response) => {
  const row = await db.get<DbUser>('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!row) return res.status(404).json({ error: 'User not found' });
  // ON DELETE SET NULL on quizzes.owner_id and sessions.hosted_by_user_id keeps the content.
  await db.run('DELETE FROM users WHERE id = ?', req.params.id);
  res.json({ ok: true });
});
