import bcrypt from 'bcrypt';
import type { Database } from 'sqlite';
import { hashPassword, MIN_PASSWORD_LENGTH } from './passwords';
import type { DbUser } from './types';
import { isUserBanned } from './utils';

export const LOGIN_NAME_RE = /^[A-Za-z0-9._-]+$/;
export const MAX_LOGIN_NAME_LENGTH = 64;
export const MAX_USER_DISPLAY_NAME_LENGTH = 100;

export class UserAccountError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

export function cleanLoginName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function createInternalUser(
  database: Database,
  input: { loginName?: unknown; username?: unknown; password?: unknown },
): Promise<DbUser> {
  const loginName = cleanLoginName(input.loginName);
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!loginName || loginName.length > MAX_LOGIN_NAME_LENGTH || !LOGIN_NAME_RE.test(loginName)) {
    throw new UserAccountError(
      'Login name may only contain letters, numbers, dots, underscores and hyphens',
    );
  }
  if (!username || username.length > MAX_USER_DISPLAY_NAME_LENGTH) {
    throw new UserAccountError('Full name is required and must be at most 100 characters');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new UserAccountError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const existing = await database.get<{ id: number }>(
    'SELECT id FROM users WHERE login_name COLLATE NOCASE = ? COLLATE NOCASE',
    loginName,
  );
  if (existing) throw new UserAccountError('Login name already exists', 409);

  const passwordHash = await hashPassword(password);
  try {
    const result = await database.run(
      `INSERT INTO users (login_name, email, username, password_hash)
       VALUES (?, NULL, ?, ?)`,
      loginName,
      username,
      passwordHash,
    );
    return (await database.get<DbUser>('SELECT * FROM users WHERE id = ?', [
      result.lastID,
    ])) as DbUser;
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) {
      throw new UserAccountError('Login name already exists', 409);
    }
    throw error;
  }
}

/** Login-name first; legacy email lookup is retained as a compatibility fallback. */
export async function findUserByIdentifier(
  database: Database,
  identifier: string,
): Promise<DbUser | undefined> {
  const cleanIdentifier = identifier.trim();
  if (!cleanIdentifier) return undefined;
  const byLoginName = await database.get<DbUser>(
    'SELECT * FROM users WHERE login_name COLLATE NOCASE = ? COLLATE NOCASE',
    cleanIdentifier,
  );
  if (byLoginName) return byLoginName;
  return database.get<DbUser>(
    'SELECT * FROM users WHERE email IS NOT NULL AND lower(email) = lower(?)',
    cleanIdentifier,
  );
}

export type UserLoginResult =
  | { ok: true; user: DbUser }
  | { ok: false; reason: 'invalid_credentials' | 'banned' };

export async function authenticateInternalUser(
  database: Database,
  identifier: string,
  password: string,
): Promise<UserLoginResult> {
  const user = await findUserByIdentifier(database, identifier);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return { ok: false, reason: 'invalid_credentials' };
  }
  if (isUserBanned(user.is_banned)) return { ok: false, reason: 'banned' };
  return { ok: true, user };
}

export async function setUserPassword(
  database: Database,
  userId: number | string,
  password: string,
): Promise<boolean> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new UserAccountError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const passwordHash = await hashPassword(password);
  const result = await database.run(
    'UPDATE users SET password_hash = ?, last_password_change = datetime("now") WHERE id = ?',
    passwordHash,
    userId,
  );
  return (result.changes ?? 0) > 0;
}
