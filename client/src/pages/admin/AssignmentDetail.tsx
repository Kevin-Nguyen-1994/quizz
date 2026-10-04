import { ArrowLeft, Check, Copy, ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppAlert } from '@/components/AppAlert';
import { AssignmentStatusBadge } from '@/components/AssignmentStatusBadge';
import AdminNav from '@/components/AdminNav';
import { MainContent, Page, Subtitle } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useDialog } from '@/context/DialogContext';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type { AdminAssignmentDetail } from '@/types';

function dateTime(value: number | null) {
  return value === null ? 'Không giới hạn' : new Date(value).toLocaleString('vi-VN');
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

export default function AssignmentDetail() {
  const { id } = useParams();
  const api = useAuthFetch();
  const { confirm } = useDialog();
  const [detail, setDetail] = useState<AdminAssignmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const result = await api.get<AdminAssignmentDetail & { error?: string }>(
      `/api/admin/assignments/${id}`,
    );
    if (result.ok && result.data?.assignment) setDetail(result.data);
    else setError(result.data?.error ?? 'Không thể tải bài kiểm tra.');
    setLoading(false);
  }, [api, id]);

  useEffect(() => {
    load().catch(() => {
      setError('Không thể kết nối máy chủ.');
      setLoading(false);
    });
  }, [load]);

  const progress = useMemo(() => {
    const members = detail?.members ?? [];
    return {
      assigned: members.length,
      notStarted: members.filter((member) => member.participant_status === 'not_started').length,
      inProgress: members.filter((member) => member.participant_status === 'in_progress').length,
      completed: members.filter((member) => member.participant_status === 'completed').length,
    };
  }, [detail]);

  async function closeAssignment() {
    if (!detail) return;
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

  if (loading)
    return (
      <Page>
        <AdminNav />
        <MainContent>
          <p className="text-muted-foreground">Đang tải…</p>
        </MainContent>
      </Page>
    );
  if (!detail)
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

  const { assignment } = detail;
  const accessLink = assignment.access_code
    ? `${window.location.origin}/assignment/${encodeURIComponent(assignment.access_code)}`
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
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2">
              <AssignmentStatusBadge status={assignment.status} />
            </div>
            <h1>{assignment.title}</h1>
            <Subtitle className="mt-1">
              Quiz: {assignment.quiz_title ?? 'Quiz nguồn đã xóa'} · {assignment.question_count} câu
            </Subtitle>
          </div>
          <div className="flex flex-wrap gap-2">
            {assignment.status === 'draft' && (
              <Button asChild>
                <Link to={`/admin/assignments/${assignment.id}/edit`}>Chỉnh sửa & phát hành</Link>
              </Button>
            )}
            {assignment.status === 'published' && (
              <Button variant="destructive" disabled={busy} onClick={closeAssignment}>
                {busy ? 'Đang đóng…' : 'Đóng bài kiểm tra'}
              </Button>
            )}
          </div>
        </div>

        {assignment.access_code && (
          <Card className="mb-5">
            <CardContent className="p-5">
              <h2 className="text-lg">Thông tin truy cập</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                <div className="min-w-0 rounded-lg bg-muted px-4 py-3">
                  <span className="block text-xs text-muted-foreground">Mã truy cập</span>
                  <code className="break-all text-base font-semibold">
                    {assignment.access_code}
                  </code>
                </div>
                <CopyButton value={assignment.access_code} label="Sao chép mã" />
                <div className="min-w-0 rounded-lg bg-muted px-4 py-3">
                  <span className="block text-xs text-muted-foreground">Liên kết</span>
                  <span className="block truncate text-sm">{accessLink}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <CopyButton value={accessLink} label="Sao chép liên kết" />
                  <Button variant="ghost" size="sm" asChild>
                    <a href={accessLink} target="_blank" rel="noopener">
                      <ExternalLink className="size-4" /> Mở
                    </a>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-5">
              <strong className="text-2xl">{progress.assigned}</strong>
              <p className="text-sm text-muted-foreground">Nhân viên được giao</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <strong className="text-2xl">{progress.notStarted}</strong>
              <p className="text-sm text-muted-foreground">Chưa bắt đầu</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <strong className="text-2xl">{progress.inProgress}</strong>
              <p className="text-sm text-muted-foreground">Đang làm</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <strong className="text-2xl">{progress.completed}</strong>
              <p className="text-sm text-muted-foreground">Đã hoàn thành</p>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-5">
          <CardContent className="grid gap-3 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <span className="block text-muted-foreground">Thời gian mở</span>
              {dateTime(assignment.opens_at_ms)}
            </div>
            <div>
              <span className="block text-muted-foreground">Hạn hoàn thành</span>
              {dateTime(assignment.deadline_at_ms)}
            </div>
            <div>
              <span className="block text-muted-foreground">Số lượt</span>
              {assignment.max_attempts} lượt/người
            </div>
            <div>
              <span className="block text-muted-foreground">Trộn nội dung</span>
              {assignment.shuffle_questions ? 'Câu hỏi' : 'Không'} ·{' '}
              {assignment.shuffle_options ? 'Đáp án' : 'Không trộn đáp án'}
            </div>
          </CardContent>
        </Card>

        <h2 className="mb-3 text-xl">Tiến độ nhân viên</h2>
        <div className="grid gap-3 md:hidden">
          {detail.members.map((member) => (
            <Card key={member.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <strong className="block truncate">{member.display_name_snapshot}</strong>
                    <span className="block truncate text-sm text-muted-foreground">
                      {member.email_snapshot}
                    </span>
                  </div>
                  <AssignmentStatusBadge status={member.participant_status} />
                </div>
                {member.started_at_ms && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Bắt đầu: {dateTime(member.started_at_ms)}
                    {member.completed_at_ms
                      ? ` · Hoàn thành: ${dateTime(member.completed_at_ms)}`
                      : ''}
                  </p>
                )}
                {member.participant_status === 'completed' && member.total_score !== null && (
                  <p className="mt-2 text-sm">
                    <strong>{member.total_score} điểm</strong> · {member.correct_count ?? 0} câu
                    đúng
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="hidden overflow-hidden md:block">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Nhân viên</th>
                  <th className="px-4 py-3 font-medium">Trạng thái</th>
                  <th className="px-4 py-3 font-medium">Bắt đầu</th>
                  <th className="px-4 py-3 font-medium">Hoàn thành</th>
                  <th className="px-4 py-3 font-medium">Đúng</th>
                  <th className="px-4 py-3 font-medium">Điểm</th>
                </tr>
              </thead>
              <tbody>
                {detail.members.map((member) => (
                  <tr key={member.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <strong className="block">{member.display_name_snapshot}</strong>
                      <span className="text-xs text-muted-foreground">{member.email_snapshot}</span>
                    </td>
                    <td className="px-4 py-3">
                      <AssignmentStatusBadge status={member.participant_status} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {member.started_at_ms ? dateTime(member.started_at_ms) : '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {member.completed_at_ms ? dateTime(member.completed_at_ms) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {member.participant_status === 'completed'
                        ? (member.correct_count ?? '—')
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {member.participant_status === 'completed'
                        ? (member.total_score ?? '—')
                        : '—'}
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
