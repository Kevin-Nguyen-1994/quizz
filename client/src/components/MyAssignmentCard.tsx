import { ArrowRight, Clock3, Eye, PlayCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AssignmentStatusBadge } from '@/components/AssignmentStatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { MyAssignmentListItem } from '@/types';

function dateTime(value: number | null) {
  return value === null ? 'Không giới hạn' : new Date(value).toLocaleString('vi-VN');
}

function assignmentAction(assignment: MyAssignmentListItem) {
  if (assignment.participantStatus === 'in_progress' && assignment.canResume) {
    return { label: 'Tiếp tục', icon: PlayCircle };
  }
  if (assignment.participantStatus === 'not_started' && assignment.canStart) {
    return { label: 'Làm bài', icon: ArrowRight };
  }
  if (
    (assignment.participantStatus === 'completed' || assignment.participantStatus === 'expired') &&
    assignment.canReview
  ) {
    return { label: 'Xem kết quả', icon: Eye };
  }
  return null;
}

function unavailableLabel(assignment: MyAssignmentListItem) {
  if (assignment.participantStatus === 'completed') return 'Đã hoàn thành';
  if (assignment.participantStatus === 'expired') return 'Hết hạn';
  if (assignment.participantStatus === 'not_started') return 'Chưa mở';
  return 'Không thể tiếp tục';
}

export function MyAssignmentCard({
  assignment,
  compact = false,
}: {
  assignment: MyAssignmentListItem;
  compact?: boolean;
}) {
  const action = assignmentAction(assignment);
  const href = `/assignment/${encodeURIComponent(assignment.accessCode)}`;
  return (
    <Card>
      <CardContent
        className={
          compact
            ? 'flex flex-col gap-3 p-4 sm:flex-row sm:items-center'
            : 'flex h-full flex-col gap-4 p-5'
        }
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="line-clamp-2 text-lg">{assignment.title}</h2>
            <AssignmentStatusBadge status={assignment.participantStatus} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>{assignment.questionCount} câu</span>
            <span>
              Lượt: {assignment.attemptsUsed}/{assignment.maxAttempts}
            </span>
          </div>
          {!compact && (
            <div className="mt-3 space-y-1.5 text-sm">
              <p className="flex items-start gap-2">
                <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="text-muted-foreground">Mở:</span>{' '}
                  {dateTime(assignment.opensAtMs)}
                </span>
              </p>
              <p className="flex items-start gap-2">
                <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="text-muted-foreground">Hạn:</span>{' '}
                  {dateTime(assignment.deadlineAtMs)}
                </span>
              </p>
            </div>
          )}
          {compact && (
            <p className="mt-1 text-sm text-muted-foreground">
              Hạn: {dateTime(assignment.deadlineAtMs)}
            </p>
          )}
          {assignment.score !== undefined && assignment.maxScore !== undefined && (
            <p className="mt-3 text-sm font-semibold">
              Điểm: {assignment.score}/{assignment.maxScore}
              {assignment.scorePercent !== undefined ? ` (${assignment.scorePercent}%)` : ''}
            </p>
          )}
        </div>
        <div className={compact ? 'shrink-0' : 'mt-auto'}>
          {action ? (
            <Button asChild className={compact ? '' : 'w-full'}>
              <Link to={href}>
                <action.icon className="size-4" /> {action.label}
              </Link>
            </Button>
          ) : (
            <Button type="button" variant="secondary" className={compact ? '' : 'w-full'} disabled>
              {unavailableLabel(assignment)}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
