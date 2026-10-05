import { ArrowRight, BarChart3 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, MainContent, Page, PageHeader } from '@/components/layout';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import CreatorNav from '../../components/CreatorNav';
import { CompactSessionList } from '../../components/UserGroupCompactLists';
import { UserGroupPanel } from '../../components/UserGroupPanel';
import { useAuth } from '../../context/AuthContext';
import { groupSessionsByHost } from '../../helpers/groupByOwner';
import { useAuthFetch } from '../../hooks/useAuthFetch';
import { useCreatorBase } from '../../hooks/useCreatorBase';
import type { Session } from '../../types';

export default function History() {
  const { isSuperAdmin } = useAuth();
  const api = useAuthFetch();
  const basePath = useCreatorBase();
  const showGroupedByUser = basePath === '/admin' && isSuperAdmin;
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'finished' | 'active' | 'waiting'>('all');

  useEffect(() => {
    api
      .get<Session[]>('/api/admin/sessions')
      .then(({ ok, data }) => {
        if (ok && Array.isArray(data)) setSessions(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api]);

  const filtered = useMemo(
    () => (filter === 'all' ? sessions : sessions.filter((s) => s.status === filter)),
    [sessions, filter],
  );

  const sessionGroups = useMemo(
    () => (showGroupedByUser ? groupSessionsByHost(filtered) : []),
    [showGroupedByUser, filtered],
  );

  function renderSessionRow(s: Session) {
    const dur =
      s.started_at && s.finished_at
        ? Math.round((new Date(s.finished_at).getTime() - new Date(s.started_at).getTime()) / 1000)
        : null;

    return (
      <tr key={s.id} className="border-b border-border last:border-0">
        <td className="px-4 py-3">
          <span className="font-semibold">{s.quiz_title}</span>
        </td>
        <td className="px-4 py-3">
          <code className="font-mono text-blue-400">{s.pin}</code>
        </td>
        <td className="px-4 py-3">{s.player_count ?? '—'}</td>
        <td className="px-4 py-3">
          <StatusBadge status={s.status} />
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground">
          {s.started_at ? new Date(s.started_at).toLocaleString('vi-VN') : '—'}
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground">
          {dur != null ? `${Math.floor(dur / 60)} phút ${dur % 60} giây` : '—'}
        </td>
        <td className="px-4 py-3">
          {s.status === 'finished' ? (
            <Button variant="ghost" size="sm" asChild>
              <Link to={`${basePath}/sessions/${s.id}`}>
                <span className="flex items-center gap-1.5">
                  Xem kết quả <ArrowRight className="size-4" />
                </span>
              </Link>
            </Button>
          ) : (
            <Button size="sm" asChild>
              <Link to={`${basePath}/game/${s.id}`}>
                <span className="flex items-center gap-1.5">
                  Tiếp tục <ArrowRight className="size-4" />
                </span>
              </Link>
            </Button>
          )}
        </td>
      </tr>
    );
  }

  function renderSessionTable(items: Session[]) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Bộ câu hỏi</th>
              <th className="px-4 py-3 font-medium">PIN</th>
              <th className="px-4 py-3 font-medium">Người chơi</th>
              <th className="px-4 py-3 font-medium">Trạng thái</th>
              <th className="px-4 py-3 font-medium">Bắt đầu</th>
              <th className="px-4 py-3 font-medium">Thời lượng</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>{items.map(renderSessionRow)}</tbody>
        </table>
      </div>
    );
  }

  return (
    <Page>
      <CreatorNav />
      <MainContent>
        <PageHeader
          title="Lịch sử Live Game"
          description={`${sessions.length} phiên${showGroupedByUser && sessionGroups.length > 0 ? ` · ${sessionGroups.length} người tổ chức` : ''}`}
          actions={
          <div className="flex flex-wrap gap-2">
            {(['all', 'active', 'waiting', 'finished'] as const).map((f) => (
              <Button
                type="button"
                key={f}
                variant={filter === f ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setFilter(f)}
              >
                {{ all: 'Tất cả', active: 'Đang chơi', waiting: 'Đang chờ', finished: 'Đã kết thúc' }[f]}
              </Button>
            ))}
          </div>
          }
        />

        {loading ? (
          <p className="text-muted-foreground">Đang tải…</p>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<BarChart3 className="size-10" />} title="Chưa có phiên chơi" description="Bắt đầu Live Game từ trang Bộ câu hỏi để xem lịch sử tại đây." />
        ) : showGroupedByUser ? (
          <div className="flex flex-col gap-4">
            {sessionGroups.map((group, index) => (
              <UserGroupPanel
                key={group.key}
                email={group.email}
                username={group.username}
                count={group.items.length}
                countLabel="phiên"
                defaultOpen={index === 0}
              >
                <CompactSessionList items={group.items} basePath={basePath} />
              </UserGroupPanel>
            ))}
          </div>
        ) : (
          <>
            <Card className="w-full max-w-6xl overflow-hidden md:hidden">
              <CompactSessionList items={filtered} basePath={basePath} />
            </Card>
            <Card className="hidden w-full max-w-6xl overflow-hidden md:block">
              {renderSessionTable(filtered)}
            </Card>
          </>
        )}
      </MainContent>
    </Page>
  );
}
