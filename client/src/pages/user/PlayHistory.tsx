import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MainContent, Page, Subtitle } from '@/components/layout';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import UserNav from '@/components/UserNav';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type { PlayHistoryEntry } from '@/types';

function formatPlayed(g: PlayHistoryEntry): string {
  if (g.finished_at) return new Date(g.finished_at).toLocaleString('vi-VN');
  if (g.started_at) return new Date(g.started_at).toLocaleString('vi-VN');
  return new Date(g.created_at).toLocaleString('vi-VN');
}

export default function PlayHistory() {
  const api = useAuthFetch();
  const [games, setGames] = useState<PlayHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ games: PlayHistoryEntry[] }>('/api/auth/play-history')
      .then(({ ok, data }) => {
        if (ok && Array.isArray(data.games)) setGames(data.games);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api]);

  return (
    <Page>
      <UserNav />
      <MainContent>
        <h1>Lịch sử Live Game</h1>
        <Subtitle className="mb-6">Các trò chơi bạn đã tham gia</Subtitle>

        {loading ? (
          <p className="text-muted-foreground">Đang tải…</p>
        ) : games.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              <p className="mb-4">Bạn chưa tham gia Live Game nào.</p>
              <Button asChild>
                <a href="/play" target="_blank" rel="noopener">
                  Tham gia Live Game
                </a>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <ul className="divide-y divide-border rounded-xl border border-border md:hidden">
              {games.map((g) => (
                <li key={g.session_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{g.quiz_title}</span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">
                      PIN <code className="font-mono text-blue-400">{g.pin}</code> · #{g.rank}/
                      {g.player_count} · {g.total_score.toLocaleString('vi-VN')} điểm
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {formatPlayed(g)}
                    </span>
                  </div>
                  <StatusBadge status={g.status} className="shrink-0" />
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={`/u/my-games/${g.session_id}`}>
                      <span className="flex items-center gap-1.5">
                        Kết quả <ArrowRight className="size-4" />
                      </span>
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Quiz</th>
                    <th className="px-4 py-3 font-medium">PIN</th>
                    <th className="px-4 py-3 font-medium">Hạng</th>
                    <th className="px-4 py-3 font-medium">Điểm</th>
                    <th className="px-4 py-3 font-medium">Trạng thái</th>
                    <th className="px-4 py-3 font-medium">Thời gian</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {games.map((g) => (
                    <tr key={g.session_id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-semibold">{g.quiz_title}</td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-blue-400">{g.pin}</code>
                      </td>
                      <td className="px-4 py-3">
                        #{g.rank} / {g.player_count}
                      </td>
                      <td className="px-4 py-3">{g.total_score.toLocaleString('vi-VN')}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={g.status} />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatPlayed(g)}</td>
                      <td className="px-4 py-3">
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/u/my-games/${g.session_id}`}>
                            <span className="flex items-center gap-1.5">
                              Kết quả <ArrowRight className="size-4" />
                            </span>
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </MainContent>
    </Page>
  );
}
