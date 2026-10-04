import { ClipboardList, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppAlert } from '@/components/AppAlert';
import { AssignmentStatusBadge } from '@/components/AssignmentStatusBadge';
import AdminNav from '@/components/AdminNav';
import { MainContent, Page, Subtitle } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useDialog } from '@/context/DialogContext';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type { AdminAssignmentListItem } from '@/types';

function dateTime(value: number | null) {
  return value === null ? 'Không giới hạn' : new Date(value).toLocaleString('vi-VN');
}

export default function Assignments() {
  const api = useAuthFetch();
  const { confirm } = useDialog();
  const [items, setItems] = useState<AdminAssignmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError('');
    const { ok, data } = await api.get<{ assignments?: AdminAssignmentListItem[]; error?: string }>(
      '/api/admin/assignments',
    );
    if (ok) setItems(data?.assignments ?? []);
    else setError(data?.error ?? 'Không thể tải danh sách bài kiểm tra.');
    setLoading(false);
  }, [api]);

  useEffect(() => {
    load().catch(() => {
      setError('Không thể kết nối máy chủ.');
      setLoading(false);
    });
  }, [load]);

  async function closeAssignment(item: AdminAssignmentListItem) {
    const proceed = await confirm({
      title: 'Đóng bài kiểm tra?',
      message: `Những lượt đang làm “${item.title}” sẽ kết thúc và không thể bắt đầu lượt mới.`,
      confirmText: 'Đóng bài kiểm tra',
      cancelText: 'Hủy',
      variant: 'danger',
    });
    if (!proceed) return;
    setBusyId(item.id);
    try {
      const { ok, data } = await api.post<{ error?: string }>(
        `/api/admin/assignments/${item.id}/close`,
        {},
      );
      if (!ok) setError(data?.error ?? 'Không thể đóng bài kiểm tra.');
      else await load();
    } catch {
      setError('Không thể kết nối máy chủ.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Page>
      <AdminNav />
      <MainContent>
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1>Bài kiểm tra cá nhân</h1>
            <Subtitle className="mt-1">Giao quiz để nhân viên làm độc lập theo thời hạn.</Subtitle>
          </div>
          <Button asChild>
            <Link to="/admin/assignments/new">
              <Plus className="size-4" /> Tạo bài kiểm tra
            </Link>
          </Button>
        </div>

        {error && <AppAlert variant="error">{error}</AppAlert>}
        {loading ? (
          <p className="text-muted-foreground">Đang tải…</p>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="px-6 py-12 text-center">
              <ClipboardList className="mx-auto mb-3 size-10 text-muted-foreground" />
              <h2>Chưa có bài kiểm tra</h2>
              <Subtitle className="mt-2">Tạo bài kiểm tra từ một quiz đã có.</Subtitle>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-3 md:hidden">
              {items.map((item) => (
                <Card key={item.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-base">{item.title}</h2>
                        <p className="truncate text-sm text-muted-foreground">
                          {item.quiz_title ?? 'Quiz đã xóa'}
                        </p>
                      </div>
                      <AssignmentStatusBadge status={item.status} />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                      <div>
                        <strong className="block">{item.member_count}</strong>
                        <span className="text-xs text-muted-foreground">Được giao</span>
                      </div>
                      <div>
                        <strong className="block">{item.started_count}</strong>
                        <span className="text-xs text-muted-foreground">Đã bắt đầu</span>
                      </div>
                      <div>
                        <strong className="block">{item.completed_count}</strong>
                        <span className="text-xs text-muted-foreground">Hoàn thành</span>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Mở: {dateTime(item.opens_at_ms)} · Hạn: {dateTime(item.deadline_at_ms)}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" asChild>
                        <Link to={`/admin/assignments/${item.id}`}>Chi tiết</Link>
                      </Button>
                      {item.status === 'draft' && (
                        <Button size="sm" variant="secondary" asChild>
                          <Link to={`/admin/assignments/${item.id}/edit`}>Chỉnh sửa</Link>
                        </Button>
                      )}
                      {item.status === 'published' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === item.id}
                          onClick={() => closeAssignment(item)}
                        >
                          Đóng
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="hidden overflow-hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Bài kiểm tra</th>
                      <th className="px-4 py-3 font-medium">Trạng thái</th>
                      <th className="px-4 py-3 font-medium">Thời gian</th>
                      <th className="px-4 py-3 font-medium">Tiến độ</th>
                      <th className="px-4 py-3 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3">
                          <strong className="block">{item.title}</strong>
                          <span className="text-xs text-muted-foreground">
                            {item.quiz_title ?? 'Quiz đã xóa'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <AssignmentStatusBadge status={item.status} />
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <span className="block">Mở: {dateTime(item.opens_at_ms)}</span>
                          <span className="block">Hạn: {dateTime(item.deadline_at_ms)}</span>
                        </td>
                        <td className="px-4 py-3">
                          {item.member_count} giao · {item.started_count} bắt đầu ·{' '}
                          {item.completed_count} xong
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" asChild>
                              <Link to={`/admin/assignments/${item.id}`}>Chi tiết</Link>
                            </Button>
                            {item.status === 'draft' && (
                              <Button size="sm" variant="secondary" asChild>
                                <Link to={`/admin/assignments/${item.id}/edit`}>Chỉnh sửa</Link>
                              </Button>
                            )}
                            {item.status === 'published' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busyId === item.id}
                                onClick={() => closeAssignment(item)}
                              >
                                Đóng
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </MainContent>
    </Page>
  );
}
