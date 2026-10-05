import { ArrowLeft, BarChart3, Check, Download, Trophy, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MedalIcon } from '@/components/game/MedalIcon';
import { MainContent, Page, PageLoading, Subtitle } from '@/components/layout';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import CreatorNav from '../../components/CreatorNav';
import { useAuthFetch } from '../../hooks/useAuthFetch';
import { useCreatorBase } from '../../hooks/useCreatorBase';
import type { Player, Question, Session } from '../../types';

interface FullSession {
  session: Session;
  players: Player[];
  questions: Question[];
  answers: Array<{
    player_id: number;
    username: string;
    question_id: number;
    chosen_index: number;
    is_correct: number;
    score: number;
    response_time_ms: number | null;
  }>;
}

function formatResponseTime(responseTimeMs: number | null | undefined): string {
  return responseTimeMs == null ? '—' : `${(responseTimeMs / 1000).toFixed(2)}s`;
}

function escapeCsvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const api = useAuthFetch();
  const basePath = useCreatorBase();
  const [data, setData] = useState<FullSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<FullSession>(`/api/admin/sessions/${id}`)
      .then(({ ok, data: d }) => {
        if (ok && d?.session) setData(d);
        else setError('Không thể tải phiên chơi này.');
      })
      .catch(() => setError('Không thể tải phiên chơi này.'));
  }, [api, id]);

  if (!data) return <PageLoading message={error ?? 'Đang tải…'} />;

  const { session, players, questions, answers } = data;
  const answerMap = new Map(answers.map((a) => [`${a.player_id}:${a.question_id}`, a]));

  const sortedPlayers = [...players].sort((a, b) => b.total_score - a.total_score);
  const playerStats = new Map(
    players.map((player) => {
      const playerAnswers = answers.filter((answer) => answer.player_id === player.id);
      const correct = playerAnswers.filter((answer) => answer.is_correct === 1).length;
      const responseTimes = playerAnswers
        .map((answer) => answer.response_time_ms)
        .filter((time): time is number => time != null);
      const averageResponseTimeMs = responseTimes.length
        ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length
        : null;

      return [
        player.id,
        {
          correct,
          wrong: questions.length - correct,
          averageResponseTimeMs,
        },
      ] as const;
    }),
  );

  function exportCsv() {
    const rows: Array<Array<string | number>> = [
      [
        'Player',
        'Question number',
        'Question text',
        'Correct/Incorrect',
        'Response time ms',
        'Response time seconds',
        'Score',
      ],
    ];

    for (const player of sortedPlayers) {
      questions.forEach((question, questionIndex) => {
        const answer = answerMap.get(`${player.id}:${question.id}`);
        const responseTimeMs = answer?.response_time_ms;
        rows.push([
          player.username,
          questionIndex + 1,
          question.text,
          answer?.is_correct === 1 ? 'Correct' : 'Incorrect',
          responseTimeMs ?? '',
          responseTimeMs == null ? '' : (responseTimeMs / 1000).toFixed(2),
          answer?.score ?? 0,
        ]);
      });
    }

    const csv = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `til-quiz-session-${session.id}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Page>
      <CreatorNav />
      <MainContent>
        <div className="mb-6 flex flex-wrap items-center gap-3 sm:gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link to={`${basePath}/history`}>
              <span className="flex items-center gap-1.5">
                <ArrowLeft className="size-4" /> Lịch sử
              </span>
            </Link>
          </Button>
          <div>
            <h1>{session.quiz_title}</h1>
            <Subtitle>
              Phiên <code className="font-mono text-blue-400">#{session.id}</code> · PIN{' '}
              <code className="font-mono text-blue-400">{session.pin}</code>
              {session.finished_at && ` · ${new Date(session.finished_at).toLocaleString('vi-VN')}`}
            </Subtitle>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={exportCsv}>
              <Download className="size-4" /> Xuất kết quả CSV
            </Button>
            <StatusBadge status={session.status} />
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-muted/30 p-5 text-center">
            <div className="text-3xl font-extrabold text-blue-400">{players.length}</div>
            <div className="mt-1 text-sm text-muted-foreground">Người chơi</div>
          </div>
          <div className="rounded-xl border border-border bg-muted/30 p-5 text-center">
            <div className="text-3xl font-extrabold text-blue-400">{questions.length}</div>
            <div className="mt-1 text-sm text-muted-foreground">Câu hỏi</div>
          </div>
          <div className="rounded-xl border border-border bg-muted/30 p-5 text-center">
            <div className="text-3xl font-extrabold text-blue-400">
              {sortedPlayers[0]?.total_score ?? 0}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">Điểm cao nhất</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Card>
            <CardContent className="p-6">
              <h2 className="mb-4 flex items-center gap-1.5">
                <Trophy className="size-4" /> Bảng xếp hạng cuối
              </h2>
              <ul className="leaderboard" style={{ gap: 6 }}>
                {sortedPlayers.map((p, i) => {
                  const stats = playerStats.get(p.id);
                  return (
                    <li key={p.id} className={`lb-item rank-${Math.min(i + 1, 4)}`}>
                      <div className="lb-rank">{i + 1}</div>
                      <div className="lb-name">
                        <div>{p.username}</div>
                        <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                          Đúng: {stats?.correct ?? 0} · Sai: {stats?.wrong ?? questions.length}{' '}
                          · Thời gian TB: {formatResponseTime(stats?.averageResponseTimeMs)}
                        </div>
                      </div>
                      <div className="lb-score text-right">
                        <div>{p.total_score.toLocaleString()}</div>
                        <div className="text-xs font-normal text-muted-foreground">Tổng điểm</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <h2 className="mb-4 flex items-center gap-1.5">
                <BarChart3 className="size-4" /> Phân tích câu hỏi
              </h2>
              {questions.map((q, qi) => {
                const qAnswers = players.map((p) => answerMap.get(`${p.id}:${q.id}`));
                const correct = qAnswers.filter((a) => a?.is_correct).length;
                const pct = players.length ? Math.round((correct / players.length) * 100) : 0;
                return (
                  <div key={q.id} className="mb-4">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-sm font-semibold">
                        Câu {qi + 1}: {q.text.slice(0, 60)}
                        {q.text.length > 60 ? '…' : ''}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {correct}/{players.length} ({pct}%)
                      </span>
                    </div>
                    <div className="answer-bar">
                      <div className="answer-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Thời gian: {q.time_sec} giây · Đáp án đúng: {q.options[q.correct_index]}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <Card className="mt-6 w-full max-w-6xl overflow-hidden">
          <CardContent className="p-6 pb-0">
            <h2>Ma trận câu trả lời</h2>
            <Subtitle>Kết quả của từng người chơi theo mỗi câu hỏi</Subtitle>
          </CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Người chơi</th>
                  {questions.map((q, i) => (
                    <th key={q.id} className="px-4 py-3 font-medium">
                      Câu {i + 1}
                    </th>
                  ))}
                  <th className="px-4 py-3 font-medium">Tổng điểm</th>
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map((p, pi) => (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <td className={`px-4 py-3 ${pi < 3 ? 'font-bold' : ''}`}>
                      <span className="inline-flex items-center gap-1.5">
                        <MedalIcon place={pi + 1} className="size-4" />
                        {p.username}
                      </span>
                    </td>
                    {questions.map((q) => {
                      const a = answerMap.get(`${p.id}:${q.id}`);
                      return (
                        <td key={q.id} className="px-4 py-3">
                          {a == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <div>
                              {a.is_correct ? (
                                <span className="inline-flex items-center gap-1 text-emerald-500">
                                  <Check className="size-4" /> +{a.score}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-destructive">
                                  <X className="size-4" /> +{a.score}
                                </span>
                              )}
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {formatResponseTime(a.response_time_ms)}
                              </div>
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 font-bold text-blue-400">
                      {p.total_score.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </MainContent>
    </Page>
  );
}
