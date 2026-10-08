import crypto from 'node:crypto';
import type { Database } from 'sqlite';
import {
  QuestionGenerationError,
  type ResolvedQuestionSelection,
  resolveQuestionSelection,
} from './questionGeneration';
import type { DbQuestion, DbSession } from './types';

export interface LiveSelectionReference {
  seed: string;
  poolFingerprint: string;
  selectionFingerprint: string;
}

export async function createLiveQuestionPreview(
  database: Database,
  quizId: number,
): Promise<ResolvedQuestionSelection> {
  return resolveQuestionSelection(database, quizId, crypto.randomBytes(16).toString('hex'));
}

export async function verifyLiveQuestionPreview(
  database: Database,
  quizId: number,
  reference: LiveSelectionReference,
): Promise<ResolvedQuestionSelection> {
  if (!reference.seed || !reference.poolFingerprint || !reference.selectionFingerprint) {
    throw new QuestionGenerationError(
      'An approved Live question preview is required',
      409,
      'LIVE_QUESTION_PREVIEW_REQUIRED',
    );
  }
  const resolved = await resolveQuestionSelection(database, quizId, reference.seed);
  if (resolved.poolFingerprint !== reference.poolFingerprint) {
    throw new QuestionGenerationError(
      'Question pool changed after the Live preview',
      409,
      'QUESTION_POOL_CHANGED',
    );
  }
  if (resolved.selectionFingerprint !== reference.selectionFingerprint) {
    throw new QuestionGenerationError(
      'Question selection changed after the Live preview',
      409,
      'QUESTION_SELECTION_CHANGED',
    );
  }
  return resolved;
}

export async function snapshotLiveSessionQuestions(
  database: Database,
  sessionId: number,
  selection: ResolvedQuestionSelection,
): Promise<void> {
  for (const item of selection.selected) {
    const question = item.question;
    await database.run(
      `INSERT INTO live_session_questions (
         session_id, source_bank_question_id, source_bank_question_revision,
         source_generation_rule_id, text, options, correct_index, correct_indices,
         base_score, time_sec, order_index, image_url, explanation, range_min, range_max,
         question_type, correct_answer, media_url, media_type, blanks, geo, matches, tags,
         source_metadata_snapshot
       ) VALUES (${Array.from({ length: 24 }, () => '?').join(', ')})`,
      sessionId,
      question.id,
      question.revision,
      item.rule.id,
      question.text,
      question.options,
      question.correct_index,
      question.correct_indices,
      item.effectiveScore,
      item.effectiveTimeSec,
      item.orderIndex,
      question.image_url,
      question.explanation,
      question.range_min,
      question.range_max,
      question.question_type,
      question.correct_answer,
      question.media_url,
      question.media_type,
      question.blanks,
      question.geo,
      question.matches,
      question.tags,
      JSON.stringify({
        sourceBankId: question.source_bank_id,
        sourceQuestionId: question.source_question_id,
        categoryId: question.category_id,
        categoryCode: question.category_code,
        categoryName: question.category_name,
        topic: question.topic,
        minimumLevelId: question.minimum_level_id,
        minimumLevelCode: question.minimum_level_code,
        difficulty: question.difficulty,
        competencyCode: question.competency_code,
        critical: question.critical === 1,
        effectiveTimeSource: item.effectiveTimeSource,
      }),
    );
  }
}

export async function loadSessionQuestions(
  database: Database,
  session: Pick<DbSession, 'id' | 'quiz_id' | 'uses_question_snapshot'>,
): Promise<DbQuestion[]> {
  if (session.uses_question_snapshot === 1) {
    return database.all<DbQuestion[]>(
      `SELECT lsq.*, ? AS quiz_id
       FROM live_session_questions lsq
       WHERE lsq.session_id = ?
       ORDER BY lsq.order_index`,
      session.quiz_id,
      session.id,
    );
  }
  return database.all<DbQuestion[]>(
    'SELECT * FROM questions WHERE quiz_id = ? ORDER BY order_index',
    session.quiz_id,
  );
}
