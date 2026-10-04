import { closestToDistance, closestToMaxDistance, parseIntegerInRange } from './closestTo';
import {
  geoDistanceKm,
  matchFillBlank,
  parseLatLng,
  scoreMatching,
  scoreOrdering,
} from './questionScoring';
import { seededPerm, seededShuffle } from './shuffle';
import type { DbAssignmentQuestion } from './types';

export interface AssignmentSubmission {
  chosenIndex?: number | null;
  chosenIndices?: Array<number | null>;
  chosenText?: string | null;
}

export interface NormalizedAssignmentAnswer {
  chosenIndex: number | null;
  chosenIndices: Array<number | null> | null;
  chosenText: string | null;
}

export interface AssignmentGrade {
  isCorrect: boolean;
  score: number;
  answer: NormalizedAssignmentAnswer;
}

export class InvalidAssignmentAnswerError extends Error {}

/** Stable unsigned 32-bit seed assembled from numeric database identifiers. */
export function mixAssignmentSeed(...values: number[]): number {
  let hash = 0x811c9dc5;
  for (const value of values) {
    hash ^= value | 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function getAssignmentQuestionOrder(
  count: number,
  assignmentId: number,
  attemptId: number,
  shuffle: boolean,
): number[] {
  if (!shuffle) return Array.from({ length: count }, (_, index) => index);
  return seededShuffle(count, mixAssignmentSeed(assignmentId, attemptId, 0x51f15e));
}

/**
 * `perm[displaySlot] = originalIndex`. Choice questions respect the assignment
 * shuffle setting. Ordering and matching are always shuffled because their
 * authored order contains the answer key.
 */
export function getAssignmentOptionPermutation(
  question: DbAssignmentQuestion,
  shuffleSeed: number,
  shuffleOptions: boolean,
): number[] {
  const options = parseStringArrayStrict(question.options, 'question options');
  if (question.question_type === 'ordering') {
    return seededPerm(options.length, mixAssignmentSeed(shuffleSeed, question.id, 0x0d3e));
  }
  if (question.question_type === 'multiple_choice' || question.question_type === 'multi_select') {
    return shuffleOptions
      ? seededShuffle(options.length, mixAssignmentSeed(shuffleSeed, question.id, 0xc401ce))
      : options.map((_, index) => index);
  }
  return options.map((_, index) => index);
}

export function getAssignmentMatchingPermutation(
  question: DbAssignmentQuestion,
  shuffleSeed: number,
): number[] {
  const rightItems = parseStringArrayStrict(question.matches ?? '[]', 'matching answers');
  return seededPerm(rightItems.length, mixAssignmentSeed(shuffleSeed, question.id, 0x4d47));
}

function parseStringArrayStrict(raw: string, label: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw new InvalidAssignmentAnswerError(`Invalid ${label}`);
  }
}

function parseFillAnswers(raw: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '');
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw new InvalidAssignmentAnswerError('Fill-blank answers must be a string array');
  }
}

function parseBlankKey(raw: string | null): string[][] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '');
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (accepted) =>
          !Array.isArray(accepted) || accepted.some((value) => typeof value !== 'string'),
      )
    ) {
      throw new Error();
    }
    return parsed as string[][];
  } catch {
    throw new InvalidAssignmentAnswerError('Invalid fill-blank answer key');
  }
}

function requireDisplaySlots(
  slots: Array<number | null> | undefined,
  optionCount: number,
  options: { exactLength?: number; allowNull?: boolean; unique?: boolean } = {},
): Array<number | null> {
  if (!Array.isArray(slots)) {
    throw new InvalidAssignmentAnswerError('chosenIndices must be an array');
  }
  if (options.exactLength !== undefined && slots.length !== options.exactLength) {
    throw new InvalidAssignmentAnswerError('chosenIndices has the wrong length');
  }
  const seen = new Set<number>();
  for (const slot of slots) {
    if (slot === null && options.allowNull) continue;
    if (!Number.isInteger(slot) || (slot as number) < 0 || (slot as number) >= optionCount) {
      throw new InvalidAssignmentAnswerError('chosenIndices contains an invalid option');
    }
    if (options.unique && seen.has(slot as number)) {
      throw new InvalidAssignmentAnswerError('chosenIndices contains duplicates');
    }
    seen.add(slot as number);
  }
  return slots;
}

function partialScore(baseScore: number, matched: number, total: number): AssignmentGrade['score'] {
  return total > 0 ? Math.round(baseScore * (matched / total)) : 0;
}

/** Pure server-side grading. It performs no I/O and never applies live-game bonuses. */
export function gradeAssignmentAnswer(
  question: DbAssignmentQuestion,
  submitted: AssignmentSubmission,
  shuffleSeed: number,
  shuffleOptions = true,
): AssignmentGrade {
  const emptyAnswer: NormalizedAssignmentAnswer = {
    chosenIndex: null,
    chosenIndices: null,
    chosenText: null,
  };

  if (question.question_type === 'multiple_choice' || question.question_type === 'true_false') {
    const options = parseStringArrayStrict(question.options, 'question options');
    const slot = submitted.chosenIndex;
    if (!Number.isInteger(slot) || (slot as number) < 0 || (slot as number) >= options.length) {
      throw new InvalidAssignmentAnswerError('chosenIndex is invalid');
    }
    const permutation =
      question.question_type === 'true_false'
        ? options.map((_, index) => index)
        : getAssignmentOptionPermutation(question, shuffleSeed, shuffleOptions);
    const originalIndex = permutation[slot as number];
    const isCorrect = originalIndex === question.correct_index;
    return {
      isCorrect,
      score: isCorrect ? question.base_score : 0,
      answer: { ...emptyAnswer, chosenIndex: originalIndex },
    };
  }

  if (question.question_type === 'multi_select') {
    const options = parseStringArrayStrict(question.options, 'question options');
    const slots = requireDisplaySlots(submitted.chosenIndices, options.length, { unique: true });
    const permutation = getAssignmentOptionPermutation(question, shuffleSeed, shuffleOptions);
    const originalIndices = (slots as number[])
      .map((slot) => permutation[slot])
      .sort((a, b) => a - b);
    let correctIndices: number[];
    try {
      const parsed: unknown = JSON.parse(question.correct_indices ?? '[]');
      if (!Array.isArray(parsed) || parsed.some((value) => !Number.isInteger(value)))
        throw new Error();
      correctIndices = [...(parsed as number[])].sort((a, b) => a - b);
    } catch {
      throw new InvalidAssignmentAnswerError('Invalid multi-select answer key');
    }
    const isCorrect =
      originalIndices.length === correctIndices.length &&
      originalIndices.every((value, index) => value === correctIndices[index]);
    return {
      isCorrect,
      score: isCorrect ? question.base_score : 0,
      answer: { ...emptyAnswer, chosenIndices: originalIndices },
    };
  }

  if (question.question_type === 'open_text') {
    if (typeof submitted.chosenText !== 'string') {
      throw new InvalidAssignmentAnswerError('chosenText is required');
    }
    const stored = submitted.chosenText.trim();
    const expected = (question.correct_answer ?? '').toLowerCase().trim();
    const isCorrect = stored.length > 0 && stored.toLowerCase() === expected;
    return {
      isCorrect,
      score: isCorrect ? question.base_score : 0,
      answer: { ...emptyAnswer, chosenText: stored },
    };
  }

  if (question.question_type === 'fill_blank') {
    const submittedAnswers = parseFillAnswers(submitted.chosenText);
    const blanks = parseBlankKey(question.blanks);
    const { matched, total } = matchFillBlank(submittedAnswers, blanks);
    return {
      isCorrect: total > 0 && matched === total,
      score: partialScore(question.base_score, matched, total),
      answer: { ...emptyAnswer, chosenText: JSON.stringify(submittedAnswers) },
    };
  }

  if (question.question_type === 'ordering') {
    const options = parseStringArrayStrict(question.options, 'question options');
    const slots = requireDisplaySlots(submitted.chosenIndices, options.length, {
      exactLength: options.length,
      unique: true,
    }) as number[];
    const permutation = getAssignmentOptionPermutation(question, shuffleSeed, shuffleOptions);
    const { matched, total } = scoreOrdering(slots, permutation);
    return {
      isCorrect: total > 0 && matched === total,
      score: partialScore(question.base_score, matched, total),
      answer: { ...emptyAnswer, chosenIndices: slots.map((slot) => permutation[slot]) },
    };
  }

  if (question.question_type === 'matching') {
    const leftItems = parseStringArrayStrict(question.options, 'matching left options');
    const rightItems = parseStringArrayStrict(question.matches ?? '[]', 'matching right options');
    const slots = requireDisplaySlots(submitted.chosenIndices, rightItems.length, {
      exactLength: leftItems.length,
      allowNull: true,
    });
    const permutation = getAssignmentMatchingPermutation(question, shuffleSeed);
    const { matched, total } = scoreMatching(slots, permutation, rightItems, rightItems);
    const normalized = slots.map((slot) => (slot === null ? null : permutation[slot]));
    return {
      isCorrect: total > 0 && matched === total,
      score: partialScore(question.base_score, matched, total),
      answer: { ...emptyAnswer, chosenIndices: normalized },
    };
  }

  if (question.question_type === 'closest_to') {
    const min = question.range_min ?? 0;
    const max = question.range_max ?? 100;
    const correct = Number.parseInt(question.correct_answer ?? '', 10);
    const guess = parseIntegerInRange(submitted.chosenText ?? undefined, min, max);
    if (guess === null || Number.isNaN(correct)) {
      throw new InvalidAssignmentAnswerError('Closest-to answer is invalid');
    }
    const distance = closestToDistance(guess, correct);
    const isCorrect = distance === 0;
    const score = isCorrect
      ? question.base_score
      : Math.max(
          0,
          Math.round(
            question.base_score * (1 - distance / closestToMaxDistance(correct, min, max)) * 0.75,
          ),
        );
    return {
      isCorrect,
      score,
      answer: { ...emptyAnswer, chosenText: String(guess) },
    };
  }

  if (question.question_type === 'geo') {
    const correct = parseLatLng(question.geo);
    const guess = parseLatLng(submitted.chosenText);
    if (!correct || !guess) throw new InvalidAssignmentAnswerError('Geo answer is invalid');
    const distanceKm = geoDistanceKm(guess, correct);
    const isCorrect = distanceKm <= 50;
    const score = isCorrect
      ? question.base_score
      : Math.round(question.base_score * Math.exp(-distanceKm / 1500));
    return {
      isCorrect,
      score,
      answer: { ...emptyAnswer, chosenText: JSON.stringify(guess) },
    };
  }

  throw new InvalidAssignmentAnswerError(`Unsupported question type: ${question.question_type}`);
}
