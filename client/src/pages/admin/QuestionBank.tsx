import { Eye, FilterX, Pencil, Plus, Search, ToggleLeft, ToggleRight } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import AdminNav from '@/components/AdminNav';
import { AppAlert } from '@/components/AppAlert';
import { MainContent, Page, PageHeader } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type {
  BankQuestion,
  BankQuestionSummary,
  EmployeeLevel,
  QuestionCategory,
  QuestionType,
} from '@/types';

const TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: 'Một đáp án',
  multi_select: 'Nhiều đáp án',
  true_false: 'Đúng / Sai',
  fill_blank: 'Điền khuyết',
  ordering: 'Sắp xếp',
  open_text: 'Trả lời ngắn',
  closest_to: 'Số gần đúng',
  geo: 'Bản đồ',
  matching: 'Nối cặp',
};
const DIFFICULTY = { easy: 'Dễ', medium: 'Trung bình', hard: 'Khó' } as const;
const ALL_TYPES = Object.keys(TYPE_LABELS) as QuestionType[];
const PAGE_SIZE = 20;
type Filters = {
  search: string;
  categoryId: string;
  minimumLevelId: string;
  difficulty: string;
  questionType: string;
  critical: string;
  isEnabled: string;
};
const EMPTY: Filters = {
  search: '',
  categoryId: '',
  minimumLevelId: '',
  difficulty: '',
  questionType: '',
  critical: '',
  isEnabled: '',
};

function createQuestionDraft(): Partial<BankQuestion> {
  return {
    question_type: 'multiple_choice',
    base_score: 100,
    time_sec: 30,
    options: ['', ''],
    correct_index: 0,
    topic: '',
    critical: 0,
    is_enabled: 1,
  };
}

function qs(filters: Filters, page: number) {
  const p = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE),
  });
  Object.entries(filters).forEach(([key, value]) => {
    if (value) p.set(key, value);
  });
  return p.toString();
}

function QuestionDialog({
  id,
  categories,
  levels,
  onClose,
  onSaved,
}: {
  id: number | null | 'new';
  categories: QuestionCategory[];
  levels: EmployeeLevel[];
  onClose(): void;
  onSaved(): void;
}) {
  const api = useAuthFetch();
  const [q, setQ] = useState<Partial<BankQuestion>>(createQuestionDraft);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const legal = (q.source_metadata?.legal ?? {}) as Record<string, unknown>;
  useEffect(() => {
    setError('');
    if (id === null) return;
    if (id === 'new') {
      setQ(createQuestionDraft());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.get<{ question: BankQuestion }>(`/api/admin/question-bank/questions/${id}`).then((r) => {
      if (!cancelled) {
        if (r.ok) setQ(r.data.question);
        else setError('Không thể tải câu hỏi.');
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [api, id]);
  const optionsText = (q.options ?? []).join('\n');
  const answer =
    q.question_type === 'multi_select'
      ? (q.correct_indices ?? []).map((i) => i + 1).join(', ')
      : q.question_type === 'multiple_choice' ||
          q.question_type === 'true_false' ||
          q.question_type === 'ordering'
        ? String((q.correct_index ?? 0) + 1)
        : (q.correct_answer ?? '');
  function setAnswer(value: string) {
    if (q.question_type === 'multi_select')
      setQ((x) => ({
        ...x,
        correct_indices: value
          .split(',')
          .map((v) => Number(v.trim()) - 1)
          .filter(Number.isInteger),
      }));
    else if (['multiple_choice', 'true_false', 'ordering'].includes(q.question_type ?? ''))
      setQ((x) => ({ ...x, correct_index: Math.max(0, Number(value) - 1) }));
    else setQ((x) => ({ ...x, correct_answer: value }));
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const payload = {
      ...q,
      categoryId: q.category_id,
      minimumLevelId: q.minimum_level_id,
      questionType: q.question_type,
      correctIndex: q.correct_index,
      correctIndices: q.correct_indices ?? [],
      baseScore: Number(q.base_score ?? 100),
      timeSec: Number(q.time_sec ?? 30),
      imageUrl: q.image_url || undefined,
      correctAnswer: q.correct_answer || undefined,
      mediaUrl: q.media_url || undefined,
      mediaType: q.media_type || undefined,
      rangeMin: q.range_min,
      rangeMax: q.range_max,
      blanks: q.blanks ?? undefined,
      geo: q.geo ?? undefined,
      matches: q.matches ?? undefined,
      tags: q.tags ?? undefined,
      recommendedSeconds: q.recommended_seconds,
      competencyCode: q.competency_code,
      isEnabled: q.is_enabled !== 0,
      critical: q.critical === 1,
      sourceMetadata: q.source_metadata ?? {},
    };
    const r =
      id === 'new'
        ? await api.post<{ error?: string }>('/api/admin/question-bank/questions', payload)
        : await api.put<{ error?: string }>(`/api/admin/question-bank/questions/${id}`, payload);
    setSaving(false);
    if (!r.ok) return setError(r.data?.error ?? 'Không thể lưu câu hỏi.');
    onSaved();
  }
  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{id === 'new' ? 'Tạo câu hỏi' : 'Chi tiết câu hỏi'}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p>Đang tải…</p>
        ) : (
          <form id="bank-form" onSubmit={save} className="grid gap-4 md:grid-cols-2">
            {error && (
              <AppAlert variant="error" className="md:col-span-2">
                {error}
              </AppAlert>
            )}
            {id !== 'new' && (
              <div className="md:col-span-2 flex flex-wrap gap-2 text-sm text-muted-foreground">
                <Badge variant="outline">ID nguồn: {q.source_question_id}</Badge>
                <Badge variant="outline">Revision {q.revision}</Badge>
              </div>
            )}
            <div className="space-y-2 md:col-span-2">
              <Label>Nội dung câu hỏi</Label>
              <Textarea
                required
                value={q.text ?? ''}
                onChange={(e) => setQ((x) => ({ ...x, text: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Loại câu hỏi</Label>
              <Select
                value={q.question_type}
                onValueChange={(v) =>
                  setQ((x) => ({
                    ...x,
                    question_type: v as QuestionType,
                    options: v === 'true_false' ? ['Đúng', 'Sai'] : x.options,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Chủ đề lớn</Label>
              <Select
                value={String(q.category_id ?? '')}
                onValueChange={(v) => setQ((x) => ({ ...x, category_id: Number(v) }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Chọn danh mục" />
                </SelectTrigger>
                <SelectContent>
                  {categories
                    .filter((c) => c.is_active || c.id === q.category_id)
                    .map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Chủ đề chi tiết</Label>
              <Input
                required
                value={q.topic ?? ''}
                onChange={(e) => setQ((x) => ({ ...x, topic: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Bậc tối thiểu</Label>
              <Select
                value={String(q.minimum_level_id ?? '')}
                onValueChange={(v) => setQ((x) => ({ ...x, minimum_level_id: Number(v) }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Chọn bậc" />
                </SelectTrigger>
                <SelectContent>
                  {levels.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.code} — {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Mức độ</Label>
              <Select
                value={q.difficulty ?? 'none'}
                onValueChange={(v) =>
                  setQ((x) => ({
                    ...x,
                    difficulty: v === 'none' ? null : (v as BankQuestion['difficulty']),
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Không xác định</SelectItem>
                  {Object.entries(DIFFICULTY).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Năng lực</Label>
              <Select
                value={q.competency_code ?? 'none'}
                onValueChange={(v) =>
                  setQ((x) => ({
                    ...x,
                    competency_code: v === 'none' ? null : (v as BankQuestion['competency_code']),
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Không xác định</SelectItem>
                  <SelectItem value="must_remember">Cần ghi nhớ</SelectItem>
                  <SelectItem value="know_where_to_lookup">Biết nơi tra cứu</SelectItem>
                  <SelectItem value="application">Vận dụng</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Đáp án / lựa chọn (mỗi dòng một mục)</Label>
              <Textarea
                value={optionsText}
                onChange={(e) => setQ((x) => ({ ...x, options: e.target.value.split('\n') }))}
              />
            </div>
            {q.question_type === 'fill_blank' && (
              <div className="space-y-2 md:col-span-2">
                <Label>
                  Đáp án từng chỗ trống (mỗi dòng một chỗ; đáp án tương đương cách nhau dấu phẩy)
                </Label>
                <Textarea
                  value={(q.blanks ?? []).map((x) => x.join(', ')).join('\n')}
                  onChange={(e) =>
                    setQ((x) => ({
                      ...x,
                      blanks: e.target.value.split('\n').map((line) =>
                        line
                          .split(',')
                          .map((v) => v.trim())
                          .filter(Boolean),
                      ),
                    }))
                  }
                />
              </div>
            )}
            {q.question_type === 'matching' && (
              <div className="space-y-2 md:col-span-2">
                <Label>Vế phải tương ứng (mỗi dòng khớp một lựa chọn phía trên)</Label>
                <Textarea
                  value={(q.matches ?? []).join('\n')}
                  onChange={(e) => setQ((x) => ({ ...x, matches: e.target.value.split('\n') }))}
                />
              </div>
            )}
            {q.question_type === 'closest_to' && (
              <div className="grid gap-3 md:col-span-2 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Giá trị nhỏ nhất</Label>
                  <Input
                    type="number"
                    value={q.range_min ?? ''}
                    onChange={(e) => setQ((x) => ({ ...x, range_min: Number(e.target.value) }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Giá trị lớn nhất</Label>
                  <Input
                    type="number"
                    value={q.range_max ?? ''}
                    onChange={(e) => setQ((x) => ({ ...x, range_max: Number(e.target.value) }))}
                  />
                </div>
              </div>
            )}
            {q.question_type === 'geo' && (
              <div className="grid gap-3 md:col-span-2 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Vĩ độ</Label>
                  <Input
                    type="number"
                    step="any"
                    value={q.geo?.lat ?? ''}
                    onChange={(e) =>
                      setQ((x) => ({
                        ...x,
                        geo: { lat: Number(e.target.value), lng: x.geo?.lng ?? 0 },
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Kinh độ</Label>
                  <Input
                    type="number"
                    step="any"
                    value={q.geo?.lng ?? ''}
                    onChange={(e) =>
                      setQ((x) => ({
                        ...x,
                        geo: { lat: x.geo?.lat ?? 0, lng: Number(e.target.value) },
                      }))
                    }
                  />
                </div>
              </div>
            )}
            {['multiple_choice', 'true_false', 'multi_select', 'open_text', 'closest_to'].includes(
              q.question_type ?? '',
            ) && (
              <div className="space-y-2">
                <Label>
                  {q.question_type === 'multi_select'
                    ? 'Số thứ tự đáp án đúng, cách nhau dấu phẩy'
                    : 'Đáp án đúng'}
                </Label>
                <Input value={answer} onChange={(e) => setAnswer(e.target.value)} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Điểm gốc</Label>
                <Input
                  type="number"
                  min="0"
                  value={q.base_score ?? 100}
                  onChange={(e) => setQ((x) => ({ ...x, base_score: Number(e.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Giây khuyến nghị</Label>
                <Input
                  type="number"
                  min="1"
                  value={q.recommended_seconds ?? q.time_sec ?? 30}
                  onChange={(e) =>
                    setQ((x) => ({
                      ...x,
                      recommended_seconds: Number(e.target.value),
                      time_sec: Number(e.target.value),
                    }))
                  }
                />
              </div>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Giải thích</Label>
              <Textarea
                value={q.explanation ?? ''}
                onChange={(e) => setQ((x) => ({ ...x, explanation: e.target.value }))}
              />
            </div>
            <label
              htmlFor="bank-critical"
              className="flex min-h-11 items-center justify-between rounded-lg border px-3"
            >
              <span>Critical</span>
              <Switch
                id="bank-critical"
                checked={q.critical === 1}
                onCheckedChange={(v) => setQ((x) => ({ ...x, critical: v ? 1 : 0 }))}
              />
            </label>
            <label
              htmlFor="bank-enabled"
              className="flex min-h-11 items-center justify-between rounded-lg border px-3"
            >
              <span>Được sử dụng</span>
              <Switch
                id="bank-enabled"
                checked={q.is_enabled !== 0}
                onCheckedChange={(v) => setQ((x) => ({ ...x, is_enabled: v ? 1 : 0 }))}
              />
            </label>
            {id !== 'new' && (
              <details className="md:col-span-2 rounded-lg border p-3">
                <summary className="cursor-pointer font-medium">Căn cứ / ghi chú pháp lý</summary>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="font-medium">Căn cứ</dt>
                    <dd className="text-muted-foreground">{String(legal.basis ?? 'Chưa có')}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Tham chiếu</dt>
                    <dd className="text-muted-foreground">
                      {String(legal.reference ?? 'Chưa có')}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">Ghi nhận cần rà soát</dt>
                    <dd className="text-muted-foreground">
                      {legal.review_required ? 'Có' : 'Không'}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">Ngày rà soát</dt>
                    <dd className="text-muted-foreground">
                      {String(legal.reviewed_on ?? 'Chưa có')}
                    </dd>
                  </div>
                </dl>
              </details>
            )}
          </form>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Đóng
          </Button>
          <Button form="bank-form" type="submit" disabled={saving || loading}>
            {saving ? 'Đang lưu…' : 'Lưu câu hỏi'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function QuestionBank() {
  const api = useAuthFetch();
  const [filters, setFilters] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<BankQuestionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [grandTotal, setGrandTotal] = useState(0);
  const [categories, setCategories] = useState<QuestionCategory[]>([]);
  const [levels, setLevels] = useState<EmployeeLevel[]>([]);
  const [dialog, setDialog] = useState<number | null | 'new'>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    const [r, c, l] = await Promise.all([
      api.get<{ questions: BankQuestionSummary[]; total: number }>(
        `/api/admin/question-bank/questions?${qs(applied, page)}`,
      ),
      api.get<{ categories: QuestionCategory[] }>('/api/admin/question-bank/categories'),
      api.get<{ levels: EmployeeLevel[] }>('/api/admin/employee-levels'),
    ]);
    if (r.ok) {
      setRows(r.data.questions);
      setTotal(r.data.total);
    } else setError('Không thể tải Ngân hàng câu hỏi.');
    if (c.ok) {
      setCategories(c.data.categories);
      setGrandTotal(c.data.categories.reduce((n, x) => n + x.question_count, 0));
    }
    if (l.ok) setLevels(l.data.levels);
    setLoading(false);
  }, [api, applied, page]);
  useEffect(() => {
    load();
  }, [load]);
  async function toggle(q: BankQuestionSummary) {
    if (
      q.is_enabled &&
      !confirm(
        'Câu này sẽ không được chọn vào các đề động mới. Các bài đã phát hành không bị ảnh hưởng.',
      )
    )
      return;
    await api.post(`/api/admin/question-bank/questions/${q.id}/enabled`, {
      enabled: !q.is_enabled,
    });
    load();
  }
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const select = (key: keyof Filters, label: string, items: Array<[string, string]>) => (
    <Select
      value={filters[key] || 'all'}
      onValueChange={(v) => setFilters((x) => ({ ...x, [key]: v === 'all' ? '' : v }))}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{label}</SelectItem>
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
        <PageHeader
          title="Ngân hàng câu hỏi"
          description={`${total} / ${grandTotal} câu`}
          actions={
            <Button onClick={() => setDialog('new')}>
              <Plus className="size-4" />
              Tạo câu hỏi
            </Button>
          }
        />
        {error && <AppAlert variant="error">{error}</AppAlert>}
        <Card className="mb-5">
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative sm:col-span-2">
              <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Tìm nội dung, topic hoặc ID nguồn"
                value={filters.search}
                onChange={(e) => setFilters((x) => ({ ...x, search: e.target.value }))}
              />
            </div>
            {select(
              'categoryId',
              'Tất cả chủ đề lớn',
              categories.map((c) => [String(c.id), c.name]),
            )}
            {select(
              'minimumLevelId',
              'Tất cả bậc',
              levels.map((l) => [String(l.id), `${l.code} — ${l.name}`]),
            )}
            {select('difficulty', 'Tất cả mức độ', Object.entries(DIFFICULTY))}
            {select(
              'questionType',
              'Tất cả loại',
              ALL_TYPES.map((t) => [t, TYPE_LABELS[t]]),
            )}
            {select('critical', 'Tất cả mức Critical', [
              ['1', 'Chỉ Critical'],
              ['0', 'Không Critical'],
            ])}
            {select('isEnabled', 'Tất cả trạng thái', [
              ['1', 'Đang dùng'],
              ['0', 'Đã tắt'],
            ])}
            <div className="flex gap-2 lg:col-span-4">
              <Button
                onClick={() => {
                  setPage(1);
                  setApplied(filters);
                }}
              >
                Áp dụng bộ lọc
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setFilters(EMPTY);
                  setApplied(EMPTY);
                  setPage(1);
                }}
              >
                <FilterX className="size-4" />
                Xóa lọc
              </Button>
            </div>
          </CardContent>
        </Card>
        {loading ? (
          <p className="text-muted-foreground">Đang tải…</p>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              Không tìm thấy câu hỏi phù hợp.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-3 md:hidden">
              {rows.map((q) => (
                <Card key={q.id}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{q.source_question_id}</Badge>
                      <Badge>{q.minimum_level_code}</Badge>
                      {q.critical === 1 && <Badge variant="destructive">Critical</Badge>}
                    </div>
                    <button
                      type="button"
                      className="text-left font-semibold"
                      onClick={() => setDialog(q.id)}
                    >
                      {q.text}
                    </button>
                    <p className="text-sm text-muted-foreground">
                      {q.category_name} · {q.topic}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs">
                        {TYPE_LABELS[q.question_type]} ·{' '}
                        {q.difficulty ? DIFFICULTY[q.difficulty] : '—'} · Rev {q.revision}
                      </span>
                      <div className="flex gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Xem chi tiết"
                          onClick={() => setDialog(q.id)}
                        >
                          <Eye />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={q.is_enabled ? 'Tắt câu hỏi' : 'Bật câu hỏi'}
                          onClick={() => toggle(q)}
                        >
                          {q.is_enabled ? <ToggleRight /> : <ToggleLeft />}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card className="hidden overflow-hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="p-3">ID nguồn / Nội dung</th>
                      <th className="p-3">Phân loại</th>
                      <th className="p-3">Bậc / Mức độ</th>
                      <th className="p-3">Loại</th>
                      <th className="p-3">Trạng thái</th>
                      <th className="p-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((q) => (
                      <tr key={q.id} className="border-b last:border-0">
                        <td className="max-w-xl p-3">
                          <span className="text-xs text-muted-foreground">
                            {q.source_question_id}
                          </span>
                          <button
                            type="button"
                            className="block text-left font-medium hover:text-primary"
                            onClick={() => setDialog(q.id)}
                          >
                            {q.text}
                          </button>
                        </td>
                        <td className="p-3">
                          {q.category_name}
                          <span className="block text-xs text-muted-foreground">{q.topic}</span>
                        </td>
                        <td className="p-3">
                          {q.minimum_level_code} · {q.difficulty ? DIFFICULTY[q.difficulty] : '—'}
                        </td>
                        <td className="p-3">{TYPE_LABELS[q.question_type]}</td>
                        <td className="p-3">
                          <div className="flex gap-1">
                            {q.critical === 1 && <Badge variant="destructive">Critical</Badge>}
                            <Badge variant={q.is_enabled ? 'default' : 'outline'}>
                              {q.is_enabled ? 'Đang dùng' : 'Đã tắt'}
                            </Badge>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            Revision {q.revision}
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label="Chỉnh sửa"
                              onClick={() => setDialog(q.id)}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={q.is_enabled ? 'Tắt câu hỏi' : 'Bật câu hỏi'}
                              onClick={() => toggle(q)}
                            >
                              {q.is_enabled ? <ToggleRight /> : <ToggleLeft />}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Trang {page} / {pages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Trước
                </Button>
                <Button
                  variant="secondary"
                  disabled={page === pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Sau
                </Button>
              </div>
            </div>
          </>
        )}
        <QuestionDialog
          id={dialog}
          categories={categories}
          levels={levels}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            load();
          }}
        />
      </MainContent>
    </Page>
  );
}
