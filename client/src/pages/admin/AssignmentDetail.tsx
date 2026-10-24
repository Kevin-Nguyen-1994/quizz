import { ArrowDown, ArrowLeft, ArrowUp, Check, Copy, Download, ExternalLink, Eye, RotateCcw, UserPlus } from 'lucide-react';
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
import { AssessmentAnalytics } from './components/AssessmentAnalytics';
import { ResultAdjustmentDialog } from './components/ResultAdjustmentDialog';
import { QuestionReplay } from './components/QuestionReplay';
import { AssignmentAppealsPanel, type AdminAppeal } from './components/AssignmentAppealsPanel';
import type {
  AssignmentAttemptDetail,
  AssignmentAttemptReportRow,
  AssignmentParticipantReportRow,
  AssignmentQuestionDetail,
  AssignmentReport,
  AdminAssignmentDetail,
  UserAccount,
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

type ParticipantSort = 'name' | 'completed' | 'correct' | 'incorrect' | 'noAnswer' | 'score' | 'percent' | 'activeTime';
type SortDirection = 'asc' | 'desc';

function searchKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLocaleLowerCase('vi-VN');
}

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
  const [questionReplay, setQuestionReplay] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [appealForAdjustment, setAppealForAdjustment] = useState<AdminAppeal | null>(null);
  const [appealRefreshKey, setAppealRefreshKey] = useState(0);
  const [detail, setDetail] = useState<AdminAssignmentDetail | null>(null);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const [participantSearch, setParticipantSearch] = useState('');
  const [participantStatus, setParticipantStatus] = useState('all');
  const [participantSort, setParticipantSort] = useState<ParticipantSort>('name');
  const [participantDirection, setParticipantDirection] = useState<SortDirection>('asc');

  const load = useCallback(async () => {
    setError('');
    const [result, detailResult, usersResult] = await Promise.all([
      api.get<AssignmentReport & { error?: string }>(`/api/admin/assignments/${id}/report`),
      api.get<AdminAssignmentDetail & { error?: string }>(`/api/admin/assignments/${id}`),
      api.get<{ users?: UserAccount[] }>('/api/admin/users'),
    ]);
    if (result.ok && result.data?.assignment) setReport(result.data);
    else setError(result.data?.error ?? 'Không thể tải báo cáo bài kiểm tra.');
    if (detailResult.ok && detailResult.data?.assignment) setDetail(detailResult.data);
    if (usersResult.ok) setUsers(usersResult.data?.users ?? []);
    setLoading(false);
  }, [api, id]);

  useEffect(() => {
    load().catch(() => {
      setError('Không thể kết nối máy chủ.');
      setLoading(false);
    });
  }, [load]);

  async function addRecipients() {
    if (!selectedUsers.length) return;
    setBusy(true); const result=await api.post<{error?:string}>(`/api/admin/assignments/${id}/recipients`,{userIds:selectedUsers});
    setBusy(false); if(!result.ok){setError(result.data?.error??'Không thể thêm người nhận.');return;} setAddOpen(false);setSelectedUsers([]);await load();
  }

  async function recipientAction(userId:number, action:'revoke'|'reassign', inProgress=false) {
    const approved=await confirm({title:action==='revoke'?'Thu hồi bài kiểm tra':'Giao lại bài kiểm tra',message:action==='revoke'?(inProgress?'Nhân viên đang làm bài. Thu hồi sẽ chấm dứt lượt làm hiện tại và nhân viên không thể tiếp tục xem nội dung hoặc kết quả bài kiểm tra.':'Thu hồi bài kiểm tra khỏi nhân viên này?'):'Nhân viên sẽ nhận một quyền làm bài mới trên cùng bộ câu hỏi đã phát hành.',confirmText:action==='revoke'?'Thu hồi bài':'Giao lại',variant:action==='revoke'?'danger':'default'}); if(!approved)return;
    setBusy(true);const result=await api.post<{error?:string}>(`/api/admin/assignments/${id}/recipients/${userId}/${action}`,{});setBusy(false);if(!result.ok)setError(result.data?.error??'Không thể cập nhật người nhận.');else await load();
  }

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

  const visibleParticipantRows = useMemo(() => {
    const query = searchKey(participantSearch.trim());
    const filtered = participantRows.filter(({ participant, attempt }) => {
      const status = attempt?.status ?? participant.status;
      return (participantStatus === 'all' || status === participantStatus) && (!query || searchKey(`${participant.name} ${participant.loginName} ${participant.email ?? ''}`).includes(query));
    });
    const numeric = (row: ParticipantAttemptRow) => {
      const attempt = row.attempt;
      if (!attempt) return null;
      if (participantSort === 'completed') return attempt.completedAtMs;
      if (participantSort === 'correct') return attempt.correct;
      if (participantSort === 'incorrect') return attempt.incorrect;
      if (participantSort === 'noAnswer') return attempt.noAnswer;
      if (participantSort === 'score') return attempt.score;
      if (participantSort === 'percent') return attempt.scorePercent;
      if (participantSort === 'activeTime') return attempt.activeAnsweringTimeMs;
      return null;
    };
    return filtered.map((row, index) => ({ row, index })).sort((left, right) => {
      if (participantSort === 'name') {
        const compared = left.row.participant.name.localeCompare(right.row.participant.name, 'vi');
        return participantDirection === 'asc' ? compared || left.index - right.index : -compared || left.index - right.index;
      }
      const a = numeric(left.row); const b = numeric(right.row);
      if (a === null) return b === null ? left.index - right.index : 1;
      if (b === null) return -1;
      const compared = a - b;
      return participantDirection === 'asc' ? compared || left.index - right.index : -compared || left.index - right.index;
    }).map(({ row }) => row);
  }, [participantRows, participantSearch, participantStatus, participantSort, participantDirection]);

  function setSort(next: ParticipantSort, defaultDirection: SortDirection = 'desc') {
    if (participantSort === next) setParticipantDirection((value) => value === 'asc' ? 'desc' : 'asc');
    else { setParticipantSort(next); setParticipantDirection(next === 'name' ? 'asc' : defaultDirection); }
  }

  function SortHeader({ label, value, defaultDirection }: { label: string; value: ParticipantSort; defaultDirection?: SortDirection }) {
    const active = participantSort === value;
    return <th className="px-3 py-3"><button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort(value, defaultDirection)}>{label}{active && (participantDirection === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}</button></th>;
  }

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
    setQuestionReplay(false);
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

        {assignment.status === 'published' && detail && (
          <Card className="mb-7">
            <CardContent className="p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl">Quản lý người nhận</h2><p className="text-sm text-muted-foreground">Thêm, thu hồi hoặc giao lại mà không thay đổi bộ câu hỏi đã phát hành.</p></div><Button onClick={()=>setAddOpen(true)}><UserPlus className="size-4" /> Thêm người nhận</Button></div>
              <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="py-2">Nhân viên</th><th>Level</th><th>Trạng thái</th><th>Nguồn giao</th><th /></tr></thead><tbody>{detail.members.map(member=><tr key={member.id} className="border-b last:border-0"><td className="py-3"><strong className="block">{member.display_name_snapshot}</strong><span className="text-xs text-muted-foreground">{member.login_name_snapshot}</span></td><td>{member.level_code_snapshot??'—'}</td><td><AssignmentStatusBadge status={member.participant_status} /></td><td>{member.membership_source==='manual_added_after_publish'?'Thêm sau phát hành':'Đối tượng ban đầu'}</td><td className="text-right">{member.recipient_status==='revoked'&&member.user_id?<Button size="sm" variant="secondary" onClick={()=>recipientAction(member.user_id as number,'reassign')}>Giao lại</Button>:member.participant_status!=='completed'&&member.user_id?<Button size="sm" variant="destructive" onClick={()=>recipientAction(member.user_id as number,'revoke',member.participant_status==='in_progress')}>Thu hồi</Button>:<span className="text-xs text-muted-foreground">Đã hoàn thành</span>}</td></tr>)}</tbody></table></div>
              {detail.recipientEvents.length>0&&<div className="mt-5 border-t pt-4"><h3 className="mb-2 text-base">Lịch sử người nhận</h3><div className="space-y-1 text-sm text-muted-foreground">{detail.recipientEvents.slice(0,10).map(event=><p key={event.id}>{dateTime(event.created_at_ms)} · {event.action==='revoked'?'Thu hồi':event.action==='reassigned'?'Giao lại':'Thêm sau phát hành'} · {event.actor_name_snapshot}{event.reason?` · ${event.reason}`:''}</p>)}</div></div>}
            </CardContent>
          </Card>
        )}

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
            <div className="flex flex-col gap-2 border-b p-4 lg:flex-row lg:items-center">
              <input value={participantSearch} onChange={(event) => setParticipantSearch(event.target.value)} placeholder="Tìm nhân viên..." className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm" />
              <select value={participantStatus} onChange={(event) => setParticipantStatus(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="all">Tất cả trạng thái</option><option value="completed">Hoàn thành</option><option value="in_progress">Đang làm</option><option value="not_started">Chưa bắt đầu</option><option value="expired">Hết hạn</option></select>
              <select value={`${participantSort}:${participantDirection}`} onChange={(event) => { const [sort, direction] = event.target.value.split(':') as [ParticipantSort, SortDirection]; setParticipantSort(sort); setParticipantDirection(direction); }} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="name:asc">Tên A → Z</option><option value="name:desc">Tên Z → A</option><option value="score:desc">Điểm cao → thấp</option><option value="score:asc">Điểm thấp → cao</option><option value="percent:desc">% cao → thấp</option><option value="percent:asc">% thấp → cao</option><option value="correct:desc">Số câu đúng cao → thấp</option><option value="noAnswer:desc">Timeout nhiều → ít</option><option value="completed:desc">Hoàn thành mới nhất</option><option value="completed:asc">Hoàn thành cũ nhất</option></select>
              <span className="text-sm text-muted-foreground">Hiển thị {visibleParticipantRows.length} / {participantRows.length} kết quả</span>
            </div>
            {visibleParticipantRows.length === 0 ? <CardContent className="p-8 text-center text-muted-foreground">Không tìm thấy nhân viên phù hợp.</CardContent> :
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1500px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <SortHeader label="Họ tên / Tên đăng nhập" value="name" defaultDirection="asc" />
                    <th className="px-3 py-3">Trạng thái</th>
                    <th className="px-3 py-3">Lượt làm</th>
                    <th className="px-3 py-3">Bắt đầu</th>
                    <SortHeader label="Hoàn thành" value="completed" />
                    <SortHeader label="Đúng" value="correct" />
                    <SortHeader label="Sai" value="incorrect" />
                    <SortHeader label="Bỏ câu" value="noAnswer" />
                    <SortHeader label="Điểm" value="score" />
                    <th className="px-3 py-3">Tối đa</th>
                    <SortHeader label="%" value="percent" />
                    <th className="px-3 py-3" title="Bao gồm cả thời gian nhân viên rời khỏi bài">
                      Từ bắt đầu đến nộp
                    </th>
                    <th
                      className="px-3 py-3"
                      title="Tổng thời gian xử lý câu hỏi; câu hết giờ tính theo giới hạn thời gian"
                    >
                      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort('activeTime')}>Thời gian làm thực tế{participantSort === 'activeTime' && (participantDirection === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}</button>
                    </th>
                    <th className="px-3 py-3" title="Chỉ tính các câu thực sự đã trả lời">
                      Trả lời TB/câu
                    </th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {visibleParticipantRows.map(({ participant, attempt }) => (
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
            </div>}
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

        <AssessmentAnalytics assignmentId={id} />
        {id && <AssignmentAppealsPanel key={appealRefreshKey} assignmentId={id} onAdjust={(appeal) => {
          setAppealForAdjustment(appeal);
          void openQuestion(appeal.assignment_question_id).then(() => setAdjustmentOpen(true));
        }} />}
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

      <Dialog open={addOpen} onOpenChange={setAddOpen}><DialogContent><DialogHeader><DialogTitle>Thêm người nhận</DialogTitle><DialogDescription>Chọn nhiều nhân viên. Người mới sẽ dùng đúng snapshot câu hỏi hiện tại.</DialogDescription></DialogHeader><select multiple className="min-h-64 w-full rounded-md border bg-background p-2" value={selectedUsers.map(String)} onChange={(event)=>setSelectedUsers(Array.from(event.currentTarget.selectedOptions).map(option=>Number(option.value)))}>{users.filter(user=>!user.is_banned&&!detail?.members.some(member=>member.user_id===user.id)).map(user=><option key={user.id} value={user.id}>{user.username} · {user.login_name} · {user.employee_level_code??'Chưa có level'}</option>)}</select><div className="flex justify-end gap-2"><Button variant="ghost" onClick={()=>setAddOpen(false)}>Hủy</Button><Button disabled={busy||!selectedUsers.length} onClick={addRecipients}>Thêm người nhận</Button></div></DialogContent></Dialog>

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
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant={questionReplay ? 'secondary' : 'outline'} onClick={() => setQuestionReplay((current) => !current)}>
                  <RotateCcw className="size-4" />
                  {questionReplay ? 'Quay về phân tích' : 'Mô phỏng câu hỏi'}
                </Button>
                {!questionReplay && (
                  <Button variant="secondary" onClick={() => { setAppealForAdjustment(null); setAdjustmentOpen(true); }}>
                    Điều chỉnh kết quả
                  </Button>
                )}
              </div>
              {questionReplay ? (
                <QuestionReplay
                  detail={questionDetail}
                  onAdjust={() => { setAppealForAdjustment(null); setAdjustmentOpen(true); }}
                />
              ) : (
                <>
              <div className="rounded-lg bg-emerald-500/10 p-3 text-sm">
                <span className="block text-xs text-muted-foreground">Đáp án đúng</span>
                <span className="whitespace-pre-wrap">{questionDetail.question.correctAnswer}</span>
                {questionDetail.question.explanation && (
                  <p className="mt-2 border-t border-emerald-500/20 pt-2">
                    {questionDetail.question.explanation}
                  </p>
                )}
              </div>
              {questionDetail.adjustments && questionDetail.adjustments.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                  <strong className="block">Lịch sử rà soát kết quả</strong>
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    {questionDetail.adjustments.map((adjustment) => (
                      <p key={adjustment.id}>
                        {dateTime(adjustment.created_at_ms)} · {adjustment.actor_name_snapshot} · {adjustment.reason_text} · {adjustment.affected_count} kết quả
                      </p>
                    ))}
                  </div>
                </div>
              )}
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
                          {participant.isAdjusted && <span className="ml-1 text-xs text-amber-300">(đã rà soát; gốc {participant.originalScore ?? 0})</span>}
                        </td>
                        <td className="px-3 py-2">
                          {formatDurationMs(participant.responseTimeMs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
                </>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">Đang tải…</p>
          )}
        </DialogContent>
      </Dialog>
      <ResultAdjustmentDialog
        assignmentId={id}
        detail={questionDetail}
        open={adjustmentOpen}
        onOpenChange={(open) => { setAdjustmentOpen(open); if (!open) setAppealForAdjustment(null); }}
        appeal={appealForAdjustment ? { id: appealForAdjustment.id, attemptId: appealForAdjustment.attempt_id, reasonCode: appealForAdjustment.reason_code } : null}
        onApplied={async () => {
          if (questionDetail) await openQuestion(questionDetail.question.id);
          await load();
          setAppealRefreshKey((value) => value + 1);
        }}
      />
    </Page>
  );
}
