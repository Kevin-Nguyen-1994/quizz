import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AssignmentAttemptStatus, AssignmentStatus } from '@/types';

const labels: Record<AssignmentStatus | AssignmentAttemptStatus | 'not_started' | 'revoked', string> = {
  draft: 'Bản nháp',
  published: 'Đã phát hành',
  closed: 'Đã đóng',
  archived: 'Đã lưu trữ',
  not_started: 'Chưa làm',
  in_progress: 'Đang làm',
  completed: 'Hoàn thành',
  expired: 'Hết hạn',
  revoked: 'Đã thu hồi',
};

export function AssignmentStatusBadge({
  status,
}: {
  status: AssignmentStatus | AssignmentAttemptStatus | 'not_started' | 'revoked';
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'whitespace-nowrap font-semibold',
        (status === 'published' || status === 'completed') &&
          'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
        (status === 'draft' || status === 'not_started') &&
          'border-border bg-muted text-muted-foreground',
        status === 'in_progress' && 'border-blue-500/30 bg-blue-500/10 text-blue-300',
        (status === 'closed' || status === 'expired' || status === 'archived') &&
          'border-amber-500/30 bg-amber-500/10 text-amber-200',
        status === 'revoked' && 'border-red-500/30 bg-red-500/10 text-red-300',
      )}
    >
      {labels[status]}
    </Badge>
  );
}
