import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

let temporaryDataDir = '';
let databaseModule: typeof import('./db');
let assignmentService: typeof import('./assignmentService');
let generation: typeof import('./questionGeneration');
let importer: typeof import('./questionBankImport');
let reporting: typeof import('./assignmentReporting');
let scoring: typeof import('./assignmentScoring');
let cs1Id = 0;
let cs2Id = 0;
let categoryId = 0;
let userId = 0;

const admin = { id: 0, role: 'super_admin' as const, username: 'admin' };

async function addBankQuestion(
  index: number,
  overrides: { enabled?: boolean; minimumLevelId?: number; baseScore?: number } = {},
): Promise<number> {
  const now = Date.now();
  const result = await databaseModule.db.run(
    `INSERT INTO bank_questions (
       source_bank_id, source_question_id, source_bank_version, source_content_hash,
       question_type, text, options, correct_index, base_score, time_sec,
       category_id, topic, minimum_level_id, difficulty, competency_code, critical,
       recommended_seconds, source_metadata_json, is_enabled, revision, created_at_ms, updated_at_ms
     ) VALUES ('test-bank', ?, 'v1', ?, 'multiple_choice', ?, '["A","B"]', 0,
               ?, 30, ?, 'Test topic', ?, 'medium', 'application', ?, 30, '{}', ?, 1, ?, ?)`,
    `Q-${index}`,
    `hash-${index}`,
    `Question ${index}`,
    overrides.baseScore ?? 500,
    categoryId,
    overrides.minimumLevelId ?? cs1Id,
    index % 2,
    overrides.enabled === false ? 0 : 1,
    now,
    now,
  );
  return Number(result.lastID);
}

async function createDynamicQuiz(
  count: number,
  patch: Partial<import('./types').QuizGenerationRuleInput> = {},
): Promise<number> {
  const quiz = await databaseModule.db.run(
    `INSERT INTO quizzes (
       title, description, language, owner_kind, quiz_mode, selection_mode, blueprint_revision
     ) VALUES (?, '', 'vi', 'admin', 'bank_generated', 'per_assignment', 1)`,
    `Dynamic ${Date.now()}-${Math.random()}`,
  );
  const quizId = Number(quiz.lastID);
  const rules = generation.normalizeGenerationRules([
    {
      categoryId,
      minimumLevelId: cs1Id,
      difficulty: 'medium',
      questionCount: count,
      ...patch,
    },
  ]);
  await generation.insertGenerationRules(databaseModule.db, quizId, rules);
  return quizId;
}

before(async () => {
  temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'til-quiz-question-bank-'));
  process.env.DATA_DIR = temporaryDataDir;
  process.env.ADMIN_PASSWORD = 'question-bank-test-admin-password';
  process.env.JWT_SECRET = 'question-bank-test-jwt-secret-at-least-32-characters';
  databaseModule = await import('./db');
  assignmentService = await import('./assignmentService');
  generation = await import('./questionGeneration');
  importer = await import('./questionBankImport');
  reporting = await import('./assignmentReporting');
  scoring = await import('./assignmentScoring');
  await databaseModule.initDb();
  await databaseModule.db.close();
  await databaseModule.initDb();

  const level = await databaseModule.db.get<{ id: number }>(
    "SELECT id FROM employee_levels WHERE code = 'CS1'",
  );
  const category = await databaseModule.db.get<{ id: number }>(
    "SELECT id FROM question_categories WHERE code = 'THU_TUC_HAI_QUAN'",
  );
  const cs2 = await databaseModule.db.get<{ id: number }>(
    "SELECT id FROM employee_levels WHERE code = 'CS2'",
  );
  cs1Id = level?.id as number;
  cs2Id = cs2?.id as number;
  categoryId = category?.id as number;
  const user = await databaseModule.db.run(
    `INSERT INTO users (login_name, username, password_hash, employee_level_id)
     VALUES ('dynamic-user', 'Dynamic User', 'not-used', ?)`,
    cs1Id,
  );
  userId = Number(user.lastID);
  for (let index = 1; index <= 30; index += 1) await addBankQuestion(index);
});

after(async () => {
  if (databaseModule?.db) await databaseModule.db.close();
  if (temporaryDataDir) fs.rmSync(temporaryDataDir, { recursive: true, force: true });
});

describe('Phase 7B Question Bank and dynamic assignment generation', () => {
  it('reports static and dynamic question counts from the quiz list API', async () => {
    const staticQuiz = await databaseModule.db.run(
      `INSERT INTO quizzes (title, description, owner_kind, quiz_mode)
       VALUES ('Static count test', '', 'admin', 'static')`,
    );
    for (let index = 0; index < 3; index += 1) {
      await databaseModule.db.run(
        `INSERT INTO questions (quiz_id, text, options, correct_index, order_index)
         VALUES (?, ?, '["A","B"]', 0, ?)`,
        staticQuiz.lastID,
        `Static question ${index + 1}`,
        index,
      );
    }

    const dynamicQuizId = await createDynamicQuiz(2);
    await generation.insertGenerationRules(
      databaseModule.db,
      dynamicQuizId,
      generation.normalizeGenerationRules([
        {
          categoryId,
          minimumLevelId: cs2Id,
          difficulty: 'hard',
          questionCount: 3,
        },
      ]),
    );
    const emptyDynamic = await databaseModule.db.run(
      `INSERT INTO quizzes (title, description, owner_kind, quiz_mode, selection_mode)
       VALUES ('Empty dynamic count test', '', 'admin', 'bank_generated', 'per_assignment')`,
    );

    const [{ default: express }, { authRouter }, { adminRouter }] = await Promise.all([
      import('express'),
      import('./routes/auth'),
      import('./routes/admin'),
    ]);
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
    app.use('/api/admin', adminRouter);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          identifier: 'admin',
          password: 'question-bank-test-admin-password',
        }),
      });
      assert.equal(login.status, 200);
      const token = ((await login.json()) as { token: string }).token;
      const response = await fetch(`${baseUrl}/api/admin/quizzes`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(response.status, 200);
      const quizzes = (await response.json()) as Array<{ id: number; question_count: number }>;
      assert.equal(quizzes.find((quiz) => quiz.id === staticQuiz.lastID)?.question_count, 3);
      assert.equal(quizzes.find((quiz) => quiz.id === dynamicQuizId)?.question_count, 5);
      assert.equal(quizzes.find((quiz) => quiz.id === emptyDynamic.lastID)?.question_count, 0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('imports idempotently and reports changed source content as a conflict', async () => {
    const filename = path.join(temporaryDataDir, 'test-source-bank.json');
    const source = {
      schema_version: '2.0',
      bank_id: 'test-import-bank',
      bank_version: 'v1',
      question_count: 1,
      questions: [
        {
          id: 'IMPORT-001',
          minimum_level: 'CS1',
          topic: 'Quy trình khai báo',
          competency: { code: 'must_remember', label_vi: 'Phải nhớ' },
          type: 'single_choice',
          difficulty: { code: 'easy', label_vi: 'Dễ' },
          critical: false,
          prompt: 'Imported question',
          options: [
            { id: 'A', text: 'Correct' },
            { id: 'B', text: 'Incorrect' },
          ],
          answer: { correct_option_id: 'A' },
          explanation: 'Explanation',
          legal: {
            basis: 'Basis',
            reference: 'Reference',
            review_required: true,
            reviewed_on: '2026-10-06',
          },
          timing: { recommended_seconds: 45, enforced_per_question: false },
          presentation: {
            shuffle_options: true,
            shuffle_ordering_items: false,
            show_explanation_after_submit: true,
          },
          scoring: { points: 1 },
        },
      ],
    };
    fs.writeFileSync(filename, JSON.stringify(source));
    const first = await importer.importSourceQuestionBank(filename);
    assert.equal(first.insertedCount, 1);
    const rerun = await importer.importSourceQuestionBank(filename);
    assert.equal(rerun.skippedCount, 1);
    source.questions[0].prompt = 'Changed imported question';
    fs.writeFileSync(filename, JSON.stringify(source));
    const dryRun = await importer.importSourceQuestionBank(filename, { dryRun: true });
    assert.equal(dryRun.conflictCount, 1);
    await assert.rejects(
      importer.importSourceQuestionBank(filename),
      importer.QuestionBankImportError,
    );
    assert.equal(
      (
        await databaseModule.db.get<{ text: string }>(
          `SELECT text FROM bank_questions
           WHERE source_bank_id = 'test-import-bank' AND source_question_id = 'IMPORT-001'`,
        )
      )?.text,
      'Imported question',
    );
  });

  it('migrates twice without changing legacy data and seeds the 12 categories', async () => {
    assert.equal(
      (
        await databaseModule.db.get<{ count: number }>(
          'SELECT COUNT(*) AS count FROM question_categories',
        )
      )?.count,
      12,
    );
    assert.equal(
      (await databaseModule.db.get<{ integrity_check: string }>('PRAGMA integrity_check'))
        ?.integrity_check,
      'ok',
    );
    assert.deepEqual(await databaseModule.db.all('PRAGMA foreign_key_check'), []);
  });

  it('rejects overlapping rules and reports an insufficient pool', async () => {
    const overlapping = generation.normalizeGenerationRules([
      { categoryId, questionCount: 2 },
      { categoryId, difficulty: 'medium', questionCount: 2 },
    ]);
    await assert.rejects(
      generation.validateGenerationRuleSet(databaseModule.db, overlapping),
      (error: unknown) =>
        error instanceof generation.QuestionGenerationError &&
        error.code === 'QUESTION_RULES_OVERLAP',
    );

    const quizId = await createDynamicQuiz(31);
    await assert.rejects(
      generation.resolveQuestionSelection(databaseModule.db, quizId, 'seed'),
      (error: unknown) =>
        error instanceof generation.QuestionGenerationError &&
        error.code === 'QUESTION_POOL_INSUFFICIENT',
    );
  });

  it('selects deterministically without duplicates and changes when regenerated', async () => {
    const quizId = await createDynamicQuiz(10);
    const first = await generation.resolveQuestionSelection(databaseModule.db, quizId, 'seed-a');
    const repeated = await generation.resolveQuestionSelection(databaseModule.db, quizId, 'seed-a');
    const regenerated = await generation.resolveQuestionSelection(
      databaseModule.db,
      quizId,
      'seed-b',
    );
    assert.equal(first.selectionFingerprint, repeated.selectionFingerprint);
    assert.deepEqual(
      first.selected.map((item) => item.question.id),
      repeated.selected.map((item) => item.question.id),
    );
    assert.equal(new Set(first.selected.map((item) => item.question.id)).size, 10);
    assert.notEqual(first.selectionFingerprint, regenerated.selectionFingerprint);
    assert.notDeepEqual(
      first.selected.map((item) => item.question.id),
      regenerated.selected.map((item) => item.question.id),
    );
  });

  it('publishes the exact approved dynamic preview with provenance and Smart Target', async () => {
    const quizId = await createDynamicQuiz(20);
    const assignment = await assignmentService.createDraftAssignment(admin, {
      quizId,
      title: 'Dynamic + smart target',
      targetMode: 'current_level',
      targetLevelId: cs1Id,
    });
    const target = await assignmentService.previewAssignmentTarget(admin, assignment.id);
    const questionPreview = await generation.createAssignmentQuestionPreview(admin, assignment.id);
    assert(
      questionPreview.selected.every(
        (item) => item.effectiveTimeSec === 25 && item.effectiveTimeSource === 'auto',
      ),
    );
    const published = await assignmentService.publishAssignment(admin, assignment.id, {
      targetFingerprint: target.fingerprint,
      questionFingerprint: questionPreview.selectionFingerprint,
    });
    assert.equal(published.status, 'published');
    assert.equal(published.question_selection_mode_snapshot, 'per_assignment');
    const snapshots = await databaseModule.db.all<
      Array<{
        source_bank_question_id: number | null;
        source_bank_question_revision: number | null;
        source_category_code: string | null;
        minimum_level_code_snapshot: string | null;
        time_sec: number;
      }>
    >('SELECT * FROM assignment_questions WHERE assignment_id = ? ORDER BY order_index', [
      assignment.id,
    ]);
    assert.equal(snapshots.length, 20);
    assert(snapshots.every((snapshot) => snapshot.source_bank_question_id !== null));
    assert(snapshots.every((snapshot) => snapshot.source_bank_question_revision === 1));
    assert(snapshots.every((snapshot) => snapshot.source_category_code === 'THU_TUC_HAI_QUAN'));
    assert(snapshots.every((snapshot) => snapshot.minimum_level_code_snapshot === 'CS1'));
    assert(snapshots.every((snapshot) => snapshot.time_sec === 25));
    assert.equal(
      (
        await databaseModule.db.get<{ count: number }>(
          'SELECT COUNT(*) AS count FROM assignment_members WHERE assignment_id = ? AND user_id = ?',
          [assignment.id, userId],
        )
      )?.count,
      1,
    );
  });

  it('snapshots level-weighted scores without changing Bank Question base scores', async () => {
    const cs2QuestionIds: number[] = [];
    for (let index = 3001; index <= 3004; index += 1) {
      cs2QuestionIds.push(await addBankQuestion(index, { minimumLevelId: cs2Id, baseScore: 500 }));
    }
    const quiz = await databaseModule.db.run(
      `INSERT INTO quizzes (
         title, description, language, owner_kind, quiz_mode, selection_mode, blueprint_revision
       ) VALUES ('Weighted dynamic', '', 'vi', 'admin', 'bank_generated', 'per_assignment', 1)`,
    );
    const quizId = Number(quiz.lastID);
    await generation.insertGenerationRules(
      databaseModule.db,
      quizId,
      generation.normalizeGenerationRules([
        {
          categoryId,
          minimumLevelId: cs1Id,
          questionCount: 2,
          pointsOverride: 100,
        },
        {
          categoryId,
          minimumLevelId: cs2Id,
          questionCount: 2,
          pointsOverride: 150,
        },
      ]),
    );
    const assignment = await assignmentService.createDraftAssignment(admin, {
      quizId,
      title: 'Weighted score staging',
      targetMode: 'current_level',
      targetLevelId: cs1Id,
    });
    const target = await assignmentService.previewAssignmentTarget(admin, assignment.id);
    const preview = await generation.createAssignmentQuestionPreview(admin, assignment.id);
    await assignmentService.publishAssignment(admin, assignment.id, {
      targetFingerprint: target.fingerprint,
      questionFingerprint: preview.selectionFingerprint,
    });

    const snapshots = await databaseModule.db.all<import('./types').DbAssignmentQuestion[]>(
      'SELECT * FROM assignment_questions WHERE assignment_id = ? ORDER BY order_index',
      assignment.id,
    );
    const cs1Snapshots = snapshots.filter(
      (question) => question.minimum_level_code_snapshot === 'CS1',
    );
    const cs2Snapshots = snapshots.filter(
      (question) => question.minimum_level_code_snapshot === 'CS2',
    );
    assert.equal(cs1Snapshots.length, 2);
    assert.equal(cs2Snapshots.length, 2);
    assert(cs1Snapshots.every((question) => question.base_score === 100));
    assert(cs2Snapshots.every((question) => question.base_score === 150));
    assert.equal(
      snapshots.reduce((sum, question) => sum + question.base_score, 0),
      500,
    );
    assert.equal(
      scoring.gradeAssignmentAnswer(cs2Snapshots[0], { chosenIndex: 0 }, 1, false).score,
      150,
    );
    assert.equal(
      (await reporting.getAssignmentReport(admin, assignment.id)).assignment.maxScore,
      500,
    );

    const sourceScores = await databaseModule.db.all<Array<{ base_score: number }>>(
      `SELECT base_score FROM bank_questions
       WHERE id IN (${cs2QuestionIds.map(() => '?').join(', ')})`,
      cs2QuestionIds,
    );
    assert.equal(sourceScores.length, 4);
    assert(sourceScores.every((question) => question.base_score === 500));
  });

  it('fails safely when the pool changes and writes no members or question snapshots', async () => {
    const quizId = await createDynamicQuiz(5);
    const assignment = await assignmentService.createDraftAssignment(admin, {
      quizId,
      title: 'Stale pool',
      targetMode: 'current_level',
      targetLevelId: cs1Id,
    });
    const target = await assignmentService.previewAssignmentTarget(admin, assignment.id);
    const preview = await generation.createAssignmentQuestionPreview(admin, assignment.id);
    await addBankQuestion(1000);
    await assert.rejects(
      assignmentService.publishAssignment(admin, assignment.id, {
        targetFingerprint: target.fingerprint,
        questionFingerprint: preview.selectionFingerprint,
      }),
      (error: unknown) =>
        error instanceof assignmentService.AssignmentServiceError &&
        error.code === 'QUESTION_POOL_CHANGED',
    );
    assert.equal(
      (
        await databaseModule.db.get<{ count: number }>(
          'SELECT COUNT(*) AS count FROM assignment_questions WHERE assignment_id = ?',
          [assignment.id],
        )
      )?.count,
      0,
    );
    assert.equal(
      (
        await databaseModule.db.get<{ count: number }>(
          'SELECT COUNT(*) AS count FROM assignment_members WHERE assignment_id = ?',
          [assignment.id],
        )
      )?.count,
      0,
    );
  });

  it('fails safely when Smart Target changes after a valid question preview', async () => {
    const quizId = await createDynamicQuiz(5);
    const assignment = await assignmentService.createDraftAssignment(admin, {
      quizId,
      title: 'Stale target',
      targetMode: 'current_level',
      targetLevelId: cs1Id,
    });
    const target = await assignmentService.previewAssignmentTarget(admin, assignment.id);
    const preview = await generation.createAssignmentQuestionPreview(admin, assignment.id);
    await databaseModule.db.run('UPDATE users SET is_banned = 1 WHERE id = ?', userId);
    await assert.rejects(
      assignmentService.publishAssignment(admin, assignment.id, {
        targetFingerprint: target.fingerprint,
        questionFingerprint: preview.selectionFingerprint,
      }),
      (error: unknown) =>
        error instanceof assignmentService.AssignmentServiceError &&
        error.code === 'TARGET_CHANGED',
    );
    await databaseModule.db.run('UPDATE users SET is_banned = 0 WHERE id = ?', userId);
    assert.equal(
      (
        await databaseModule.db.get<{ count: number }>(
          'SELECT COUNT(*) AS count FROM assignment_questions WHERE assignment_id = ?',
          [assignment.id],
        )
      )?.count,
      0,
    );
  });

  it('fails safely with no partial writes when both the pool and Smart Target change', async () => {
    const quizId = await createDynamicQuiz(5);
    const assignment = await assignmentService.createDraftAssignment(admin, {
      quizId,
      title: 'Stale pool and target',
      targetMode: 'current_level',
      targetLevelId: cs1Id,
    });
    const target = await assignmentService.previewAssignmentTarget(admin, assignment.id);
    const preview = await generation.createAssignmentQuestionPreview(admin, assignment.id);
    await addBankQuestion(2000);
    await databaseModule.db.run('UPDATE users SET is_banned = 1 WHERE id = ?', userId);

    try {
      await assert.rejects(
        assignmentService.publishAssignment(admin, assignment.id, {
          targetFingerprint: target.fingerprint,
          questionFingerprint: preview.selectionFingerprint,
        }),
        (error: unknown) =>
          error instanceof assignmentService.AssignmentServiceError &&
          error.code === 'QUESTION_POOL_CHANGED',
      );
      assert.equal(
        (
          await databaseModule.db.get<{ count: number }>(
            'SELECT COUNT(*) AS count FROM assignment_questions WHERE assignment_id = ?',
            [assignment.id],
          )
        )?.count,
        0,
      );
      assert.equal(
        (
          await databaseModule.db.get<{ count: number }>(
            'SELECT COUNT(*) AS count FROM assignment_members WHERE assignment_id = ?',
            [assignment.id],
          )
        )?.count,
        0,
      );
    } finally {
      await databaseModule.db.run('UPDATE users SET is_banned = 0 WHERE id = ?', userId);
    }
  });

  it('invalidates pools when a question revision, enabled flag, or category state changes', async () => {
    const quizId = await createDynamicQuiz(5);
    const initial = await generation.resolveQuestionSelection(databaseModule.db, quizId, 'stable');
    const selectedId = initial.selected[0].question.id;
    await databaseModule.db.run(
      'UPDATE bank_questions SET revision = revision + 1 WHERE id = ?',
      selectedId,
    );
    const revised = await generation.resolveQuestionSelection(databaseModule.db, quizId, 'stable');
    assert.notEqual(revised.poolFingerprint, initial.poolFingerprint);
    await databaseModule.db.run(
      'UPDATE bank_questions SET is_enabled = 0 WHERE id = ?',
      selectedId,
    );
    const disabled = await generation.resolveQuestionSelection(databaseModule.db, quizId, 'stable');
    assert.notEqual(disabled.poolFingerprint, revised.poolFingerprint);
    await databaseModule.db.run(
      'UPDATE question_categories SET is_active = 0 WHERE id = ?',
      categoryId,
    );
    await assert.rejects(
      generation.resolveQuestionSelection(databaseModule.db, quizId, 'stable'),
      (error: unknown) =>
        error instanceof generation.QuestionGenerationError &&
        error.code === 'QUESTION_CATEGORY_INACTIVE',
    );
    await databaseModule.db.run(
      'UPDATE question_categories SET is_active = 1 WHERE id = ?',
      categoryId,
    );
    await databaseModule.db.run(
      'UPDATE bank_questions SET is_enabled = 1 WHERE id = ?',
      selectedId,
    );
  });
});
