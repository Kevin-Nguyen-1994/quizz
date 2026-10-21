import { db } from './db';
import { AssignmentServiceError } from './assignmentService';
import { getParticipantAttemptReview } from './assignmentReporting';
import type { JwtPayload } from './types';

const reasons = ['ANSWER_MARKED_WRONG','ANSWER_KEY_DISPUTE','QUESTION_AMBIGUOUS','TIMER_OR_SYSTEM_ISSUE','OTHER'] as const;
type Reason = typeof reasons[number];
const actorName = (actor: JwtPayload) => actor.username?.trim() || `User #${actor.id}`;

export async function createAppeal(userId:number, attemptId:number, questionId:number, reasonCode:unknown, message:unknown) {
  if (!reasons.includes(reasonCode as Reason) || typeof message !== 'string' || message.trim().length < 10) throw new AssignmentServiceError('Invalid appeal payload');
  const review = await getParticipantAttemptReview(attemptId,userId);
  const question = review.questions.find((item) => item.questionId === questionId);
  if (!question || review.attempt.status !== 'completed') throw new AssignmentServiceError('Appeal is unavailable',403);
  const attempt = await db.get<{assignment_id:number;participant_login_name:string|null;participant_name:string}>('SELECT assignment_id,participant_login_name,participant_name FROM assignment_attempts WHERE id=?',[attemptId]);
  const answer = await db.get<{id:number}>('SELECT id FROM attempt_answers WHERE attempt_id=? AND assignment_question_id=?',[attemptId,questionId]);
  try { const now=Date.now(); const result=await db.run(`INSERT INTO assignment_answer_appeals (assignment_id,assignment_question_id,attempt_id,answer_id,user_id,participant_login_name_snapshot,participant_name_snapshot,reason_code,message,status,submitted_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)`,[attempt?.assignment_id,questionId,attemptId,answer?.id??null,userId,attempt?.participant_login_name??null,attempt?.participant_name??'',reasonCode,message.trim(),now,now]); return {id:Number(result.lastID),status:'pending'}; }
  catch (error) { if ((error as {code?:string}).code==='SQLITE_CONSTRAINT') throw new AssignmentServiceError('An appeal is already open',409,'APPEAL_ALREADY_OPEN'); throw error; }
}

export async function listOwnAppeals(userId:number,attemptId:number) { await getParticipantAttemptReview(attemptId,userId); return db.all(`SELECT id,assignment_question_id,reason_code,message,status,resolution_outcome,resolution_note,submitted_at_ms,updated_at_ms,resolved_at_ms FROM assignment_answer_appeals WHERE attempt_id=? AND user_id=? ORDER BY submitted_at_ms DESC`,[attemptId,userId]); }

async function assertAdmin(actor:JwtPayload,assignmentId:number){const a=await db.get<{owner_kind:string;owner_id:number|null}>('SELECT owner_kind,owner_id FROM assignments WHERE id=?',[assignmentId]);if(!a||(actor.role!=='super_admin'&&!(a.owner_kind==='user'&&a.owner_id===actor.id)))throw new AssignmentServiceError('Assignment not found',404);}
export async function listAdminAppeals(actor:JwtPayload,assignmentId:number){await assertAdmin(actor,assignmentId);return db.all(`SELECT ap.*,aq.text question_text,aa.chosen_text,aa.score original_score,aa.is_correct original_is_correct FROM assignment_answer_appeals ap JOIN assignment_questions aq ON aq.id=ap.assignment_question_id LEFT JOIN attempt_answers aa ON aa.id=ap.answer_id WHERE ap.assignment_id=? ORDER BY CASE ap.status WHEN 'pending' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,ap.submitted_at_ms DESC`,[assignmentId]);}
export async function getAdminAppeal(actor:JwtPayload,assignmentId:number,appealId:number){
  await assertAdmin(actor,assignmentId);
  const appeal = await db.get(`SELECT ap.*,aq.text question_text,aa.chosen_text,aa.score original_score,aa.is_correct original_is_correct FROM assignment_answer_appeals ap JOIN assignment_questions aq ON aq.id=ap.assignment_question_id LEFT JOIN attempt_answers aa ON aa.id=ap.answer_id WHERE ap.assignment_id=? AND ap.id=?`,[assignmentId,appealId]);
  if (!appeal) throw new AssignmentServiceError('Appeal not found',404);
  return appeal;
}
export async function transitionAppeal(actor:JwtPayload,assignmentId:number,appealId:number,action:'review'|'accept'|'reject',note?:unknown){
  if ((action === 'accept' || action === 'reject') && (typeof note !== 'string' || !note.trim())) {
    throw new AssignmentServiceError('Resolution note is required');
  }
  await db.run('BEGIN IMMEDIATE');
  try {
    await assertAdmin(actor,assignmentId);
    const appeal=await db.get<{status:string}>('SELECT status FROM assignment_answer_appeals WHERE id=? AND assignment_id=?',[appealId,assignmentId]);
    if(!appeal||appeal.status==='resolved')throw new AssignmentServiceError('Appeal already resolved',409,'APPEAL_ALREADY_RESOLVED');
    const now=Date.now();
    if(action==='review')await db.run("UPDATE assignment_answer_appeals SET status='in_review',updated_at_ms=? WHERE id=?",[now,appealId]);
    else await db.run("UPDATE assignment_answer_appeals SET status='resolved',resolution_outcome=?,resolution_note=?,resolved_at_ms=?,updated_at_ms=?,resolved_by_actor_id=?,resolved_by_actor_role=?,resolved_by_actor_name_snapshot=? WHERE id=?",[action==='accept'?'accepted_no_score_change':'rejected',String(note).trim(),now,now,actor.id,actor.role,actorName(actor),appealId]);
    await db.run('COMMIT');
  }catch(e){await db.run('ROLLBACK').catch(()=>undefined);throw e;}
}
