import { ArrowLeft, Clock3, LogOut, PlayCircle, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppAlert } from '@/components/AppAlert';
import { AssignmentAttemptReview } from '@/components/AssignmentAttemptReview';
import { AssignmentStatusBadge } from '@/components/AssignmentStatusBadge';
import { AppLogo, Page } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type {
  AssignmentAnswerSubmission,
  AssignmentAttemptDetail,
  ParticipantAssignmentLookup,
  ParticipantAttemptState,
} from '@/types';
import { AssignmentQuestion } from './AssignmentQuestion';

function dateTime(value: number | null) {
  return value === null ? 'Không giới hạn' : new Date(value).toLocaleString('vi-VN');
}

function duration(value: number | null) {
  if (value === null) return '—';
  const totalSeconds = Math.max(0, Math.round(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes > 0 ? `${minutes} phút ` : ''}${totalSeconds % 60} giây`;
}

function friendlyError(message?: string) {
  if (!message) return 'Không thể xử lý yêu cầu. Vui lòng thử lại.';
  if (message.includes('not found'))
    return 'Không tìm thấy bài kiểm tra hoặc bạn không có quyền truy cập.';
  if (message.includes('has not opened')) return 'Bài kiểm tra chưa đến thời gian mở.';
  if (message.includes('deadline')) return 'Bài kiểm tra đã hết hạn.';
  if (message.includes('not open')) return 'Bài kiểm tra hiện không mở.';
  if (message.includes('attempt')) return 'Bạn không còn lượt làm bài.';
  return 'Không thể xử lý yêu cầu. Vui lòng thử lại.';
}

export default function AssignmentPage() {
  const { accessCode = '' } = useParams();
  const api = useAuthFetch();
  const { appName } = useApp();
  const { user, logout } = useAuth();
  const [lookup, setLookup] = useState<ParticipantAssignmentLookup | null>(null);
  const [attempt, setAttempt] = useState<ParticipantAttemptState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [review, setReview] = useState<AssignmentAttemptDetail | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const timeoutSentFor = useRef<number | null>(null);

  const loadLookup = useCallback(async () => {
    setError('');
    const result = await api.get<ParticipantAssignmentLookup & { error?: string }>(
      `/api/assignments/${encodeURIComponent(accessCode)}`,
    );
    if (result.ok && result.data?.id) setLookup(result.data);
    else setError(friendlyError(result.data?.error));
    setLoading(false);
  }, [accessCode, api]);

  useEffect(() => {
    loadLookup().catch(() => {
      setError('Không thể kết nối máy chủ. Hãy kiểm tra mạng LAN và thử lại.');
      setLoading(false);
    });
  }, [loadLookup]);

  const applyAttemptState = useCallback((next: ParticipantAttemptState) => {
    setAttempt(next);
    setReview(null);
    setSubmitting(false);
    setError('');
    if (next.question) {
      setTimeLeft(Math.max(0, Math.ceil(next.question.remainingMs / 1000)));
      timeoutSentFor.current = null;
    }
  }, []);

  const sendTimeout = useCallback(async () => {
    const current = attempt;
    if (!current?.question || current.attempt.status !== 'in_progress') return;
    timeoutSentFor.current = current.question.questionId;
    setSubmitting(true);
    try {
      const result = await api.post<ParticipantAttemptState & { error?: string }>(
        `/api/assignments/attempts/${current.attempt.id}/timeout`,
        {},
      );
      if (result.ok && result.data?.attempt) {
        setNotice('Đã hết thời gian cho câu vừa rồi.');
        applyAttemptState(result.data);
        return;
      }
      setSubmitting(false);
      setError(friendlyError(result.data?.error));
    } catch {
      setSubmitting(false);
      setError('Mất kết nối với máy chủ. Câu trả lời chưa được gửi; vui lòng thử lại.');
    }
  }, [api, applyAttemptState, attempt]);

  useEffect(() => {
    const question = attempt?.question;
    if (!question || attempt.attempt.status !== 'in_progress') return;
    const serverOffsetMs = question.serverNowMs - Date.now();
    const endsAtServerMs = question.questionStartedAtMs + question.timeSec * 1000;
    const tick = () => {
      const remainingMs = endsAtServerMs - (Date.now() + serverOffsetMs);
      setTimeLeft(Math.max(0, Math.ceil(remainingMs / 1000)));
      if (remainingMs <= 0 && timeoutSentFor.current !== question.questionId) {
        void sendTimeout();
      }
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [attempt, sendTimeout]);

  async function startOrResume() {
    setSubmitting(true);
    setError('');
    try {
      const result = await api.post<ParticipantAttemptState & { error?: string }>(
        `/api/assignments/${encodeURIComponent(accessCode)}/start`,
        {},
      );
      if (result.ok && result.data?.attempt) {
        applyAttemptState(result.data);
        return;
      }
      setSubmitting(false);
      setError(friendlyError(result.data?.error));
    } catch {
      setSubmitting(false);
      setError('Không thể kết nối máy chủ. Hãy kiểm tra mạng LAN và thử lại.');
    }
  }

  async function openExistingAttempt() {
    if (!lookup?.attemptId) return;
    setSubmitting(true);
    try {
      const result = await api.get<ParticipantAttemptState & { error?: string }>(
        `/api/assignments/attempts/${lookup.attemptId}/current`,
      );
      if (result.ok && result.data?.attempt) {
        applyAttemptState(result.data);
        return;
      }
      setSubmitting(false);
      setError(friendlyError(result.data?.error));
    } catch {
      setSubmitting(false);
      setError('Không thể kết nối máy chủ. Hãy kiểm tra mạng LAN và thử lại.');
    }
  }

  async function submitAnswer(answer: AssignmentAnswerSubmission) {
    if (!attempt || submitting) return;
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const result = await api.post<ParticipantAttemptState & { error?: string }>(
        `/api/assignments/attempts/${attempt.attempt.id}/answers`,
        answer,
      );
      if (result.ok && result.data?.attempt) {
        if (result.data.duplicate) setNotice('Câu trả lời này đã được ghi nhận trước đó.');
        else if (result.data.timedOut)
          setNotice('Câu trả lời đến sau khi hết giờ và không được ghi nhận.');
        applyAttemptState(result.data);
        return;
      }
      setSubmitting(false);
      setError(friendlyError(result.data?.error));
    } catch {
      setSubmitting(false);
      setError('Mất kết nối với máy chủ. Câu trả lời chưa được gửi; vui lòng thử lại.');
    }
  }

  async function loadReview() {
    if (!attempt || reviewLoading) return;
    setReviewLoading(true);
    setError('');
    try {
      const result = await api.get<AssignmentAttemptDetail & { error?: string }>(
        `/api/assignments/attempts/${attempt.attempt.id}/review`,
      );
      if (result.ok && result.data?.attempt) setReview(result.data);
      else setError(friendlyError(result.data?.error));
    } catch {
      setError('Không thể kết nối máy chủ để tải phần xem lại.');
    } finally {
      setReviewLoading(false);
    }
  }

  const header = (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex min-h-14 max-w-5xl items-center gap-3 px-4">
        <AppLogo className="text-xl">{appName || 'TiL Quiz'}</AppLogo>
        <span className="hidden text-sm text-muted-foreground sm:inline">Bài kiểm tra cá nhân</span>
        <div className="flex-1" />
        <span className="hidden max-w-48 truncate text-sm sm:block">
          {user?.playDisplayName || user?.username}
        </span>
        <Button variant="ghost" size="sm" onClick={() => logout()}>
          <LogOut className="size-4" /> Đăng xuất
        </Button>
      </div>
    </header>
  );

  if (loading)
    return (
      <Page>
        {header}
        <div className="m-auto text-muted-foreground">Đang tải bài kiểm tra…</div>
      </Page>
    );

  if (attempt?.question && attempt.attempt.status === 'in_progress') {
    return (
      <Page>
        {header}
        {notice && (
          <div className="mx-auto mt-4 w-full max-w-3xl px-4">
            <AppAlert variant="info">{notice}</AppAlert>
          </div>
        )}
        {error && (
          <div className="mx-auto mt-4 w-full max-w-3xl px-4">
            <AppAlert variant="error">
              {error}{' '}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  attempt.question && timeLeft <= 0 ? sendTimeout() : openExistingAttempt()
                }
              >
                <RotateCcw className="size-4" /> Thử lại
              </Button>
            </AppAlert>
          </div>
        )}
        <AssignmentQuestion
          key={attempt.question.questionId}
          question={attempt.question}
          assignmentTitle={attempt.assignment.title}
          timeLeft={timeLeft}
          submitting={submitting}
          onSubmit={submitAnswer}
        />
      </Page>
    );
  }

  if (attempt && attempt.attempt.status !== 'in_progress') {
    const completed = attempt.attempt.status === 'completed';
    return (
      <Page>
        {header}
        <main className="m-auto w-full max-w-3xl px-4 py-8">
          <Card className="mx-auto max-w-lg">
            <CardContent className="p-6 text-center sm:p-8">
              <AssignmentStatusBadge status={attempt.attempt.status} />
              <h1 className="mt-4">
                {completed ? 'Đã hoàn thành bài kiểm tra' : 'Lượt làm đã kết thúc'}
              </h1>
              <p className="mt-2 text-muted-foreground">{attempt.assignment.title}</p>
              <div className="mt-6 grid grid-cols-2 gap-3 text-left">
                <div className="rounded-lg bg-muted p-3">
                  <span className="block text-xs text-muted-foreground">Bắt đầu</span>
                  <strong className="text-sm">{dateTime(attempt.attempt.startedAtMs)}</strong>
                </div>
                <div className="rounded-lg bg-muted p-3">
                  <span className="block text-xs text-muted-foreground">Hoàn thành</span>
                  <strong className="text-sm">{dateTime(attempt.attempt.completedAtMs)}</strong>
                </div>
                <div className="rounded-lg bg-muted p-3">
                  <span className="block text-xs text-muted-foreground">Thời gian làm</span>
                  <strong className="text-sm">{duration(attempt.attempt.elapsedTimeMs)}</strong>
                </div>
                <div className="rounded-lg bg-muted p-3">
                  <span className="block text-xs text-muted-foreground">Thời gian trả lời</span>
                  <strong className="text-sm">
                    {duration(attempt.attempt.activeAnsweringTimeMs)}
                  </strong>
                </div>
              </div>
              {attempt.reviewAvailable && attempt.attempt.totalScore !== undefined ? (
                <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                  <span className="block text-sm text-muted-foreground">Kết quả</span>
                  <strong className="text-2xl">{attempt.attempt.totalScore} điểm</strong>
                  <span className="mt-1 block text-sm">
                    {attempt.attempt.correctCount} câu đúng
                  </span>
                </div>
              ) : (
                <AppAlert variant="info" className="mt-4 mb-0">
                  Kết quả sẽ được công bố sau khi bài kiểm tra đóng hoặc hết hạn.
                </AppAlert>
              )}
              {attempt.reviewAvailable && !review && (
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-4 w-full"
                  disabled={reviewLoading}
                  onClick={loadReview}
                >
                  {reviewLoading ? 'Đang tải…' : 'Xem chi tiết đáp án'}
                </Button>
              )}
              <Button variant="ghost" className="mt-5" asChild>
                <Link to="/u">
                  <ArrowLeft className="size-4" /> Về trang cá nhân
                </Link>
              </Button>
            </CardContent>
          </Card>
          {error && (
            <AppAlert variant="error" className="mt-4">
              {error}
            </AppAlert>
          )}
          {review && (
            <div className="mt-6 text-left">
              <h2 className="mb-3 text-xl">Chi tiết đáp án</h2>
              <AssignmentAttemptReview detail={review} />
            </div>
          )}
        </main>
      </Page>
    );
  }

  return (
    <Page>
      {header}
      <main className="m-auto w-full max-w-lg px-4 py-8">
        {error && <AppAlert variant="error">{error}</AppAlert>}
        {lookup ? (
          <Card>
            <CardContent className="p-6 sm:p-8">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h1>{lookup.title}</h1>
                  <p className="mt-1 text-sm text-muted-foreground">Bài kiểm tra cá nhân</p>
                </div>
                <AssignmentStatusBadge status={lookup.status} />
              </div>
              <div className="mt-6 space-y-3 rounded-lg bg-muted p-4 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Số câu hỏi</span>
                  <strong>{lookup.questionCount}</strong>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Thời gian mở</span>
                  <strong className="text-right">{dateTime(lookup.opensAtMs)}</strong>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Hạn hoàn thành</span>
                  <strong className="text-right">{dateTime(lookup.deadlineAtMs)}</strong>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Số lượt đã dùng</span>
                  <strong>
                    {lookup.attemptsUsed}/{lookup.maxAttempts}
                  </strong>
                </div>
              </div>
              {lookup.participantStatus !== 'not_started' && (
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">Trạng thái của bạn</span>
                  <AssignmentStatusBadge status={lookup.participantStatus} />
                </div>
              )}
              <div className="mt-6">
                {lookup.canResume ? (
                  <Button
                    className="w-full"
                    size="lg"
                    disabled={submitting}
                    onClick={startOrResume}
                  >
                    <PlayCircle className="size-5" /> {submitting ? 'Đang mở…' : 'Tiếp tục làm bài'}
                  </Button>
                ) : lookup.canStart ? (
                  <Button
                    className="w-full"
                    size="lg"
                    disabled={submitting}
                    onClick={startOrResume}
                  >
                    <PlayCircle className="size-5" />{' '}
                    {submitting ? 'Đang bắt đầu…' : 'Bắt đầu làm bài'}
                  </Button>
                ) : lookup.attemptId ? (
                  <Button
                    className="w-full"
                    size="lg"
                    disabled={submitting}
                    onClick={openExistingAttempt}
                  >
                    <Clock3 className="size-5" />{' '}
                    {lookup.participantStatus === 'completed'
                      ? 'Xem kết quả'
                      : 'Xem trạng thái lượt làm'}
                  </Button>
                ) : (
                  <AppAlert variant="warn" className="mb-0">
                    Bài kiểm tra chưa mở, đã đóng hoặc đã hết hạn.
                  </AppAlert>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Button onClick={loadLookup}>
            <RotateCcw className="size-4" /> Thử tải lại
          </Button>
        )}
      </main>
    </Page>
  );
}
