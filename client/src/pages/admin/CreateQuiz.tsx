import { ArrowLeft, Braces, Check, Eye, Languages, Sparkles, WandSparkles } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppAlert } from '@/components/AppAlert';
import { Textarea } from '@/components/Input';
import { MainContent, Page, Subtitle } from '@/components/layout';
import { QuizPreviewModal } from '@/components/QuizPreviewModal';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  importPayloadToStudioDraft,
  parseQuizImportJson,
  QUIZ_IMPORT_AI_PROMPT,
  QUIZ_IMPORT_EXAMPLE_JSON,
  QUIZ_IMPORT_JSON_SHORT,
} from '@/helpers/quizImportSchema';
import { cn } from '@/lib/utils';
import CreatorNav from '../../components/CreatorNav';
import { useAuth } from '../../context/AuthContext';
import { useAuthFetch } from '../../hooks/useAuthFetch';
import { useCreatorBase } from '../../hooks/useCreatorBase';
import type { ImportPayload, ImportQuestion, QuizTranslationPayload } from '../../types';
import { DynamicQuizEditor } from './components/DynamicQuizEditor';
import { clearCreateDraft, QuizStudio, saveCreateDraft } from './components/studio/QuizStudio';
import { TranslationsDialog } from './components/TranslationsDialog';

const COPY_TONE = {
  example: {
    label: 'Sao chép mẫu',
    icon: Braces,
    className:
      'border-primary bg-primary text-white hover:bg-[var(--brand-primary-hover)] focus-visible:ring-primary/40',
  },
  prompt: {
    label: 'Sao chép hướng dẫn',
    icon: Sparkles,
    className:
      'border-[var(--brand-accent)] bg-[var(--brand-accent)] text-white hover:bg-[var(--brand-accent-hover)] focus-visible:ring-[var(--brand-accent)]/40',
  },
} as const;

/** Copies preset text to the clipboard with brief copied feedback. */
function CopyTextButton({
  text,
  tone,
  className,
  inSummary,
}: {
  text: string;
  tone: keyof typeof COPY_TONE;
  className?: string;
  inSummary?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const { label, icon: Icon, className: toneClassName } = COPY_TONE[tone];
  return (
    <Button
      type="button"
      size="sm"
      className={cn(toneClassName, className)}
      onClick={(e) => {
        if (inSummary) {
          e.preventDefault();
          e.stopPropagation();
        }
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? (
        <>
          <Check className="size-3.5" /> Đã sao chép
        </>
      ) : (
        <>
          <Icon className="size-3.5" /> {label}
        </>
      )}
    </Button>
  );
}

export default function CreateQuiz() {
  const api = useAuthFetch();
  const navigate = useNavigate();
  const basePath = useCreatorBase();
  const { isSuperAdmin } = useAuth();
  const [quizMode, setQuizMode] = useState<'static' | 'bank_generated'>('static');
  const [mode, setMode] = useState<'studio' | 'json'>('studio');
  const [studioKey, setStudioKey] = useState(0);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ title: string; questions: ImportQuestion[] } | null>(
    null,
  );
  const [translationsOpen, setTranslationsOpen] = useState(false);
  const [stagedTranslations, setStagedTranslations] = useState<QuizTranslationPayload[]>([]);

  const saveLabel = saving ? (
    'Đang lưu…'
  ) : (
    <>
      <Check className="size-4" /> Tạo bộ câu hỏi
    </>
  );

  if (quizMode === 'bank_generated') {
    return (
      <DynamicQuizEditor
        onCancel={() => setQuizMode('static')}
        onSaved={() => navigate(basePath)}
      />
    );
  }

  async function saveQuiz(payload: ImportPayload) {
    setSaving(true);
    setJsonError('');
    setSuccess('');
    const { ok, data } = await api.post<{ id: number; error?: string }>(
      '/api/admin/quizzes',
      payload,
    );
    if (!ok) {
      setSaving(false);
      setJsonError(data.error ?? 'Không thể lưu bộ câu hỏi.');
      return;
    }
    // Drop the studio autosave here, not only in QuizStudio's success effect —
    // the JSON-import path saves with QuizStudio unmounted, and the stale
    // draft would otherwise be restored (and re-saveable) on the next visit.
    clearCreateDraft();

    // Upload any translations staged before the quiz had an id. The quiz is
    // already created at this point — a translation failure (e.g. the staged
    // JSON's question count drifted from what was actually saved) shouldn't
    // block navigating away, just gets reported alongside the success message.
    let translationWarning = '';
    for (const translation of stagedTranslations) {
      const res = await api.post<{ error?: string }>(
        `/api/admin/quizzes/${data.id}/translations`,
        translation,
      );
      if (!res.ok) {
        translationWarning = ` (không thể lưu bản dịch "${translation.locale}": ${res.data.error ?? 'lỗi không xác định'} — có thể thêm lại từ màn hình chỉnh sửa)`;
      }
    }

    setSaving(false);
    setSuccess(`Đã tạo bộ câu hỏi. ID: ${data.id}${translationWarning}`);
    setTimeout(() => navigate(basePath), translationWarning ? 2500 : 1000);
  }

  async function handleJsonSubmit() {
    const parsed = parseQuizImportJson(jsonText);
    if (!parsed.ok) {
      setJsonError(parsed.error);
      return;
    }
    await saveQuiz(parsed.payload);
  }

  function applyJsonToStudio(): boolean {
    setJsonError('');
    const parsed = parseQuizImportJson(jsonText);
    if (!parsed.ok) {
      setJsonError(parsed.error);
      return false;
    }
    saveCreateDraft(importPayloadToStudioDraft(parsed.payload));
    setStudioKey((k) => k + 1);
    setMode('studio');
    return true;
  }

  function backToStudio() {
    if (jsonText.trim()) {
      applyJsonToStudio();
      return;
    }
    setJsonError('');
    setMode('studio');
  }

  function openJsonPreview() {
    setJsonError('');
    const parsed = parseQuizImportJson(jsonText, { requireTitle: false });
    if (!parsed.ok) {
      setJsonError(parsed.error);
      return;
    }
    setPreview({ title: parsed.payload.title ?? '', questions: parsed.payload.questions });
  }

  // Default full-screen Kahoot-style studio.
  if (mode === 'studio') {
    return (
      <>
        <QuizStudio
          key={studioKey}
          mode="create"
          saving={saving}
          error={jsonError}
          success={success}
          onSave={saveQuiz}
          onCancel={() => navigate(basePath)}
          onValidationError={setJsonError}
          allowQuestionBank={isSuperAdmin}
          headerExtra={
            <>
              {isSuperAdmin && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setQuizMode('bank_generated')}
                >
                  <WandSparkles className="size-4" /> Bộ đề động
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={() => setMode('json')}>
                <Braces className="size-4" /> Nhập JSON
              </Button>
              <Button type="button" variant="ghost" onClick={() => setTranslationsOpen(true)}>
                <Languages className="size-4" />
                Bản dịch
                {stagedTranslations.length > 0 && ` (${stagedTranslations.length})`}
              </Button>
            </>
          }
        />
        <TranslationsDialog
          open={translationsOpen}
          onClose={() => setTranslationsOpen(false)}
          stagedLocales={stagedTranslations.map((t) => t.locale)}
          onStage={(payload) =>
            setStagedTranslations((prev) => [
              ...prev.filter((t) => t.locale !== payload.locale),
              payload,
            ])
          }
          onUnstage={(locale) =>
            setStagedTranslations((prev) => prev.filter((t) => t.locale !== locale))
          }
        />
      </>
    );
  }

  return (
    <Page>
      <CreatorNav />
      <MainContent>
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div>
            <h1>Tạo bộ câu hỏi</h1>
            <Subtitle>Dán dữ liệu JSON được tạo sẵn hoặc từ công cụ AI.</Subtitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CopyTextButton text={QUIZ_IMPORT_EXAMPLE_JSON} tone="example" />
            <CopyTextButton text={QUIZ_IMPORT_AI_PROMPT} tone="prompt" />
            <Button type="button" variant="ghost" onClick={() => setTranslationsOpen(true)}>
              <Languages className="size-4" />
              Bản dịch
              {stagedTranslations.length > 0 && ` (${stagedTranslations.length})`}
            </Button>
            <Button type="button" variant="ghost" onClick={backToStudio}>
              <ArrowLeft className="size-4" /> Quay lại trình chỉnh sửa
            </Button>
          </div>
        </div>

        {jsonError && <AppAlert variant="error">{jsonError}</AppAlert>}
        {success && <AppAlert variant="success">{success}</AppAlert>}

        <Card className="w-full max-w-4xl">
          <CardContent className="p-6">
            <h2 className="mb-4">Dán JSON</h2>
            <AppAlert variant="info" className="text-[0.85rem]">
              Dùng <strong>Sao chép hướng dẫn</strong> để lấy yêu cầu và JSON schema cho AI, hoặc{' '}
              <strong>Sao chép mẫu</strong> để lấy một bộ câu hỏi hoàn chỉnh. Sau đó dán JSON vào
              đây và chọn <strong>Đưa vào trình chỉnh sửa</strong>.
            </AppAlert>
            <div className="mb-3 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => navigate(basePath)}>
                Hủy
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleJsonSubmit}
                disabled={saving || !jsonText.trim()}
              >
                {saveLabel}
              </Button>
              <Button type="button" onClick={applyJsonToStudio} disabled={!jsonText.trim()}>
                Đưa vào trình chỉnh sửa
              </Button>
            </div>
            <Textarea
              id="quiz-json"
              label="JSON bộ câu hỏi"
              className="font-mono min-h-80"
              placeholder={QUIZ_IMPORT_JSON_SHORT}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
            />
            <details className="mt-2 mb-2">
              <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm text-muted-foreground">
                <span>JSON mẫu</span>
                <CopyTextButton text={QUIZ_IMPORT_EXAMPLE_JSON} tone="example" inSummary />
              </summary>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-background p-4 font-mono text-[0.78rem] text-muted-foreground whitespace-pre-wrap">
                {QUIZ_IMPORT_EXAMPLE_JSON}
              </pre>
            </details>
            <details className="mb-4">
              <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm text-muted-foreground">
                <span>Hướng dẫn + schema</span>
                <CopyTextButton text={QUIZ_IMPORT_AI_PROMPT} tone="prompt" inSummary />
              </summary>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-background p-4 font-mono text-[0.78rem] text-muted-foreground whitespace-pre-wrap">
                {QUIZ_IMPORT_AI_PROMPT}
              </pre>
            </details>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => navigate(basePath)}>
                Hủy
              </Button>
              <Button
                type="button"
                size="lg"
                variant="secondary"
                onClick={openJsonPreview}
                disabled={!jsonText.trim()}
              >
                <Eye className="size-4" /> Xem trước
              </Button>
              <Button
                type="button"
                size="lg"
                variant="secondary"
                onClick={handleJsonSubmit}
                disabled={saving || !jsonText.trim()}
              >
                {saveLabel}
              </Button>
              <Button
                type="button"
                size="lg"
                onClick={applyJsonToStudio}
                disabled={!jsonText.trim()}
              >
                Đưa vào trình chỉnh sửa
              </Button>
            </div>
          </CardContent>
        </Card>
      </MainContent>
      {preview && (
        <QuizPreviewModal
          title={preview.title}
          questions={preview.questions}
          onClose={() => setPreview(null)}
        />
      )}
      <TranslationsDialog
        open={translationsOpen}
        onClose={() => setTranslationsOpen(false)}
        stagedLocales={stagedTranslations.map((t) => t.locale)}
        onStage={(payload) =>
          setStagedTranslations((prev) => [
            ...prev.filter((t) => t.locale !== payload.locale),
            payload,
          ])
        }
        onUnstage={(locale) =>
          setStagedTranslations((prev) => prev.filter((t) => t.locale !== locale))
        }
      />
    </Page>
  );
}
