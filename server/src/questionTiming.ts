import type { DbBankQuestion, QuestionDifficulty, QuestionType } from './types';

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

export const MIN_QUESTION_TIME_SECONDS = 15;
export const MAX_AUTO_QUESTION_TIME_SECONDS = 90;

export type EffectiveQuestionTimeSource = 'auto' | 'question_override' | 'rule_override';

type AutoTimeQuestion = Pick<DbBankQuestion, 'text' | 'options' | 'matches' | 'question_type' | 'difficulty'>;

function stringList(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

export function calculateAutoQuestionTime(question: {
  text?: string | null;
  options?: string | string[] | null;
  matches?: string | string[] | null;
  question_type: QuestionType;
  difficulty?: QuestionDifficulty | null;
}): number {
  const contentLength =
    (question.text?.length ?? 0) +
    stringList(question.options).reduce((sum, option) => sum + option.length, 0) +
    stringList(question.matches).reduce((sum, option) => sum + option.length, 0);
  const lengthAdjustment =
    contentLength <= 300 ? 0 : contentLength <= 600 ? 5 : contentLength <= 1000 ? 10 : 20;
  const difficultyAdjustment =
    question.difficulty === 'medium' ? 5 : question.difficulty === 'hard' ? 10 : 0;
  return Math.min(
    MAX_AUTO_QUESTION_TIME_SECONDS,
    Math.max(
      MIN_QUESTION_TIME_SECONDS,
      BASE_SECONDS[question.question_type] + lengthAdjustment + difficultyAdjustment,
    ),
  );
}

export function explicitQuestionTimeOverride(
  sourceMetadataJson: string | Record<string, unknown> | null | undefined,
): number | null {
  try {
    const metadata =
      typeof sourceMetadataJson === 'string'
        ? (JSON.parse(sourceMetadataJson) as Record<string, unknown>)
        : sourceMetadataJson;
    if (!metadata || typeof metadata !== 'object') return null;
    const runtime = metadata.runtime;
    if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) return null;
    const value = (runtime as Record<string, unknown>).time_seconds_override;
    return Number.isInteger(value) && (value as number) >= MIN_QUESTION_TIME_SECONDS
      ? (value as number)
      : null;
  } catch {
    return null;
  }
}

export function resolveEffectiveQuestionTime(
  question: AutoTimeQuestion & Pick<DbBankQuestion, 'source_metadata_json'>,
  ruleOverride: number | null,
): { seconds: number; source: EffectiveQuestionTimeSource } {
  if (ruleOverride !== null) return { seconds: ruleOverride, source: 'rule_override' };
  const questionOverride = explicitQuestionTimeOverride(question.source_metadata_json);
  if (questionOverride !== null) {
    return { seconds: questionOverride, source: 'question_override' };
  }
  return { seconds: calculateAutoQuestionTime(question), source: 'auto' };
}
