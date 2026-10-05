import { ClipboardList, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AppAlert } from '@/components/AppAlert';
import { EmptyState, MainContent, Page, PageHeader } from '@/components/layout';
import { MyAssignmentCard } from '@/components/MyAssignmentCard';
import UserNav from '@/components/UserNav';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useMyAssignments } from '@/hooks/useMyAssignments';
import type { MyAssignmentListItem } from '@/types';

type Filter = 'todo' | 'in_progress' | 'completed' | 'expired' | 'all';

const filters: Array<{ id: Filter; label: string }> = [
  { id: 'todo', label: 'Cần làm' },
  { id: 'in_progress', label: 'Đang làm' },
  { id: 'completed', label: 'Đã hoàn thành' },
  { id: 'expired', label: 'Hết hạn' },
  { id: 'all', label: 'Tất cả' },
];

function matchesFilter(assignment: MyAssignmentListItem, filter: Filter) {
  if (filter === 'all') return true;
  if (filter === 'todo') return assignment.participantStatus === 'not_started';
  return assignment.participantStatus === filter;
}

export default function MyAssignments() {
  const { assignments, loading, error, reload } = useMyAssignments();
  const [filter, setFilter] = useState<Filter>('todo');
  const filtered = useMemo(
    () => assignments.filter((assignment) => matchesFilter(assignment, filter)),
    [assignments, filter],
  );

  return (
    <Page>
      <UserNav />
      <MainContent>
        <PageHeader
          title="Bài kiểm tra của tôi"
          description="Theo dõi và hoàn thành các bài kiểm tra được giao."
          actions={
            <Button type="button" variant="secondary" onClick={reload} disabled={loading}>
              <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} /> Làm mới
            </Button>
          }
        />

        {error && <AppAlert variant="error">{error}</AppAlert>}

        <div
          className="mb-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
          role="tablist"
          aria-label="Lọc bài kiểm tra"
        >
          {filters.map((item) => {
            const count = assignments.filter((assignment) =>
              matchesFilter(assignment, item.id),
            ).length;
            return (
              <Button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                variant={filter === item.id ? 'default' : 'secondary'}
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => setFilter(item.id)}
              >
                {item.label} ({count})
              </Button>
            );
          })}
        </div>

        {loading ? (
          <Card>
            <CardContent className="p-10 text-center text-muted-foreground">
              Đang tải bài kiểm tra…
            </CardContent>
          </Card>
        ) : assignments.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="size-10" />}
            title="Chưa có bài kiểm tra nào"
            description="Các bài được quản trị viên giao sẽ xuất hiện tại đây."
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="Không có bài kiểm tra trong nhóm này" />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((assignment) => (
              <MyAssignmentCard key={assignment.assignmentId} assignment={assignment} />
            ))}
          </div>
        )}
      </MainContent>
    </Page>
  );
}
