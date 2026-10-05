import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type {
  AssignmentAttemptDetail,
  AssignmentAttemptQuestionDetail,
  AssignmentReportResult,
  QuestionType,
} from '@/types';

export const questionTypeLabels: Record<QuestionType, string> = {
  multiple_choice: 'Một đáp án',
  true_false: 'Đúng / Sai',
  open_text: 'Trả lời ngắn',
  multi_select: 'Nhiều đáp án',
  closest_to: 'Số gần đúng',
  fill_blank: 'Điền chỗ trống',
  ordering: 'Sắp xếp',
  geo: 'Bản đồ',
  matching: 'Nối cặp',
};

const answerStatusLabels = {
  answered: 'Đã trả lời',
  timed_out: 'Hết giờ',
  not_answered: 'Chưa trả lời',
} as const;

export function formatDurationMs(value: number | null): string {
  if (value === null) return '—';
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)} giây`;
  const wholeSeconds = Math.round(seconds);
  return `${Math.floor(wholeSeconds / 60)} phút ${wholeSeconds % 60} giây`;
}

export function ResultBadge({ result }: { result: AssignmentReportResult }) {
  const labels = { correct: 'Đúng', incorrect: 'Sai', no_answer: 'Không trả lời' } as const;
  return (
    <Badge
      variant="outline"
      className={cn(
        'whitespace-nowrap',
        result === 'correct' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
        result === 'incorrect' && 'border-red-500/30 bg-red-500/10 text-red-300',
        result === 'no_answer' && 'border-amber-500/30 bg-amber-500/10 text-amber-200',
      )}
    >
      {labels[result]}
    </Badge>
  );
}

function QuestionCard({ question }: { question: AssignmentAttemptQuestionDetail }) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="text-xs text-muted-foreground">
              Câu {question.questionNumber} · {questionTypeLabels[question.questionType]}
            </span>
            <h3 className="mt-1 text-base">{question.text}</h3>
          </div>
          <ResultBadge result={question.result} />
        </div>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-lg bg-muted p-3">
            <span className="block text-xs text-muted-foreground">Câu trả lời của bạn</span>
            <span className="whitespace-pre-wrap">{question.submittedAnswer}</span>
          </div>
          <div className="rounded-lg bg-emerald-500/10 p-3">
            <span className="block text-xs text-muted-foreground">Đáp án đúng</span>
            <span className="whitespace-pre-wrap">{question.correctAnswer}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>
            Điểm: {question.score}/{question.maxScore}
          </span>
          <span>Thời gian: {formatDurationMs(question.responseTimeMs)}</span>
          <span>Giới hạn: {question.timeLimitSec} giây</span>
          <span>Trạng thái: {answerStatusLabels[question.answerStatus]}</span>
        </div>
        {question.explanation && (
          <div className="rounded-lg border border-border p-3 text-sm">
            <strong className="block text-xs text-muted-foreground">Giải thích</strong>
            <p className="mt-1 whitespace-pre-wrap">{question.explanation}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AssignmentAttemptReview({ detail }: { detail: AssignmentAttemptDetail }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2 rounded-lg bg-muted p-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <span className="block text-xs text-muted-foreground">Lượt</span>#
          {detail.attempt.attemptNumber}
        </div>
        <div>
          <span className="block text-xs text-muted-foreground">Đúng</span>
          {detail.attempt.correct}
        </div>
        <div>
          <span className="block text-xs text-muted-foreground">Sai</span>
          {detail.attempt.incorrect}
        </div>
        <div>
          <span className="block text-xs text-muted-foreground">Bỏ câu</span>
          {detail.attempt.noAnswer}
        </div>
        <div>
          <span className="block text-xs text-muted-foreground">Điểm</span>
          {detail.attempt.score}/{detail.attempt.maxScore} ({detail.attempt.scorePercent}%)
        </div>
        <div>
          <span className="block text-xs text-muted-foreground">Thời gian làm thực tế</span>
          {formatDurationMs(detail.attempt.activeAnsweringTimeMs)}
        </div>
      </div>
      <div className="grid gap-3">
        {detail.questions.map((question) => (
          <QuestionCard key={question.questionId} question={question} />
        ))}
      </div>
    </div>
  );
}
