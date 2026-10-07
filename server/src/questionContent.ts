import { config } from './config';
import type { QuestionType, QuizQuestion } from './types';
import {
  normalizeImageUrl,
  normalizeOptionalText,
  normalizeQuestionMedia,
  normalizeTags,
} from './utils';

const QUESTION_TYPES = new Set<QuestionType>([
  'multiple_choice',
  'true_false',
  'open_text',
  'multi_select',
  'closest_to',
  'fill_blank',
  'ordering',
  'geo',
  'matching',
]);

export class QuestionContentError extends Error {}

export interface StoredQuestionContent {
  text: string;
  options: string;
  correct_index: number;
  correct_indices: string | null;
  base_score: number;
  time_sec: number;
  image_url: string | null;
  explanation: string | null;
  range_min: number | null;
  range_max: number | null;
  question_type: QuestionType;
  correct_answer: string | null;
  media_url: string | null;
  media_type: string | null;
  blanks: string | null;
  geo: string | null;
  matches: string | null;
  tags: string | null;
}

function countBlankMarkers(text: string): number {
  return (text.match(/_{3,}/g) ?? []).length;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new QuestionContentError(`${label} must be an array of strings`);
  }
  return value;
}

/** Validate the canonical nine-type TiL question representation. */
export function validateQuestionContent(question: QuizQuestion): void {
  const type = question.questionType ?? 'multiple_choice';
  if (!QUESTION_TYPES.has(type))
    throw new QuestionContentError(`Unsupported question type: ${type}`);
  if (typeof question.text !== 'string' || !question.text.trim()) {
    throw new QuestionContentError('Question text is required');
  }
  const options = requireStringArray(question.options, 'options');
  if (!Number.isInteger(question.baseScore) || question.baseScore < 0) {
    throw new QuestionContentError('baseScore must be a non-negative integer');
  }
  if (
    question.timeSec !== undefined &&
    (!Number.isInteger(question.timeSec) || question.timeSec < 1)
  ) {
    throw new QuestionContentError('timeSec must be a positive integer');
  }

  if (type === 'multiple_choice' || type === 'true_false') {
    if (
      options.length < 2 ||
      !Number.isInteger(question.correctIndex) ||
      question.correctIndex < 0 ||
      question.correctIndex >= options.length
    ) {
      throw new QuestionContentError('Choice question has an invalid answer key');
    }
  } else if (type === 'multi_select') {
    const correct = question.correctIndices;
    if (
      !Array.isArray(correct) ||
      correct.length === 0 ||
      new Set(correct).size !== correct.length ||
      correct.some((index) => !Number.isInteger(index) || index < 0 || index >= options.length)
    ) {
      throw new QuestionContentError('Multi-select question has an invalid answer key');
    }
  } else if (type === 'open_text') {
    if (!question.correctAnswer?.trim()) {
      throw new QuestionContentError('Open-text question has no answer key');
    }
  } else if (type === 'fill_blank') {
    const markers = countBlankMarkers(question.text);
    const blanks = question.blanks;
    if (
      markers === 0 ||
      !Array.isArray(blanks) ||
      blanks.length !== markers ||
      blanks.some(
        (accepted) =>
          !Array.isArray(accepted) ||
          accepted.length === 0 ||
          accepted.some((answer) => typeof answer !== 'string' || !answer.trim()),
      )
    ) {
      throw new QuestionContentError('Fill-blank question has an invalid answer key');
    }
  } else if (type === 'ordering') {
    if (options.length < 2 || options.some((option) => !option.trim())) {
      throw new QuestionContentError('Ordering question needs at least two non-empty items');
    }
  } else if (type === 'matching') {
    const matches = question.matches;
    if (
      options.length < 2 ||
      options.length > 6 ||
      !Array.isArray(matches) ||
      matches.length !== options.length ||
      options.some((option) => !option.trim()) ||
      matches.some((match) => typeof match !== 'string' || !match.trim())
    ) {
      throw new QuestionContentError('Matching question has an invalid answer key');
    }
  } else if (type === 'closest_to') {
    const correct = Number.parseInt(question.correctAnswer ?? '', 10);
    if (
      !Number.isInteger(question.rangeMin) ||
      !Number.isInteger(question.rangeMax) ||
      (question.rangeMin as number) >= (question.rangeMax as number) ||
      Number.isNaN(correct) ||
      correct < (question.rangeMin as number) ||
      correct > (question.rangeMax as number)
    ) {
      throw new QuestionContentError('Closest-to question has an invalid range or answer');
    }
  } else if (type === 'geo') {
    const point = question.geo;
    if (
      !point ||
      !Number.isFinite(point.lat) ||
      !Number.isFinite(point.lng) ||
      point.lat < -90 ||
      point.lat > 90 ||
      point.lng < -180 ||
      point.lng > 180
    ) {
      throw new QuestionContentError('Geo question has an invalid answer key');
    }
  }
}

/** Normalize and serialize content for both static and Bank Question rows. */
export function normalizeQuestionContent(question: QuizQuestion): StoredQuestionContent {
  const normalized: QuizQuestion = {
    ...question,
    questionType: question.questionType ?? 'multiple_choice',
    baseScore: question.baseScore ?? config.defaultBaseScore,
    timeSec: question.timeSec ?? config.questionTimeSec,
  };
  validateQuestionContent(normalized);
  const media = normalizeQuestionMedia(normalized.mediaType, normalized.mediaUrl);
  return {
    text: normalized.text,
    options: JSON.stringify(normalized.options),
    correct_index: normalized.correctIndex,
    correct_indices: normalized.correctIndices ? JSON.stringify(normalized.correctIndices) : null,
    base_score: normalized.baseScore,
    time_sec: normalized.timeSec as number,
    image_url: normalizeImageUrl(normalized.imageUrl) ?? null,
    explanation: normalizeOptionalText(normalized.explanation) ?? null,
    range_min: normalized.rangeMin ?? null,
    range_max: normalized.rangeMax ?? null,
    question_type: normalized.questionType as QuestionType,
    correct_answer: normalized.correctAnswer ?? null,
    media_url: media.mediaUrl,
    media_type: media.mediaType,
    blanks: normalized.blanks ? JSON.stringify(normalized.blanks) : null,
    geo: normalized.geo ? JSON.stringify(normalized.geo) : null,
    matches: normalized.matches ? JSON.stringify(normalized.matches) : null,
    tags: normalizeTags(normalized.tags),
  };
}

export const STORED_QUESTION_COLUMNS = [
  'text',
  'options',
  'correct_index',
  'correct_indices',
  'base_score',
  'time_sec',
  'image_url',
  'explanation',
  'range_min',
  'range_max',
  'question_type',
  'correct_answer',
  'media_url',
  'media_type',
  'blanks',
  'geo',
  'matches',
  'tags',
] as const;

export function storedQuestionValues(content: StoredQuestionContent): unknown[] {
  return STORED_QUESTION_COLUMNS.map((column) => content[column]);
}
