import { Eye, EyeOff } from 'lucide-react';
import { OptionText } from '@/components/OptionText';
import { QuestionImage } from '@/components/QuestionImage';
import { QuestionMedia } from '@/components/QuestionMedia';
import { QuestionText } from '@/components/QuestionText';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type {
  AssignmentReplayQuestionSnapshot,
  AssignmentReplaySubmittedState,
  QuestionType,
} from '@/types';

export interface ReplayQuestionViewQuestion {
  text: string;
  questionType: QuestionType;
  correctAnswer: string;
  explanation: string | null;
  replay: AssignmentReplayQuestionSnapshot;
}

function parseStringArray(value: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

function ReplayAnswer({
  question,
  submission,
}: {
  question: ReplayQuestionViewQuestion;
  submission: AssignmentReplaySubmittedState;
}) {
  const { replay } = question;
  const indices = submission.chosenIndices ?? [];
  const selected = new Set(indices.filter((value): value is number => value !== null));
  const optionClass = (isSelected: boolean) =>
    cn(
      'min-h-12 rounded-lg border p-3 text-left text-sm',
      isSelected ? 'border-primary bg-primary/15 ring-1 ring-primary' : 'border-border bg-muted/40',
    );

  if (submission.answerStatus !== 'answered') {
    return (
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
        {submission.answerStatus === 'timed_out'
          ? 'Nhân viên không kịp nộp đáp án cho câu này.'
          : 'Nhân viên chưa nộp đáp án cho câu này.'}
      </p>
    );
  }
  if (question.questionType === 'multiple_choice' || question.questionType === 'true_false') {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {replay.options.map((option, index) => (
          <div key={`${index}-${option}`} className={optionClass(submission.chosenIndex === index)}>
            <span className="mb-1 block text-xs text-muted-foreground">
              {submission.chosenIndex === index ? 'Nhân viên đã chọn' : 'Không chọn'}
            </span>
            <OptionText value={option} imgClassName="option-img-sm" />
          </div>
        ))}
      </div>
    );
  }
  if (question.questionType === 'multi_select') {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {replay.options.map((option, index) => (
          <div key={`${index}-${option}`} className={optionClass(selected.has(index))}>
            <span className="mb-1 block text-xs text-muted-foreground">
              {selected.has(index) ? 'Nhân viên đã chọn' : 'Không chọn'}
            </span>
            <OptionText value={option} imgClassName="option-img-sm" />
          </div>
        ))}
      </div>
    );
  }
  if (question.questionType === 'ordering') {
    return (
      <ol className="space-y-2">
        {indices.map((optionIndex, position) => (
          <li
            key={`${position}-${optionIndex}`}
            className="flex gap-3 rounded-lg border border-primary bg-primary/10 p-3 text-sm"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {position + 1}
            </span>
            <OptionText
              value={optionIndex === null ? '—' : (replay.options[optionIndex] ?? '—')}
              imgClassName="option-img-sm"
            />
          </li>
        ))}
      </ol>
    );
  }
  if (question.questionType === 'matching') {
    return (
      <div className="space-y-2">
        {replay.options.map((left, index) => {
          const rightIndex = indices[index];
          return (
            <div
              key={`${index}-${left}`}
              className="grid gap-2 rounded-lg border border-primary bg-primary/10 p-3 text-sm sm:grid-cols-[1fr_auto_1fr]"
            >
              <OptionText value={left} imgClassName="option-img-sm" />
              <span className="text-muted-foreground">→</span>
              <OptionText
                value={
                  rightIndex === null || rightIndex === undefined
                    ? '—'
                    : (replay.rightOptions[rightIndex] ?? '—')
                }
                imgClassName="option-img-sm"
              />
            </div>
          );
        })}
      </div>
    );
  }
  if (question.questionType === 'fill_blank') {
    const blanks = parseStringArray(submission.chosenText);
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {blanks.map((value, index) => (
          <div
            key={`${index}-${value}`}
            className="rounded-lg border border-primary bg-primary/10 p-3 text-sm"
          >
            <span className="block text-xs text-muted-foreground">Ô trống {index + 1}</span>
            {value || '—'}
          </div>
        ))}
      </div>
    );
  }
  const label =
    question.questionType === 'geo'
      ? 'Vị trí đã chọn'
      : question.questionType === 'closest_to'
        ? 'Số đã nhập'
        : 'Câu trả lời đã nhập';
  return (
    <div className="rounded-lg border border-primary bg-primary/10 p-3 text-sm">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className="whitespace-pre-wrap">{submission.chosenText || '—'}</span>
    </div>
  );
}

export function ReplayQuestionView({
  question,
  submission,
  reveal,
  onRevealChange,
}: {
  question: ReplayQuestionViewQuestion;
  submission: AssignmentReplaySubmittedState;
  reveal: boolean;
  onRevealChange: (reveal: boolean) => void;
}) {
  const media =
    question.replay.mediaType && question.replay.mediaUrl ? (
      <QuestionMedia
        url={question.replay.mediaUrl}
        kind={question.replay.mediaType}
        className="mb-4"
      />
    ) : (
      <QuestionImage src={question.replay.imageUrl ?? undefined} className="question-image mb-4" />
    );
  return (
    <Card>
      <CardContent className="p-4 sm:p-6">
        {media}
        <div className="question-text mb-5">
          <QuestionText text={question.text} />
        </div>
        <ReplayAnswer question={question} submission={submission} />
        {reveal && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
              <strong className="block text-xs text-muted-foreground">Đáp án đúng</strong>
              <p className="mt-1 whitespace-pre-wrap">{question.correctAnswer}</p>
            </div>
            {question.explanation && (
              <div className="rounded-lg border border-border p-3 text-sm">
                <strong className="block text-xs text-muted-foreground">Giải thích</strong>
                <p className="mt-1 whitespace-pre-wrap">{question.explanation}</p>
              </div>
            )}
          </div>
        )}
        <div className="mt-5 border-t pt-4">
          <Button type="button" variant="secondary" onClick={() => onRevealChange(!reveal)}>
            {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            {reveal ? 'Ẩn đáp án' : 'Hiện đáp án & giải thích'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
