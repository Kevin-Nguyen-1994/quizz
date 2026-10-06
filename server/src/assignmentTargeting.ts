import crypto from 'node:crypto';
import type { Database } from 'sqlite';
import type {
  AssignmentTargetOverrideAction,
  DbAssignment,
  DbEmployeeLevel,
  DbQuiz,
} from './types';

export class AssignmentTargetingError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code?: string,
  ) {
    super(message);
  }
}

interface TargetUserRow {
  id: number;
  login_name: string | null;
  email: string | null;
  username: string;
  play_display_name: string | null;
  is_banned: number;
  employee_level_id: number | null;
  level_code: string | null;
  level_name: string | null;
}

interface OverrideRow {
  user_id: number;
  action: AssignmentTargetOverrideAction;
}

export interface ResolvedTargetMember {
  id: number;
  loginName: string;
  username: string;
  displayName: string;
  email: string;
  levelId: number | null;
  levelCode: string | null;
  levelName: string | null;
  currentLevel: { id: number; code: string; name: string } | null;
  source: 'rule' | 'manual' | 'override_include';
}

export interface AssignmentTargetWarning {
  code: string;
  message: string;
  userId?: number;
}

export interface AssignmentTargetPreview {
  matchedCount: number;
  finalCount: number;
  members: ResolvedTargetMember[];
  warnings: AssignmentTargetWarning[];
  fingerprint: string;
}

export interface ResolvedAssignmentTarget extends AssignmentTargetPreview {
  targetLevel: DbEmployeeLevel | null;
  promotionTargetLevel: DbEmployeeLevel | null;
}

function loginName(user: TargetUserRow): string {
  return user.login_name?.trim() || user.email?.trim() || `user-${user.id}`;
}

function displayName(user: TargetUserRow): string {
  return user.play_display_name?.trim() || user.username;
}

function memberFrom(
  user: TargetUserRow,
  source: ResolvedTargetMember['source'],
): ResolvedTargetMember {
  return {
    id: user.id,
    loginName: loginName(user),
    username: user.username,
    displayName: displayName(user),
    email: user.email ?? '',
    levelId: user.employee_level_id,
    levelCode: user.level_code,
    levelName: user.level_name,
    currentLevel:
      user.employee_level_id && user.level_code && user.level_name
        ? { id: user.employee_level_id, code: user.level_code, name: user.level_name }
        : null,
    source,
  };
}

async function activeLevel(
  database: Database,
  levelId: number | null,
  label: string,
): Promise<DbEmployeeLevel | null> {
  if (levelId === null) return null;
  const level = await database.get<DbEmployeeLevel>('SELECT * FROM employee_levels WHERE id = ?', [
    levelId,
  ]);
  if (!level) throw new AssignmentTargetingError(`${label} no longer exists`, 409, 'LEVEL_MISSING');
  if (level.is_active !== 1) {
    throw new AssignmentTargetingError(`${label} is inactive`, 409, 'LEVEL_INACTIVE');
  }
  return level;
}

function canonicalUser(user: TargetUserRow): unknown[] {
  return [
    user.id,
    loginName(user),
    displayName(user),
    user.email ?? '',
    user.employee_level_id,
    user.level_code,
    user.level_name,
    user.is_banned,
  ];
}

export async function resolveAssignmentTarget(
  database: Database,
  assignment: DbAssignment,
): Promise<ResolvedAssignmentTarget> {
  const [targetLevel, promotionTargetLevel, overrides, quiz] = await Promise.all([
    activeLevel(database, assignment.target_level_id, 'Target level'),
    activeLevel(database, assignment.promotion_target_level_id, 'Promotion target level'),
    database.all<OverrideRow[]>(
      `SELECT user_id, action FROM assignment_target_overrides
       WHERE assignment_id = ? ORDER BY user_id`,
      [assignment.id],
    ),
    assignment.quiz_id
      ? database.get<Pick<DbQuiz, 'recommended_level_id'>>(
          'SELECT recommended_level_id FROM quizzes WHERE id = ?',
          [assignment.quiz_id],
        )
      : null,
  ]);

  if (assignment.target_mode === 'current_level' && !targetLevel) {
    throw new AssignmentTargetingError('Current-level targeting requires a target level');
  }
  if (assignment.target_mode === 'promotion' && (!targetLevel || !promotionTargetLevel)) {
    throw new AssignmentTargetingError(
      'Promotion targeting requires source and destination levels',
    );
  }

  const observed = new Map<number, TargetUserRow>();
  const base = new Map<number, ResolvedTargetMember>();
  let matchedCount = 0;

  const selectUsers = async (whereSql: string, values: unknown[]): Promise<TargetUserRow[]> => {
    const rows = await database.all<TargetUserRow[]>(
      `SELECT u.id, u.login_name, u.email, u.username, u.play_display_name, u.is_banned,
              u.employee_level_id, l.code AS level_code, l.name AS level_name
       FROM users u
       LEFT JOIN employee_levels l ON l.id = u.employee_level_id
       WHERE ${whereSql}
       ORDER BY u.id`,
      values,
    );
    rows.forEach((row) => {
      observed.set(row.id, row);
    });
    return rows;
  };

  if (assignment.target_mode === 'manual') {
    const rows = await selectUsers(
      `u.id IN (
        SELECT user_id FROM assignment_members WHERE assignment_id = ? AND user_id IS NOT NULL
      )`,
      [assignment.id],
    );
    matchedCount = rows.length;
    rows
      .filter((user) => user.is_banned === 0)
      .forEach((user) => {
        base.set(user.id, memberFrom(user, 'manual'));
      });
  } else {
    const sourceLevelId = targetLevel?.id as number;
    const rows = await selectUsers('u.employee_level_id = ? AND u.is_banned = 0', [sourceLevelId]);
    matchedCount = rows.length;
    if (assignment.target_mode === 'current_level') {
      rows.forEach((user) => {
        base.set(user.id, memberFrom(user, 'rule'));
      });
    }
    // Promotion intentionally has no automatic selection. The source-level rows
    // are the candidate pool and explicit include overrides form the final list.
  }

  const warnings: AssignmentTargetWarning[] = [];
  for (const override of overrides) {
    let user = observed.get(override.user_id);
    if (!user) {
      [user] = await selectUsers('u.id = ?', [override.user_id]);
    }
    if (!user) {
      warnings.push({
        code: 'OVERRIDE_USER_MISSING',
        message: 'An override references a user who no longer exists.',
        userId: override.user_id,
      });
      continue;
    }
    if (override.action === 'exclude') {
      base.delete(user.id);
      continue;
    }
    if (user.is_banned !== 0) {
      base.delete(user.id);
      warnings.push({
        code: 'OVERRIDE_USER_BANNED',
        message: 'A banned user cannot be included.',
        userId: user.id,
      });
      continue;
    }
    if (targetLevel && user.employee_level_id !== targetLevel.id) {
      warnings.push({
        code: 'OVERRIDE_OUTSIDE_TARGET_LEVEL',
        message: 'An included user is outside the source target level.',
        userId: user.id,
      });
    }
    base.set(user.id, memberFrom(user, 'override_include'));
  }

  const expectedQuizLevel =
    assignment.target_mode === 'promotion' ? promotionTargetLevel?.id : targetLevel?.id;
  if (
    quiz?.recommended_level_id &&
    expectedQuizLevel &&
    quiz.recommended_level_id !== expectedQuizLevel
  ) {
    warnings.push({
      code: 'QUIZ_LEVEL_MISMATCH',
      message: 'The quiz recommended level differs from this assignment target.',
    });
  }

  const members = [...base.values()].sort((left, right) => left.id - right.id);
  const fingerprintPayload = {
    assignment: [
      assignment.id,
      assignment.quiz_id,
      assignment.assignment_kind,
      assignment.target_mode,
      assignment.audience_mode,
      assignment.target_level_id,
      targetLevel?.code ?? null,
      targetLevel?.name ?? null,
      assignment.promotion_target_level_id,
      promotionTargetLevel?.code ?? null,
      promotionTargetLevel?.name ?? null,
      quiz?.recommended_level_id ?? null,
    ],
    overrides: overrides.map((override) => [override.user_id, override.action]),
    observedUsers: [...observed.values()]
      .sort((left, right) => left.id - right.id)
      .map(canonicalUser),
    finalMembers: members.map((member) => [member.id, member.source]),
  };
  const fingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify(fingerprintPayload))
    .digest('hex');

  return {
    targetLevel,
    promotionTargetLevel,
    matchedCount,
    finalCount: members.length,
    members,
    warnings,
    fingerprint,
  };
}
