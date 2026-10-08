import { Dices, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppAlert } from '@/components/AppAlert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { calculateAutoQuestionTime, questionTimeOverride } from '@/helpers/questionTiming';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type {
  BankQuestion,
  BankQuestionSummary,
  EmployeeLevel,
  ImportQuestion,
  QuestionCategory,
  QuestionType,
} from '@/types';

const TYPES: Array<[QuestionType, string]> = [
  ['multiple_choice', 'Một đáp án'],
  ['multi_select', 'Nhiều đáp án'],
  ['true_false', 'Đúng / Sai'],
  ['fill_blank', 'Điền khuyết'],
  ['ordering', 'Sắp xếp'],
  ['matching', 'Nối cặp'],
  ['closest_to', 'Số gần đúng'],
  ['geo', 'Bản đồ'],
  ['open_text', 'Trả lời ngắn'],
];

function toImportQuestion(question: BankQuestion): ImportQuestion {
  return {
    text: question.text,
    options: question.options,
    correctIndex: question.correct_index,
    correctIndices: question.correct_indices ?? undefined,
    baseScore: question.base_score,
    timeSec: questionTimeOverride(question.source_metadata) ?? calculateAutoQuestionTime(question),
    imageUrl: question.image_url ?? undefined,
    explanation: question.explanation ?? undefined,
    rangeMin: question.range_min ?? undefined,
    rangeMax: question.range_max ?? undefined,
    questionType: question.question_type,
    correctAnswer: question.correct_answer ?? undefined,
    mediaUrl: question.media_url ?? undefined,
    mediaType: question.media_type ?? undefined,
    blanks: question.blanks ?? undefined,
    geo: question.geo ?? undefined,
    matches: question.matches ?? undefined,
    tags: question.tags ?? undefined,
    sourceBankQuestionId: question.id,
    sourceBankQuestionRevision: question.revision,
  };
}

interface Props {
  open: boolean;
  initialMode: 'manual' | 'random';
  existingSourceIds: Set<number>;
  onClose(): void;
  onAdd(questions: ImportQuestion[]): void;
}

export function QuestionBankPicker({
  open,
  initialMode,
  existingSourceIds,
  onClose,
  onAdd,
}: Props) {
  const api = useAuthFetch();
  const [mode, setMode] = useState(initialMode);
  const [categories, setCategories] = useState<QuestionCategory[]>([]);
  const [levels, setLevels] = useState<EmployeeLevel[]>([]);
  const [rows, setRows] = useState<BankQuestionSummary[]>([]);
  const [preview, setPreview] = useState<BankQuestion[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [topic, setTopic] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [levelId, setLevelId] = useState('all');
  const [difficulty, setDifficulty] = useState('all');
  const [questionType, setQuestionType] = useState('all');
  const [critical, setCritical] = useState('all');
  const [count, setCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const queryString = useMemo(() => {
    const query = new URLSearchParams({ limit: '200', isEnabled: '1' });
    if (search.trim()) query.set('search', search.trim());
    if (topic.trim()) query.set('topic', topic.trim());
    if (categoryId !== 'all') query.set('categoryId', categoryId);
    if (levelId !== 'all') query.set('minimumLevelId', levelId);
    if (difficulty !== 'all') query.set('difficulty', difficulty);
    if (questionType !== 'all') query.set('questionType', questionType);
    if (critical !== 'all') query.set('critical', critical);
    return query.toString();
  }, [search, topic, categoryId, levelId, difficulty, questionType, critical]);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setPreview([]);
    setSelected(new Set());
    setError('');
    Promise.all([
      api.get<{ categories: QuestionCategory[] }>('/api/admin/question-bank/categories'),
      api.get<{ levels: EmployeeLevel[] }>('/api/admin/employee-levels'),
    ]).then(([categoryResponse, levelResponse]) => {
      if (categoryResponse.ok) setCategories(categoryResponse.data.categories);
      if (levelResponse.ok)
        setLevels(levelResponse.data.levels.filter((level) => level.is_active === 1));
    });
  }, [api, initialMode, open]);

  const loadManual = useCallback(async () => {
    setLoading(true);
    setError('');
    const response = await api.get<{ questions: BankQuestionSummary[] }>(
      `/api/admin/question-bank/questions?${queryString}`,
    );
    setLoading(false);
    if (response.ok) setRows(response.data.questions);
    else setError('Không thể tải câu hỏi phù hợp.');
  }, [api, queryString]);

  useEffect(() => {
    if (open && mode === 'manual') loadManual();
  }, [open, mode, loadManual]);

  async function addManual() {
    setLoading(true);
    const details = await Promise.all(
      [...selected].map((id) =>
        api.get<{ question: BankQuestion }>(`/api/admin/question-bank/questions/${id}`),
      ),
    );
    setLoading(false);
    if (details.some((item) => !item.ok)) {
      setError('Một số câu hỏi không còn khả dụng. Vui lòng tải lại danh sách.');
      return;
    }
    onAdd(details.map((item) => toImportQuestion(item.data.question)));
    onClose();
  }

  function randomBody() {
    return {
      count,
      categoryId: categoryId === 'all' ? undefined : Number(categoryId),
      minimumLevelId: levelId === 'all' ? undefined : Number(levelId),
      difficulty: difficulty === 'all' ? undefined : difficulty,
      questionType: questionType === 'all' ? undefined : questionType,
      critical: critical === 'all' ? undefined : Number(critical),
      topic: topic.trim() || undefined,
      excludeIds: [...existingSourceIds],
    };
  }

  async function generateRandom() {
    setLoading(true);
    setError('');
    const response = await api.post<{ questions?: BankQuestion[]; error?: string }>(
      '/api/admin/question-bank/questions/random-preview',
      randomBody(),
    );
    setLoading(false);
    if (!response.ok || !response.data.questions) {
      setPreview([]);
      setError(response.data.error ?? 'Không thể tạo danh sách ngẫu nhiên.');
      return;
    }
    setPreview(response.data.questions);
  }

  const selector = (
    value: string,
    setValue: (value: string) => void,
    label: string,
    items: Array<[string, string]>,
  ) => (
    <Select value={value} onValueChange={setValue}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{label}</SelectItem>
        {items.map(([key, text]) => (
          <SelectItem key={key} value={key}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Thêm từ Ngân hàng câu hỏi</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Câu được chọn sẽ được sao chép cố định vào Bộ đề; thay đổi ở Bank sau này không làm đổi
            Bộ đề.
          </p>
        </DialogHeader>
        <div className="flex gap-2">
          <Button
            variant={mode === 'manual' ? 'default' : 'secondary'}
            onClick={() => setMode('manual')}
          >
            Tự chọn câu
          </Button>
          <Button
            variant={mode === 'random' ? 'default' : 'secondary'}
            onClick={() => setMode('random')}
          >
            <Dices className="size-4" /> Chọn ngẫu nhiên
          </Button>
        </div>
        {error && <AppAlert variant="error">{error}</AppAlert>}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {mode === 'manual' && (
            <div className="relative sm:col-span-2">
              <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Tìm nội dung hoặc ID nguồn"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          )}
          <Input
            placeholder="Topic"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
          />
          {selector(
            categoryId,
            setCategoryId,
            'Tất cả nhóm',
            categories.map((item) => [String(item.id), `${item.code} — ${item.name}`]),
          )}
          {selector(
            levelId,
            setLevelId,
            'Tất cả bậc',
            levels.map((item) => [String(item.id), item.code]),
          )}
          {selector(difficulty, setDifficulty, 'Tất cả độ khó', [
            ['easy', 'Dễ'],
            ['medium', 'Trung bình'],
            ['hard', 'Khó'],
          ])}
          {selector(questionType, setQuestionType, 'Tất cả loại', TYPES)}
          {selector(critical, setCritical, 'Tất cả Critical', [
            ['1', 'Chỉ Critical'],
            ['0', 'Không Critical'],
          ])}
          {mode === 'random' && (
            <Input
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(event) => setCount(Math.max(1, Number(event.target.value) || 1))}
              aria-label="Số câu"
            />
          )}
        </div>

        {mode === 'manual' ? (
          <div className="max-h-[46vh] space-y-2 overflow-y-auto rounded-lg border p-2">
            {loading ? (
              <p className="p-4 text-muted-foreground">Đang tải…</p>
            ) : (
              rows.map((question) => {
                const duplicate = existingSourceIds.has(question.id);
                return (
                  <div
                    key={question.id}
                    className={`flex gap-3 rounded-lg p-3 ${duplicate ? 'opacity-50' : 'hover:bg-muted'}`}
                  >
                    <Checkbox
                      aria-label={`Chọn câu ${question.source_question_id}`}
                      disabled={duplicate}
                      checked={selected.has(question.id)}
                      onCheckedChange={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked === true) next.add(question.id);
                          else next.delete(question.id);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <strong className="line-clamp-2 text-sm">{question.text}</strong>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="outline">{question.category_code}</Badge>
                        <Badge variant="outline">{question.minimum_level_code}</Badge>
                        <Badge variant="outline">{question.difficulty ?? '—'}</Badge>
                        {question.critical === 1 && <Badge variant="destructive">Critical</Badge>}
                        {duplicate && <Badge>Đã có trong Bộ đề</Badge>}
                      </span>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Button variant="secondary" onClick={generateRandom} disabled={loading}>
              <RefreshCw className="size-4" />{' '}
              {preview.length ? 'Tạo lại' : 'Tạo danh sách xem trước'}
            </Button>
            {preview.length > 0 && (
              <div className="max-h-[40vh] space-y-2 overflow-y-auto rounded-lg border p-2">
                {preview.map((question, index) => (
                  <div key={question.id} className="rounded-lg bg-muted/40 p-3">
                    <strong className="text-sm">
                      {index + 1}. {question.text}
                    </strong>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {question.category_code} · {question.minimum_level_code} ·{' '}
                      {question.difficulty ?? '—'}
                      {existingSourceIds.has(question.id) ? ' · Đã có trong Bộ đề (sẽ bỏ qua)' : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          {mode === 'manual' ? (
            <Button onClick={addManual} disabled={loading || selected.size === 0}>
              Thêm {selected.size} câu vào Bộ đề
            </Button>
          ) : (
            <Button
              onClick={() => {
                onAdd(
                  preview
                    .filter((question) => !existingSourceIds.has(question.id))
                    .map(toImportQuestion),
                );
                onClose();
              }}
              disabled={preview.length === 0}
            >
              Chấp nhận danh sách
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
