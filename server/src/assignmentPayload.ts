import {
  getAssignmentMatchingPermutation,
  getAssignmentOptionPermutation,
  mixAssignmentSeed,
} from './assignmentScoring';
import type { DbAssignment, DbAssignmentAttempt, DbAssignmentQuestion } from './types';

export interface ParticipantQuestionDto {
  questionId: number;
  questionIndex: number;
  totalQuestions: number;
  text: string;
  options: string[];
  timeSec: number;
  questionType: DbAssignmentQuestion['question_type'];
  imageUrl?: string;
  mediaUrl?: string;
  mediaType?: 'audio' | 'video';
  rangeMin?: number;
  rangeMax?: number;
  blankCount?: number;
  rightOptions?: string[];
  questionStartedAtMs: number;
  serverNowMs: number;
  remainingMs: number;
}

function parseStringArray(raw: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Build an explicit participant allowlist. No answer-key field is copied. */
export function buildParticipantQuestionDto(
  assignment: DbAssignment,
  attempt: DbAssignmentAttempt,
  question: DbAssignmentQuestion,
  questionIndex: number,
  totalQuestions: number,
  nowMs: number,
): ParticipantQuestionDto {
  const startedAt = attempt.current_question_started_at_ms ?? nowMs;
  const seed = mixAssignmentSeed(assignment.id, attempt.id);
  const originalOptions = parseStringArray(question.options);
  let options = originalOptions;
  let rightOptions: string[] | undefined;

  if (
    question.question_type === 'multiple_choice' ||
    question.question_type === 'multi_select' ||
    question.question_type === 'ordering'
  ) {
    const permutation = getAssignmentOptionPermutation(
      question,
      seed,
      assignment.shuffle_options === 1,
    );
    options = permutation.map((originalIndex) => originalOptions[originalIndex]);
  }

  if (question.question_type === 'matching') {
    const rightItems = parseStringArray(question.matches);
    const permutation = getAssignmentMatchingPermutation(question, seed);
    rightOptions = permutation.map((originalIndex) => rightItems[originalIndex]);
  }

  const dto: ParticipantQuestionDto = {
    questionId: question.id,
    questionIndex,
    totalQuestions,
    text: question.text,
    options,
    timeSec: question.time_sec,
    questionType: question.question_type,
    questionStartedAtMs: startedAt,
    serverNowMs: nowMs,
    remainingMs: Math.max(0, question.time_sec * 1000 - (nowMs - startedAt)),
  };

  if (question.image_url) dto.imageUrl = question.image_url;
  if (question.media_url) dto.mediaUrl = question.media_url;
  if (question.media_type === 'audio' || question.media_type === 'video') {
    dto.mediaType = question.media_type;
  }
  if (question.question_type === 'closest_to') {
    dto.rangeMin = question.range_min ?? 0;
    dto.rangeMax = question.range_max ?? 100;
  }
  if (question.question_type === 'fill_blank') {
    try {
      const blanks: unknown = JSON.parse(question.blanks ?? '[]');
      dto.blankCount = Array.isArray(blanks) ? blanks.length : 0;
    } catch {
      dto.blankCount = 0;
    }
  }
  if (rightOptions) dto.rightOptions = rightOptions;

  return dto;
}
