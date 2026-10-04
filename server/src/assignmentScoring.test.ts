import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getAssignmentMatchingPermutation,
  getAssignmentOptionPermutation,
  gradeAssignmentAnswer,
} from './assignmentScoring';
import type { DbAssignmentQuestion, QuestionType } from './types';

function question(
  questionType: QuestionType,
  patch: Partial<DbAssignmentQuestion> = {},
): DbAssignmentQuestion {
  return {
    id: 10,
    assignment_id: 2,
    source_question_id: 99,
    text: 'Question',
    options: JSON.stringify(['A', 'B', 'C']),
    correct_index: 1,
    correct_indices: null,
    base_score: 1000,
    time_sec: 20,
    order_index: 0,
    image_url: null,
    explanation: null,
    range_min: null,
    range_max: null,
    question_type: questionType,
    correct_answer: null,
    media_url: null,
    media_type: null,
    blanks: null,
    geo: null,
    matches: null,
    tags: null,
    ...patch,
  };
}

describe('gradeAssignmentAnswer', () => {
  const seed = 12345;

  it('grades multiple choice using the stable display permutation', () => {
    const q = question('multiple_choice');
    const permutation = getAssignmentOptionPermutation(q, seed, true);
    const result = gradeAssignmentAnswer(q, { chosenIndex: permutation.indexOf(1) }, seed, true);
    assert.equal(result.isCorrect, true);
    assert.equal(result.score, 1000);
    assert.equal(result.answer.chosenIndex, 1);
  });

  it('grades multi select without a speed bonus', () => {
    const q = question('multi_select', { correct_indices: JSON.stringify([0, 2]) });
    const permutation = getAssignmentOptionPermutation(q, seed, true);
    const displaySlots = [permutation.indexOf(0), permutation.indexOf(2)];
    const result = gradeAssignmentAnswer(q, { chosenIndices: displaySlots }, seed, true);
    assert.equal(result.isCorrect, true);
    assert.equal(result.score, 1000);
    assert.deepEqual(result.answer.chosenIndices, [0, 2]);
  });

  it('grades open text case-insensitively', () => {
    const q = question('open_text', { options: '[]', correct_answer: 'Hải Phòng' });
    const result = gradeAssignmentAnswer(q, { chosenText: '  hải phòng  ' }, seed);
    assert.equal(result.isCorrect, true);
    assert.equal(result.score, 1000);
  });

  it('keeps partial credit for fill blank', () => {
    const q = question('fill_blank', {
      options: '[]',
      blanks: JSON.stringify([['Việt Nam'], ['Hà Nội']]),
    });
    const result = gradeAssignmentAnswer(
      q,
      { chosenText: JSON.stringify(['việt nam', 'Huế']) },
      seed,
    );
    assert.equal(result.isCorrect, false);
    assert.equal(result.score, 500);
  });

  it('grades ordering against its stable shuffled presentation', () => {
    const q = question('ordering');
    const permutation = getAssignmentOptionPermutation(q, seed, true);
    const correctDisplayOrder = [0, 1, 2].map((original) => permutation.indexOf(original));
    const result = gradeAssignmentAnswer(q, { chosenIndices: correctDisplayOrder }, seed);
    assert.equal(result.isCorrect, true);
    assert.equal(result.score, 1000);
    assert.deepEqual(result.answer.chosenIndices, [0, 1, 2]);
  });

  it('grades matching against its stable shuffled right column', () => {
    const q = question('matching', { matches: JSON.stringify(['1', '2', '3']) });
    const permutation = getAssignmentMatchingPermutation(q, seed);
    const links = [0, 1, 2].map((original) => permutation.indexOf(original));
    const result = gradeAssignmentAnswer(q, { chosenIndices: links }, seed);
    assert.equal(result.isCorrect, true);
    assert.equal(result.score, 1000);
    assert.deepEqual(result.answer.chosenIndices, [0, 1, 2]);
  });

  it('keeps closest-to distance scoring but adds no speed bonus', () => {
    const q = question('closest_to', {
      options: '[]',
      range_min: 0,
      range_max: 100,
      correct_answer: '50',
    });
    const exact = gradeAssignmentAnswer(q, { chosenText: '50' }, seed);
    const near = gradeAssignmentAnswer(q, { chosenText: '40' }, seed);
    assert.equal(exact.score, 1000);
    assert.equal(near.isCorrect, false);
    assert.ok(near.score > 0 && near.score < 1000);
  });

  it('keeps geo distance scoring but adds no speed bonus', () => {
    const q = question('geo', {
      options: '[]',
      geo: JSON.stringify({ lat: 10.7769, lng: 106.7009 }),
    });
    const exact = gradeAssignmentAnswer(
      q,
      { chosenText: JSON.stringify({ lat: 10.7769, lng: 106.7009 }) },
      seed,
    );
    const far = gradeAssignmentAnswer(
      q,
      { chosenText: JSON.stringify({ lat: 21.0285, lng: 105.8542 }) },
      seed,
    );
    assert.equal(exact.score, 1000);
    assert.equal(far.isCorrect, false);
    assert.ok(far.score > 0 && far.score < 1000);
  });
});
