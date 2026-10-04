import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
});
