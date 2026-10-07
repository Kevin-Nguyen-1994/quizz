import { Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AppAlert } from '@/components/AppAlert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type { EmployeeLevel, QuestionCategory, QuizGenerationRule, SmartMixPlan } from '@/types';

type Distribution = 'balanced' | 'custom';

function suggestedLevelMix(levels: EmployeeLevel[], targetId: string): Record<number, number> {
  const target = levels.find((level) => String(level.id) === targetId);
  const cs1 = levels.find((level) => level.code.toUpperCase() === 'CS1');
  if (target?.code.toUpperCase() === 'CS2' && cs1) {
    return { [cs1.id]: 25, [target.id]: 75 };
  }
  return target ? { [target.id]: 100 } : {};
}

export function SmartMixBuilder({
  categories,
  levels,
  recommendedLevelId,
  onApply,
}: {
  categories: QuestionCategory[];
  levels: EmployeeLevel[];
  recommendedLevelId: string;
  onApply(rules: QuizGenerationRule[], targetLevelId: string): void;
}) {
  const api = useAuthFetch();
  const initialized = useRef(false);
  const [totalQuestions, setTotalQuestions] = useState(20);
  const [targetLevelId, setTargetLevelId] = useState(recommendedLevelId);
  const [levelPercentages, setLevelPercentages] = useState<Record<number, number>>({});
  const [selectedCategories, setSelectedCategories] = useState<number[]>([]);
  const [distribution, setDistribution] = useState<Distribution>('balanced');
  const [categoryWeights, setCategoryWeights] = useState<Record<number, number>>({});
  const [criticalMinimum, setCriticalMinimum] = useState(4);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<SmartMixPlan | null>(null);

  useEffect(() => {
    if (initialized.current || categories.length === 0 || levels.length === 0) return;
    initialized.current = true;
    const activeCategories = categories
      .filter((category) => category.is_active)
      .map((item) => item.id);
    const fallbackTarget =
      recommendedLevelId ||
      String(levels.find((level) => level.code.toUpperCase() === 'CS2')?.id ?? levels[0].id);
    setTargetLevelId(fallbackTarget);
    setLevelPercentages(suggestedLevelMix(levels, fallbackTarget));
    setSelectedCategories(activeCategories);
    setCategoryWeights(
      Object.fromEntries(activeCategories.map((id) => [id, 1])) as Record<number, number>,
    );
  }, [categories, levels, recommendedLevelId]);

  const percentageTotal = Object.values(levelPercentages).reduce((sum, value) => sum + value, 0);
  const activeCategories = categories.filter((category) => category.is_active);

  async function createPlan() {
    if (percentageTotal !== 100) {
      setError('Tổng tỷ lệ bậc câu hỏi phải bằng 100%.');
      return;
    }
    setPlanning(true);
    setError('');
    setPlan(null);
    const result = await api.post<{ plan?: SmartMixPlan; error?: string }>(
      '/api/admin/question-bank/smart-mix/plan',
      {
        totalQuestions,
        categoryIds: selectedCategories,
        levelMix: levels.map((level) => ({
          minimumLevelId: level.id,
          percentage: levelPercentages[level.id] ?? 0,
        })),
        categoryDistribution: distribution,
        categoryWeights:
          distribution === 'custom'
            ? selectedCategories.map((categoryId) => ({
                categoryId,
                weight: categoryWeights[categoryId] ?? 0,
              }))
            : undefined,
        criticalMinimum,
      },
    );
    setPlanning(false);
    if (!result.ok || !result.data.plan) {
      setError(result.data?.error ?? 'Không thể lập phương án trộn đề.');
      return;
    }
    setPlan(result.data.plan);
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-5 p-5">
          <div>
            <h2 className="font-heading text-lg font-semibold">Tự trộn đề</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Nhập yêu cầu tổng quát, hệ thống sẽ đề xuất cấu hình dựa trên số câu đang có.
            </p>
          </div>
          {error && <AppAlert variant="error">{error}</AppAlert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="smart-mix-total">Tổng số câu</Label>
              <Input
                id="smart-mix-total"
                type="number"
                min="1"
                inputMode="numeric"
                value={totalQuestions}
                onChange={(event) =>
                  setTotalQuestions(Math.max(1, Number(event.target.value) || 1))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Đối tượng bài kiểm tra</Label>
              <Select
                value={targetLevelId}
                onValueChange={(value) => {
                  setTargetLevelId(value);
                  setLevelPercentages(suggestedLevelMix(levels, value));
                  setPlan(null);
                }}
              >
                <SelectTrigger aria-label="Đối tượng bài kiểm tra">
                  <SelectValue placeholder="Chọn bậc" />
                </SelectTrigger>
                <SelectContent>
                  {levels.map((level) => (
                    <SelectItem key={level.id} value={String(level.id)}>
                      {level.code} — {level.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <section className="space-y-3" aria-labelledby="smart-mix-levels">
            <div className="flex items-center justify-between gap-3">
              <h3 id="smart-mix-levels" className="font-medium">
                Phân bổ bậc câu hỏi
              </h3>
              <Badge variant={percentageTotal === 100 ? 'secondary' : 'destructive'}>
                Tổng {percentageTotal}%
              </Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {levels.map((level) => {
                const percentage = levelPercentages[level.id] ?? 0;
                const estimated = Math.round((totalQuestions * percentage) / 100);
                return (
                  <div key={level.id} className="rounded-lg border p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Label htmlFor={`level-${level.id}`}>{level.code}</Label>
                      <span className="text-xs text-muted-foreground">≈ {estimated} câu</span>
                    </div>
                    <div className="relative">
                      <Input
                        id={`level-${level.id}`}
                        type="number"
                        min="0"
                        max="100"
                        inputMode="numeric"
                        className="pr-9"
                        value={percentage}
                        onChange={(event) => {
                          setLevelPercentages((current) => ({
                            ...current,
                            [level.id]: Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                          }));
                          setPlan(null);
                        }}
                      />
                      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground">
                        %
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-3" aria-labelledby="smart-mix-categories">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 id="smart-mix-categories" className="font-medium">
                Nhóm nghiệp vụ
              </h3>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedCategories(activeCategories.map((item) => item.id))}
                >
                  Chọn tất cả
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedCategories([])}
                >
                  Bỏ chọn
                </Button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {activeCategories.map((category) => {
                const checked = selectedCategories.includes(category.id);
                return (
                  <label
                    key={category.id}
                    htmlFor={`smart-mix-category-${category.id}`}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2"
                  >
                    <Checkbox
                      id={`smart-mix-category-${category.id}`}
                      checked={checked}
                      onCheckedChange={(value) => {
                        setSelectedCategories((current) =>
                          value
                            ? [...current, category.id]
                            : current.filter((id) => id !== category.id),
                        );
                        setPlan(null);
                      }}
                    />
                    <span className="min-w-0 flex-1 text-sm">{category.name}</span>
                    <span className="text-xs text-muted-foreground">{category.question_count}</span>
                  </label>
                );
              })}
            </div>
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Kiểu phân bổ nhóm nghiệp vụ</Label>
              <Select
                value={distribution}
                onValueChange={(value) => {
                  setDistribution(value as Distribution);
                  setPlan(null);
                }}
              >
                <SelectTrigger aria-label="Kiểu phân bổ nhóm nghiệp vụ">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="balanced">Phân bổ cân bằng</SelectItem>
                  <SelectItem value="custom">Tùy chỉnh tỷ trọng</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="smart-mix-critical">Số câu trọng yếu tối thiểu</Label>
              <Input
                id="smart-mix-critical"
                type="number"
                min="0"
                max={totalQuestions}
                inputMode="numeric"
                value={criticalMinimum}
                onChange={(event) => {
                  setCriticalMinimum(Math.max(0, Number(event.target.value) || 0));
                  setPlan(null);
                }}
              />
            </div>
          </div>
          {distribution === 'custom' && (
            <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-3">
              {activeCategories
                .filter((category) => selectedCategories.includes(category.id))
                .map((category) => (
                  <div key={category.id} className="space-y-2">
                    <Label htmlFor={`category-weight-${category.id}`}>{category.name}</Label>
                    <Input
                      id={`category-weight-${category.id}`}
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={categoryWeights[category.id] ?? 1}
                      onChange={(event) => {
                        setCategoryWeights((current) => ({
                          ...current,
                          [category.id]: Math.max(0, Number(event.target.value) || 0),
                        }));
                        setPlan(null);
                      }}
                    />
                  </div>
                ))}
            </div>
          )}
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={createPlan}
              disabled={planning || selectedCategories.length === 0 || percentageTotal !== 100}
            >
              <Sparkles className="size-4" />
              {planning ? 'Đang lập phương án…' : 'Lập phương án đề xuất'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {plan && (
        <Card className="border-primary/30">
          <CardContent className="space-y-4 p-5">
            <div>
              <h2 className="font-heading text-lg font-semibold">Phương án đề xuất</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Các nhóm dưới đây sẽ trở thành cấu hình có thể chỉnh sửa thủ công.
              </p>
            </div>
            {plan.warnings.map((warning) => (
              <AppAlert key={warning} variant="warn">
                {warning}
              </AppAlert>
            ))}
            <div className="hidden overflow-hidden rounded-lg border sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 font-medium">Nhóm nghiệp vụ</th>
                    <th className="px-3 py-2 font-medium">Bậc</th>
                    <th className="px-3 py-2 text-right font-medium">Số câu</th>
                    <th className="px-3 py-2 text-right font-medium">Trọng yếu</th>
                    <th className="px-3 py-2 text-right font-medium">Điểm/câu</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.allocations.map((item) => (
                    <tr key={`${item.categoryId}-${item.minimumLevelId}`} className="border-t">
                      <td className="px-3 py-2">{item.categoryName}</td>
                      <td className="px-3 py-2">{item.minimumLevelCode}</td>
                      <td className="px-3 py-2 text-right">{item.questionCount}</td>
                      <td className="px-3 py-2 text-right">{item.criticalCount}</td>
                      <td className="px-3 py-2 text-right">{item.pointsPerQuestion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-2 sm:hidden">
              {plan.allocations.map((item) => (
                <div
                  key={`${item.categoryId}-${item.minimumLevelId}`}
                  className="rounded-lg border p-3 text-sm"
                >
                  <strong className="block">{item.categoryName}</strong>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-muted-foreground">
                    <span>{item.minimumLevelCode}</span>
                    <span>{item.questionCount} câu</span>
                    <span>{item.pointsPerQuestion} điểm/câu</span>
                  </div>
                  {item.criticalCount > 0 && (
                    <p className="mt-2 text-xs">Có {item.criticalCount} câu trọng yếu</p>
                  )}
                </div>
              ))}
            </div>
            <div className="grid gap-3 rounded-lg bg-muted/30 p-4 sm:grid-cols-4">
              <div>
                <span className="text-xs text-muted-foreground">Tổng câu</span>
                <strong className="block text-xl">{plan.totalQuestions}</strong>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Theo bậc</span>
                <strong className="block text-sm">
                  {plan.levelCounts
                    .map((item) => `${item.minimumLevelCode}: ${item.questionCount}`)
                    .join(' · ')}
                </strong>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Câu trọng yếu</span>
                <strong className="block text-xl">{plan.criticalCount}</strong>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Điểm tối đa</span>
                <strong className="block text-xl">{plan.totalScore.toLocaleString('vi-VN')}</strong>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Pool phù hợp: {plan.poolCapacity} câu · {plan.rules.length} nhóm cấu hình không giao
              nhau
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setPlan(null)}>
                Hủy
              </Button>
              <Button type="button" onClick={() => onApply(plan.rules, targetLevelId)}>
                Áp dụng cấu hình
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
