import type { QuestionDifficulty, QuestionType } from '@/types';

const BASE_SECONDS: Record<QuestionType, number> = {
  true_false: 15,
  multiple_choice: 20,
  multi_select: 30,
  fill_blank: 30,
  ordering: 35,
  matching: 40,
  closest_to: 30,
  geo: 35,
  open_text: 30,
};

export function calculateAutoQuestionTime(question: {
  text?: string | null;
  options?: string[] | null;
  matches?: string[] | null;
  question_type?: QuestionType | null;
  difficulty?: QuestionDifficulty | null;
}): number {
  const type = question.question_type ?? 'multiple_choice';
  const contentLength =
    (question.text?.length ?? 0) +
    (question.options ?? []).reduce((sum, option) => sum + option.length, 0) +
    (question.matches ?? []).reduce((sum, option) => sum + option.length, 0);
  const lengthAdjustment =
    contentLength <= 300 ? 0 : contentLength <= 600 ? 5 : contentLength <= 1000 ? 10 : 20;
  const difficultyAdjustment =
    question.difficulty === 'medium' ? 5 : question.difficulty === 'hard' ? 10 : 0;
  return Math.min(90, Math.max(15, BASE_SECONDS[type] + lengthAdjustment + difficultyAdjustment));
}

export function questionTimeOverride(sourceMetadata: Record<string, unknown> | undefined): number | null {
  const runtime = sourceMetadata?.runtime;
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) return null;
  const value = (runtime as Record<string, unknown>).time_seconds_override;
  return Number.isInteger(value) && (value as number) >= 15 ? (value as number) : null;
}

export function withQuestionTimeOverride(
  sourceMetadata: Record<string, unknown> | undefined,
  seconds: number | null,
): Record<string, unknown> {
  const metadata = { ...(sourceMetadata ?? {}) };
  const existingRuntime =
    metadata.runtime && typeof metadata.runtime === 'object' && !Array.isArray(metadata.runtime)
      ? (metadata.runtime as Record<string, unknown>)
      : {};
  if (seconds === null) {
    const { time_seconds_override: _removed, ...remainingRuntime } = existingRuntime;
    if (Object.keys(remainingRuntime).length > 0) metadata.runtime = remainingRuntime;
    else delete metadata.runtime;
  } else {
    metadata.runtime = { ...existingRuntime, time_seconds_override: seconds };
  }
  return metadata;
}
