import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

let temporaryDataDir = '';
let databaseModule: typeof import('./db');
let assignmentService: typeof import('./assignmentService');
let levelService: typeof import('./employeeLevels');
let quizId = 0;
let cs1Id = 0;
let cs2Id = 0;
let cs3Id = 0;
let aliceId = 0;
let bobId = 0;
let outsiderId = 0;
let bannedId = 0;
let unclassifiedId = 0;

const admin = { id: 0, role: 'super_admin' as const, username: 'admin' };

async function addUser(loginName: string, levelId: number | null, banned = false): Promise<number> {
  const result = await databaseModule.db.run(
    `INSERT INTO users
       (login_name, email, username, password_hash, is_banned, employee_level_id)
     VALUES (?, ?, ?, 'not-used', ?, ?)`,
    loginName,
    `${loginName}@example.com`,
    loginName,
    banned ? 1 : 0,
    levelId,
  );
  return Number(result.lastID);
}

before(async () => {
  temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'til-quiz-smart-target-'));
  process.env.DATA_DIR = temporaryDataDir;
  process.env.ADMIN_PASSWORD = 'smart-target-test-admin-password';
  process.env.JWT_SECRET = 'smart-target-test-jwt-secret-at-least-32-characters';

  databaseModule = await import('./db');
  assignmentService = await import('./assignmentService');
  levelService = await import('./employeeLevels');

  await databaseModule.initDb();
  await databaseModule.db.close();
  await databaseModule.initDb();

  const levels = await databaseModule.db.all<Array<{ id: number; code: string }>>(
    'SELECT id, code FROM employee_levels ORDER BY code',
  );
  assert.deepEqual(
    levels.map((level) => level.code),
    ['CS1', 'CS2', 'CS3'],
  );
  cs1Id = levels.find((level) => level.code === 'CS1')?.id as number;
  cs2Id = levels.find((level) => level.code === 'CS2')?.id as number;
  cs3Id = levels.find((level) => level.code === 'CS3')?.id as number;

  aliceId = await addUser('alice', cs1Id);
  bobId = await addUser('bob', cs1Id);
  outsiderId = await addUser('outsider', cs2Id);
  bannedId = await addUser('banned', cs1Id, true);
  unclassifiedId = await addUser('unclassified', null);

  const quiz = await databaseModule.db.run(
    `INSERT INTO quizzes
       (title, description, language, owner_kind, recommended_level_id)
     VALUES ('Smart assignment source', '', 'vi', 'admin', ?)`,
    cs2Id,
  );
  quizId = Number(quiz.lastID);
  await databaseModule.db.run(
    `INSERT INTO questions (
       quiz_id, text, options, correct_index, base_score, time_sec, order_index, question_type
     ) VALUES (?, 'Question', '["A","B"]', 0, 500, 20, 0, 'multiple_choice')`,
    quizId,
  );
});

after(async () => {
  if (databaseModule?.db) await databaseModule.db.close();
  if (temporaryDataDir) fs.rmSync(temporaryDataDir, { recursive: true, force: true });
});

describe('Phase 5B employee levels and smart assignment targeting', () => {
  it('migrates idempotently, leaves old users unclassified, and keeps database checks clean', async () => {
    const unclassified = await databaseModule.db.get<{ employee_level_id: number | null }>(
      'SELECT employee_level_id FROM users WHERE id = ?',
      [unclassifiedId],
    );
    assert.equal(unclassified?.employee_level_id, null);
    assert.equal(
      (await databaseModule.db.get<{ integrity_check: string }>('PRAGMA integrity_check'))
        ?.integrity_check,
      'ok',
    );
    assert.deepEqual(await databaseModule.db.all('PRAGMA foreign_key_check'), []);
  });

  it('changes a level and history atomically with optimistic concurrency and inactive validation', async () => {
    const changed = await levelService.changeEmployeeLevel(admin, unclassifiedId, {
      employeeLevelId: cs1Id,
      expectedCurrentLevelId: null,
      reason: 'Initial classification',
    });
    assert.equal(changed.user.employee_level_id, cs1Id);
    assert.equal(changed.historyCreated, true);
    const history = await databaseModule.db.get<{
      old_level_code_snapshot: string | null;
      new_level_code_snapshot: string | null;
      reason: string | null;
    }>('SELECT * FROM employee_level_history WHERE user_id = ?', [unclassifiedId]);
    assert.equal(history?.old_level_code_snapshot, null);
    assert.equal(history?.new_level_code_snapshot, 'CS1');
    assert.equal(history?.reason, 'Initial classification');

    await assert.rejects(
      levelService.changeEmployeeLevel(admin, unclassifiedId, {
        employeeLevelId: cs2Id,
        expectedCurrentLevelId: null,
      }),
      (error: unknown) =>
        error instanceof levelService.EmployeeLevelError && error.code === 'EMPLOYEE_LEVEL_CHANGED',
    );

    await levelService.updateEmployeeLevel(cs3Id, { isActive: false });
    await assert.rejects(
      levelService.changeEmployeeLevel(admin, unclassifiedId, {
        employeeLevelId: cs3Id,
        expectedCurrentLevelId: cs1Id,
      }),
      (error: unknown) =>
        error instanceof levelService.EmployeeLevelError && error.code === 'LEVEL_INACTIVE',
    );
    await levelService.updateEmployeeLevel(cs3Id, { isActive: true });
  });

  it('previews current-level rules, applies exceptions, and fingerprints all relevant changes', async () => {
    const assignment = await assignmentService.createDraftAssignment(admin, {
      quizId,
      title: 'Current CS1',
      audienceMode: 'members',
      targetMode: 'current_level',
      targetLevelId: cs1Id,
      assignmentKind: 'periodic',
    });
    await assignmentService.setAssignmentTargetOverrides(admin, assignment.id, [
      { userId: bobId, action: 'exclude' },
      { userId: outsiderId, action: 'include' },
      { userId: bannedId, action: 'include' },
    ]);
    const first = await assignmentService.previewAssignmentTarget(admin, assignment.id);
    const second = await assignmentService.previewAssignmentTarget(admin, assignment.id);
    assert.equal(first.fingerprint, second.fingerprint);
    assert.equal(first.matchedCount, 3);
    assert.deepEqual(
      first.members.map((member) => member.id),
      [aliceId, outsiderId, unclassifiedId],
    );
    assert.equal(
      first.members.find((member) => member.id === outsiderId)?.source,
      'override_include',
    );
    assert(first.warnings.some((warning) => warning.code === 'OVERRIDE_OUTSIDE_TARGET_LEVEL'));
    assert(first.warnings.some((warning) => warning.code === 'OVERRIDE_USER_BANNED'));
    assert(first.warnings.some((warning) => warning.code === 'QUIZ_LEVEL_MISMATCH'));
    assert.equal(
      (
        await databaseModule.db.get<{ count: number }>(
          'SELECT COUNT(*) AS count FROM assignment_members WHERE assignment_id = ?',
          [assignment.id],
        )
      )?.count,
      0,
    );

    await databaseModule.db.run(
      'UPDATE users SET employee_level_id = ? WHERE id = ?',
      cs2Id,
      aliceId,
    );
    const afterLevel = await assignmentService.previewAssignmentTarget(admin, assignment.id);
    assert.notEqual(afterLevel.fingerprint, first.fingerprint);
    await databaseModule.db.run(
      'UPDATE users SET employee_level_id = ? WHERE id = ?',
      cs1Id,
      aliceId,
    );

    await databaseModule.db.run('UPDATE users SET is_banned = 1 WHERE id = ?', bobId);
    const afterBan = await assignmentService.previewAssignmentTarget(admin, assignment.id);
    assert.notEqual(afterBan.fingerprint, first.fingerprint);
    await databaseModule.db.run('UPDATE users SET is_banned = 0 WHERE id = ?', bobId);

    await assignmentService.setAssignmentTargetOverrides(admin, assignment.id, [
      { userId: outsiderId, action: 'include' },
    ]);
    const afterOverride = await assignmentService.previewAssignmentTarget(admin, assignment.id);
    assert.notEqual(afterOverride.fingerprint, first.fingerprint);
  });

  it('publishes only a confirmed target and preserves immutable member and target snapshots', async () => {
    const assignment = await assignmentService.createDraftAssignment(admin, {
      quizId,
      title: 'Publish CS1',
      targetMode: 'current_level',
      targetLevelId: cs1Id,
    });
    const preview = await assignmentService.previewAssignmentTarget(admin, assignment.id);
    const published = await assignmentService.publishAssignment(
      admin,
      assignment.id,
      preview.fingerprint,
    );
    assert.equal(published.status, 'published');
    assert.equal(published.target_level_code_snapshot, 'CS1');
    const aliceSnapshot = await databaseModule.db.get<{
      level_code_snapshot: string | null;
      level_name_snapshot: string | null;
    }>('SELECT * FROM assignment_members WHERE assignment_id = ? AND user_id = ?', [
      assignment.id,
      aliceId,
    ]);
    assert.equal(aliceSnapshot?.level_code_snapshot, 'CS1');
    await databaseModule.db.run(
      'UPDATE users SET employee_level_id = ? WHERE id = ?',
      cs2Id,
      aliceId,
    );
    assert.equal(
      (
        await databaseModule.db.get<{ level_code_snapshot: string | null }>(
          'SELECT level_code_snapshot FROM assignment_members WHERE assignment_id = ? AND user_id = ?',
          [assignment.id, aliceId],
        )
      )?.level_code_snapshot,
      'CS1',
    );
    await databaseModule.db.run(
      'UPDATE users SET employee_level_id = ? WHERE id = ?',
      cs1Id,
      aliceId,
    );
    await assert.rejects(
      assignmentService.publishAssignment(admin, assignment.id, preview.fingerprint),
      (error: unknown) =>
        error instanceof assignmentService.AssignmentServiceError && error.statusCode === 409,
    );
  });

  it('rejects a stale publish fingerprint with a fresh preview', async () => {
    const assignment = await assignmentService.createDraftAssignment(admin, {
      quizId,
      title: 'Stale target',
      targetMode: 'current_level',
      targetLevelId: cs1Id,
    });
    const preview = await assignmentService.previewAssignmentTarget(admin, assignment.id);
    await databaseModule.db.run('UPDATE users SET is_banned = 1 WHERE id = ?', aliceId);
    await assert.rejects(
      assignmentService.publishAssignment(admin, assignment.id, preview.fingerprint),
      (error: unknown) => {
        if (!(error instanceof assignmentService.AssignmentServiceError)) return false;
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, 'TARGET_CHANGED');
        assert.ok(error.details);
        return true;
      },
    );
    await databaseModule.db.run('UPDATE users SET is_banned = 0 WHERE id = ?', aliceId);
  });

  it('uses promotion users as candidates only and never changes their current level', async () => {
    await assert.rejects(
      assignmentService.createDraftAssignment(admin, {
        quizId,
        title: 'Invalid promotion',
        targetMode: 'promotion',
        targetLevelId: cs1Id,
        promotionTargetLevelId: cs1Id,
      }),
      assignmentService.AssignmentServiceError,
    );
    const assignment = await assignmentService.createDraftAssignment(admin, {
      quizId,
      title: 'CS1 to CS2',
      assignmentKind: 'promotion',
      targetMode: 'promotion',
      targetLevelId: cs1Id,
      promotionTargetLevelId: cs2Id,
    });
    const empty = await assignmentService.previewAssignmentTarget(admin, assignment.id);
    assert.equal(empty.matchedCount, 3);
    assert.equal(empty.finalCount, 0);
    await assert.rejects(
      assignmentService.publishAssignment(admin, assignment.id, empty.fingerprint),
      (error: unknown) =>
        error instanceof assignmentService.AssignmentServiceError && error.statusCode === 400,
    );
    await assignmentService.setAssignmentTargetOverrides(admin, assignment.id, [
      { userId: aliceId, action: 'include' },
    ]);
    const selected = await assignmentService.previewAssignmentTarget(admin, assignment.id);
    assert.deepEqual(
      selected.members.map((member) => member.id),
      [aliceId],
    );
    await assignmentService.publishAssignment(admin, assignment.id, selected.fingerprint);
    assert.equal(
      (
        await databaseModule.db.get<{ employee_level_id: number | null }>(
          'SELECT employee_level_id FROM users WHERE id = ?',
          [aliceId],
        )
      )?.employee_level_id,
      cs1Id,
    );
  });

  it('keeps legacy manual draft publication compatible without a fingerprint', async () => {
    const assignment = await assignmentService.createDraftAssignment(admin, {
      quizId,
      title: 'Legacy manual',
    });
    await assignmentService.setAssignmentMembers(admin, assignment.id, [bobId]);
    const published = await assignmentService.publishAssignment(admin, assignment.id);
    assert.equal(published.target_mode, 'manual');
    assert.equal(published.assignment_kind, 'general');
    assert.equal(published.status, 'published');
  });
});
