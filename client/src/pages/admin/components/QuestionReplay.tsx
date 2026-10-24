import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ReplayQuestionView } from '@/components/ReplayQuestionView';
import {
  formatDurationMs,
  questionTypeLabels,
  ResultBadge,
} from '@/components/AssignmentAttemptReview';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AssignmentQuestionDetail, AssignmentReportResult } from '@/types';

const resultOrder: Record<AssignmentReportResult, number> = {
  incorrect: 0,
  no_answer: 1,
  correct: 2,
};

const difficultyLabels: Record<string, string> = {
  easy: 'Dễ',
  medium: 'Trung bình',
  hard: 'Khó',
};

export function QuestionReplay({
  detail,
  onAdjust,
}: {
  detail: AssignmentQuestionDetail;
  onAdjust: () => void;
}) {
  const [participantIndex, setParticipantIndex] = useState(0);
  const [reveal, setReveal] = useState(false);
  const participants = useMemo(
    () =>
      detail.participants
        .filter((participant) => participant.attemptId !== null)
        .sort(
          (left, right) =>
            resultOrder[left.result] - resultOrder[right.result] ||
            left.name.localeCompare(right.name, 'vi'),
        ),
    [detail.participants],
  );

  const participant = participants[participantIndex];
  const counts = detail.participants.reduce(
    (summary, item) => {
      summary[item.result] += item.attemptId === null ? 0 : 1;
      return summary;
    },
    { correct: 0, incorrect: 0, no_answer: 0 } as Record<AssignmentReportResult, number>,
  );
  const notStarted = detail.participants.length - participants.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-muted p-3">
        <div>
          <strong>
            Câu {detail.question.questionNumber} ·{' '}
            {questionTypeLabels[detail.question.questionType]}
          </strong>
          <div className="mt-2 flex flex-wrap gap-2">
            {(detail.question.categoryName || detail.question.categoryCode) && (
              <Badge variant="outline">
                {detail.question.categoryName ?? detail.question.categoryCode}
              </Badge>
            )}
            {detail.question.levelCode && (
              <Badge variant="outline">{detail.question.levelCode}</Badge>
            )}
            {detail.question.difficulty && (
              <Badge variant="outline">
                {difficultyLabels[detail.question.difficulty] ?? detail.question.difficulty}
              </Badge>
            )}
            {detail.question.critical && <Badge variant="destructive">Critical</Badge>}
          </div>
        </div>
        <Button type="button" variant="secondary" onClick={onAdjust}>
          Điều chỉnh kết quả
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-lg border p-2">
          <strong className="block text-lg text-emerald-500">{counts.correct}</strong>
          Đúng
        </div>
        <div className="rounded-lg border p-2">
          <strong className="block text-lg text-red-500">{counts.incorrect}</strong>
          Sai
        </div>
        <div className="rounded-lg border p-2">
          <strong className="block text-lg text-amber-500">{counts.no_answer}</strong>
          Không trả lời
        </div>
      </div>

      {participant ? (
        <>
          <div className="space-y-3 rounded-lg border p-3">
            <label className="block text-sm font-medium" htmlFor="question-replay-participant">
              Nhân viên
            </label>
            <select
              id="question-replay-participant"
              className="min-h-11 w-full rounded-md border bg-background px-3 text-sm"
              value={participantIndex}
              onChange={(event) => setParticipantIndex(Number(event.target.value))}
            >
              {participants.map((item, index) => (
                <option key={item.memberId} value={index}>
                  {item.name} · {item.loginName} · lượt #{item.attemptNumber}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <ResultBadge result={participant.result} />
                {participant.isAdjusted && <Badge variant="outline">Đã rà soát kết quả</Badge>}
                <span>
                  {participant.score}/{detail.question.maxScore} điểm
                </span>
                <span className="text-muted-foreground">
                  {formatDurationMs(participant.responseTimeMs)} / {detail.question.timeLimitSec}{' '}
                  giây
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={participantIndex === 0}
                  onClick={() => setParticipantIndex((current) => current - 1)}
                >
                  <ChevronLeft className="size-4" /> Trước
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={participantIndex === participants.length - 1}
                  onClick={() => setParticipantIndex((current) => current + 1)}
                >
                  Sau <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>

          <ReplayQuestionView
            question={detail.question}
            submission={{
              answerStatus: participant.answerStatus,
              chosenIndex: participant.chosenIndex,
              chosenIndices: participant.chosenIndices,
              chosenText: participant.chosenText,
            }}
            reveal={reveal}
            onRevealChange={setReveal}
          />
        </>
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          Chưa có nhân viên nào có lượt làm để mô phỏng.
        </div>
      )}

      {notStarted > 0 && (
        <p className="text-xs text-muted-foreground">
          {notStarted} nhân viên chưa có lượt làm; xem trong bảng phân tích câu hỏi.
        </p>
      )}
    </div>
  );
}
