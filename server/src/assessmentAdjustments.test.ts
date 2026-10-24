import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

let temporaryDataDir = '';
let database: typeof import('./db');
let adjustments: typeof import('./assessmentAdjustments');
let reporting: typeof import('./assignmentReporting');
let assignmentId = 0;
let questionId = 0;
let attemptA = 0;
let attemptB = 0;
let answerA = 0;

before(async () => {
  temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'til-quiz-adjustments-'));
  process.env.DATA_DIR = temporaryDataDir;
  process.env.ADMIN_PASSWORD = 'assessment-adjustment-test-password';
  process.env.JWT_SECRET = 'assessment-adjustment-test-jwt-secret-at-least-32-characters';
  database = await import('./db');
  adjustments = await import('./assessmentAdjustments');
  reporting = await import('./assignmentReporting');
  await database.initDb();
  const now = Date.now();
  const assignment = await database.db.run(
    `INSERT INTO assignments (owner_kind,title,opens_at_ms,status,max_attempts,result_policy,review_policy,shuffle_questions,shuffle_options,created_at_ms,updated_at_ms)
     VALUES ('admin','Adjustment test',?,'closed',2,'highest_score','after_close',0,0,?,?)`,
    now - 10_000, now, now,
  );
  assignmentId = Number(assignment.lastID);
  const question = await database.db.run(
    `INSERT INTO assignment_questions (assignment_id,text,options,correct_index,base_score,time_sec,order_index,question_type)
     VALUES (?,'AWB','[]',0,100,20,0,'fill_blank')`, assignmentId,
  );
  questionId = Number(question.lastID);
  const firstUser = await database.db.run(`INSERT INTO users (username,password_hash) VALUES ('A','x')`);
  const secondUser = await database.db.run(`INSERT INTO users (username,password_hash) VALUES ('B','x')`);
  const memberA = await database.db.run(`INSERT INTO assignment_members (assignment_id,user_id,display_name_snapshot,email_snapshot,assigned_at_ms) VALUES (?,?, 'A','',?)`,assignmentId,firstUser.lastID,now);
  const memberB = await database.db.run(`INSERT INTO assignment_members (assignment_id,user_id,display_name_snapshot,email_snapshot,assigned_at_ms) VALUES (?,?, 'B','',?)`,assignmentId,secondUser.lastID,now);
  const attempt = async (userId: number, memberId: number, number: number, score: number) => Number((await database.db.run(`INSERT INTO assignment_attempts (assignment_id,assignment_member_id,user_id,participant_name,participant_email,attempt_number,status,started_at_ms,completed_at_ms,last_activity_at_ms,correct_count,total_score) VALUES (?,?,?,'Test','',?,'completed',?,?,?,?,?)`,assignmentId,memberId,userId,number,now,now,now,0,score)).lastID);
  attemptA = await attempt(Number(firstUser.lastID),Number(memberA.lastID),1,0);
  attemptB = await attempt(Number(secondUser.lastID),Number(memberB.lastID),1,0);
  answerA = Number((await database.db.run(`INSERT INTO attempt_answers (attempt_id,assignment_question_id,status,chosen_text,is_correct,score,question_started_at_ms,response_time_ms,answered_at_ms) VALUES (?,?,'answered','["Airway Bill"]',0,0,?,?,?)`,attemptA,questionId,now,1000,now)).lastID);
  await database.db.run(`INSERT INTO attempt_answers (attempt_id,assignment_question_id,status,chosen_text,is_correct,score,question_started_at_ms,response_time_ms,answered_at_ms) VALUES (?,?,'timed_out',NULL,0,0,?,NULL,?)`,attemptB,questionId,now,now);
});

after(async () => { await database?.db.close(); fs.rmSync(temporaryDataDir, { recursive: true, force: true }); });

const actor = { id: 0, role: 'super_admin', username: 'Admin' } as const;

describe('assessment adjustments', () => {
  it('keeps original answer immutable and calculates effective totals', async () => {
    await adjustments.applyResultAdjustment(actor, { assignmentId, assignmentQuestionId: questionId, scope: 'individual', reasonCode: 'MISSING_ACCEPTED_ANSWER', reasonText: 'Accepted spelling missing', source: 'employee_appeal', targets: [{ attemptId: attemptA, adjustedIsCorrect: true, adjustedScore: 100 }], expectedCurrentAdjustmentIds: { [String(attemptA)]: null } });
    const original = await database.db.get<{ is_correct: number; score: number; chosen_text: string }>('SELECT is_correct,score,chosen_text FROM attempt_answers WHERE id=?',[answerA]);
    assert.deepEqual(original, { is_correct: 0, score: 0, chosen_text: '["Airway Bill"]' });
    const effective = await database.db.get<{ effective_total_score: number; effective_correct_count: number }>('SELECT effective_total_score,effective_correct_count FROM assignment_attempts WHERE id=?',[attemptA]);
    assert.deepEqual(effective, { effective_total_score: 100, effective_correct_count: 1 });
    const detail = (await reporting.getAdminQuestionDetail(actor, assignmentId, questionId)) as {
      participants: Array<{ attemptId: number | null; result: string; score: number; originalScore: number; isAdjusted: boolean; answerStatus: string; chosenText: string | null }>;
    };
    const participant = detail.participants.find((item) => item.attemptId === attemptA);
    assert.equal(participant?.result, 'correct');
    assert.equal(participant?.score, 100);
    assert.equal(participant?.originalScore, 0);
    assert.equal(participant?.isAdjusted, true);
    assert.equal(participant?.answerStatus, 'answered');
    assert.equal(participant?.chosenText, '["Airway Bill"]');
  });

  it('does not turn timeout into correct for a text-variant adjustment', async () => {
    const result = await adjustments.effectiveResultsForAttempts(
      [await database.db.get('SELECT * FROM assignment_attempts WHERE id=?',[attemptB]) as never],
      await database.db.all('SELECT * FROM attempt_answers WHERE attempt_id=?',[attemptB]),
      await database.db.all('SELECT * FROM assignment_questions WHERE assignment_id=?',[assignmentId]),
    );
    assert.equal(result.get(`${attemptB}:${questionId}`)?.originalStatus, 'timed_out');
    assert.equal(result.get(`${attemptB}:${questionId}`)?.effectiveScore, 0);
  });

  it('grants timeout credit only through an explicit adjustment and supersedes the leaf', async () => {
    const firstLeaf = await database.db.get<{ id: number }>(`SELECT id FROM assignment_answer_adjustments WHERE attempt_id=? AND NOT EXISTS (SELECT 1 FROM assignment_answer_adjustments s WHERE s.supersedes_adjustment_id=assignment_answer_adjustments.id)`,[attemptA]);
    await adjustments.applyResultAdjustment(actor, { assignmentId, assignmentQuestionId: questionId, scope: 'full_credit_all', reasonCode: 'AMBIGUOUS_QUESTION', reasonText: 'Question ambiguous', source: 'admin_review', targets: [{ attemptId: attemptB, adjustedIsCorrect: true, adjustedScore: 100 }], expectedCurrentAdjustmentIds: { [String(attemptA)]: firstLeaf?.id ?? null, [String(attemptB)]: null } });
    const afterFirst = await database.db.get<{ effective_total_score: number }>('SELECT effective_total_score FROM assignment_attempts WHERE id=?',[attemptB]);
    assert.equal(afterFirst?.effective_total_score, 100);
    const leaf = await database.db.get<{ id: number }>(`SELECT id FROM assignment_answer_adjustments WHERE attempt_id=? AND NOT EXISTS (SELECT 1 FROM assignment_answer_adjustments s WHERE s.supersedes_adjustment_id=assignment_answer_adjustments.id)`,[attemptB]);
    await adjustments.applyResultAdjustment(actor, { assignmentId, assignmentQuestionId: questionId, scope: 'individual', reasonCode: 'ADMIN_SCORE_CORRECTION', reasonText: 'Partial review', source: 'admin_review', targets: [{ attemptId: attemptB, adjustedIsCorrect: false, adjustedScore: 50 }], expectedCurrentAdjustmentIds: { [String(attemptB)]: leaf?.id ?? null } });
    const second = await database.db.get<{ effective_total_score: number; effective_correct_count: number }>('SELECT effective_total_score,effective_correct_count FROM assignment_attempts WHERE id=?',[attemptB]);
    assert.deepEqual(second, { effective_total_score: 50, effective_correct_count: 0 });
  });

  it('blocks adjustment while any participant is in progress', async () => {
    const now = Date.now();
    await database.db.run(`UPDATE assignment_attempts SET status='in_progress',completed_at_ms=NULL WHERE id=?`,attemptA);
    await assert.rejects(
      adjustments.applyResultAdjustment(actor, { assignmentId, assignmentQuestionId: questionId, scope: 'individual', reasonCode: 'MANUAL_REVIEW', reasonText: 'Blocked test', source: 'analytics_flag', targets: [{ attemptId: attemptB, adjustedIsCorrect: true, adjustedScore: 100 }], expectedCurrentAdjustmentIds: {} }),
      (error: unknown) => (error as { code?: string }).code === 'ASSIGNMENT_REGRADING_BLOCKED_ACTIVE_ATTEMPTS',
    );
    await database.db.run(`UPDATE assignment_attempts SET status='completed',completed_at_ms=? WHERE id=?`,now,attemptA);
  });

  it('uses effective score for the highest-score official attempt without changing original totals', async () => {
    const first = await database.db.get<{ user_id: number; assignment_member_id: number }>('SELECT user_id,assignment_member_id FROM assignment_attempts WHERE id=?',[attemptA]);
    const now = Date.now();
    const second = await database.db.run(
      `INSERT INTO assignment_attempts (assignment_id,assignment_member_id,user_id,participant_name,participant_email,attempt_number,status,started_at_ms,completed_at_ms,last_activity_at_ms,correct_count,total_score)
       VALUES (?,?,?,'Test','',2,'completed',?,?,?,?,?)`, assignmentId,first?.assignment_member_id,first?.user_id,now,now,now,1,80,
    );
    const secondId = Number(second.lastID);
    await database.db.run(`INSERT INTO attempt_answers (attempt_id,assignment_question_id,status,chosen_text,is_correct,score,question_started_at_ms,response_time_ms,answered_at_ms) VALUES (?,?,'answered','["AWB"]',1,80,?,?,?)`,secondId,questionId,now,1000,now);
    const report = await reporting.getAssignmentReport(actor, assignmentId);
    const member = report.participants.find((item) => item.userId === first?.user_id);
    assert.equal(member?.selectedAttemptId, attemptA);
    const originals = await database.db.get<{ total_score: number }>('SELECT total_score FROM assignment_attempts WHERE id=?',[attemptA]);
    assert.equal(originals?.total_score, 0);
  });

  it('resolves a linked appeal in the same transaction as its adjustment', async () => {
    const now = Date.now();
    const appeal = await database.db.run(
      `INSERT INTO assignment_answer_appeals
       (assignment_id,assignment_question_id,attempt_id,answer_id,user_id,participant_name_snapshot,reason_code,message,status,submitted_at_ms,updated_at_ms)
       VALUES (?,?,?,?,?,'A','ANSWER_MARKED_WRONG','Please review this answer carefully','pending',?,?)`,
      [assignmentId, questionId, attemptA, answerA, 1, now, now],
    );
    const current = await database.db.get<{ id: number }>(
      `SELECT id FROM assignment_answer_adjustments WHERE attempt_id=? AND assignment_question_id=? AND NOT EXISTS (SELECT 1 FROM assignment_answer_adjustments successor WHERE successor.supersedes_adjustment_id=assignment_answer_adjustments.id)`,
      [attemptA, questionId],
    );
    const result = await adjustments.applyResultAdjustment(actor, {
      assignmentId, assignmentQuestionId: questionId, scope: 'individual', reasonCode: 'MANUAL_REVIEW',
      reasonText: 'Appeal review confirms a scoring correction', source: 'employee_appeal',
      targets: [{ attemptId: attemptA, adjustedIsCorrect: true, adjustedScore: 100 }],
      expectedCurrentAdjustmentIds: { [String(attemptA)]: current?.id ?? null }, appealId: Number(appeal.lastID),
    });
    const resolved = await database.db.get<{ status: string; resolution_outcome: string; linked_adjustment_batch_id: number }>(
      'SELECT status,resolution_outcome,linked_adjustment_batch_id FROM assignment_answer_appeals WHERE id=?', [appeal.lastID],
    );
    assert.deepEqual(resolved, { status: 'resolved', resolution_outcome: 'adjusted', linked_adjustment_batch_id: result.batchId });
  });
});
