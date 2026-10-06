import type { Database } from 'sqlite';
import { db } from './db';
import { withImmediateTransaction } from './transactions';
import type { DbEmployeeLevel, DbUser, JwtPayload } from './types';

const LEVEL_CODE_RE = /^[A-Za-z0-9._-]{1,32}$/;

export class EmployeeLevelError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code?: string,
  ) {
    super(message);
  }
}

function normalizeLevelCode(value: unknown): string {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!LEVEL_CODE_RE.test(code)) {
    throw new EmployeeLevelError(
      'Level code must use 1-32 letters, numbers, dots, dashes or underscores',
    );
  }
  return code;
}

function normalizeLevelName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 100) {
    throw new EmployeeLevelError('Level name is required and must be at most 100 characters');
  }
  return name;
}

export async function listEmployeeLevels(includeInactive = false): Promise<DbEmployeeLevel[]> {
  return db.all<DbEmployeeLevel[]>(
    `SELECT * FROM employee_levels ${includeInactive ? '' : 'WHERE is_active = 1'}
     ORDER BY sort_order, code COLLATE NOCASE`,
  );
}

export async function createEmployeeLevel(input: {
  code?: unknown;
  name?: unknown;
  sortOrder?: unknown;
}): Promise<DbEmployeeLevel> {
  const code = normalizeLevelCode(input.code);
  const name = normalizeLevelName(input.name);
  const sortOrder = input.sortOrder === undefined ? 0 : Number(input.sortOrder);
  if (!Number.isInteger(sortOrder)) throw new EmployeeLevelError('sortOrder must be an integer');
  try {
    const now = Date.now();
    const result = await db.run(
      `INSERT INTO employee_levels (code, name, sort_order, is_active, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, 1, ?, ?)`,
      code,
      name,
      sortOrder,
      now,
      now,
    );
    return (await db.get<DbEmployeeLevel>('SELECT * FROM employee_levels WHERE id = ?', [
      result.lastID,
    ])) as DbEmployeeLevel;
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) {
      throw new EmployeeLevelError('Level code already exists', 409, 'LEVEL_CODE_EXISTS');
    }
    throw error;
  }
}

export async function updateEmployeeLevel(
  levelId: number,
  input: { name?: unknown; sortOrder?: unknown; isActive?: unknown; code?: unknown },
): Promise<DbEmployeeLevel> {
  if ('code' in input) throw new EmployeeLevelError('Level code is immutable');
  const level = await db.get<DbEmployeeLevel>('SELECT * FROM employee_levels WHERE id = ?', [
    levelId,
  ]);
  if (!level) throw new EmployeeLevelError('Employee level not found', 404);
  const name = input.name === undefined ? level.name : normalizeLevelName(input.name);
  const sortOrder = input.sortOrder === undefined ? level.sort_order : Number(input.sortOrder);
  if (!Number.isInteger(sortOrder)) throw new EmployeeLevelError('sortOrder must be an integer');
  const isActive = input.isActive === undefined ? level.is_active === 1 : input.isActive;
  if (typeof isActive !== 'boolean') throw new EmployeeLevelError('isActive must be a boolean');
  await db.run(
    'UPDATE employee_levels SET name = ?, sort_order = ?, is_active = ?, updated_at_ms = ? WHERE id = ?',
    name,
    sortOrder,
    isActive ? 1 : 0,
    Date.now(),
    levelId,
  );
  return (await db.get<DbEmployeeLevel>('SELECT * FROM employee_levels WHERE id = ?', [
    levelId,
  ])) as DbEmployeeLevel;
}

async function levelOrNull(
  database: Database,
  levelId: number | null,
  requireActive = false,
): Promise<DbEmployeeLevel | null> {
  if (levelId === null) return null;
  if (!Number.isInteger(levelId) || levelId < 1) {
    throw new EmployeeLevelError('employeeLevelId is invalid');
  }
  const level = await database.get<DbEmployeeLevel>('SELECT * FROM employee_levels WHERE id = ?', [
    levelId,
  ]);
  if (!level) throw new EmployeeLevelError('Employee level not found', 404);
  if (requireActive && level.is_active !== 1) {
    throw new EmployeeLevelError(
      'Inactive employee levels cannot be assigned',
      409,
      'LEVEL_INACTIVE',
    );
  }
  return level;
}

export async function changeEmployeeLevel(
  actor: JwtPayload,
  userId: number,
  input: {
    employeeLevelId?: unknown;
    expectedCurrentLevelId?: unknown;
    reason?: unknown;
  },
): Promise<{ user: DbUser; historyCreated: boolean }> {
  if (!Object.hasOwn(input, 'employeeLevelId') || !Object.hasOwn(input, 'expectedCurrentLevelId')) {
    throw new EmployeeLevelError('employeeLevelId and expectedCurrentLevelId are required');
  }
  const requested = input.employeeLevelId === null ? null : Number(input.employeeLevelId);
  const expected =
    input.expectedCurrentLevelId === null ? null : Number(input.expectedCurrentLevelId);
  if (requested !== null && (!Number.isInteger(requested) || requested < 1)) {
    throw new EmployeeLevelError('employeeLevelId is invalid');
  }
  if (expected !== null && (!Number.isInteger(expected) || expected < 1)) {
    throw new EmployeeLevelError('expectedCurrentLevelId is invalid');
  }
  const reason =
    typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) || null : null;

  return withImmediateTransaction(async (database) => {
    const user = await database.get<DbUser>('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) throw new EmployeeLevelError('User not found', 404);
    const currentLevelId = user.employee_level_id ?? null;
    if (currentLevelId !== expected) {
      throw new EmployeeLevelError(
        'Employee level changed since it was loaded',
        409,
        'EMPLOYEE_LEVEL_CHANGED',
      );
    }
    const [oldLevel, newLevel] = await Promise.all([
      levelOrNull(database, currentLevelId),
      levelOrNull(database, requested, true),
    ]);
    if (currentLevelId === requested) return { user, historyCreated: false };

    await database.run('UPDATE users SET employee_level_id = ? WHERE id = ?', requested, userId);
    await database.run(
      `INSERT INTO employee_level_history (
        user_id, user_login_name_snapshot, user_display_name_snapshot,
        old_level_id, old_level_code_snapshot, old_level_name_snapshot,
        new_level_id, new_level_code_snapshot, new_level_name_snapshot,
        changed_at_ms, changed_by_role, changed_by_id, changed_by_name_snapshot, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      user.id,
      user.login_name ?? user.email ?? `user-${user.id}`,
      user.username,
      oldLevel?.id ?? null,
      oldLevel?.code ?? null,
      oldLevel?.name ?? null,
      newLevel?.id ?? null,
      newLevel?.code ?? null,
      newLevel?.name ?? null,
      Date.now(),
      actor.role,
      actor.id,
      actor.username,
      reason,
    );
    const updated = (await database.get<DbUser>('SELECT * FROM users WHERE id = ?', [
      userId,
    ])) as DbUser;
    return { user: updated, historyCreated: true };
  });
}

export async function requireActiveEmployeeLevel(
  database: Database,
  levelId: number,
): Promise<DbEmployeeLevel> {
  return (await levelOrNull(database, levelId, true)) as DbEmployeeLevel;
}
