import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

let temporaryDataDir = '';
let databaseModule: typeof import('./db');
let reporting: typeof import('./assignmentReporting');
let assignmentId = 0;
let userA = 0;
let userB = 0;
let attemptA1 = 0;
let attemptB = 0;
let baseTime = 0;

before(async () => {
  temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'til-quiz-reporting-'));
  process.env.DATA_DIR = temporaryDataDir;
  process.env.ADMIN_PASSWORD = 'assignment-reporting-admin-password';
  process.env.JWT_SECRET = 'assignment-reporting-jwt-secret-at-least-32-characters';
  databaseModule = await import('./db');
  reporting = await import('./assignmentReporting');
  await databaseModule.initDb();

  const users: number[] = [];
  for (const [email, username] of [
    ['an@example.com', 'An'],
    ['binh@example.com', 'Bình'],
    ['chi@example.com', 'Chi'],
    ['dung@example.com', 'Dũng'],
  ]) {
    const result = await databaseModule.db.run(
      `INSERT INTO users (email, username, password_hash, play_display_name)
       VALUES (?, ?, 'not-used', ?)`,
      email,
      username,
      username,
    );
    users.push(Number(result.lastID));
  }
  [userA, userB] = users;
  baseTime = Date.now();
  const assignment = await databaseModule.db.run(
    `INSERT INTO assignments (
       owner_kind, title, access_code, opens_at_ms, deadline_at_ms, status,
       max_attempts, result_policy, review_policy, shuffle_questions, shuffle_options,
       created_at_ms, updated_at_ms, published_at_ms
     ) VALUES ('admin', 'Kiểm tra, "DNCX"\nTháng 10', 'report-code', ?, ?, 'published',
       2, 'highest_score', 'after_deadline', 0, 0, ?, ?, ?)`,
    baseTime - 10_000,
    baseTime + 60_000,
    baseTime - 20_000,
    baseTime - 20_000,
    baseTime - 20_000,
  );
  assignmentId = Number(assignment.lastID);

  const questionIds: number[] = [];
  const questions = [
    {
      text: 'Dòng 1,\n"Dòng 2"',
      options: '["Đúng","Sai"]',
      correctIndex: 0,
      baseScore: 100,
      timeSec: 10,
      type: 'multiple_choice',
      correctAnswer: null,
      blanks: null,
      explanation: 'Giải thích câu 1',
    },
    {
      text: 'Thủ đô ___ thuộc ___.',
      options: '[]',
      correctIndex: 0,
      baseScore: 100,
      timeSec: 10,
      type: 'fill_blank',
      correctAnswer: null,
      blanks: '[["Hà Nội","Hanoi"],["Việt Nam"]]',
      explanation: null,
    },
    {
      text: 'Nhập mã',
      options: '[]',
      correctIndex: 0,
      baseScore: 100,
      timeSec: 5,
      type: 'open_text',
      correctAnswer: 'ABC',
      blanks: null,
      explanation: null,
    },
    {
      text: 'Câu chưa mở',
      options: '["A","B"]',
      correctIndex: 1,
      baseScore: 100,
      timeSec: 20,
      type: 'multiple_choice',
      correctAnswer: null,
      blanks: null,
      explanation: null,
    },
  ];
  for (const [index, question] of questions.entries()) {
    const result = await databaseModule.db.run(
      `INSERT INTO assignment_questions (
        assignment_id, text, options, correct_index, base_score, time_sec, order_index,
        question_type, correct_answer, blanks, explanation
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      assignmentId,
      question.text,
      question.options,
      question.correctIndex,
      question.baseScore,
      question.timeSec,
      index,
      question.type,
      question.correctAnswer,
      question.blanks,
      question.explanation,
    );
    questionIds.push(Number(result.lastID));
  }

  const memberIds: number[] = [];
  for (let index = 0; index < users.length; index++) {
    const result = await databaseModule.db.run(
      `INSERT INTO assignment_members
       (assignment_id, user_id, display_name_snapshot, email_snapshot, assigned_at_ms)
       VALUES (?, ?, ?, ?, ?)`,
      assignmentId,
      users[index],
      ['An', 'Bình', 'Chi', 'Dũng'][index],
      ['an@example.com', 'binh@example.com', 'chi@example.com', 'dung@example.com'][index],
      baseTime - 20_000,
    );
    memberIds.push(Number(result.lastID));
  }

  async function insertAttempt(
    memberIndex: number,
    number: number,
    status: 'in_progress' | 'completed' | 'expired',
    startOffset: number,
    completeOffset: number | null,
    score: number,
  ) {
    const result = await databaseModule.db.run(
      `INSERT INTO assignment_attempts (
        assignment_id, assignment_member_id, user_id, participant_name, participant_email,
        attempt_number, status, started_at_ms, completed_at_ms, last_activity_at_ms,
        correct_count, total_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      assignmentId,
      memberIds[memberIndex],
      users[memberIndex],
      ['An', 'Bình', 'Chi'][memberIndex],
      ['an@example.com', 'binh@example.com', 'chi@example.com'][memberIndex],
      number,
      status,
      baseTime + startOffset,
      completeOffset === null ? null : baseTime + completeOffset,
      baseTime + (completeOffset ?? startOffset),
      score >= 100 ? 1 : 0,
      score,
    );
    return Number(result.lastID);
  }

  attemptA1 = await insertAttempt(0, 1, 'completed', -10_000, 0, 150);
  await insertAttempt(0, 2, 'completed', -8_000, -1_000, 100);
  attemptB = await insertAttempt(1, 1, 'in_progress', -4_000, null, 0);
  const attemptC = await insertAttempt(2, 1, 'expired', -7_000, -2_000, 0);

  async function answer(
    attemptId: number,
    questionIndex: number,
    status: 'answered' | 'timed_out',
    chosenIndex: number | null,
    chosenText: string | null,
    isCorrect: number,
    score: number,
    responseMs: number,
  ) {
    await databaseModule.db.run(
      `INSERT INTO attempt_answers (
        attempt_id, assignment_question_id, status, chosen_index, chosen_text,
        is_correct, score, question_started_at_ms, response_time_ms, answered_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      attemptId,
      questionIds[questionIndex],
      status,
      chosenIndex,
      chosenText,
      isCorrect,
      score,
      baseTime - 9_000,
      responseMs,
      baseTime - 9_000 + responseMs,
    );
  }

  await answer(attemptA1, 0, 'answered', 0, null, 1, 100, 1_000);
  await answer(attemptA1, 1, 'answered', null, '["Hà Nội","Lào"]', 0, 50, 2_000);
  await answer(attemptA1, 2, 'timed_out', null, null, 0, 0, 5_000);
  const attemptA2 = await databaseModule.db.get<{ id: number }>(
    'SELECT id FROM assignment_attempts WHERE user_id = ? AND attempt_number = 2',
    [userA],
  );
  await answer(attemptA2?.id as number, 0, 'answered', 0, null, 1, 100, 3_000);
  await answer(attemptB, 0, 'answered', 1, null, 0, 0, 500);
  await answer(attemptC, 0, 'answered', 1, null, 0, 0, 1_000);
  await answer(attemptC, 1, 'timed_out', null, null, 0, 0, 10_000);
});

after(async () => {
  if (databaseModule?.db) await databaseModule.db.close();
  if (temporaryDataDir) fs.rmSync(temporaryDataDir, { recursive: true, force: true });
});

describe('assignment reporting', () => {
  it('aggregates all participant states, partial credit and unanswered questions', async () => {
    const report = await reporting.getAssignmentReport(
      { id: 0, role: 'super_admin' },
      assignmentId,
    );
    assert.deepEqual(report.overview, {
      assigned: 4,
      notStarted: 1,
      inProgress: 1,
      completed: 1,
      expired: 1,
      completionRate: 25,
      averageScore: 75,
      averageScorePercent: 18.75,
      averageElapsedTimeMs: 7_500,
      averageActiveAnsweringTimeMs: 9_500,
    });
    const an = report.participants.find((participant) => participant.name === 'An');
    const selected = an?.attempts.find((attempt) => attempt.isSelected);
    assert.equal(selected?.attemptNumber, 1);
    assert.equal(selected?.correct, 1);
    assert.equal(selected?.incorrect, 1);
    assert.equal(selected?.noAnswer, 2);
    assert.equal(
      (selected?.correct ?? 0) + (selected?.incorrect ?? 0) + (selected?.noAnswer ?? 0),
      4,
    );
    assert.equal(selected?.score, 150);
    assert.equal(selected?.scorePercent, 37.5);
    assert.equal(selected?.elapsedTimeMs, 10_000);
    assert.equal(selected?.activeAnsweringTimeMs, 8_000);
    assert.equal(selected?.averageResponseTimeMs, 1_500);

    const firstQuestion = report.questions.find((question) => question.questionNumber === 1);
    assert.equal(firstQuestion?.sampleSize, 3);
    assert.equal(firstQuestion?.answered, 3);
    assert.equal(firstQuestion?.correct, 1);
    assert.equal(firstQuestion?.incorrect, 2);
    assert.equal(firstQuestion?.noAnswer, 0);
    assert.equal(firstQuestion?.correctRate, 33.33);
    assert.equal(firstQuestion?.correctRateAmongAnswered, 33.33);
    assert.equal(firstQuestion?.averageScore, 33.33);

    const partialQuestion = report.questions.find((question) => question.questionNumber === 2);
    assert.equal(partialQuestion?.correct, 0);
    assert.equal(partialQuestion?.incorrect, 1);
    assert.equal(partialQuestion?.noAnswer, 1);
    assert.equal(partialQuestion?.averageScore, 25);
  });

  it('separates answered-incorrect from no-answer for a finished six-question attempt', async () => {
    const now = Date.now();
    const assignment = await databaseModule.db.run(
      `INSERT INTO assignments (
        owner_kind, title, access_code, opens_at_ms, status, max_attempts,
        result_policy, review_policy, shuffle_questions, shuffle_options,
        created_at_ms, updated_at_ms, published_at_ms
      ) VALUES ('admin', 'Semantics test', 'semantics-test', ?, 'closed', 1,
        'highest_score', 'after_close', 0, 0, ?, ?, ?)`,
      now - 10_000,
      now - 20_000,
      now - 20_000,
      now - 20_000,
    );
    const semanticsAssignmentId = Number(assignment.lastID);
    const questionIds: number[] = [];
    for (let index = 0; index < 6; index++) {
      const question = await databaseModule.db.run(
        `INSERT INTO assignment_questions (
          assignment_id, text, options, correct_index, base_score, time_sec,
          order_index, question_type
        ) VALUES (?, ?, '["A","B"]', 0, 100, 10, ?, 'multiple_choice')`,
        semanticsAssignmentId,
        `Câu ${index + 1}`,
        index,
      );
      questionIds.push(Number(question.lastID));
    }
    const member = await databaseModule.db.run(
      `INSERT INTO assignment_members (
        assignment_id, user_id, display_name_snapshot, email_snapshot, assigned_at_ms
      ) VALUES (?, ?, 'An', 'an@example.com', ?)`,
      semanticsAssignmentId,
      userA,
      now - 20_000,
    );
    const attempt = await databaseModule.db.run(
      `INSERT INTO assignment_attempts (
        assignment_id, assignment_member_id, user_id, participant_name, participant_email,
        attempt_number, status, started_at_ms, completed_at_ms, last_activity_at_ms,
        correct_count, total_score
      ) VALUES (?, ?, ?, 'An', 'an@example.com', 1, 'completed', ?, ?, ?, 0, 0)`,
      semanticsAssignmentId,
      member.lastID,
      userA,
      now - 10_000,
      now,
      now,
    );
    for (let index = 0; index < 6; index++) {
      await databaseModule.db.run(
        `INSERT INTO attempt_answers (
          attempt_id, assignment_question_id, status, chosen_index, is_correct, score,
          question_started_at_ms, response_time_ms, answered_at_ms
        ) VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)`,
        attempt.lastID,
        questionIds[index],
        index < 3 ? 'answered' : 'timed_out',
        index < 3 ? 1 : null,
        now - 9_000,
        index < 3 ? 1_000 : 10_000,
        now - 8_000,
      );
    }

    const report = await reporting.getAssignmentReport(
      { id: 0, role: 'super_admin' },
      semanticsAssignmentId,
    );
    const metrics = report.participants[0].attempts[0];
    assert.equal(metrics.correct, 0);
    assert.equal(metrics.incorrect, 3);
    assert.equal(metrics.noAnswer, 3);
    assert.equal(metrics.correct + metrics.incorrect + metrics.noAnswer, 6);
    assert.equal(report.questions[0].incorrect, 1);
    assert.equal(report.questions[0].noAnswer, 0);
    assert.equal(report.questions[3].incorrect, 0);
    assert.equal(report.questions[3].noAnswer, 1);
  });

  it('selects attempts according to result_policy', () => {
    const attempts = [
      { id: 1, attempt_number: 1, status: 'completed', total_score: 900 },
      { id: 2, attempt_number: 2, status: 'completed', total_score: 700 },
    ] as never;
    assert.equal(reporting.selectPrimaryAttempt(attempts, 'highest_score')?.id, 1);
    assert.equal(reporting.selectPrimaryAttempt(attempts, 'latest_completed')?.id, 2);
  });

  it('protects participant review and exposes answer keys only when allowed', async () => {
    await assert.rejects(
      reporting.getParticipantAttemptReview(attemptA1, userA, baseTime),
      (error: unknown) =>
        error instanceof Error && 'statusCode' in error && error.statusCode === 403,
    );
    await assert.rejects(
      reporting.getParticipantAttemptReview(attemptB, userB, baseTime),
      (error: unknown) =>
        error instanceof Error && 'statusCode' in error && error.statusCode === 403,
    );
    const untouchedAttempt = await databaseModule.db.get<{
      status: string;
      current_question_started_at_ms: number | null;
    }>('SELECT status, current_question_started_at_ms FROM assignment_attempts WHERE id = ?', [
      attemptB,
    ]);
    assert.equal(untouchedAttempt?.status, 'in_progress');
    assert.equal(untouchedAttempt?.current_question_started_at_ms, null);
    await assert.rejects(
      reporting.getParticipantAttemptReview(attemptA1, userB, baseTime + 61_000),
      (error: unknown) =>
        error instanceof Error && 'statusCode' in error && error.statusCode === 404,
    );
    const review = await reporting.getParticipantAttemptReview(attemptA1, userA, baseTime + 61_000);
    assert.equal(review.questions[0].correctAnswer, 'Đúng');
    assert.equal(review.questions[0].explanation, 'Giải thích câu 1');
    assert.equal(review.questions[1].result, 'incorrect');
    assert.equal(review.questions[1].score, 50);

    const admin = await reporting.getAdminAttemptDetail(
      { id: 0, role: 'super_admin' },
      assignmentId,
      attemptA1,
    );
    assert.equal(admin.questions[0].correctAnswer, 'Đúng');

    await databaseModule.db.run(
      "UPDATE assignments SET review_policy = 'after_close' WHERE id = ?",
      [assignmentId],
    );
    await assert.rejects(
      reporting.getParticipantAttemptReview(attemptA1, userA, baseTime + 61_000),
      (error: unknown) =>
        error instanceof Error && 'statusCode' in error && error.statusCode === 403,
    );
    await databaseModule.db.run("UPDATE assignments SET status = 'closed' WHERE id = ?", [
      assignmentId,
    ]);
    const closedReview = await reporting.getParticipantAttemptReview(attemptA1, userA, baseTime);
    assert.equal(closedReview.questions[0].correctAnswer, 'Đúng');
    await databaseModule.db.run(
      "UPDATE assignments SET status = 'published', review_policy = 'after_deadline' WHERE id = ?",
      [assignmentId],
    );
  });

  it('exports Excel-safe UTF-8 CSV with partial credit and no-answer rows', async () => {
    const csv = await reporting.buildAssignmentCsv({ id: 0, role: 'super_admin' }, assignmentId);
    assert.equal(csv.body.startsWith('\uFEFF'), true);
    assert.equal(csv.body.includes('\r\n'), true);
    assert.equal(csv.body.includes('Kiểm tra, ""DNCX""'), true);
    assert.equal(csv.body.includes('"Dòng 1,\n""Dòng 2"""'), true);
    assert.equal(csv.body.includes('Incorrect,2000,2,10,50,100,150,400,37.5'), true);
    assert.equal(csv.body.includes('No answer'), true);
    assert.match(csv.filename, /^TiL_Quiz_Kiem_tra_DNCX_Thang_10_/);
  });

  it('expires stale in-progress attempts when an admin opens the report after deadline', async () => {
    await databaseModule.db.run('UPDATE assignments SET deadline_at_ms = ? WHERE id = ?', [
      Date.now() - 1,
      assignmentId,
    ]);
    const report = await reporting.getAssignmentReport(
      { id: 0, role: 'super_admin' },
      assignmentId,
    );
    const binh = report.participants.find((participant) => participant.name === 'Bình');
    assert.equal(binh?.status, 'expired');
    assert.equal(report.overview.inProgress, 0);
    assert.equal(report.overview.expired, 2);
  });
});
