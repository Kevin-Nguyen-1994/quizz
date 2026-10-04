import { Link } from 'react-router-dom';
import { AppAlert } from '@/components/AppAlert';
import { MyAssignmentCard } from '@/components/MyAssignmentCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useMyAssignments } from '@/hooks/useMyAssignments';

export function PendingAssignmentsBlock() {
  const { assignments, loading, error } = useMyAssignments();
  const pending = assignments
    .filter(
      (assignment) =>
        assignment.participantStatus === 'in_progress' ||
        assignment.participantStatus === 'not_started',
    )
    .sort((a, b) => {
      if (a.participantStatus !== b.participantStatus) {
        return a.participantStatus === 'in_progress' ? -1 : 1;
      }
      return (
        (a.deadlineAtMs ?? Number.POSITIVE_INFINITY) - (b.deadlineAtMs ?? Number.POSITIVE_INFINITY)
      );
    })
    .slice(0, 5);

  return (
    <section className="mb-7" aria-labelledby="pending-assignments-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="pending-assignments-title" className="text-xl">
          Bài kiểm tra cần làm
        </h2>
        <Button asChild variant="ghost" size="sm">
          <Link to="/u/assignments">Xem tất cả bài kiểm tra</Link>
        </Button>
      </div>
      {error ? (
        <AppAlert variant="error">Không thể tải bài kiểm tra được giao.</AppAlert>
      ) : loading ? (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">Đang tải…</CardContent>
        </Card>
      ) : pending.length === 0 ? (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">
            Hiện chưa có bài kiểm tra nào cần hoàn thành.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {pending.map((assignment) => (
            <MyAssignmentCard key={assignment.assignmentId} assignment={assignment} compact />
          ))}
        </div>
      )}
    </section>
  );
}
