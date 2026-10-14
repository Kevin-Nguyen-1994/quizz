import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  largestRemainder,
  planSmartMix,
  SmartMixPlanError,
  type SmartMixCapacity,
} from './smartMix';

function capacities(
  categoryCount = 6,
  overrides: Record<string, [number, number]> = {},
): SmartMixCapacity[] {
  return Array.from({ length: categoryCount }, (_, categoryIndex) => categoryIndex + 1).flatMap(
    (categoryId) =>
      [1, 2].flatMap((minimumLevelId) => {
        const [nonCritical, critical] = overrides[`${categoryId}:${minimumLevelId}`] ?? [8, 6];
        return [
          {
            categoryId,
            categoryName: `Nhóm ${categoryId}`,
            minimumLevelId,
            minimumLevelCode: minimumLevelId === 1 ? 'CS1' : 'CS2',
            difficulty: null,
            critical: false,
            availableCount: nonCritical,
          },
          {
            categoryId,
            categoryName: `Nhóm ${categoryId}`,
            minimumLevelId,
            minimumLevelCode: minimumLevelId === 1 ? 'CS1' : 'CS2',
            difficulty: null,
            critical: true,
            availableCount: critical,
          },
        ];
      }),
  );
}

describe('Phase 7C.1 Smart Mix planner', () => {
  it('uses largest remainder so level counts always match the requested total', () => {
    assert.deepEqual(
      [
        ...largestRemainder(30, [
          { id: 1, weight: 25 },
          { id: 2, weight: 75 },
        ]),
      ],
      [
        [1, 8],
        [2, 22],
      ],
    );
  });

  it('builds the 20-question CS1/CS2 acceptance plan with weighted points', () => {
    const plan = planSmartMix(
      {
        totalQuestions: 20,
        categoryIds: [1, 2, 3, 4, 5, 6],
        levelMix: [
          { minimumLevelId: 1, percentage: 25 },
          { minimumLevelId: 2, percentage: 75 },
        ],
        categoryDistribution: 'balanced',
        criticalMinimum: 4,
      },
      capacities(),
    );

    assert.equal(plan.totalQuestions, 20);
    assert.equal(
      plan.levelCounts.find((item) => item.minimumLevelCode === 'CS1')?.questionCount,
      5,
    );
    assert.equal(
      plan.levelCounts.find((item) => item.minimumLevelCode === 'CS2')?.questionCount,
      15,
    );
    assert.equal(plan.criticalCount, 4);
    assert.equal(plan.totalScore, 2750);
    assert.equal(
      plan.rules.reduce((sum, rule) => sum + rule.questionCount, 0),
      20,
    );
    assert.ok(plan.rules.every((rule) => rule.questionCount <= rule.availableCount));
    const keys = plan.rules.map(
      (rule) => `${rule.categoryId}:${rule.minimumLevelId}:${String(rule.critical)}`,
    );
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(plan.rules.every((rule) => rule.critical !== null));
  });

  it('redistributes questions when a balanced category has a small pool', () => {
    const plan = planSmartMix(
      {
        totalQuestions: 12,
        categoryIds: [1, 2, 3],
        levelMix: [{ minimumLevelId: 1, percentage: 100 }],
        categoryDistribution: 'balanced',
        criticalMinimum: 0,
      },
      capacities(3, { '1:1': [1, 1] }),
    );
    const first = plan.allocations.find(
      (item) => item.categoryId === 1 && item.minimumLevelId === 1,
    );
    assert.equal(first?.questionCount, 2);
    assert.equal(plan.totalQuestions, 12);
    assert.ok(plan.rules.every((rule) => rule.critical === null));
  });

  it('rejects a plan when the selected pool or critical pool is insufficient', () => {
    assert.throws(
      () =>
        planSmartMix(
          {
            totalQuestions: 50,
            categoryIds: [1],
            levelMix: [{ minimumLevelId: 1, percentage: 100 }],
            categoryDistribution: 'balanced',
          },
          capacities(1),
        ),
      (error: unknown) =>
        error instanceof SmartMixPlanError && error.code === 'SMART_MIX_POOL_INSUFFICIENT',
    );
    assert.throws(
      () =>
        planSmartMix(
          {
            totalQuestions: 10,
            categoryIds: [1],
            levelMix: [{ minimumLevelId: 1, percentage: 100 }],
            categoryDistribution: 'balanced',
            criticalMinimum: 7,
          },
          capacities(1, { '1:1': [20, 2] }),
        ),
      (error: unknown) =>
        error instanceof SmartMixPlanError && error.code === 'SMART_MIX_CRITICAL_INSUFFICIENT',
    );
  });

  it('filters the pool by the allowed difficulty set and reports actual counts', () => {
    const difficultyCapacities: SmartMixCapacity[] = ['easy', 'medium', 'hard'].flatMap(
      (difficulty, index) => [
        {
          categoryId: 1,
          categoryName: 'Nhóm 1',
          minimumLevelId: 1,
          minimumLevelCode: 'CS1',
          difficulty: difficulty as 'easy' | 'medium' | 'hard',
          critical: false,
          availableCount: 2 + index,
        },
        {
          categoryId: 1,
          categoryName: 'Nhóm 1',
          minimumLevelId: 1,
          minimumLevelCode: 'CS1',
          difficulty: difficulty as 'easy' | 'medium' | 'hard',
          critical: true,
          availableCount: 1,
        },
      ],
    );
    const request = {
      totalQuestions: 3,
      categoryIds: [1],
      levelMix: [{ minimumLevelId: 1, percentage: 100 }],
      categoryDistribution: 'balanced' as const,
      criticalMinimum: 0,
    };

    const easy = planSmartMix({ ...request, selectedDifficulties: ['easy'] }, difficultyCapacities);
    assert.ok(easy.rules.every((rule) => rule.difficulty === 'easy'));
    assert.equal(
      easy.difficultyCounts.find((item) => item.difficulty === 'easy')?.questionCount,
      3,
    );

    const mediumHard = planSmartMix(
      { ...request, totalQuestions: 5, selectedDifficulties: ['medium', 'hard'] },
      difficultyCapacities,
    );
    assert.ok(mediumHard.rules.every((rule) => rule.difficulty !== 'easy'));
    assert.equal(
      mediumHard.difficultyCounts.reduce((sum, item) => sum + item.questionCount, 0),
      5,
    );

    const all = planSmartMix(
      { ...request, selectedDifficulties: ['easy', 'medium', 'hard'] },
      difficultyCapacities,
    );
    assert.equal(all.totalQuestions, 3);
    assert.ok(all.rules.every((rule) => rule.difficulty !== null));
  });

  it('rejects an empty difficulty selection and keeps legacy null as no filter', () => {
    assert.throws(
      () =>
        planSmartMix(
          {
            totalQuestions: 1,
            categoryIds: [1],
            levelMix: [{ minimumLevelId: 1, percentage: 100 }],
            categoryDistribution: 'balanced',
            selectedDifficulties: [],
          },
          capacities(1),
        ),
      (error: unknown) => error instanceof SmartMixPlanError && error.code === 'SMART_MIX_INVALID',
    );
    const legacy = planSmartMix(
      {
        totalQuestions: 1,
        categoryIds: [1],
        levelMix: [{ minimumLevelId: 1, percentage: 100 }],
        categoryDistribution: 'balanced',
        selectedDifficulties: null,
      },
      capacities(1),
    );
    assert.equal(legacy.rules[0].difficulty, null);
  });

  it('filters difficulty independently per level and reports the actual matrix', () => {
    const matrixCapacities: SmartMixCapacity[] = [1, 2].flatMap((minimumLevelId) =>
      (['easy', 'medium', 'hard'] as const).map((difficulty) => ({
        categoryId: 1,
        categoryName: 'Nhóm 1',
        minimumLevelId,
        minimumLevelCode: minimumLevelId === 1 ? 'CS1' : 'CS2',
        difficulty,
        critical: false,
        availableCount: 10,
      })),
    );
    const plan = planSmartMix(
      {
        totalQuestions: 10,
        categoryIds: [1],
        levelMix: [
          { minimumLevelId: 1, percentage: 60 },
          { minimumLevelId: 2, percentage: 40 },
        ],
        categoryDistribution: 'balanced',
        selectedDifficultiesByLevel: { '1': ['easy'], '2': ['hard'] },
      },
      matrixCapacities,
    );

    assert.ok(
      plan.rules.every(
        (rule) =>
          (rule.minimumLevelId === 1 && rule.difficulty === 'easy') ||
          (rule.minimumLevelId === 2 && rule.difficulty === 'hard'),
      ),
    );
    assert.equal(
      plan.levelDifficultyCounts.find(
        (item) => item.minimumLevelId === 1 && item.difficulty === 'easy',
      )?.questionCount,
      6,
    );
    assert.equal(
      plan.levelDifficultyCounts.find(
        (item) => item.minimumLevelId === 2 && item.difficulty === 'hard',
      )?.questionCount,
      4,
    );
  });

  it('requires difficulties only for levels above zero and never falls back on shortage', () => {
    const matrixCapacities: SmartMixCapacity[] = [
      {
        categoryId: 1,
        categoryName: 'Nhóm 1',
        minimumLevelId: 1,
        minimumLevelCode: 'CS1',
        difficulty: 'easy',
        critical: false,
        availableCount: 10,
      },
      {
        categoryId: 1,
        categoryName: 'Nhóm 1',
        minimumLevelId: 2,
        minimumLevelCode: 'CS2',
        difficulty: 'hard',
        critical: false,
        availableCount: 1,
      },
    ];
    const base = {
      totalQuestions: 10,
      categoryIds: [1],
      categoryDistribution: 'balanced' as const,
    };

    assert.doesNotThrow(() =>
      planSmartMix(
        {
          ...base,
          levelMix: [
            { minimumLevelId: 1, percentage: 100 },
            { minimumLevelId: 2, percentage: 0 },
          ],
          selectedDifficultiesByLevel: { '1': ['easy'], '2': [] },
        },
        matrixCapacities,
      ),
    );
    assert.throws(
      () =>
        planSmartMix(
          {
            ...base,
            levelMix: [
              { minimumLevelId: 1, percentage: 50 },
              { minimumLevelId: 2, percentage: 50 },
            ],
            selectedDifficultiesByLevel: { '1': ['easy'], '2': [] },
          },
          matrixCapacities,
        ),
      (error: unknown) =>
        error instanceof SmartMixPlanError && /CS2 phải chọn/.test(error.message),
    );
    assert.throws(
      () =>
        planSmartMix(
          {
            ...base,
            levelMix: [
              { minimumLevelId: 1, percentage: 50 },
              { minimumLevelId: 2, percentage: 50 },
            ],
            selectedDifficultiesByLevel: { '1': ['easy'], '2': ['hard'] },
          },
          matrixCapacities,
        ),
      (error: unknown) =>
        error instanceof SmartMixPlanError && error.code === 'SMART_MIX_LEVEL_INSUFFICIENT',
    );
  });
});
