import {
  Check,
  ClipboardList,
  Copy,
  Database,
  Dices,
  Eye,
  PencilLine,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { AppAlert } from '@/components/AppAlert';
import { BrandLogo } from '@/components/BrandLogo';
import { Input, Textarea } from '@/components/Input';
import { MediaPicker } from '@/components/MediaPicker';
import { QuizPreviewModal } from '@/components/QuizPreviewModal';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { type QuestionWithKey, validateQuizPayload, withKey } from '@/helpers';
import { COMMON_LOCALES, DEFAULT_LOCALE, localeName } from '@/helpers/locale';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { cn } from '@/lib/utils';
import {
  type EmployeeLevel,
  type ImportPayload,
  type ImportQuestion,
  THEME_IDS,
  type ThemeId,
} from '@/types';
import { PropertiesPanel } from './PropertiesPanel';
import { QuestionBankPicker } from './QuestionBankPicker';
import { QuestionCanvas } from './QuestionCanvas';
import {
  blankQuestion,
  normalizeQuestion,
  questionOps,
  stripTrailingEmptyOptions,
} from './questionOps';
import { SlideRail } from './SlideRail';

// Autosaved new-quiz draft, so a reload mid-creation doesn't lose work.
const DRAFT_KEY = 'quizz:create-draft-v1';

/** Preview colors for the theme swatch picker (bg + accent per theme). */
const THEME_SWATCH: Record<ThemeId, { bg: string; accent: string }> = {
  default: { bg: '#f6f8fb', accent: '#02438f' },
  neon: { bg: '#05010f', accent: '#22d3ee' },
  paper: { bg: '#f5f0e6', accent: '#b45309' },
  space: { bg: '#020617', accent: '#818cf8' },
  retro: { bg: '#001200', accent: '#22c55e' },
};

interface Draft {
  title: string;
  description: string;
  coverImage: string;
  theme?: ThemeId;
  language?: string;
  recommendedLevelId?: number | null;
  questions: QuestionWithKey[];
}

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (!d || !Array.isArray(d.questions) || d.questions.length === 0) return null;
    // Older drafts (or hand-edited storage) may lack the React list keys.
    d.questions = d.questions.map((q) => (q?._key ? q : withKey(q)));
    return d;
  } catch {
    return null;
  }
}

/**
 * Drop the autosaved create draft. Exported so the JSON-import path in
 * CreateQuiz (where this component is unmounted) can also clear it on success.
 */
export function clearCreateDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore storage errors */
  }
}

/** Write a create draft — used when JSON import hydrates the studio. */
export function saveCreateDraft(draft: Draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* ignore storage errors (quota / private mode) */
  }
}

/** True while the studio state is still the untouched blank quiz. */
function isPristine(
  title: string,
  description: string,
  coverImage: string,
  questions: QuestionWithKey[],
): boolean {
  if (title !== '' || description !== '' || coverImage !== '') return false;
  if (questions.length !== 1) return false;
  const { _key, ...q } = questions[0];
  return JSON.stringify(q) === JSON.stringify(blankQuestion());
}

interface Props {
  mode: 'create' | 'edit';
  initialTitle?: string;
  initialDescription?: string;
  initialCoverImage?: string;
  initialTheme?: ThemeId;
  initialLanguage?: string;
  initialRecommendedLevelId?: number | null;
  initialQuestions?: QuestionWithKey[];
  saving: boolean;
  error: string;
  success: string;
  onSave: (payload: ImportPayload) => void;
  onCancel: () => void;
  onValidationError: (msg: string) => void;
  headerExtra?: ReactNode;
  allowQuestionBank?: boolean;
}

export function QuizStudio({
  mode,
  initialTitle = '',
  initialDescription = '',
  initialCoverImage = '',
  initialTheme = 'default',
  initialLanguage = DEFAULT_LOCALE,
  initialRecommendedLevelId = null,
  initialQuestions,
  saving,
  error,
  success,
  onSave,
  onCancel,
  onValidationError,
  headerExtra,
  allowQuestionBank = false,
}: Props) {
  const api = useAuthFetch();
  // Only the create flow restores an autosaved draft; edit hydrates from the DB.
  const [draft, setDraft] = useState<Draft | null>(() => (mode === 'create' ? readDraft() : null));
  const [title, setTitle] = useState(draft?.title ?? initialTitle);
  const [description, setDescription] = useState(draft?.description ?? initialDescription);
  const [coverImage, setCoverImage] = useState(draft?.coverImage ?? initialCoverImage);
  const [theme, setTheme] = useState<ThemeId>(draft?.theme ?? initialTheme);
  const [language, setLanguage] = useState(draft?.language ?? initialLanguage);
  const [recommendedLevelId, setRecommendedLevelId] = useState<number | null>(
    draft?.recommendedLevelId ?? initialRecommendedLevelId,
  );
  const [employeeLevels, setEmployeeLevels] = useState<EmployeeLevel[]>([]);
  const [questions, setQuestions] = useState<QuestionWithKey[]>(() =>
    (
      draft?.questions ??
      (initialQuestions && initialQuestions.length > 0
        ? initialQuestions
        : [withKey(blankQuestion())])
    ).map((q) => ({ ...normalizeQuestion(q), _key: q._key })),
  );
  const [active, setActive] = useState(0);
  const [tab, setTab] = useState<'props' | 'quiz'>('props');
  const [previewing, setPreviewing] = useState(false);
  const [coverPicker, setCoverPicker] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [bankPickerMode, setBankPickerMode] = useState<'manual' | 'random' | null>(null);

  const existingSourceIds = useMemo(
    () =>
      new Set(
        questions
          .map((question) => question.sourceBankQuestionId)
          .filter((id): id is number => typeof id === 'number'),
      ),
    [questions],
  );

  const activeQ = questions[Math.min(active, questions.length - 1)];

  // Autosave the create draft (debounced) so a reload restores it. A pristine
  // blank quiz clears the draft instead of writing one — otherwise every visit
  // would show "Draft restored" and "Discard draft" would be undone instantly.
  useEffect(() => {
    if (mode !== 'create') return;
    const timer = setTimeout(() => {
      try {
        if (isPristine(title, description, coverImage, questions)) {
          clearCreateDraft();
        } else {
          localStorage.setItem(
            DRAFT_KEY,
            JSON.stringify({
              title,
              description,
              coverImage,
              theme,
              language,
              recommendedLevelId,
              questions,
            }),
          );
        }
      } catch {
        /* ignore storage errors (quota / private mode) */
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [mode, title, description, coverImage, theme, language, recommendedLevelId, questions]);

  useEffect(() => {
    api.get<{ levels?: EmployeeLevel[] }>('/api/admin/employee-levels').then(({ ok, data }) => {
      if (ok) setEmployeeLevels((data?.levels ?? []).filter((level) => level.is_active === 1));
    });
  }, [api]);

  // Once the quiz is created, drop the draft so it doesn't reappear next time.
  useEffect(() => {
    if (mode === 'create' && success) clearCreateDraft();
  }, [mode, success]);

  function updateActive(field: keyof ImportQuestion, value: unknown) {
    setQuestions((prev) => prev.map((q, i) => (i === active ? { ...q, [field]: value } : q)));
  }

  function addSlide() {
    // setActive stays outside the updater — updaters must be pure (StrictMode
    // double-invokes them), so use the current length for the new index.
    setQuestions((prev) => [...prev, withKey(blankQuestion())]);
    setActive(questions.length);
  }

  function removeSlide(i: number) {
    setQuestions((prev) => prev.filter((_, idx) => idx !== i));
    setActive((a) => Math.max(0, Math.min(a, questions.length - 2)));
  }

  function addBankQuestions(imported: ImportQuestion[]) {
    const unique = imported.filter(
      (question, index) =>
        typeof question.sourceBankQuestionId === 'number' &&
        !existingSourceIds.has(question.sourceBankQuestionId) &&
        imported.findIndex(
          (candidate) => candidate.sourceBankQuestionId === question.sourceBankQuestionId,
        ) === index,
    );
    if (unique.length === 0) {
      onValidationError('Các câu đã chọn đều đã có trong Bộ đề.');
      return;
    }
    const mapped = unique.map(withKey);
    const blankOnly =
      questions.length === 1 &&
      !questions[0].text.trim() &&
      questions[0].options.every((option) => !option.trim());
    setQuestions((current) => (blankOnly ? mapped : [...current, ...mapped]));
    setActive(blankOnly ? 0 : questions.length);
    onValidationError('');
  }

  function handleSave() {
    const prepared = questions.map((q) => ({
      ...stripTrailingEmptyOptions(normalizeQuestion(q)),
      _key: q._key,
    }));
    const err = validateQuizPayload(title, prepared);
    if (err) {
      onValidationError(err);
      return;
    }
    onSave({
      title,
      description,
      coverImage: coverImage || undefined,
      theme,
      language,
      recommendedLevelId,
      questions: prepared,
    });
  }

  function buildExportPayload(): ImportPayload {
    return {
      title,
      description: description || undefined,
      coverImage: coverImage || undefined,
      theme,
      language,
      recommendedLevelId,
      questions: questions.map((q) => {
        const { _key, ...base } = q;
        return stripTrailingEmptyOptions(normalizeQuestion(base));
      }),
    };
  }

  function handleExportJson() {
    navigator.clipboard.writeText(JSON.stringify(buildExportPayload(), null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 1500);
  }

  function discardDraft() {
    clearCreateDraft();
    setDraft(null);
    setTitle('');
    setDescription('');
    setCoverImage('');
    setLanguage(DEFAULT_LOCALE);
    setRecommendedLevelId(null);
    setQuestions([withKey(blankQuestion())]);
    setActive(0);
  }

  const ops = questionOps(activeQ, updateActive);

  return (
    <div data-theme={theme} className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* Top bar */}
      <header className="z-20 flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 backdrop-blur sm:gap-3 sm:px-4">
        <BrandLogo compact className="shrink-0 [&_img]:w-[96px]" />
        <span className="hidden h-5 w-px bg-border sm:block" />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Nhập tên bộ câu hỏi…"
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-[15px] font-bold text-foreground outline-none focus:border-border focus:bg-muted sm:max-w-xs sm:flex-none sm:px-3 lg:max-w-sm lg:w-72"
        />
        {mode === 'create' && draft && (
          <span className="hidden items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground sm:flex">
            <PencilLine className="size-3" /> Đã khôi phục bản nháp
          </span>
        )}
        <div className="hidden flex-1 lg:block" />
        <div className="flex w-full flex-wrap items-center justify-end gap-1.5 sm:w-auto sm:gap-2">
          {mode === 'create' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={discardDraft}
              title="Xóa bản nháp và bắt đầu lại"
              className="hidden sm:inline-flex"
            >
              Bỏ bản nháp
            </Button>
          )}
          {headerExtra}
          {allowQuestionBank && (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-auto min-h-9 w-full justify-start whitespace-normal text-left sm:w-auto"
                aria-label="Thêm từ Ngân hàng câu hỏi"
                title="Thêm từ Ngân hàng câu hỏi"
                onClick={() => setBankPickerMode('manual')}
              >
                <Database className="size-4" />
                <span>Thêm từ Ngân hàng câu hỏi</span>
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-auto min-h-9 w-full justify-start whitespace-normal text-left sm:w-auto"
                aria-label="Chọn ngẫu nhiên từ Ngân hàng câu hỏi"
                title="Chọn ngẫu nhiên từ Ngân hàng câu hỏi"
                onClick={() => setBankPickerMode('random')}
              >
                <Dices className="size-4" />
                <span>Chọn ngẫu nhiên từ Ngân hàng</span>
              </Button>
            </div>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Thoát
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setPreviewing(true)}>
            <Eye className="size-4" />
            <span className="hidden sm:inline">Xem trước</span>
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleExportJson}
            title="Sao chép bộ câu hỏi dưới dạng JSON để nhập lại"
          >
            {copiedJson ? (
              <>
                <Check className="size-4" />
                <span className="hidden sm:inline">Đã sao chép</span>
              </>
            ) : (
              <>
                <Copy className="size-4" />
                <span className="hidden sm:inline">Xuất JSON</span>
              </>
            )}
          </Button>
          <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? (
              '…'
            ) : (
              <>
                <Check className="size-4" />
                <span className="hidden sm:inline">
                  {mode === 'create' ? 'Tạo bộ câu hỏi' : 'Lưu'}
                </span>
                <span className="sm:hidden">{mode === 'create' ? 'Tạo' : 'Lưu'}</span>
              </>
            )}
          </Button>
        </div>
      </header>

      {(error || success) && (
        <div className="shrink-0 px-4 py-2">
          {error && <AppAlert variant="error">{error}</AppAlert>}
          {success && <AppAlert variant="success">{success}</AppAlert>}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <SlideRail
          layout="horizontal"
          className="lg:hidden"
          questions={questions}
          active={active}
          onSelect={setActive}
          onAdd={addSlide}
          onRemove={removeSlide}
        />

        <SlideRail
          className="hidden lg:flex"
          questions={questions}
          active={active}
          onSelect={setActive}
          onAdd={addSlide}
          onRemove={removeSlide}
        />

        {/* Center canvas */}
        <main
          className="studio-scroll min-h-0 min-w-0 flex-1 overflow-y-auto"
          style={{
            background:
              'radial-gradient(800px 420px at 50% -10%, color-mix(in srgb, var(--primary) 10%, transparent), transparent 60%)',
          }}
        >
          {activeQ && <QuestionCanvas q={activeQ} ops={ops} onChange={updateActive} />}
        </main>

        {/* Right panel — full width strip on mobile, sidebar on desktop */}
        <aside className="studio-scroll flex max-h-[42vh] w-full shrink-0 flex-col overflow-y-auto border-t border-border bg-muted/20 lg:max-h-none lg:w-[345px] lg:border-l lg:border-t-0">
          <div className="flex gap-1 p-3">
            <button
              type="button"
              onClick={() => setTab('props')}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[0.8rem] font-semibold transition-colors',
                tab === 'props'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <SlidersHorizontal className="size-3.5" /> Câu hỏi
            </button>
            <button
              type="button"
              onClick={() => setTab('quiz')}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[0.8rem] font-semibold transition-colors',
                tab === 'quiz'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <ClipboardList className="size-3.5" /> Bộ câu hỏi
            </button>
          </div>

          {tab === 'props' ? (
            activeQ && <PropertiesPanel q={activeQ} ops={ops} onChange={updateActive} />
          ) : (
            <div className="flex flex-col gap-4 p-4">
              <div>
                <Input
                  noMargin
                  label="Ngôn ngữ"
                  list="quiz-language-suggestions"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value || DEFAULT_LOCALE)}
                  placeholder={DEFAULT_LOCALE}
                  hint={`Ngôn ngữ gốc của bộ câu hỏi: ${localeName(language)}.`}
                />
                <datalist id="quiz-language-suggestions">
                  {COMMON_LOCALES.map((code) => (
                    <option key={code} value={code}>
                      {localeName(code)}
                    </option>
                  ))}
                </datalist>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">Bậc khuyến nghị</div>
                <Select
                  value={recommendedLevelId === null ? 'none' : String(recommendedLevelId)}
                  onValueChange={(value) =>
                    setRecommendedLevelId(value === 'none' ? null : Number(value))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Không chỉ định</SelectItem>
                    {employeeLevels.map((level) => (
                      <SelectItem key={level.id} value={String(level.id)}>
                        {level.code} — {level.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Chỉ là metadata hướng dẫn khi giao bài; không ảnh hưởng tính điểm.
                </p>
              </div>
              <Textarea
                noMargin
                label="Mô tả"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Hiển thị cho người chơi tại phòng chờ"
              />
              <div>
                <Input
                  noMargin
                  label="URL ảnh bìa"
                  type="url"
                  value={coverImage}
                  onChange={(e) => setCoverImage(e.target.value)}
                  placeholder="https://…"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => setCoverPicker(true)}
                >
                  <Search className="size-3.5" /> Tìm ảnh
                </Button>
                {coverImage.trim() && (
                  <img
                    src={coverImage}
                    alt="Xem trước ảnh bìa"
                    className="mt-2 max-h-[140px] w-full rounded-lg object-cover"
                  />
                )}
              </div>
              <div>
                <div className="mb-1.5 block text-sm font-medium text-foreground">Giao diện</div>
                <div className="flex flex-wrap gap-2">
                  {THEME_IDS.map((t) => {
                    const selected = theme === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTheme(t)}
                        aria-pressed={selected}
                        title={t}
                        className={cn(
                          'relative flex flex-col items-center gap-1 rounded-lg border-2 p-1.5 transition-all',
                          selected
                            ? 'border-primary ring-2 ring-primary/40'
                            : 'border-border opacity-70 hover:opacity-100',
                        )}
                      >
                        {selected && (
                          <span className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Check className="size-3" />
                          </span>
                        )}
                        <span
                          className="h-8 w-12 rounded"
                          style={{ background: THEME_SWATCH[t].bg }}
                        >
                          <span
                            className="block h-2 w-6 translate-x-1 translate-y-3 rounded-full"
                            style={{ background: THEME_SWATCH[t].accent }}
                          />
                        </span>
                        <span
                          className={cn('text-[10px] capitalize', selected && 'font-bold')}
                          style={{ color: selected ? 'var(--accent2)' : 'var(--text2)' }}
                        >
                          {t}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Live preview: data-theme scopes the CSS var overrides to this box,
                    so the sample game elements reflect the picked theme instantly. */}
                <div
                  data-theme={theme}
                  className="mt-3 rounded-xl border p-3"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                >
                  <div
                    className="mb-1 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text2)' }}
                  >
                    Xem trước
                  </div>
                  <div
                    className="rounded-lg p-3"
                    style={{ background: 'var(--surface)', color: 'var(--foreground)' }}
                  >
                    <div className="mb-2 text-sm font-bold">Hành tinh nào lớn nhất?</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="rounded-md px-2.5 py-1 text-xs font-bold"
                        style={{ background: 'var(--accent)', color: '#fff' }}
                      >
                        Jupiter
                      </span>
                      <span
                        className="rounded-md px-2.5 py-1 text-xs font-semibold"
                        style={{ background: 'var(--surface2)', color: 'var(--text2)' }}
                      >
                        Mars
                      </span>
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold"
                        style={{
                          background: 'color-mix(in srgb, var(--success) 18%, transparent)',
                          color: 'var(--success)',
                        }}
                      >
                        <Check className="size-3" /> Đúng
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>

      {previewing && (
        <QuizPreviewModal
          title={title}
          questions={questions}
          theme={theme}
          onClose={() => setPreviewing(false)}
        />
      )}
      <MediaPicker
        open={coverPicker}
        onClose={() => setCoverPicker(false)}
        allow={['image']}
        onPick={(m) => {
          if (m.kind === 'image') setCoverImage(m.url);
        }}
      />
      <QuestionBankPicker
        open={bankPickerMode !== null}
        initialMode={bankPickerMode ?? 'manual'}
        existingSourceIds={existingSourceIds}
        onClose={() => setBankPickerMode(null)}
        onAdd={addBankQuestions}
      />
    </div>
  );
}
