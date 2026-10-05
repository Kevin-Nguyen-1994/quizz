import { Languages, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AppAlert } from '@/components/AppAlert';
import { Input, Textarea } from '@/components/Input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { COMMON_LOCALES, localeName } from '@/helpers/locale';
import { parseQuizTranslationJson } from '@/helpers/quizImportSchema';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type { QuizTranslationPayload } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The base quiz's current question count, when known — enables client-side count validation. */
  questionCount?: number;
  /** The base quiz's own language (e.g. "fr") — shown so "falls back to the original" is concrete. */
  baseLanguage?: string;
  /** Editing an existing quiz: upload/list/remove hit the server directly. */
  quizId?: string;
  /** Creating a new quiz (no id yet): hold translations in memory until the quiz is saved. */
  stagedLocales?: string[];
  onStage?: (payload: QuizTranslationPayload) => void;
  onUnstage?: (locale: string) => void;
  /**
   * The base quiz's current questions, when known — powers "Use quiz as
   * starting point", which pre-fills the textarea with the translation JSON
   * shape (locale + text/options/matches/explanation only, in the same
   * order) so translators don't have to hand-build it from the much bigger
   * quiz Export JSON shape.
   */
  baseQuestions?: Array<{
    text: string;
    options: string[];
    matches?: string[];
    explanation?: string;
  }>;
}

const EXAMPLE = `{
  "questions": [
    { "text": "Quelle est la capitale de la France ?", "options": ["Paris", "Lyon", "Marseille", "Nice"] }
  ]
}`;

export function TranslationsDialog({
  open,
  onClose,
  questionCount,
  baseLanguage,
  quizId,
  stagedLocales,
  onStage,
  onUnstage,
  baseQuestions,
}: Props) {
  const staged = quizId === undefined;
  const api = useAuthFetch();
  const [locales, setLocales] = useState<string[]>([]);
  const [locale, setLocale] = useState('');
  const [json, setJson] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `api` is a fresh object each render (useAuthFetch memoizes on token only)
  useEffect(() => {
    if (!open || staged) return;
    setError('');
    setSuccess('');
    api
      .get<{ locales: string[] }>(`/api/admin/quizzes/${quizId}/translations`)
      .then(({ ok, data }) => setLocales(ok ? data.locales : []));
  }, [open, staged, quizId]);

  const shownLocales = staged ? (stagedLocales ?? []) : locales;

  async function handleUpload() {
    setError('');
    setSuccess('');
    const parsed = parseQuizTranslationJson(json, { expectedCount: questionCount, locale });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    if (staged) {
      onStage?.(parsed.payload);
      setSuccess(`Bản dịch "${parsed.payload.locale}" đã sẵn sàng và sẽ được lưu cùng bộ câu hỏi.`);
      setJson('');
      setLocale('');
      return;
    }

    setBusy(true);
    const { ok, data } = await api.post<{ error?: string; locale?: string }>(
      `/api/admin/quizzes/${quizId}/translations`,
      parsed.payload,
    );
    setBusy(false);
    if (!ok) {
      setError(data.error ?? 'Không thể tải bản dịch.');
      return;
    }
    setSuccess(`Đã lưu bản dịch "${data.locale}".`);
    setJson('');
    setLocale('');
    setLocales((prev) =>
      data.locale && prev.includes(data.locale) ? prev : [...prev, data.locale ?? ''],
    );
  }

  function handleUseTemplate() {
    if (!baseQuestions || baseQuestions.length === 0) return;
    setJson(
      JSON.stringify(
        {
          questions: baseQuestions.map((q) => ({
            text: q.text,
            options: q.options,
            ...(q.matches ? { matches: q.matches } : {}),
            ...(q.explanation ? { explanation: q.explanation } : {}),
          })),
        },
        null,
        2,
      ),
    );
  }

  async function handleRemove(loc: string) {
    if (staged) {
      onUnstage?.(loc);
      return;
    }
    setBusy(true);
    await api.delete(`/api/admin/quizzes/${quizId}/translations/${encodeURIComponent(loc)}`);
    setBusy(false);
    setLocales((prev) => prev.filter((l) => l !== loc));
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Languages className="size-4" /> Bản dịch
          </DialogTitle>
          <DialogDescription>
            {staged
              ? 'Dán JSON đã dịch với cùng số lượng và thứ tự câu; chỉ nội dung, đáp án và giải thích được thay đổi. Bản dịch sẽ được lưu cùng bộ câu hỏi.'
              : 'Tải JSON đã dịch với cùng số lượng và thứ tự câu; chỉ nội dung, đáp án và giải thích được thay đổi.'}{' '}
            Người chơi chọn ngôn ngữ khi tham gia; câu chưa có bản dịch sẽ dùng{' '}
            {baseLanguage
              ? `ngôn ngữ gốc ${localeName(baseLanguage)}`
              : 'nội dung gốc'}
            .
          </DialogDescription>
        </DialogHeader>

        {shownLocales.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {shownLocales.map((loc) => (
              <span
                key={loc}
                className="flex items-center gap-1 rounded-full border border-border bg-muted/40 py-1 pr-1.5 pl-2.5 text-xs"
              >
                {localeName(loc)}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleRemove(loc)}
                  className="text-muted-foreground hover:text-destructive"
                  title={`Xóa bản dịch ${loc}`}
                >
                  <Trash2 className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {error && <AppAlert variant="error">{error}</AppAlert>}
        {success && <AppAlert variant="success">{success}</AppAlert>}

        {baseQuestions && baseQuestions.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit shrink-0"
            onClick={handleUseTemplate}
          >
            <Wand2 className="size-3.5" /> Dùng nội dung hiện tại làm mẫu
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Gợi ý: dùng nút <strong>Xuất JSON</strong> trên thanh công cụ để sao chép nội dung và
            đáp án làm mẫu dịch.
          </p>
        )}

        <Input
          label="Mã ngôn ngữ"
          list="translation-locale-suggestions"
          placeholder="fr, es-MX, de…"
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
          hint="Chọn gợi ý hoặc nhập mã ngôn ngữ."
          noMargin
        />
        <datalist id="translation-locale-suggestions">
          {COMMON_LOCALES.map((code) => (
            <option key={code} value={code}>
              {localeName(code)}
            </option>
          ))}
        </datalist>

        <Textarea
          label="JSON bản dịch"
          placeholder={EXAMPLE}
          value={json}
          onChange={(e) => setJson(e.target.value)}
          rows={10}
          className="max-h-64 resize-y overflow-y-auto font-mono text-xs"
          noMargin
        />

        <Button
          type="button"
          className="shrink-0"
          onClick={handleUpload}
          disabled={busy || !json.trim()}
        >
          {busy ? 'Đang lưu…' : staged ? 'Thêm bản dịch' : 'Lưu bản dịch'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
