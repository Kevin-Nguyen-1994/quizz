export interface SmartMixLevelRequest {
  minimumLevelId: number;
  percentage: number;
}

export interface SmartMixCategoryWeight {
  categoryId: number;
  weight: number;
}

export interface SmartMixRequest {
  totalQuestions: number;
  categoryIds: number[];
  levelMix: SmartMixLevelRequest[];
  categoryDistribution: 'balanced' | 'custom';
  categoryWeights?: SmartMixCategoryWeight[];
  criticalMinimum?: number;
}

export interface SmartMixCapacity {
  categoryId: number;
  categoryName: string;
  minimumLevelId: number;
  minimumLevelCode: string;
  critical: boolean;
  availableCount: number;
}

export interface SmartMixRule {
  categoryId: number;
  minimumLevelId: number;
  difficulty: null;
  questionType: null;
  critical: boolean | null;
  questionCount: number;
  pointsOverride: number;
  recommendedSecondsOverride: null;
  sortOrder: number;
  availableCount: number;
}

export interface SmartMixAllocation {
  categoryId: number;
  categoryName: string;
  minimumLevelId: number;
  minimumLevelCode: string;
  questionCount: number;
  criticalCount: number;
  availableCount: number;
  pointsPerQuestion: number;
}

export interface SmartMixPlan {
  rules: SmartMixRule[];
  allocations: SmartMixAllocation[];
  totalQuestions: number;
  totalScore: number;
  criticalCount: number;
  criticalMinimum: number;
  poolCapacity: number;
  levelCounts: Array<{
    minimumLevelId: number;
    minimumLevelCode: string;
    questionCount: number;
    percentage: number;
  }>;
  warnings: string[];
}

export class SmartMixPlanError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 400,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new SmartMixPlanError(`${label} không hợp lệ.`, 'SMART_MIX_INVALID');
  }
  return value as number;
}

/** Convert percentages to exact counts while preserving the requested total. */
export function largestRemainder(
  total: number,
  items: Array<{ id: number; weight: number }>,
): Map<number, number> {
  const weightTotal = items.reduce((sum, item) => sum + item.weight, 0);
  if (weightTotal <= 0) {
    throw new SmartMixPlanError('Phân bổ phải lớn hơn 0%.', 'SMART_MIX_INVALID');
  }
  const rows = items.map((item, index) => {
    const exact = (total * item.weight) / weightTotal;
    return { ...item, index, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = total - rows.reduce((sum, row) => sum + row.count, 0);
  for (const row of [...rows].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (remaining <= 0) break;
    row.count += 1;
    remaining -= 1;
  }
  return new Map(rows.map((row) => [row.id, row.count]));
}

type Cell = {
  categoryId: number;
  categoryName: string;
  minimumLevelId: number;
  minimumLevelCode: string;
  criticalCapacity: number;
  nonCriticalCapacity: number;
  allocated: number;
  criticalAllocated: number;
};

export function planSmartMix(raw: SmartMixRequest, capacities: SmartMixCapacity[]): SmartMixPlan {
  const totalQuestions = positiveInteger(raw.totalQuestions, 'Tổng số câu');
  const categoryIds = [...new Set(raw.categoryIds ?? [])];
  if (categoryIds.length === 0 || categoryIds.some((id) => !Number.isInteger(id) || id < 1)) {
    throw new SmartMixPlanError('Hãy chọn ít nhất một nhóm nghiệp vụ.', 'SMART_MIX_INVALID');
  }
  const levelMix = (raw.levelMix ?? []).filter((item) => item.percentage > 0);
  if (
    levelMix.length === 0 ||
    levelMix.some(
      (item) =>
        !Number.isInteger(item.minimumLevelId) ||
        item.minimumLevelId < 1 ||
        !Number.isFinite(item.percentage) ||
        item.percentage < 0,
    )
  ) {
    throw new SmartMixPlanError('Phân bổ bậc câu hỏi không hợp lệ.', 'SMART_MIX_INVALID');
  }
  if (new Set(levelMix.map((item) => item.minimumLevelId)).size !== levelMix.length) {
    throw new SmartMixPlanError('Bậc câu hỏi bị lặp.', 'SMART_MIX_INVALID');
  }
  const criticalMinimum = raw.criticalMinimum ?? 0;
  if (
    !Number.isInteger(criticalMinimum) ||
    criticalMinimum < 0 ||
    criticalMinimum > totalQuestions
  ) {
    throw new SmartMixPlanError('Số câu trọng yếu không hợp lệ.', 'SMART_MIX_INVALID');
  }

  const categoryWeight = new Map<number, number>();
  if (raw.categoryDistribution === 'custom') {
    for (const item of raw.categoryWeights ?? []) {
      if (
        categoryIds.includes(item.categoryId) &&
        Number.isFinite(item.weight) &&
        item.weight > 0
      ) {
        categoryWeight.set(item.categoryId, item.weight);
      }
    }
    if (categoryIds.some((id) => !categoryWeight.has(id))) {
      throw new SmartMixPlanError(
        'Hãy nhập tỷ lệ lớn hơn 0 cho mọi nhóm nghiệp vụ đã chọn.',
        'SMART_MIX_INVALID',
      );
    }
  } else {
    categoryIds.forEach((id) => {
      categoryWeight.set(id, 1);
    });
  }

  const selectedLevels = new Set(levelMix.map((item) => item.minimumLevelId));
  const selectedCategories = new Set(categoryIds);
  const relevant = capacities.filter(
    (item) => selectedCategories.has(item.categoryId) && selectedLevels.has(item.minimumLevelId),
  );
  const cellMap = new Map<string, Cell>();
  for (const item of relevant) {
    const key = `${item.categoryId}:${item.minimumLevelId}`;
    const cell = cellMap.get(key) ?? {
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      minimumLevelId: item.minimumLevelId,
      minimumLevelCode: item.minimumLevelCode,
      criticalCapacity: 0,
      nonCriticalCapacity: 0,
      allocated: 0,
      criticalAllocated: 0,
    };
    if (item.critical) cell.criticalCapacity += item.availableCount;
    else cell.nonCriticalCapacity += item.availableCount;
    cellMap.set(key, cell);
  }
  const cells = [...cellMap.values()];
  const poolCapacity = cells.reduce(
    (sum, cell) => sum + cell.criticalCapacity + cell.nonCriticalCapacity,
    0,
  );
  if (poolCapacity < totalQuestions) {
    throw new SmartMixPlanError(
      `Yêu cầu ${totalQuestions} câu nhưng ngân hàng phù hợp chỉ có ${poolCapacity} câu.`,
      'SMART_MIX_POOL_INSUFFICIENT',
      409,
      { requestedCount: totalQuestions, availableCount: poolCapacity },
    );
  }

  const levelCounts = largestRemainder(
    totalQuestions,
    levelMix.map((item) => ({ id: item.minimumLevelId, weight: item.percentage })),
  );
  const totalByCategory = new Map(categoryIds.map((id) => [id, 0]));
  const levelsBySlack = levelMix
    .map((item, index) => ({
      ...item,
      index,
      target: levelCounts.get(item.minimumLevelId) ?? 0,
      capacity: cells
        .filter((cell) => cell.minimumLevelId === item.minimumLevelId)
        .reduce((sum, cell) => sum + cell.criticalCapacity + cell.nonCriticalCapacity, 0),
    }))
    .sort((a, b) => a.capacity - a.target - (b.capacity - b.target) || a.index - b.index);

  for (const level of levelsBySlack) {
    if (level.capacity < level.target) {
      const code =
        cells.find((cell) => cell.minimumLevelId === level.minimumLevelId)?.minimumLevelCode ??
        `#${level.minimumLevelId}`;
      throw new SmartMixPlanError(
        `Bậc ${code} cần ${level.target} câu nhưng ngân hàng phù hợp chỉ có ${level.capacity} câu.`,
        'SMART_MIX_LEVEL_INSUFFICIENT',
        409,
        {
          minimumLevelId: level.minimumLevelId,
          requestedCount: level.target,
          availableCount: level.capacity,
        },
      );
    }
    for (let count = 0; count < level.target; count += 1) {
      const candidates = cells
        .filter(
          (cell) =>
            cell.minimumLevelId === level.minimumLevelId &&
            cell.allocated < cell.criticalCapacity + cell.nonCriticalCapacity,
        )
        .sort((left, right) => {
          const leftRatio =
            (totalByCategory.get(left.categoryId) ?? 0) /
            (categoryWeight.get(left.categoryId) ?? 1);
          const rightRatio =
            (totalByCategory.get(right.categoryId) ?? 0) /
            (categoryWeight.get(right.categoryId) ?? 1);
          return (
            leftRatio - rightRatio ||
            left.allocated - right.allocated ||
            categoryIds.indexOf(left.categoryId) - categoryIds.indexOf(right.categoryId)
          );
        });
      const chosen = candidates[0];
      if (!chosen) {
        throw new SmartMixPlanError(
          'Không thể phân bổ đủ câu theo bậc đã chọn.',
          'SMART_MIX_LEVEL_INSUFFICIENT',
          409,
        );
      }
      chosen.allocated += 1;
      totalByCategory.set(chosen.categoryId, (totalByCategory.get(chosen.categoryId) ?? 0) + 1);
    }
  }

  const usedCells = cells.filter((cell) => cell.allocated > 0);
  if (criticalMinimum > 0) {
    usedCells.forEach((cell) => {
      cell.criticalAllocated = Math.max(0, cell.allocated - cell.nonCriticalCapacity);
    });
    const possibleCritical = usedCells.reduce(
      (sum, cell) => sum + Math.min(cell.allocated, cell.criticalCapacity),
      0,
    );
    if (possibleCritical < criticalMinimum) {
      throw new SmartMixPlanError(
        `Yêu cầu ít nhất ${criticalMinimum} câu trọng yếu nhưng phương án hiện tại chỉ đáp ứng tối đa ${possibleCritical} câu.`,
        'SMART_MIX_CRITICAL_INSUFFICIENT',
        409,
        { requestedCount: criticalMinimum, availableCount: possibleCritical },
      );
    }
    let currentCritical = usedCells.reduce((sum, cell) => sum + cell.criticalAllocated, 0);
    while (currentCritical < criticalMinimum) {
      const candidate = [...usedCells]
        .filter((cell) => cell.criticalAllocated < Math.min(cell.allocated, cell.criticalCapacity))
        .sort(
          (left, right) =>
            left.criticalAllocated - right.criticalAllocated ||
            left.allocated - right.allocated ||
            categoryIds.indexOf(left.categoryId) - categoryIds.indexOf(right.categoryId),
        )[0];
      if (!candidate) break;
      candidate.criticalAllocated += 1;
      currentCritical += 1;
    }
  }

  const multipleLevels = levelCounts.size > 1;
  const pointsFor = (cell: Cell) =>
    multipleLevels && cell.minimumLevelCode.toUpperCase() === 'CS2' ? 150 : 100;
  const allocations: SmartMixAllocation[] = usedCells
    .sort(
      (left, right) =>
        categoryIds.indexOf(left.categoryId) - categoryIds.indexOf(right.categoryId) ||
        levelMix.findIndex((item) => item.minimumLevelId === left.minimumLevelId) -
          levelMix.findIndex((item) => item.minimumLevelId === right.minimumLevelId),
    )
    .map((cell) => ({
      categoryId: cell.categoryId,
      categoryName: cell.categoryName,
      minimumLevelId: cell.minimumLevelId,
      minimumLevelCode: cell.minimumLevelCode,
      questionCount: cell.allocated,
      criticalCount: cell.criticalAllocated,
      availableCount: cell.criticalCapacity + cell.nonCriticalCapacity,
      pointsPerQuestion: pointsFor(cell),
    }));
  const rules: SmartMixRule[] = [];
  for (const cell of usedCells) {
    const pointsOverride = pointsFor(cell);
    if (criticalMinimum === 0) {
      rules.push({
        categoryId: cell.categoryId,
        minimumLevelId: cell.minimumLevelId,
        difficulty: null,
        questionType: null,
        critical: null,
        questionCount: cell.allocated,
        pointsOverride,
        recommendedSecondsOverride: null,
        sortOrder: rules.length,
        availableCount: cell.criticalCapacity + cell.nonCriticalCapacity,
      });
      continue;
    }
    if (cell.criticalAllocated > 0) {
      rules.push({
        categoryId: cell.categoryId,
        minimumLevelId: cell.minimumLevelId,
        difficulty: null,
        questionType: null,
        critical: true,
        questionCount: cell.criticalAllocated,
        pointsOverride,
        recommendedSecondsOverride: null,
        sortOrder: rules.length,
        availableCount: cell.criticalCapacity,
      });
    }
    const nonCriticalCount = cell.allocated - cell.criticalAllocated;
    if (nonCriticalCount > 0) {
      rules.push({
        categoryId: cell.categoryId,
        minimumLevelId: cell.minimumLevelId,
        difficulty: null,
        questionType: null,
        critical: false,
        questionCount: nonCriticalCount,
        pointsOverride,
        recommendedSecondsOverride: null,
        sortOrder: rules.length,
        availableCount: cell.nonCriticalCapacity,
      });
    }
  }

  const actualCritical = usedCells.reduce((sum, cell) => sum + cell.criticalAllocated, 0);
  const warnings: string[] = [];
  if (actualCritical > criticalMinimum) {
    warnings.push(
      `Pool hiện tại cần dùng ${actualCritical} câu trọng yếu để giữ đúng tổng số câu và phân bổ bậc.`,
    );
  }
  return {
    rules,
    allocations,
    totalQuestions,
    totalScore: allocations.reduce(
      (sum, item) => sum + item.questionCount * item.pointsPerQuestion,
      0,
    ),
    criticalCount: actualCritical,
    criticalMinimum,
    poolCapacity,
    levelCounts: levelMix.map((item) => {
      const matching = cells.find((cell) => cell.minimumLevelId === item.minimumLevelId);
      return {
        minimumLevelId: item.minimumLevelId,
        minimumLevelCode: matching?.minimumLevelCode ?? `#${item.minimumLevelId}`,
        questionCount: levelCounts.get(item.minimumLevelId) ?? 0,
        percentage: item.percentage,
      };
    }),
    warnings,
  };
}
