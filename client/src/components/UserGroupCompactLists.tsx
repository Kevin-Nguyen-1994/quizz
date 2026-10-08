import { Eye, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import type { Quiz, Session } from '../types';

interface CompactQuizListProps {
  items: Quiz[];
  basePath: string;
  starting: number | null;
  deleting: number | null;
  previewing?: number | null;
  onStart: (quizId: number) => void;
  onDelete: (quizId: number) => void;
  onPreview?: (quizId: number) => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('vi-VN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function CompactQuizList({
  items,
  basePath,
  starting,
  deleting,
  previewing,
  onStart,
  onDelete,
  onPreview,
}: CompactQuizListProps) {
  return (
    <ul className="divide-y divide-border">
      {items.map((q) => (
        <li key={q.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/30">
          <div className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2 font-medium">
              <span className="truncate">{q.title}</span>
              {q.quiz_mode === 'bank_generated' && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  Bộ đề động
                </span>
              )}
            </span>
            <span className="block text-sm text-muted-foreground">
              {`${q.question_count} câu hỏi`} · {formatDate(q.created_at)}
            </span>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              variant="success"
              size="sm"
              onClick={() => onStart(q.id)}
              disabled={starting === q.id}
            >
              {starting === q.id ? (
                '…'
              ) : (
                <>
                  <Play className="size-4" /> Bắt đầu
                </>
              )}
            </Button>
            {onPreview && q.quiz_mode !== 'bank_generated' && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onPreview(q.id)}
                disabled={previewing === q.id}
                title="Xem trước bộ câu hỏi mà không tạo phiên chơi"
              >
                {previewing === q.id ? (
                  '…'
                ) : (
                  <>
                    <Eye className="size-4" /> Xem trước
                  </>
                )}
              </Button>
            )}
            <Button variant="secondary" size="sm" asChild>
              <Link to={`${basePath}/quiz/${q.id}/edit`}>Chỉnh sửa</Link>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onDelete(q.id)}
              disabled={deleting === q.id}
              title={`Xóa bộ câu hỏi ${q.title}`}
              className="text-destructive hover:bg-destructive/10"
            >
              Xóa
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

interface CompactSessionListProps {
  items: Session[];
  basePath: string;
}

export function CompactSessionList({ items, basePath }: CompactSessionListProps) {
  return (
    <ul className="divide-y divide-border">
      {items.map((s) => {
        const dur =
          s.started_at && s.finished_at
            ? Math.round(
                (new Date(s.finished_at).getTime() - new Date(s.started_at).getTime()) / 1000,
              )
            : null;

        return (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/30">
            <div className="min-w-0 flex-1">
              <span className="block truncate font-medium">{s.quiz_title}</span>
              <span className="block text-sm text-muted-foreground">
                PIN <code className="font-mono text-blue-400">{s.pin}</code> · {s.player_count ?? 0}{' '}
                người chơi
                {s.started_at ? ` · ${new Date(s.started_at).toLocaleDateString('vi-VN')}` : ''}
                {dur != null ? ` · ${Math.floor(dur / 60)} phút ${dur % 60} giây` : ''}
              </span>
            </div>
            <StatusBadge status={s.status} className="shrink-0" />
            <div className="flex shrink-0 gap-2">
              {s.status === 'finished' ? (
                <Button variant="secondary" size="sm" asChild>
                  <Link to={`${basePath}/sessions/${s.id}`}>Xem kết quả</Link>
                </Button>
              ) : (
                <Button size="sm" asChild>
                  <Link to={`${basePath}/game/${s.id}`}>Tiếp tục</Link>
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
