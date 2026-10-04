import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { after, before, describe, it } from 'node:test';

let temporaryDataDir = '';
let databaseModule: typeof import('./db');
let service: typeof import('./assignmentService');
let userId = 0;
let outsiderUserId = 0;
let accessCode = '';
let testStartMs = 0;
let sourceQuizId = 0;

before(async () => {
  temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'til-quiz-assignment-'));
  process.env.DATA_DIR = temporaryDataDir;
  process.env.ADMIN_PASSWORD = 'assignment-test-admin-password';
  process.env.JWT_SECRET = 'assignment-test-jwt-secret-that-is-at-least-32-characters';

  databaseModule = await import('./db');
  service = await import('./assignmentService');
  await databaseModule.initDb();

  const user = await databaseModule.db.run(
    `INSERT INTO users (email, username, password_hash, play_display_name)
     VALUES ('employee@example.com', 'employee', 'not-used', 'Nhân viên A')`,
  );
  userId = Number(user.lastID);
  const outsider = await databaseModule.db.run(
    `INSERT INTO users (email, username, password_hash, play_display_name)
     VALUES ('outsider@example.com', 'outsider', 'not-used', 'Nhân viên ngoài danh sách')`,
  );
  outsiderUserId = Number(outsider.lastID);
  const quiz = await databaseModule.db.run(
    `INSERT INTO quizzes (title, description, language, owner_kind)
     VALUES ('Assignment source', '', 'vi', 'admin')`,
  );
  const quizId = Number(quiz.lastID);
  sourceQuizId = quizId;
  await databaseModule.db.run(
    `INSERT INTO questions (
       quiz_id, text, options, correct_index, base_score, time_sec, order_index, question_type
     ) VALUES (?, 'First question', '["A","B"]', 0, 500, 1, 0, 'multiple_choice')`,
    quizId,
  );
  await databaseModule.db.run(
    `INSERT INTO questions (
       quiz_id, text, options, correct_index, base_score, time_sec, order_index, question_type
     ) VALUES (?, 'Second question', '["Yes","No"]', 0, 500, 20, 1, 'multiple_choice')`,
    quizId,
  );

  testStartMs = Date.now();
  const assignment = await service.createDraftAssignment(
    { id: 0, role: 'super_admin' },
    {
      quizId,
      title: 'Backend core test',
      opensAtMs: testStartMs - 1_000,
      deadlineAtMs: testStartMs + 100_000,
      maxAttempts: 1,
      shuffleQuestions: false,
      shuffleOptions: true,
    },
  );
  await service.setAssignmentMembers({ id: 0, role: 'super_admin' }, assignment.id, [userId]);
  const published = await service.publishAssignment({ id: 0, role: 'super_admin' }, assignment.id);
  accessCode = published.access_code as string;
});

after(async () => {
  if (databaseModule?.db) await databaseModule.db.close();
  if (temporaryDataDir) fs.rmSync(temporaryDataDir, { recursive: true, force: true });
});

describe('assignment attempt state machine', () => {
  it('handles concurrent start, timeout/resume, duplicate submit and max_attempts=1', async () => {
    const startedAt = testStartMs;
    const lookupBefore = (await service.lookupParticipantAssignment(
      accessCode,
      userId,
      startedAt,
    )) as {
      participantStatus: string;
      canStart: boolean;
      canResume: boolean;
      attemptId: number | null;
    };
    assert.equal(lookupBefore.participantStatus, 'not_started');
    assert.equal(lookupBefore.canStart, true);
    assert.equal(lookupBefore.canResume, false);
    assert.equal(lookupBefore.attemptId, null);
    await assert.rejects(
      service.lookupParticipantAssignment(accessCode, outsiderUserId, startedAt),
      (error: unknown) =>
        error instanceof service.AssignmentServiceError && error.statusCode === 404,
    );

    const [firstStart, secondStart] = await Promise.all([
      service.startOrResumeAttempt(accessCode, userId, startedAt),
      service.startOrResumeAttempt(accessCode, userId, startedAt),
    ]);

    assert.equal(firstStart.attempt.id, secondStart.attempt.id);
    const attemptsAfterStart = await databaseModule.db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM assignment_attempts',
    );
    assert.equal(attemptsAfterStart?.count, 1);

    const lookupDuring = (await service.lookupParticipantAssignment(
      accessCode,
      userId,
      startedAt,
    )) as { participantStatus: string; canResume: boolean; attemptId: number | null };
    assert.equal(lookupDuring.participantStatus, 'in_progress');
    assert.equal(lookupDuring.canResume, true);
    assert.equal(lookupDuring.attemptId, firstStart.attempt.id);

    const list = (await service.listAssignmentsForAdmin({
      id: 0,
      role: 'super_admin',
    })) as Array<Record<string, unknown>>;
    const listed = list.find((item) => item.id === firstStart.assignment.id);
    assert.equal(listed?.quiz_title, 'Assignment source');
    assert.equal(listed?.question_count, 2);
    assert.equal(listed?.started_count, 1);

    const participantJson = JSON.stringify(firstStart);
    for (const secret of [
      'correct_index',
      'correct_indices',
      'correct_answer',
      'explanation',
      'blanks',
      'geo',
      'matches',
    ]) {
      assert.equal(participantJson.includes(secret), false, `participant DTO leaked ${secret}`);
    }

    // The first question expires while the browser is away. Resume marks only
    // that question timed out and starts the next question at resume time.
    const resumed = await service.getParticipantAttemptState(
      firstStart.attempt.id,
      userId,
      startedAt + 1_500,
    );
    assert.equal(resumed.attempt.currentQuestionIndex, 1);
    assert.equal(resumed.question?.questionStartedAtMs, startedAt + 1_500);

    const resumedAgain = await service.getParticipantAttemptState(
      firstStart.attempt.id,
      userId,
      startedAt + 1_600,
    );
    assert.equal(resumedAgain.question?.questionStartedAtMs, startedAt + 1_500);

    const correctSlot = resumedAgain.question?.options.indexOf('Yes') ?? -1;
    assert.ok(correctSlot >= 0);
    const submitAt = startedAt + 2_000;
    const [submitA, submitB] = await Promise.all([
      service.submitAssignmentAnswer(
        firstStart.attempt.id,
        userId,
        resumedAgain.question?.questionId as number,
        { chosenIndex: correctSlot },
        submitAt,
      ),
      service.submitAssignmentAnswer(
        firstStart.attempt.id,
        userId,
        resumedAgain.question?.questionId as number,
        { chosenIndex: correctSlot },
        submitAt,
      ),
    ]);
    assert.equal([submitA.accepted, submitB.accepted].filter(Boolean).length, 1);
    assert.equal([submitA.duplicate, submitB.duplicate].filter(Boolean).length, 1);

    const answerCount = await databaseModule.db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM attempt_answers',
    );
    assert.equal(answerCount?.count, 2);

    const finalState = submitA.attempt.status === 'completed' ? submitA : submitB;
    assert.equal(finalState.attempt.status, 'completed');
    assert.equal(finalState.reviewAvailable, false);
    assert.equal(finalState.attempt.totalScore, undefined);
    assert.equal(finalState.attempt.correctCount, undefined);
    assert.equal(finalState.attempt.activeAnsweringTimeMs, 1_500);

    const storedAttempt = await databaseModule.db.get<{
      total_score: number;
      correct_count: number;
    }>('SELECT total_score, correct_count FROM assignment_attempts WHERE id = ?', [
      firstStart.attempt.id,
    ]);
    assert.equal(storedAttempt?.total_score, 500);
    assert.equal(storedAttempt?.correct_count, 1);

    const adminDetail = await service.getAssignmentForAdmin(
      { id: 0, role: 'super_admin' },
      firstStart.assignment.id,
    );
    assert.equal(adminDetail.assignment.quiz_title, 'Assignment source');
    const member = adminDetail.members[0] as Record<string, unknown>;
    assert.equal(member.participant_status, 'completed');
    assert.equal(member.correct_count, 1);
    assert.equal(member.total_score, 500);

    const startAfterCompletion = await service.startOrResumeAttempt(
      accessCode,
      userId,
      submitAt + 100,
    );
    assert.equal(startAfterCompletion.attempt.id, firstStart.attempt.id);
    const attemptsAfterRetry = await databaseModule.db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM assignment_attempts',
    );
    assert.equal(attemptsAfterRetry?.count, 1);

    await service.closeAssignment({ id: 0, role: 'super_admin' }, firstStart.assignment.id);
    const reviewState = await service.getParticipantAttemptState(
      firstStart.attempt.id,
      userId,
      submitAt + 200,
    );
    assert.equal(reviewState.reviewAvailable, true);
    assert.equal(reviewState.attempt.totalScore, 500);
    assert.equal(reviewState.attempt.correctCount, 1);
  });

  it('expires at the deadline and records only an already-open timed-out question', async () => {
    const baseTime = Date.now();
    const assignment = await service.createDraftAssignment(
      { id: 0, role: 'super_admin' },
      {
        quizId: sourceQuizId,
        title: 'Deadline test',
        opensAtMs: baseTime - 1,
        deadlineAtMs: baseTime + 1_500,
        shuffleQuestions: false,
      },
    );
    await service.setAssignmentMembers({ id: 0, role: 'super_admin' }, assignment.id, [userId]);
    const published = await service.publishAssignment(
      { id: 0, role: 'super_admin' },
      assignment.id,
    );
    const started = await service.startOrResumeAttempt(
      published.access_code as string,
      userId,
      baseTime,
    );
    const expired = await service.getParticipantAttemptState(
      started.attempt.id,
      userId,
      baseTime + 2_000,
    );
    assert.equal(expired.attempt.status, 'expired');
    assert.equal(expired.attempt.completedAtMs, baseTime + 1_500);
    assert.equal(expired.attempt.activeAnsweringTimeMs, 1_000);
    const answers = await databaseModule.db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM attempt_answers WHERE attempt_id = ?',
      [started.attempt.id],
    );
    assert.equal(answers?.count, 1);
  });

  it('can run database initialization again without duplicating or losing assignment data', async () => {
    await databaseModule.db.close();
    await databaseModule.initDb();
    const counts = await databaseModule.db.get<{ assignments: number; attempts: number }>(
      `SELECT
        (SELECT COUNT(*) FROM assignments) as assignments,
        (SELECT COUNT(*) FROM assignment_attempts) as attempts`,
    );
    assert.equal(counts?.assignments, 2);
    assert.equal(counts?.attempts, 2);
  });

  it('lists only the authenticated employee assignments with reconciled participant states', async () => {
    const now = Date.now();
    const actor = { id: 0, role: 'super_admin' } as const;
    async function createPublished(
      title: string,
      memberUserId: number,
      options: { deadlineAtMs?: number; maxAttempts?: number } = {},
    ) {
      const draft = await service.createDraftAssignment(actor, {
        quizId: sourceQuizId,
        title,
        opensAtMs: now - 10_000,
        deadlineAtMs: options.deadlineAtMs ?? now + 60_000,
        maxAttempts: options.maxAttempts ?? 1,
        shuffleQuestions: false,
      });
      await service.setAssignmentMembers(actor, draft.id, [memberUserId]);
      return service.publishAssignment(actor, draft.id);
    }

    const notStarted = await createPublished('Mine not started', userId, { maxAttempts: 2 });
    const inProgress = await createPublished('Mine in progress', userId);
    await databaseModule.db.run(
      'UPDATE assignment_questions SET time_sec = 3600 WHERE assignment_id = ?',
      [inProgress.id],
    );
    const inProgressAttempt = await service.startOrResumeAttempt(
      inProgress.access_code as string,
      userId,
      now,
    );

    const completed = await createPublished('Mine completed', userId);
    const completedAttempt = await service.startOrResumeAttempt(
      completed.access_code as string,
      userId,
      now,
    );
    await service.completeAssignmentAttempt(completedAttempt.attempt.id, userId, now + 100);
    await service.closeAssignment(actor, completed.id);

    const expired = await createPublished('Mine expired', userId);
    await service.startOrResumeAttempt(expired.access_code as string, userId, now - 5_000);
    await databaseModule.db.run('UPDATE assignments SET deadline_at_ms = ? WHERE id = ?', [
      now - 1_000,
      expired.id,
    ]);
    const otherUser = await createPublished('Only outsider', outsiderUserId);

    const mine = await service.listParticipantAssignments(userId, now);
    const byTitle = new Map(mine.map((item) => [item.title, item]));
    assert.equal(byTitle.has(otherUser.title), false);
    assert.equal(byTitle.get(notStarted.title)?.participantStatus, 'not_started');
    assert.equal(byTitle.get(notStarted.title)?.canStart, true);
    assert.equal(byTitle.get(notStarted.title)?.maxAttempts, 2);
    assert.equal(byTitle.get(inProgress.title)?.participantStatus, 'in_progress');
    assert.equal(byTitle.get(inProgress.title)?.canResume, true);
    assert.equal(byTitle.get(inProgress.title)?.attemptId, inProgressAttempt.attempt.id);
    assert.equal(byTitle.get(completed.title)?.participantStatus, 'completed');
    assert.equal(byTitle.get(completed.title)?.canReview, true);
    assert.equal(byTitle.get(completed.title)?.score, 0);
    assert.equal(byTitle.get(completed.title)?.maxScore, 1_000);
    assert.equal(byTitle.get(expired.title)?.participantStatus, 'expired');
    assert.equal(byTitle.get(expired.title)?.canResume, false);
    assert.equal(byTitle.get(expired.title)?.canReview, true);

    const outsiderAssignments = await service.listParticipantAssignments(outsiderUserId, now);
    assert.deepEqual(
      outsiderAssignments.map((item) => item.title),
      ['Only outsider'],
    );

    const [{ assignmentsRouter }, { signToken }] = await Promise.all([
      import('./routes/assignments'),
      import('./middleware'),
    ]);
    const app = express();
    app.use(express.json());
    app.use('/api/assignments', assignmentsRouter);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not start');
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const userToken = signToken({ id: userId, role: 'user', username: 'employee' });
      const response = await fetch(`${baseUrl}/api/assignments/mine`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { assignments?: Array<Record<string, unknown>> };
      assert.equal(Array.isArray(body.assignments), true);
      const endpointItem = body.assignments?.find((item) => item.title === 'Mine in progress');
      assert.equal(endpointItem?.accessCode, inProgress.access_code);
      assert.equal(endpointItem?.attemptId, inProgressAttempt.attempt.id);
      const serialized = JSON.stringify(body);
      for (const secret of [
        '"correct_index"',
        '"correct_indices"',
        '"correct_answer"',
        '"correctAnswer"',
        '"explanation"',
        '"assignment_questions"',
        '"members"',
      ]) {
        assert.equal(serialized.includes(secret), false, `/mine leaked ${secret}`);
      }

      const outsiderToken = signToken({
        id: outsiderUserId,
        role: 'user',
        username: 'outsider',
      });
      const outsiderResponse = await fetch(`${baseUrl}/api/assignments/mine`, {
        headers: { Authorization: `Bearer ${outsiderToken}` },
      });
      assert.equal(outsiderResponse.status, 200);
      const outsiderBody = (await outsiderResponse.json()) as {
        assignments?: Array<{ title: string }>;
      };
      assert.deepEqual(
        outsiderBody.assignments?.map((assignment) => assignment.title),
        ['Only outsider'],
      );

      const adminToken = signToken({ id: 0, role: 'super_admin', username: 'admin' });
      const adminResponse = await fetch(`${baseUrl}/api/assignments/mine`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(adminResponse.status, 403);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    const adminList = (await service.listAssignmentsForAdmin(actor)) as Array<{ id: number }>;
    assert.equal(
      adminList.some((assignment) => assignment.id === notStarted.id),
      true,
    );
  });
});
