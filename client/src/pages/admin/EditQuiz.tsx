import { Languages } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Page, PageCenter } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { mapDbQuestionToImport, type QuestionWithKey } from '@/helpers';
import { DEFAULT_LOCALE } from '@/helpers/locale';
import CreatorNav from '../../components/CreatorNav';
import { useAuthFetch } from '../../hooks/useAuthFetch';
import { useCreatorBase } from '../../hooks/useCreatorBase';
import type { ImportPayload, ThemeId } from '../../types';
import { QuizStudio } from './components/studio/QuizStudio';
import { TranslationsDialog } from './components/TranslationsDialog';

export default function EditQuiz() {
  const api = useAuthFetch();
  const navigate = useNavigate();
  const basePath = useCreatorBase();
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [theme, setTheme] = useState<ThemeId>('default');
  const [language, setLanguage] = useState(DEFAULT_LOCALE);
  const [questions, setQuestions] = useState<QuestionWithKey[]>([]);
  const [translationsOpen, setTranslationsOpen] = useState(false);

  useEffect(() => {
    api
      .get<{
        title: string;
        description: string;
        cover_image?: string | null;
        theme?: ThemeId | null;
        language?: string | null;
        questions: unknown[];
      }>(`/api/admin/quizzes/${id}`)
      .then(({ ok, data }) => {
        if (!ok) {
          setError('Không thể tải bộ câu hỏi.');
          setLoading(false);
          return;
        }
        setTitle(data.title ?? '');
        setDescription(data.description ?? '');
        setCoverImage(data.cover_image ?? '');
        setTheme(data.theme ?? 'default');
        setLanguage(data.language ?? DEFAULT_LOCALE);
        setQuestions(
          (data.questions ?? []).map((q) =>
            mapDbQuestionToImport(q as Parameters<typeof mapDbQuestionToImport>[0]),
          ),
        );
        setLoading(false);
      })
      .catch(() => {
        setError('Không thể tải bộ câu hỏi.');
        setLoading(false);
      });
  }, [id, api]);

  async function handleSave(payload: ImportPayload) {
    setError('');
    setSaving(true);
    const { ok, data } = await api.put<{ error?: string }>(`/api/admin/quizzes/${id}`, payload);
    setSaving(false);
    if (ok) {
      setSuccess('Đã cập nhật bộ câu hỏi.');
      setTimeout(() => navigate(basePath), 1000);
    } else {
      setError(data.error ?? 'Không thể cập nhật bộ câu hỏi.');
    }
  }

  if (loading)
    return (
      <Page>
        <CreatorNav />
        <PageCenter>
          <p className="text-muted-foreground">Đang tải bộ câu hỏi…</p>
        </PageCenter>
      </Page>
    );

  return (
    <>
      <QuizStudio
        mode="edit"
        initialTitle={title}
        initialDescription={description}
        initialCoverImage={coverImage}
        initialTheme={theme}
        initialLanguage={language}
        initialQuestions={questions}
        saving={saving}
        error={error}
        success={success}
        onSave={handleSave}
        onCancel={() => navigate(basePath)}
        onValidationError={setError}
        headerExtra={
          <Button type="button" variant="ghost" size="sm" onClick={() => setTranslationsOpen(true)}>
            <Languages className="size-4" />
            <span className="hidden sm:inline">Bản dịch</span>
          </Button>
        }
      />
      {id && (
        <TranslationsDialog
          open={translationsOpen}
          onClose={() => setTranslationsOpen(false)}
          quizId={id}
          questionCount={questions.length}
          baseQuestions={questions}
          baseLanguage={language}
        />
      )}
    </>
  );
}
