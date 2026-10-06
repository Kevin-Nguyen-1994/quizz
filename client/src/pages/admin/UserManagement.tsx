import { Copy, Plus, TrendingUp } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { AppAlert } from '@/components/AppAlert';
import { EmptyState, MainContent, Page, PageHeader } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/Input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import AdminNav from '../../components/AdminNav';
import { useDialog } from '../../context/DialogContext';
import { useAuthFetch } from '../../hooks/useAuthFetch';
import type { EmployeeLevel, UserAccount } from '../../types';

type UserActionsProps = {
  user: UserAccount;
  actionId: number | null;
  onUnban: (id: number) => void;
  onBan: (id: number) => void;
  onReset: (id: number) => void;
  onDelete: (id: number) => void;
  onChangeLevel: (user: UserAccount) => void;
};

/** Employee actions shared between the mobile list and desktop table. */
function UserActions({
  user,
  actionId,
  onUnban,
  onBan,
  onReset,
  onDelete,
  onChangeLevel,
}: UserActionsProps) {
  const busy = actionId === user.id;
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => onChangeLevel(user)}
      >
        <TrendingUp className="size-4" /> Đổi bậc
      </Button>
      {user.is_banned ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => onUnban(user.id)}
        >
          Mở khóa
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => onBan(user.id)}
        >
          Khóa
        </Button>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => onReset(user.id)}
      >
        Đặt lại mật khẩu
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => onDelete(user.id)}
        className="text-destructive"
      >
        Xóa
      </Button>
    </>
  );
}

function LevelBadge({ user }: { user: UserAccount }) {
  return user.employee_level_id ? (
    <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-300">
      {user.employee_level_code ?? user.employee_level_name ?? 'Đã phân bậc'}
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Chưa phân bậc
    </Badge>
  );
}

export default function UserManagement() {
  const api = useAuthFetch();
  const { confirm } = useDialog();
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [levels, setLevels] = useState<EmployeeLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState<{
    loginName: string;
    password: string;
  } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loginName, setLoginName] = useState('');
  const [username, setUsername] = useState('');
  const [initialPassword, setInitialPassword] = useState('');
  const [createLevelId, setCreateLevelId] = useState('none');
  const [levelUser, setLevelUser] = useState<UserAccount | null>(null);
  const [nextLevelId, setNextLevelId] = useState('none');
  const [levelReason, setLevelReason] = useState('');
  const [changingLevel, setChangingLevel] = useState(false);
  const [levelError, setLevelError] = useState('');
  const [error, setError] = useState('');
  const [createError, setCreateError] = useState('');

  const load = useCallback(async () => {
    const [userResult, levelResult] = await Promise.all([
      api.get<{ users?: UserAccount[] }>('/api/admin/users'),
      api.get<{ levels?: EmployeeLevel[] }>('/api/admin/employee-levels'),
    ]);
    if (!userResult.ok || !levelResult.ok) {
      setError('Không thể tải danh sách nhân viên.');
      setLoading(false);
      return;
    }
    setUsers(userResult.data?.users ?? []);
    setLevels((levelResult.data?.levels ?? []).filter((level) => level.is_active === 1));
    setLoading(false);
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  async function banUser(id: number) {
    const selected = users.find((user) => user.id === id);
    const proceed = await confirm({
      title: `Khóa nhân viên ${selected?.username ?? `#${id}`}?`,
      message: 'Nhân viên sẽ không thể đăng nhập cho đến khi được mở khóa.',
      confirmText: 'Khóa nhân viên',
      cancelText: 'Hủy',
      variant: 'danger',
    });
    if (!proceed) return;
    setActionId(id);
    await api.post(`/api/admin/users/${id}/ban`);
    setActionId(null);
    load();
  }

  async function unbanUser(id: number) {
    setActionId(id);
    await api.post(`/api/admin/users/${id}/unban`);
    setActionId(null);
    load();
  }

  async function resetUserPassword(id: number) {
    const selected = users.find((user) => user.id === id);
    const proceed = await confirm({
      title: `Đặt lại mật khẩu cho ${selected?.username ?? `#${id}`}?`,
      message: 'Hệ thống sẽ tạo mật khẩu mới và chỉ hiển thị một lần.',
      confirmText: 'Tạo mật khẩu mới',
    });
    if (!proceed) return;
    setActionId(id);
    const { ok, data } = await api.post<{ password?: string; error?: string }>(
      `/api/admin/users/${id}/reset-password`,
      {},
    );
    setActionId(null);
    if (ok && data?.password) {
      setResetPassword({ loginName: selected?.login_name ?? `#${id}`, password: data.password });
    } else setError(data?.error ?? 'Không thể đặt lại mật khẩu.');
  }

  async function deleteUser(id: number) {
    const selected = users.find((user) => user.id === id);
    const ok = await confirm({
      title: `Xóa nhân viên ${selected?.username ?? `#${id}`}?`,
      message: 'Các quiz của tài khoản sẽ được giữ lại nhưng không còn chủ sở hữu.',
      confirmText: 'Xóa',
      variant: 'danger',
    });
    if (!ok) return;
    setActionId(id);
    await api.delete(`/api/admin/users/${id}`);
    setActionId(null);
    load();
  }

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setCreateError('');
    setCreating(true);
    const { ok, data } = await api.post<{ user?: UserAccount; error?: string }>(
      '/api/admin/users',
      {
        loginName,
        username,
        password: initialPassword,
      },
    );
    setCreating(false);
    if (!ok || !data?.user) {
      setCreateError(data?.error ?? 'Không thể tạo nhân viên.');
      return;
    }
    if (createLevelId !== 'none') {
      const levelResult = await api.patch<{ error?: string }>(
        `/api/admin/users/${data.user.id}/level`,
        {
          employeeLevelId: Number(createLevelId),
          expectedCurrentLevelId: null,
          reason: 'Phân bậc khi tạo tài khoản',
        },
      );
      if (!levelResult.ok) {
        setError(
          `Đã tạo nhân viên nhưng chưa gán được bậc: ${levelResult.data?.error ?? 'lỗi không xác định'}`,
        );
      }
    }
    setLoginName('');
    setUsername('');
    setInitialPassword('');
    setCreateLevelId('none');
    setCreateOpen(false);
    await load();
  }

  function openLevelDialog(user: UserAccount) {
    setLevelUser(user);
    setNextLevelId(user.employee_level_id ? String(user.employee_level_id) : 'none');
    setLevelReason('');
    setLevelError('');
  }

  async function changeLevel() {
    if (!levelUser) return;
    const requestedId = nextLevelId === 'none' ? null : Number(nextLevelId);
    setChangingLevel(true);
    setLevelError('');
    const result = await api.patch<{ error?: string; code?: string }>(
      `/api/admin/users/${levelUser.id}/level`,
      {
        employeeLevelId: requestedId,
        expectedCurrentLevelId: levelUser.employee_level_id,
        reason: levelReason,
      },
    );
    setChangingLevel(false);
    if (!result.ok) {
      setLevelError(
        result.data?.code === 'EMPLOYEE_LEVEL_CHANGED'
          ? 'Bậc của nhân viên đã được thay đổi bởi phiên khác. Vui lòng tải lại dữ liệu.'
          : (result.data?.error ?? 'Không thể đổi bậc nhân viên.'),
      );
      return;
    }
    setLevelUser(null);
    await load();
  }

  async function copyResetPassword() {
    if (!resetPassword) return;
    await navigator.clipboard.writeText(resetPassword.password);
  }

  return (
    <Page>
      <AdminNav />
      <MainContent>
        <PageHeader
          title="Quản lý nhân viên"
          description="Quản lý tài khoản nhân viên sử dụng TiL Quiz."
          actions={
            <Button
              type="button"
              onClick={() => {
                setCreateError('');
                setCreateOpen(true);
              }}
            >
              <Plus className="size-4" /> Tạo nhân viên
            </Button>
          }
        />

        {error && <AppAlert variant="error">{error}</AppAlert>}
        {resetPassword && (
          <AppAlert variant="success">
            Mật khẩu mới cho <strong>{resetPassword.loginName}</strong>:{' '}
            <code>{resetPassword.password}</code>. Hãy sao chép ngay; mật khẩu này sẽ không được
            hiển thị lại.
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-2"
              onClick={copyResetPassword}
            >
              <Copy className="size-4" /> Sao chép
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setResetPassword(null)}>
              Đóng
            </Button>
          </AppAlert>
        )}

        {loading ? (
          <p className="text-muted-foreground">Đang tải…</p>
        ) : users.length === 0 ? (
          <EmptyState
            title="Chưa có nhân viên"
            description="Tạo tài khoản để giao bài kiểm tra và theo dõi kết quả."
          />
        ) : (
          <>
            <ul className="divide-y divide-border rounded-xl border border-border md:hidden">
              {users.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{u.username}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {u.login_name}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Tạo ngày {new Date(u.created_at).toLocaleDateString('vi-VN')}
                    </span>
                    <span className="mt-2 block">
                      <LevelBadge user={u} />
                    </span>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      'shrink-0 font-semibold uppercase',
                      u.is_banned
                        ? 'border-border bg-muted text-muted-foreground'
                        : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
                    )}
                  >
                    {u.is_banned ? 'Đã khóa' : 'Hoạt động'}
                  </Badge>
                  <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                    <UserActions
                      user={u}
                      actionId={actionId}
                      onUnban={unbanUser}
                      onBan={banUser}
                      onReset={resetUserPassword}
                      onDelete={deleteUser}
                      onChangeLevel={openLevelDialog}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <Card className="hidden w-full max-w-6xl overflow-hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Họ tên</th>
                      <th className="px-4 py-3 font-medium">Tên đăng nhập</th>
                      <th className="px-4 py-3 font-medium">Bậc</th>
                      <th className="px-4 py-3 font-medium">Trạng thái</th>
                      <th className="px-4 py-3 text-right font-medium">Hành động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3">{u.username}</td>
                        <td className="max-w-[200px] truncate px-4 py-3">{u.login_name}</td>
                        <td className="px-4 py-3">
                          <LevelBadge user={u} />
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={cn(
                              'font-semibold uppercase',
                              u.is_banned
                                ? 'border-border bg-muted text-muted-foreground'
                                : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
                            )}
                          >
                            {u.is_banned ? 'Đã khóa' : 'Hoạt động'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <UserActions
                              user={u}
                              actionId={actionId}
                              onUnban={unbanUser}
                              onBan={banUser}
                              onReset={resetUserPassword}
                              onDelete={deleteUser}
                              onChangeLevel={openLevelDialog}
                            />
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

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Tạo nhân viên</DialogTitle>
              <DialogDescription>
                Tạo tài khoản nội bộ. Email không bắt buộc và nhân viên không thể tự đăng ký.
              </DialogDescription>
            </DialogHeader>
            {createError && <AppAlert variant="error">{createError}</AppAlert>}
            <form id="create-employee-form" onSubmit={createUser}>
              <Input
                id="employee-login-name"
                label="Tên đăng nhập"
                autoComplete="off"
                maxLength={64}
                pattern="[A-Za-z0-9._-]+"
                hint="Chỉ dùng chữ cái không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang."
                required
                value={loginName}
                onChange={(event) => setLoginName(event.target.value)}
              />
              <Input
                id="employee-full-name"
                label="Họ tên"
                autoComplete="off"
                maxLength={100}
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <Input
                id="employee-initial-password"
                label="Mật khẩu ban đầu"
                type="password"
                autoComplete="new-password"
                minLength={6}
                required
                value={initialPassword}
                onChange={(event) => setInitialPassword(event.target.value)}
              />
              <div className="space-y-2">
                <Label>Bậc hiện tại</Label>
                <Select value={createLevelId} onValueChange={setCreateLevelId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Chưa phân bậc</SelectItem>
                    {levels.map((level) => (
                      <SelectItem key={level.id} value={String(level.id)}>
                        {level.code} — {level.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </form>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Hủy
              </Button>
              <Button type="submit" form="create-employee-form" disabled={creating}>
                {creating ? 'Đang tạo…' : 'Tạo nhân viên'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={levelUser !== null} onOpenChange={(open) => !open && setLevelUser(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Đổi bậc nhân viên</DialogTitle>
              <DialogDescription>
                {levelUser
                  ? `Chuyển ${levelUser.username} từ ${levelUser.employee_level_code ?? 'Chưa phân bậc'} sang ${nextLevelId === 'none' ? 'Chưa phân bậc' : (levels.find((level) => level.id === Number(nextLevelId))?.code ?? 'bậc mới')}?`
                  : ''}
              </DialogDescription>
            </DialogHeader>
            {levelError && <AppAlert variant="error">{levelError}</AppAlert>}
            <div className="space-y-2">
              <Label>Bậc mới</Label>
              <Select value={nextLevelId} onValueChange={setNextLevelId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Chưa phân bậc</SelectItem>
                  {levels.map((level) => (
                    <SelectItem key={level.id} value={String(level.id)}>
                      {level.code} — {level.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="employee-level-reason">Lý do (không bắt buộc)</Label>
              <Textarea
                id="employee-level-reason"
                value={levelReason}
                onChange={(event) => setLevelReason(event.target.value)}
                maxLength={500}
                placeholder="Ví dụ: Được quản lý xác nhận nâng bậc"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setLevelUser(null)}>
                Hủy
              </Button>
              <Button
                type="button"
                onClick={changeLevel}
                disabled={
                  changingLevel ||
                  !levelUser ||
                  (nextLevelId === 'none' ? null : Number(nextLevelId)) ===
                    levelUser.employee_level_id
                }
              >
                {changingLevel ? 'Đang lưu…' : 'Xác nhận đổi bậc'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </MainContent>
    </Page>
  );
}
