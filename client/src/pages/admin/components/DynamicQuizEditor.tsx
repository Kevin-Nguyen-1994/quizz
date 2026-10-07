import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import AdminNav from '@/components/AdminNav';
import { AppAlert } from '@/components/AppAlert';
import { MainContent, Page, PageHeader } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type {
  EmployeeLevel,
  QuestionCategory,
  QuestionDifficulty,
  QuestionType,
  QuizGenerationRule,
} from '@/types';

const TYPES: Array<[QuestionType, string]> = [
  ['multiple_choice', 'Một đáp án'],
  ['multi_select', 'Nhiều đáp án'],
  ['true_false', 'Đúng / Sai'],
  ['fill_blank', 'Điền khuyết'],
  ['ordering', 'Sắp xếp'],
  ['open_text', 'Trả lời ngắn'],
  ['closest_to', 'Số gần đúng'],
  ['geo', 'Bản đồ'],
  ['matching', 'Nối cặp'],
];
const emptyRule = (i: number): QuizGenerationRule => ({
  categoryId: null,
  minimumLevelId: null,
  difficulty: null,
  questionType: null,
  critical: null,
  questionCount: 1,
  pointsOverride: 100,
  recommendedSecondsOverride: null,
  sortOrder: i,
});
const intersects = (a: unknown, b: unknown) => a === null || b === null || a === b;
function overlap(a: QuizGenerationRule, b: QuizGenerationRule) {
  return (
    intersects(a.categoryId, b.categoryId) &&
    intersects(a.minimumLevelId, b.minimumLevelId) &&
    intersects(a.difficulty, b.difficulty) &&
    intersects(a.questionType, b.questionType) &&
    intersects(a.critical, b.critical)
  );
}
function fromDb(r: Record<string, unknown>, i: number): QuizGenerationRule {
  return {
    id: Number(r.id),
    categoryId: r.category_id as number | null,
    minimumLevelId: r.minimum_level_id as number | null,
    difficulty: r.difficulty as QuestionDifficulty | null,
    questionType: r.question_type as QuestionType | null,
    critical: r.critical === null ? null : r.critical === 1,
    questionCount: Number(r.question_count),
    pointsOverride: r.points_override === null ? null : Number(r.points_override),
    recommendedSecondsOverride:
      r.recommended_seconds_override === null ? null : Number(r.recommended_seconds_override),
    sortOrder: i,
  };
}

export function DynamicQuizEditor({
  quizId,
  initial,
  onCancel,
  onSaved,
}: {
  quizId?: string;
  initial?: {
    title: string;
    description: string;
    recommendedLevelId: number | null;
    rules: Record<string, unknown>[];
  };
  onCancel(): void;
  onSaved(id: number): void;
}) {
  const api = useAuthFetch();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [recommendedLevelId, setRecommendedLevelId] = useState<string>(
    initial?.recommendedLevelId ? String(initial.recommendedLevelId) : '',
  );
  const [rules, setRules] = useState<QuizGenerationRule[]>(
    initial?.rules?.map(fromDb) ?? [emptyRule(0)],
  );
  const [pointsTouched, setPointsTouched] = useState<boolean[]>(
    initial?.rules?.map(() => true) ?? [false],
  );
  const [categories, setCategories] = useState<QuestionCategory[]>([]);
  const [levels, setLevels] = useState<EmployeeLevel[]>([]);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([
      api.get<{ categories: QuestionCategory[] }>('/api/admin/question-bank/categories'),
      api.get<{ levels: EmployeeLevel[] }>('/api/admin/employee-levels'),
    ]).then(([c, l]) => {
      if (c.ok) setCategories(c.data.categories);
      if (l.ok) setLevels(l.data.levels.filter((x) => x.is_active));
    });
  }, [api]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh pools only when rule filters change, not when counts are written back
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setChecking(true);
      const next = await Promise.all(
        rules.map(async (r) => {
          const p = new URLSearchParams({ limit: '1' });
          if (r.categoryId) p.set('categoryId', String(r.categoryId));
          if (r.minimumLevelId) p.set('minimumLevelId', String(r.minimumLevelId));
          if (r.difficulty) p.set('difficulty', r.difficulty);
          if (r.questionType) p.set('questionType', r.questionType);
          if (r.critical !== null) p.set('critical', r.critical ? '1' : '0');
          const x = await api.get<{ total: number }>(`/api/admin/question-bank/questions?${p}`);
          return x.ok ? x.data.total : 0;
        }),
      );
      if (!cancelled) setRules((rs) => rs.map((r, i) => ({ ...r, availableCount: next[i] })));
      setChecking(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    api,
    rules
      .map((r) =>
        [r.categoryId, r.minimumLevelId, r.difficulty, r.questionType, r.critical].join('|'),
      )
      .join(';'),
  ]);
  const overlaps = useMemo(() => {
    const bad = new Set<number>();
    rules.forEach((r, i) => {
      rules.slice(0, i).forEach((o, j) => {
        if (overlap(r, o)) {
          bad.add(i);
          bad.add(j);
        }
      });
    });
    return bad;
  }, [rules]);
  const insufficient = rules.some(
    (r) => r.availableCount !== undefined && r.availableCount < r.questionCount,
  );
  const totalQuestions = rules.reduce((n, r) => n + r.questionCount, 0);
  const totalScore = rules.reduce((n, r) => n + r.questionCount * (r.pointsOverride ?? 0), 0);
  const totalSeconds = rules.reduce(
    (n, r) => n + r.questionCount * (r.recommendedSecondsOverride ?? 30),
    0,
  );
  function update(i: number, patch: Partial<QuizGenerationRule>) {
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  async function save() {
    if (!title.trim()) return setError('Vui lòng nhập tên bộ đề.');
    if (overlaps.size)
      return setError(
        'Hai nhóm điều kiện có thể chọn trùng cùng một câu hỏi. Hãy thu hẹp hoặc tách lại điều kiện.',
      );
    if (insufficient) return setError('Một hoặc nhiều nhóm không đủ câu hỏi khả dụng.');
    setSaving(true);
    setError('');
    const payload = {
      title: title.trim(),
      description,
      recommendedLevelId: recommendedLevelId ? Number(recommendedLevelId) : null,
      quizMode: 'bank_generated',
      selectionMode: 'per_assignment',
      generationRules: rules.map((r, i) => ({ ...r, sortOrder: i, availableCount: undefined })),
    };
    const result = quizId
      ? await api.put<{ id?: number; error?: string; code?: string }>(
          `/api/admin/quizzes/${quizId}`,
          payload,
        )
      : await api.post<{ id?: number; error?: string; code?: string }>(
          '/api/admin/quizzes',
          payload,
        );
    setSaving(false);
    if (!result.ok)
      return setError(
        result.data?.code === 'QUESTION_RULES_OVERLAP'
          ? 'Hai nhóm điều kiện có thể chọn trùng cùng một câu hỏi. Hãy thu hẹp hoặc tách lại điều kiện.'
          : (result.data?.error ?? 'Không thể lưu bộ đề động.'),
      );
    onSaved(Number(quizId ?? result.data.id));
  }
  const sel = (
    value: string,
    onChange: (v: string) => void,
    any: string,
    items: Array<[string, string]>,
  ) => (
    <Select value={value || 'any'} onValueChange={(v) => onChange(v === 'any' ? '' : v)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="any">{any}</SelectItem>
        {items.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <Page>
      <AdminNav />
      <MainContent>
        <Button variant="ghost" size="sm" className="mb-3" onClick={onCancel}>
          <ArrowLeft className="size-4" />
          Quay lại
        </Button>
        <PageHeader
          title={quizId ? 'Chỉnh sửa bộ đề động' : 'Tạo bộ đề động'}
          description="Hệ thống chọn câu tự động theo các điều kiện đã cấu hình."
        />
        {error && <AppAlert variant="error">{error}</AppAlert>}
        <Card className="mb-5">
          <CardContent className="grid gap-4 p-5 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label>Tên Quiz</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Mô tả</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Bậc khuyến nghị</Label>
              {sel(
                recommendedLevelId,
                setRecommendedLevelId,
                'Không chỉ định',
                levels.map((l) => [String(l.id), `${l.code} — ${l.name}`]),
              )}
            </div>
            <div className="flex items-end">
              <Badge variant="outline">Chọn câu theo từng Assignment</Badge>
            </div>
          </CardContent>
        </Card>
        <div className="space-y-4">
          {rules.map((r, i) => (
            <Card key={r.id ?? r.sortOrder} className={overlaps.has(i) ? 'border-destructive' : ''}>
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg">Nhóm điều kiện {i + 1}</h2>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Xóa nhóm ${i + 1}`}
                    disabled={rules.length === 1}
                    onClick={() => {
                      setRules((rs) => rs.filter((_, j) => j !== i));
                      setPointsTouched((items) => items.filter((_, j) => j !== i));
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
                {overlaps.has(i) && (
                  <AppAlert variant="error">Nhóm này giao nhau với một nhóm khác.</AppAlert>
                )}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Chủ đề lớn</Label>
                    {sel(
                      String(r.categoryId ?? ''),
                      (v) => update(i, { categoryId: v ? Number(v) : null }),
                      'Tất cả chủ đề lớn',
                      categories.filter((c) => c.is_active).map((c) => [String(c.id), c.name]),
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Bậc tối thiểu</Label>
                    {sel(
                      String(r.minimumLevelId ?? ''),
                      (v) => {
                        const id = v ? Number(v) : null;
                        update(i, {
                          minimumLevelId: id,
                          pointsOverride: pointsTouched[i]
                            ? r.pointsOverride
                            : id && levels.find((l) => l.id === id)?.code === 'CS2'
                              ? 150
                              : 100,
                        });
                      },
                      'Tất cả bậc',
                      levels.map((l) => [String(l.id), `${l.code} — ${l.name}`]),
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Mức độ</Label>
                    {sel(
                      r.difficulty ?? '',
                      (v) => update(i, { difficulty: (v || null) as QuestionDifficulty | null }),
                      'Tất cả mức độ',
                      [
                        ['easy', 'Dễ'],
                        ['medium', 'Trung bình'],
                        ['hard', 'Khó'],
                      ],
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Loại câu</Label>
                    {sel(
                      r.questionType ?? '',
                      (v) => update(i, { questionType: (v || null) as QuestionType | null }),
                      'Tất cả loại',
                      TYPES,
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Critical</Label>
                    {sel(
                      r.critical === null ? '' : r.critical ? '1' : '0',
                      (v) => update(i, { critical: v === '' ? null : v === '1' }),
                      'Tất cả',
                      [
                        ['1', 'Chỉ Critical'],
                        ['0', 'Không Critical'],
                      ],
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Số câu</Label>
                    <Input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={r.questionCount}
                      onChange={(e) =>
                        update(i, { questionCount: Math.max(1, Number(e.target.value) || 1) })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Điểm mỗi câu</Label>
                    <Input
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={r.pointsOverride ?? ''}
                      placeholder="Theo điểm gốc"
                      onChange={(e) => {
                        setPointsTouched((items) =>
                          items.map((touched, j) => (j === i ? true : touched)),
                        );
                        update(i, {
                          pointsOverride: e.target.value === '' ? null : Number(e.target.value),
                        });
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Giây khuyến nghị (ghi đè)</Label>
                    <Input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={r.recommendedSecondsOverride ?? ''}
                      placeholder="Theo câu hỏi"
                      onChange={(e) =>
                        update(i, {
                          recommendedSecondsOverride:
                            e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>
                <div
                  className={`rounded-lg border p-3 text-sm ${r.availableCount !== undefined && r.availableCount < r.questionCount ? 'border-destructive bg-destructive/5' : 'bg-muted/30'}`}
                >
                  <strong>Pool: {checking ? '…' : (r.availableCount ?? 0)} câu khả dụng</strong>
                  <span className="ml-3">Yêu cầu: {r.questionCount}</span>
                  <span className="ml-3">
                    Tổng: {(r.questionCount * (r.pointsOverride ?? 0)).toLocaleString('vi-VN')} điểm
                  </span>
                  {r.availableCount !== undefined && r.availableCount < r.questionCount && (
                    <p className="mt-1 text-destructive">Không đủ câu hỏi để tạo đề xem trước.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => {
            setRules((rs) => [...rs, emptyRule(rs.length)]);
            setPointsTouched((items) => [...items, false]);
          }}
        >
          <Plus className="size-4" />
          Thêm nhóm điều kiện
        </Button>
        <Card className="my-5">
          <CardContent className="grid gap-3 p-5 sm:grid-cols-3">
            <div>
              <span className="text-sm text-muted-foreground">Tổng số câu</span>
              <strong className="block text-2xl">{totalQuestions}</strong>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">Tổng điểm tối đa</span>
              <strong className="block text-2xl">{totalScore.toLocaleString('vi-VN')}</strong>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">Thời gian khuyến nghị</span>
              <strong className="block text-2xl">~{Math.ceil(totalSeconds / 60)} phút</strong>
            </div>
          </CardContent>
        </Card>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Hủy
          </Button>
          <Button onClick={save} disabled={saving || checking || insufficient || overlaps.size > 0}>
            {saving ? 'Đang lưu…' : 'Lưu bộ đề động'}
          </Button>
        </div>
      </MainContent>
    </Page>
  );
}
