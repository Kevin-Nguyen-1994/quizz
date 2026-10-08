import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calculateAutoQuestionTime,
  explicitQuestionTimeOverride,
  resolveEffectiveQuestionTime,
} from './questionTiming';

function question(
  questionType: Parameters<typeof calculateAutoQuestionTime>[0]['question_type'],
  difficulty: Parameters<typeof calculateAutoQuestionTime>[0]['difficulty'],
  contentLength: number,
) {
  return {
    question_type: questionType,
    difficulty,
    text: 'x'.repeat(contentLength),
    options: [] as string[],
    matches: [] as string[],
  };
}

describe('automatic question timing', () => {
  it('matches the approved acceptance examples', () => {
    assert.equal(calculateAutoQuestionTime(question('multiple_choice', 'easy', 100)), 20);
    assert.equal(calculateAutoQuestionTime(question('multiple_choice', 'medium', 100)), 25);
    assert.equal(calculateAutoQuestionTime(question('multiple_choice', 'hard', 700)), 40);
    assert.equal(calculateAutoQuestionTime(question('multi_select', 'medium', 400)), 40);
    assert.equal(calculateAutoQuestionTime(question('ordering', 'hard', 100)), 45);
  });

  it('counts option and matching text and caps automatic time at 90 seconds', () => {
    assert.equal(
      calculateAutoQuestionTime({
        question_type: 'matching',
        difficulty: 'hard',
        text: 'Prompt',
        options: ['x'.repeat(600)],
        matches: ['y'.repeat(600)],
      }),
      70,
    );
  });

  it('ignores source recommended time and applies explicit priorities', () => {
    const base = {
      ...question('multiple_choice', 'medium', 100),
      source_metadata_json: JSON.stringify({
        timing: { recommended_seconds: 62, enforced_per_question: false },
        runtime: { time_seconds_override: 40 },
      }),
    };
    assert.equal(explicitQuestionTimeOverride(base.source_metadata_json), 40);
    assert.deepEqual(resolveEffectiveQuestionTime(base as never, null), {
      seconds: 40,
      source: 'question_override',
    });
    assert.deepEqual(resolveEffectiveQuestionTime(base as never, 55), {
      seconds: 55,
      source: 'rule_override',
    });
    assert.deepEqual(
      resolveEffectiveQuestionTime(
        {
          ...base,
          source_metadata_json: JSON.stringify({
            timing: { recommended_seconds: 62, enforced_per_question: false },
          }),
        } as never,
        null,
      ),
      { seconds: 25, source: 'auto' },
    );
  });
});
