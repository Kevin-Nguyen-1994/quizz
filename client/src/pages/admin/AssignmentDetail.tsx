import { ArrowLeft, Check, Copy, Download, ExternalLink, Eye } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppAlert } from '@/components/AppAlert';
import {
  AssignmentAttemptReview,
  formatDurationMs,
  questionTypeLabels,
  ResultBadge,
} from '@/components/AssignmentAttemptReview';
import { AssignmentStatusBadge } from '@/components/AssignmentStatusBadge';
import AdminNav from '@/components/AdminNav';
import { MainContent, Page, Subtitle } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDialog } from '@/context/DialogContext';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { authHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import type {
  AssignmentAttemptDetail,
  AssignmentAttemptReportRow,
  AssignmentParticipantReportRow,
  AssignmentQuestionDetail,
  AssignmentReport,
} from '@/types';

function dateTime(value: number | null) {
  return value === null ? '—' : new Date(value).toLocaleString('vi-VN');
}

function number(value: number, maximumFractionDigits = 2) {
  return value.toLocaleString('vi-VN', { maximumFractionDigits });
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}{' '}
      {copied ? 'Đã sao chép' : label}
    </Button>
  );
}

function MetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <strong className="text-2xl">{value}</strong>
        <p className="text-sm text-muted-foreground">{label}</p>
        {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}

type ParticipantAttemptRow = {
  participant: AssignmentParticipantReportRow;
  attempt: AssignmentAttemptReportRow | null;
};

export default function AssignmentDetail() {
  const { id } = useParams();
  const api = useAuthFetch();
  const { confirm } = useDialog();
  const [report, setReport] = useState<AssignmentReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attemptOpen, setAttemptOpen] = useState(false);
  const [attemptDetail, setAttemptDetail] = useState<AssignmentAttemptDetail | null>(null);
  const [attemptError, setAttemptError] = useState('');
  const [questionOpen, setQuestionOpen] = useState(false);
  const [questionDetail, setQuestionDetail] = useState<AssignmentQuestionDetail | null>(null);
  const [questionError, setQuestionError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const result = await api.get<AssignmentReport & { error?: string }>(
      `/api/admin/assignments/${id}/report`,
    );
    if (result.ok && result.data?.assignment) setReport(result.data);
    else setError(result.data?.error ?? 'Không thể tải báo cáo bài kiểm tra.');
    setLoading(false);
  }, [api, id]);

  useEffect(() => {
    load().catch(() => {
      setError('Không thể kết nối máy chủ.');
      setLoading(false);
    });
  }, [load]);

  const participantRows = useMemo<ParticipantAttemptRow[]>(
    () =>
      (report?.participants ?? []).flatMap((participant): ParticipantAttemptRow[] =>
        // Keep a synthetic row for assigned employees who have not started.
        participant.attempts.length
          ? participant.attempts.map((attempt) => ({ participant, attempt }))
          : [{ participant, attempt: null }],
      ),
    [report],
  );

  async function closeAssignment() {
    if (!report) return;
    const proceed = await confirm({
      title: 'Đóng bài kiểm tra?',
      message: 'Lượt đang làm sẽ kết thúc và nhân viên không thể bắt đầu lượt mới.',
      confirmText: 'Đóng bài kiểm tra',
      cancelText: 'Hủy',
      variant: 'danger',
    });
    if (!proceed) return;
    setBusy(true);
    try {
      const result = await api.post<{ error?: string }>(`/api/admin/assignments/${id}/close`, {});
      if (!result.ok) setError(result.data?.error ?? 'Không thể đóng bài kiểm tra.');
      else await load();
    } catch {
      setError('Không thể kết nối máy chủ.');
    } finally {
      setBusy(false);
    }
  }

  async function openAttempt(attemptId: number) {
    setAttemptOpen(true);
    setAttemptDetail(null);
    setAttemptError('');
    try {
      const result = await api.get<AssignmentAttemptDetail & { error?: string }>(
        `/api/admin/assignments/${id}/attempts/${attemptId}`,
      );
      if (result.ok && result.data?.attempt) setAttemptDetail(result.data);
      else setAttemptError(result.data?.error ?? 'Không thể tải chi tiết lượt làm.');
    } catch {
      setAttemptError('Không thể kết nối máy chủ.');
    }
  }

  async function openQuestion(questionId: number) {
    setQuestionOpen(true);
    setQuestionDetail(null);
    setQuestionError('');
    try {
      const result = await api.get<AssignmentQuestionDetail & { error?: string }>(
        `/api/admin/assignments/${id}/questions/${questionId}`,
      );
      if (result.ok && result.data?.question) setQuestionDetail(result.data);
      else setQuestionError(result.data?.error ?? 'Không thể tải phân tích câu hỏi.');
    } catch {
      setQuestionError('Không thể kết nối máy chủ.');
    }
  }

  async function exportCsv() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/assignments/${id}/export.csv`, {
        headers: authHeaders(api.token),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Không thể xuất CSV.');
        return;
      }
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'TiL_Quiz_Assignment.csv';
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Không thể kết nối máy chủ để xuất CSV.');
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <Page>
        <AdminNav />
        <MainContent>
          <p className="text-muted-foreground">Đang tải báo cáo…</p>
        </MainContent>
      </Page>
    );
  if (!report)
    return (
      <Page>
        <AdminNav />
        <MainContent>
          {error && <AppAlert variant="error">{error}</AppAlert>}
          <Button asChild>
            <Link to="/admin/assignments">Quay lại</Link>
          </Button>
        </MainContent>
      </Page>
    );

  const { assignment, overview } = report;
  const accessLink = assignment.accessCode
    ? `${window.location.origin}/assignment/${encodeURIComponent(assignment.accessCode)}`
    : '';

  return (
    <Page>
      <AdminNav />
      <MainContent>
        <Button variant="ghost" size="sm" asChild className="mb-3">
          <Link to="/admin/assignments">
            <ArrowLeft className="size-4" /> Danh sách
          </Link>
        </Button>
        {error && <AppAlert variant="error">{error}</AppAlert>}
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2">
              <AssignmentStatusBadge status={assignment.status} />
            </div>
            <h1>{assignment.title}</h1>
            <Subtitle className="mt-1">
              Bộ câu hỏi: {assignment.quizTitle ?? 'Bộ câu hỏi nguồn đã xóa'} ·{' '}
              {assignment.questionCount} câu · Tối đa {assignment.maxScore} điểm
            </Subtitle>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy} onClick={exportCsv}>
              <Download className="size-4" /> Xuất báo cáo CSV
            </Button>
            {assignment.status === 'draft' && (
              <Button asChild>
                <Link to={`/admin/assignments/${assignment.id}/edit`}>Chỉnh sửa & phát hành</Link>
              </Button>
            )}
            {assignment.status === 'published' && (
              <Button variant="destructive" disabled={busy} onClick={closeAssignment}>
                {busy ? 'Đang xử lý…' : 'Đóng bài kiểm tra'}
              </Button>
            )}
          </div>
        </div>

        {assignment.accessCode && (
          <Card className="mb-5">
            <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_auto_2fr_auto] md:items-center">
              <div>
                <span className="block text-xs text-muted-foreground">Mã truy cập</span>
                <code className="font-semibold">{assignment.accessCode}</code>
              </div>
              <CopyButton value={assignment.accessCode} label="Sao chép mã" />
              <div className="min-w-0">
                <span className="block text-xs text-muted-foreground">Liên kết</span>
                <span className="block truncate text-sm">{accessLink}</span>
              </div>
              <div className="flex gap-2">
                <CopyButton value={accessLink} label="Sao chép link" />
                <Button variant="ghost" size="sm" asChild>
                  <a href={accessLink} target="_blank" rel="noopener">
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="mb-5">
          <CardContent className="grid gap-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <span className="block text-muted-foreground">Loại bài</span>
              {assignment.assignmentKind === 'promotion'
                ? 'Thi lên bậc'
                : assignment.assignmentKind === 'periodic'
                  ? 'Kiểm tra định kỳ'
                  : 'Thông thường'}
            </div>
            <div>
              <span className="block text-muted-foreground">Đối tượng ban đầu</span>
              {assignment.targetMode === 'promotion'
                ? `${assignment.targetLevelCode ?? '—'} → ${assignment.promotionTargetLevelCode ?? '—'}`
                : assignment.targetMode === 'current_level'
                  ? (assignment.targetLevelCode ?? '—')
                  : 'Chọn thủ công'}
            </div>
            <div>
              <span className="block text-muted-foreground">Phương thức</span>
              {assignment.targetMode === 'promotion'
                ? 'Thi lên bậc'
                : assignment.targetMode === 'current_level'
                  ? 'Theo bậc hiện tại'
                  : 'Chọn thủ công'}
            </div>
            <div>
              <span className="block text-muted-foreground">Điều chỉnh thủ công</span>
              {assignment.overrideCount > 0 ? `${assignment.overrideCount} ngoại lệ` : 'Không có'}
            </div>
            <div>
              <span className="block text-muted-foreground">Thời gian mở</span>
              {dateTime(assignment.opensAtMs)}
            </div>
            <div>
              <span className="block text-muted-foreground">Hạn hoàn thành</span>
              {dateTime(assignment.deadlineAtMs)}
            </div>
            <div>
              <span className="block text-muted-foreground">Số lượt</span>
              {assignment.maxAttempts} lượt/người
            </div>
            <div>
              <span className="block text-muted-foreground">Cách chọn kết quả</span>
              {assignment.resultPolicy === 'highest_score'
                ? 'Điểm cao nhất'
                : 'Lượt hoàn thành gần nhất'}
            </div>
          </CardContent>
        </Card>

        <h2 className="mb-3 text-xl">Tổng quan</h2>
        <div className="mb-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <MetricCard label="Được giao" value={overview.assigned} />
          <MetricCard label="Chưa bắt đầu" value={overview.notStarted} />
          <MetricCard label="Đang làm" value={overview.inProgress} />
          <MetricCard label="Hoàn thành" value={overview.completed} />
          <MetricCard label="Hết hạn" value={overview.expired} />
          <MetricCard label="Tỷ lệ hoàn thành" value={`${number(overview.completionRate)}%`} />
          <MetricCard
            label="Điểm trung bình"
            value={number(overview.averageScore)}
            note={`Trên ${assignment.maxScore} điểm`}
          />
          <MetricCard
            label="Điểm trung bình (%)"
            value={`${number(overview.averageScorePercent)}%`}
          />
          <MetricCard
            label="Thời gian làm thực tế TB"
            value={formatDurationMs(overview.averageActiveAnsweringTimeMs)}
            note="Tổng thời gian xử lý câu hỏi; câu hết giờ tính theo giới hạn thời gian."
          />
          <MetricCard
            label="Từ bắt đầu đến nộp TB"
            value={formatDurationMs(overview.averageElapsedTimeMs)}
            note="Bao gồm cả thời gian nhân viên rời khỏi bài."
          />
        </div>

        <h2 className="mb-3 text-xl">Kết quả theo nhân viên</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          <strong>Từ bắt đầu đến nộp</strong> bao gồm thời gian rời khỏi bài.{' '}
          <strong>Thời gian làm thực tế</strong> là tổng thời gian xử lý câu hỏi, trong đó câu hết
          giờ tính theo giới hạn. <strong>Trả lời TB/câu</strong> chỉ tính các câu thực sự đã trả
          lời.
        </p>
        {participantRows.length === 0 ? (
          <Card className="mb-7">
            <CardContent className="p-8 text-center text-muted-foreground">
              Chưa có nhân viên được giao.
            </CardContent>
          </Card>
        ) : (
          <Card className="mb-7 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1500px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-3">Họ tên / Tên đăng nhập</th>
                    <th className="px-3 py-3">Trạng thái</th>
                    <th className="px-3 py-3">Lượt làm</th>
                    <th className="px-3 py-3">Bắt đầu</th>
                    <th className="px-3 py-3">Hoàn thành</th>
                    <th className="px-3 py-3">Đúng</th>
                    <th className="px-3 py-3">Sai</th>
                    <th className="px-3 py-3">Bỏ câu</th>
                    <th className="px-3 py-3">Điểm</th>
                    <th className="px-3 py-3">Tối đa</th>
                    <th className="px-3 py-3">%</th>
                    <th className="px-3 py-3" title="Bao gồm cả thời gian nhân viên rời khỏi bài">
                      Từ bắt đầu đến nộp
                    </th>
                    <th
                      className="px-3 py-3"
                      title="Tổng thời gian xử lý câu hỏi; câu hết giờ tính theo giới hạn thời gian"
                    >
                      Thời gian làm thực tế
                    </th>
                    <th className="px-3 py-3" title="Chỉ tính các câu thực sự đã trả lời">
                      Trả lời TB/câu
                    </th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {participantRows.map(({ participant, attempt }) => (
                    <tr
                      key={`${participant.memberId}-${attempt?.id ?? 'none'}`}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-3">
                        <strong className="block">{participant.name}</strong>
                        <span className="text-xs text-muted-foreground">
                          {participant.loginName}
                          {participant.email ? ` · ${participant.email}` : ''}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <AssignmentStatusBadge status={attempt?.status ?? 'not_started'} />
                      </td>
                      <td className="px-3 py-3">
                        {attempt ? (
                          <span>
                            #{attempt.attemptNumber}{' '}
                            {attempt.isSelected && (
                              <Badge variant="secondary" className="ml-1">
                                Kết quả chính
                              </Badge>
                            )}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {dateTime(attempt?.startedAtMs ?? null)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {dateTime(attempt?.completedAtMs ?? null)}
                      </td>
                      <td className="px-3 py-3">{attempt?.correct ?? 0}</td>
                      <td className="px-3 py-3">{attempt?.incorrect ?? 0}</td>
                      <td className="px-3 py-3">{attempt?.noAnswer ?? 0}</td>
                      <td className="px-3 py-3">{attempt?.score ?? 0}</td>
                      <td className="px-3 py-3">{attempt?.maxScore ?? assignment.maxScore}</td>
                      <td className="px-3 py-3">{number(attempt?.scorePercent ?? 0)}%</td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {formatDurationMs(attempt?.elapsedTimeMs ?? null)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {formatDurationMs(attempt?.activeAnsweringTimeMs ?? 0)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {formatDurationMs(attempt?.averageResponseTimeMs ?? null)}
                      </td>
                      <td className="px-3 py-3">
                        {attempt && (
                          <Button variant="ghost" size="sm" onClick={() => openAttempt(attempt.id)}>
                            <Eye className="size-4" /> Chi tiết
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <div className="mb-3">
          <h2 className="text-xl">Phân tích theo câu hỏi</h2>
          <Subtitle className="mt-1">Mặc định sắp xếp câu có tỷ lệ đúng thấp nhất trước.</Subtitle>
        </div>
        {report.questions.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              Chưa có dữ liệu câu hỏi.
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1250px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-3">Câu</th>
                    <th className="px-3 py-3">Nội dung</th>
                    <th className="px-3 py-3">Loại</th>
                    <th className="px-3 py-3">Mẫu</th>
                    <th className="px-3 py-3">Trả lời</th>
                    <th className="px-3 py-3">Đúng</th>
                    <th className="px-3 py-3">Sai</th>
                    <th className="px-3 py-3">Bỏ câu</th>
                    <th className="px-3 py-3">Tỷ lệ đúng</th>
                    <th className="px-3 py-3">Điểm TB</th>
                    <th className="px-3 py-3">Tối đa</th>
                    <th className="px-3 py-3" title="Chỉ tính các câu thực sự đã trả lời">
                      Trả lời TB/câu
                    </th>
                    <th className="px-3 py-3">Giới hạn</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {report.questions.map((question) => (
                    <tr key={question.questionId} className="border-b border-border last:border-0">
                      <td className="px-3 py-3 font-semibold">#{question.questionNumber}</td>
                      <td className="max-w-72 px-3 py-3">
                        <span className="line-clamp-2">{question.text}</span>
                      </td>
                      <td className="px-3 py-3">{questionTypeLabels[question.questionType]}</td>
                      <td className="px-3 py-3">{question.sampleSize}</td>
                      <td className="px-3 py-3">{question.answered}</td>
                      <td className="px-3 py-3">{question.correct}</td>
                      <td className="px-3 py-3">{question.incorrect}</td>
                      <td className="px-3 py-3">{question.noAnswer}</td>
                      <td
                        className={cn(
                          'px-3 py-3 font-semibold',
                          question.correctRate < 50
                            ? 'text-red-300'
                            : question.correctRate >= 80
                              ? 'text-emerald-300'
                              : 'text-amber-200',
                        )}
                      >
                        {number(question.correctRate)}%
                        <span className="block text-xs font-normal text-muted-foreground">
                          Trong người đã trả lời:{' '}
                          {question.correctRateAmongAnswered === null
                            ? '—'
                            : `${number(question.correctRateAmongAnswered)}%`}
                        </span>
                      </td>
                      <td className="px-3 py-3">{number(question.averageScore)}</td>
                      <td className="px-3 py-3">{question.maxScore}</td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {formatDurationMs(question.averageResponseTimeMs)}
                      </td>
                      <td className="px-3 py-3">{question.timeLimitSec}s</td>
                      <td className="px-3 py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openQuestion(question.questionId)}
                        >
                          <Eye className="size-4" /> Xem
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </MainContent>

      <Dialog open={attemptOpen} onOpenChange={setAttemptOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              Chi tiết lượt làm
              {attemptDetail
                ? ` · ${attemptDetail.participant.name} · ${attemptDetail.participant.loginName}`
                : ''}
            </DialogTitle>
            <DialogDescription>
              Câu trả lời, đáp án đúng, điểm và thời gian từng câu.
            </DialogDescription>
          </DialogHeader>
          {attemptError ? (
            <AppAlert variant="error">{attemptError}</AppAlert>
          ) : attemptDetail ? (
            <AssignmentAttemptReview detail={attemptDetail} />
          ) : (
            <p className="text-muted-foreground">Đang tải…</p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={questionOpen} onOpenChange={setQuestionOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {questionDetail
                ? `Câu ${questionDetail.question.questionNumber}: ${questionDetail.question.text}`
                : 'Phân tích câu hỏi'}
            </DialogTitle>
            <DialogDescription>
              {questionDetail
                ? `${questionTypeLabels[questionDetail.question.questionType]} · ${questionDetail.question.maxScore} điểm · ${questionDetail.question.timeLimitSec} giây`
                : 'Đang tải dữ liệu.'}
            </DialogDescription>
          </DialogHeader>
          {questionError ? (
            <AppAlert variant="error">{questionError}</AppAlert>
          ) : questionDetail ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-emerald-500/10 p-3 text-sm">
                <span className="block text-xs text-muted-foreground">Đáp án đúng</span>
                <span className="whitespace-pre-wrap">{questionDetail.question.correctAnswer}</span>
                {questionDetail.question.explanation && (
                  <p className="mt-2 border-t border-emerald-500/20 pt-2">
                    {questionDetail.question.explanation}
                  </p>
                )}
              </div>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[800px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-3 py-2">Nhân viên</th>
                      <th className="px-3 py-2">Lượt</th>
                      <th className="px-3 py-2">Câu trả lời</th>
                      <th className="px-3 py-2">Kết quả</th>
                      <th className="px-3 py-2">Điểm</th>
                      <th className="px-3 py-2">Thời gian</th>
                    </tr>
                  </thead>
                  <tbody>
                    {questionDetail.participants.map((participant) => (
                      <tr
                        key={participant.memberId}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-3 py-2">
                          <strong className="block">{participant.name}</strong>
                          <span className="text-xs text-muted-foreground">
                            {participant.loginName}
                            {participant.email ? ` · ${participant.email}` : ''}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {participant.attemptNumber ? `#${participant.attemptNumber}` : '—'}
                        </td>
                        <td className="max-w-72 whitespace-pre-wrap px-3 py-2">
                          {participant.submittedAnswer}
                        </td>
                        <td className="px-3 py-2">
                          <ResultBadge result={participant.result} />
                        </td>
                        <td className="px-3 py-2">
                          {participant.score}/{questionDetail.question.maxScore}
                        </td>
                        <td className="px-3 py-2">
                          {formatDurationMs(participant.responseTimeMs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">Đang tải…</p>
          )}
        </DialogContent>
      </Dialog>
    </Page>
  );
}
