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
            critical: false,
            availableCount: nonCritical,
          },
          {
            categoryId,
            categoryName: `Nhóm ${categoryId}`,
            minimumLevelId,
            minimumLevelCode: minimumLevelId === 1 ? 'CS1' : 'CS2',
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
});
