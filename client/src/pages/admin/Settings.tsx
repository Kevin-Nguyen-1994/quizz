import {
  Check,
  FolderTree,
  Layers3,
  Lock,
  Pencil,
  Smile,
  Target,
  Timer,
  Trash2,
  Upload,
} from 'lucide-react';
import { type ChangeEvent, useEffect, useState } from 'react';
import { AppAlert } from '@/components/AppAlert';
import { BrandLogo } from '@/components/BrandLogo';
import { FormRow, MainContent, Page, PageHeader, PageLoading } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Input as FileInput } from '@/components/ui/input';
import { invalidateAvatarCache } from '@/lib/avatars';
import { cn } from '@/lib/utils';
import AdminNav from '../../components/AdminNav';
import { Input, IntegerInput } from '../../components/Input';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../context/DialogContext';
import { useAuthFetch } from '../../hooks/useAuthFetch';
import type { AppConfig } from '../../types';
import { EmployeeLevelCatalog } from './components/EmployeeLevelCatalog';
import { QuestionCategoryCatalog } from './components/QuestionCategoryCatalog';
import { SettingsFieldGroup, SettingsSection, SettingsToggle } from './components/SettingsSection';

const NAV_SECTIONS = [
  { id: 'branding', label: 'Giao diện', icon: Pencil },
  { id: 'gameplay', label: 'Live Game', icon: Timer },
  { id: 'scoring', label: 'Tính điểm', icon: Target },
  { id: 'avatars', label: 'Ảnh đại diện', icon: Smile },
  { id: 'employee-levels', label: 'Cấp bậc', icon: Layers3 },
  { id: 'question-categories', label: 'Danh mục câu hỏi', icon: FolderTree },
  { id: 'security', label: 'Bảo mật', icon: Lock },
] as const;

function computeSpeedBonus(position: number, totalPlayers: number, max: number, min: number) {
  if (totalPlayers <= 1) return max;
  return Math.max(Math.round(max - (max - min) * (position / (totalPlayers - 1))), min);
}

function SpeedBonusPreview({ max, min }: { max: number; min: number }) {
  const examples = [5, 10, 20];
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        Xem trước điểm thưởng tốc độ
      </p>
      <div className="flex flex-wrap gap-4 text-sm">
        {examples.map((n) => (
          <div key={n} className="flex flex-col gap-0.5">
            <strong>{n} người chơi</strong>
            {Array.from({ length: Math.min(n, 5) }, (_, i) => {
              const bonus = computeSpeedBonus(i, n, max, min);
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: stable list based on player count
                <span key={i}>
                  Hạng {i + 1} = {bonus}
                  {i < Math.min(n, 5) - 1 ? ', ' : ''}
                </span>
              );
            })}
            {n > 5 && (
              <span className="text-muted-foreground">
                {' '}
                … hạng {n} = {computeSpeedBonus(n - 1, n, max, min)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BrandingPreview({ appName, appSubtitle }: { appName: string; appSubtitle: string }) {
  const name = appName.trim();
  const logo = name || 'TiL Quiz';

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        Xem trước màn hình tham gia
      </p>
      <div className="py-4 text-center">
        <BrandLogo className="justify-center" productName={logo} />
        <div className="mt-3 text-lg font-bold text-foreground">{logo}</div>
        {appSubtitle.trim() && (
          <p className="text-sm font-medium text-foreground mt-2">{appSubtitle.trim()}</p>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  const { isSuperAdmin, logout } = useAuth();
  const { alert, confirm } = useDialog();
  const api = useAuthFetch();
  const [cfg, setCfg] = useState<Partial<AppConfig> | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adminUsername, setAdminUsername] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [uploadingAvatars, setUploadingAvatars] = useState(false);
  const [avatarUploadMessage, setAvatarUploadMessage] = useState<string | null>(null);
  const [availableAvatars, setAvailableAvatars] = useState<string[] | null>(null);
  const [avatarsError, setAvatarsError] = useState<string | null>(null);
  const [deletingAvatar, setDeletingAvatar] = useState<string | null>(null);
  const [dbAdmins, setDbAdmins] = useState<
    { id: number; username: string; created_at: string; last_password_change: string | null }[]
  >([]);
  const [resetPasswords, setResetPasswords] = useState<Record<number, string>>({});
  const [resettingId, setResettingId] = useState<number | null>(null);

  useEffect(() => {
    api.get<AppConfig>('/api/admin/config').then(({ ok, data }) => {
      if (ok && data) setCfg(data);
    });

    api.get<{ username?: string }>('/api/admin/me').then(({ ok, data }) => {
      if (ok && data?.username) setAdminUsername(data.username);
    });

    fetch('/api/avatars')
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load avatars');
        return r.json();
      })
      .then((urls: string[]) => {
        setAvailableAvatars(urls);
        setAvatarsError(null);
      })
      .catch(() => {
        setAvailableAvatars([]);
        setAvatarsError('Không thể tải danh sách ảnh đại diện hiện tại.');
      });

    if (isSuperAdmin) {
      api
        .get<{ admins?: typeof dbAdmins }>('/api/admin/admins')
        .then(({ ok, data }) => {
          if (ok && data?.admins) setDbAdmins(data.admins);
        })
        .catch(() => {});
    }
  }, [api, isSuperAdmin]);

  async function changePassword() {
    if (!currentPassword) {
      await alert({ message: 'Vui lòng nhập mật khẩu hiện tại.' });
      return;
    }
    if (!newPassword && !newUsername) {
      await alert({ message: 'Vui lòng nhập tên đăng nhập hoặc mật khẩu mới.' });
      return;
    }

    setChangingPassword(true);
    try {
      const body: Record<string, string> = { currentPassword };
      if (newPassword) body.newPassword = newPassword;
      if (newUsername && newUsername !== adminUsername) body.newUsername = newUsername;

      const { ok, data } = await api.post<{ error?: string }>('/api/admin/change-password', body);

      if (!ok) {
        await alert({ message: data?.error || 'Không thể đổi thông tin đăng nhập.' });
        return;
      }

      await alert({
        title: 'Đã cập nhật thông tin đăng nhập',
        message: 'Vui lòng đăng nhập lại.',
      });
      await logout();
      window.location.href = '/login';
    } catch (error) {
      console.error('Password change failed:', error);
      await alert({ message: 'Không thể đổi thông tin đăng nhập.' });
    } finally {
      setChangingPassword(false);
      setCurrentPassword('');
      setNewPassword('');
      setNewUsername('');
    }
  }

  async function save() {
    if (!cfg) return;
    setSaving(true);
    const { ok } = await api.put('/api/admin/config', { ...cfg });
    setSaving(false);
    if (!ok) {
      await alert({ message: 'Không thể lưu cài đặt.' });
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function handleAvatarBulkUpload(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setAvatarUploadMessage(null);
    setUploadingAvatars(true);

    try {
      const toDataUrl = (file: File) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsDataURL(file);
        });

      const dataUrls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const url = await toDataUrl(files[i] as File);
        dataUrls.push(url);
      }

      const { ok, data: payload } = await api.post<{ error?: string; urls?: string[] }>(
        '/api/admin/avatars/bulk',
        { dataUrls },
      );

      if (!ok) {
        throw new Error(payload?.error || 'Upload failed');
      }

      const urls = Array.isArray(payload?.urls) ? payload.urls : [];
      const created = urls.length;

      if (urls.length > 0) {
        setAvailableAvatars((prev) => [...(prev ?? []), ...urls]);
      }

      setAvatarUploadMessage(
        created > 0
          ? `Đã tải lên ${created} ảnh đại diện mới.`
          : 'Đã tải lên nhưng không tạo được ảnh đại diện mới.',
      );
    } catch (err) {
      console.error(err);
      setAvatarUploadMessage('Không thể tải ảnh đại diện. Vui lòng kiểm tra định dạng tệp.');
    } finally {
      setUploadingAvatars(false);
      e.target.value = '';
    }
  }

  async function handleDeleteAvatar(url: string) {
    const ok = await confirm({
      title: 'Xóa ảnh đại diện?',
      message: 'Người chơi đã chọn ảnh này vẫn giữ ảnh cho đến khi họ thay đổi.',
      confirmText: 'Xóa ảnh',
      variant: 'danger',
    });
    if (!ok) return;

    setDeletingAvatar(url);
    setAvatarUploadMessage(null);
    const { ok: deleted, data } = await api.delete<{ error?: string }>('/api/admin/avatars', {
      url,
    });
    setDeletingAvatar(null);

    if (!deleted) {
      setAvatarUploadMessage(data?.error ?? 'Không thể xóa ảnh đại diện.');
      return;
    }

    setAvailableAvatars((prev) => (prev ?? []).filter((u) => u !== url));
    invalidateAvatarCache();
    setAvatarUploadMessage('Đã xóa ảnh đại diện.');
  }

  function update<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setCfg((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  if (!cfg) {
    return <PageLoading nav={<AdminNav />} />;
  }

  const streakEnabled = cfg.streakBonusEnabled ?? true;

  return (
    <Page>
      <AdminNav />
      <MainContent>
        <PageHeader
          title="Cài đặt"
          description="Cấu hình giao diện, Live Game, tính điểm và quyền quản trị."
          actions={
            <Button type="button" onClick={save} disabled={saving} size="lg">
              {saving ? (
                'Đang lưu…'
              ) : saved ? (
                <span className="flex items-center gap-1.5">
                  <Check className="size-4" /> Đã lưu
                </span>
              ) : (
                'Lưu thay đổi'
              )}
            </Button>
          }
        />

        {saved && <AppAlert variant="success">Đã lưu cài đặt thành công.</AppAlert>}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_1fr]">
          <nav
            className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:sticky lg:top-20 lg:flex lg:flex-col lg:self-start"
            aria-label="Các nhóm cài đặt"
          >
            {NAV_SECTIONS.map(({ id, label, icon: Icon }) => (
              <a
                key={id}
                href={`#${id}`}
                className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </a>
            ))}
          </nav>

          <div className="flex min-w-0 flex-col gap-6">
            <SettingsSection
              id="employee-levels"
              icon={Layers3}
              title="Cấp bậc nhân viên"
              description="Quản lý danh mục bậc dùng cho nhân viên, bộ câu hỏi và bài kiểm tra."
            >
              <EmployeeLevelCatalog />
            </SettingsSection>
            <SettingsSection
              id="question-categories"
              icon={FolderTree}
              title="Danh mục câu hỏi"
              description="Quản lý nhóm chủ đề lớn dùng trong Ngân hàng câu hỏi."
            >
              <QuestionCategoryCatalog />
            </SettingsSection>
            <SettingsSection
              id="branding"
              icon={Pencil}
              title="Giao diện"
              description="Tùy chỉnh tên và nội dung hiển thị trên màn hình tham gia."
            >
              <Input
                label="Tên tổ chức / sự kiện"
                placeholder="Để trống để dùng TiL Quiz"
                value={cfg.appName ?? ''}
                onChange={(e) => update('appName', e.target.value)}
                hint="Tên chính của ứng dụng; để trống để hiển thị TiL Quiz."
              />
              <Input
                label="Mô tả trang tham gia"
                placeholder="Ví dụ: Đào tạo & Kiểm tra nội bộ"
                value={cfg.appSubtitle ?? ''}
                onChange={(e) => update('appSubtitle', e.target.value)}
                noMargin
                hint="Hiển thị dưới tên ứng dụng; để trống để ẩn."
              />
              <BrandingPreview appName={cfg.appName ?? ''} appSubtitle={cfg.appSubtitle ?? ''} />
            </SettingsSection>

            <SettingsSection
              id="gameplay"
              icon={Timer}
              title="Live Game"
              description="Thời gian và giới hạn mặc định cho phiên chơi mới."
            >
              <FormRow>
                <IntegerInput
                  label="Thời gian mỗi câu (giây)"
                  min={5}
                  max={120}
                  value={cfg.questionTimeSec ?? 20}
                  onValueChange={(value) => update('questionTimeSec', value)}
                />
                <IntegerInput
                  label="Số người chơi tối đa"
                  min={2}
                  max={500}
                  value={cfg.maxPlayersPerSession ?? 50}
                  onValueChange={(value) => update('maxPlayersPerSession', value)}
                />
              </FormRow>

              <SettingsFieldGroup
                title="Màn hình kết quả"
                description="Thời gian hiển thị trước khi tự chuyển. Đặt 0 để quản trị viên tự chuyển."
              >
                <IntegerInput
                  id="results-auto-advance-sec"
                  label="Thời lượng (giây)"
                  min={0}
                  max={60}
                  value={cfg.resultsAutoAdvanceSec ?? 5}
                  onValueChange={(value) => update('resultsAutoAdvanceSec', value)}
                  noMargin
                />
              </SettingsFieldGroup>

              <SettingsFieldGroup
                title="Sau trò chơi"
                description="Nội dung hiển thị sau khi phiên chơi kết thúc."
              >
                <SettingsToggle
                  id="choose-quiz-maker"
                  label="Chọn người tạo bộ câu hỏi tiếp theo"
                  description="Hiển thị công cụ chọn ngẫu nhiên một người chơi trên màn hình tổng kết."
                  checked={cfg.chooseQuizMaker ?? false}
                  onChange={(v) => update('chooseQuizMaker', v)}
                />
              </SettingsFieldGroup>
            </SettingsSection>

            <SettingsSection
              id="scoring"
              icon={Target}
              title="Tính điểm"
              description="Điểm cho câu trả lời đúng, tốc độ và chuỗi trả lời đúng."
            >
              <SettingsFieldGroup title="Điểm cơ bản">
                <IntegerInput
                  label="Điểm cơ bản mỗi câu"
                  min={0}
                  step={50}
                  value={cfg.defaultBaseScore ?? 500}
                  onValueChange={(value) => update('defaultBaseScore', value)}
                  noMargin
                />
              </SettingsFieldGroup>

              <SettingsFieldGroup
                title="Điểm thưởng tốc độ"
                description="Thưởng thêm theo thứ tự trả lời đúng; người đúng đầu tiên nhận mức cao nhất."
              >
                <FormRow>
                  <IntegerInput
                    label="Thưởng tối đa (đúng đầu tiên)"
                    min={0}
                    step={10}
                    value={cfg.speedBonusMax ?? 200}
                    onValueChange={(value) => update('speedBonusMax', value)}
                    noMargin
                  />
                  <IntegerInput
                    label="Thưởng tối thiểu (đúng cuối cùng)"
                    min={0}
                    step={5}
                    value={cfg.speedBonusMin ?? 10}
                    onValueChange={(value) => update('speedBonusMin', value)}
                    noMargin
                  />
                </FormRow>
                <SpeedBonusPreview max={cfg.speedBonusMax ?? 200} min={cfg.speedBonusMin ?? 10} />
              </SettingsFieldGroup>

              <SettingsFieldGroup
                title="Thưởng chuỗi trả lời đúng"
                description="Thưởng người chơi trả lời đúng nhiều câu liên tiếp."
              >
                <SettingsToggle
                  id="streakEnabled"
                  label="Bật thưởng chuỗi"
                  description="Cộng thêm điểm khi trả lời đúng liên tiếp."
                  checked={streakEnabled}
                  onChange={(checked) => update('streakBonusEnabled', checked)}
                />
                <FormRow>
                  <IntegerInput
                    label="Bắt đầu thưởng từ"
                    min={2}
                    max={10}
                    value={cfg.streakMinimum ?? 2}
                    onValueChange={(value) => update('streakMinimum', value)}
                    disabled={!streakEnabled}
                    hint="Số câu đúng liên tiếp tối thiểu để bắt đầu nhận thưởng."
                  />
                  <IntegerInput
                    label="Điểm mỗi cấp chuỗi"
                    min={0}
                    step={10}
                    value={cfg.streakBonusBase ?? 50}
                    onValueChange={(value) => update('streakBonusBase', value)}
                    disabled={!streakEnabled}
                    hint="Ví dụ 50 → chuỗi 3: +50, chuỗi 4: +100…"
                    noMargin
                  />
                </FormRow>
              </SettingsFieldGroup>
            </SettingsSection>

            <SettingsSection
              id="avatars"
              icon={Smile}
              title="Thư viện ảnh đại diện"
              description="Tải ảnh để người chơi chọn làm ảnh đại diện."
            >
              <label
                htmlFor="avatar-upload"
                className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/20 p-8 transition hover:border-blue-500/50 hover:bg-muted/40"
              >
                <FileInput
                  id="avatar-upload"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleAvatarBulkUpload}
                  disabled={uploadingAvatars}
                  className="hidden"
                />
                <Upload className="size-10 text-muted-foreground" aria-hidden />
                <span className="font-semibold">
                  {uploadingAvatars ? 'Đang tải lên…' : 'Bấm để tải ảnh đại diện'}
                </span>
                <span className="text-center text-xs text-muted-foreground">
                  PNG, JPG, GIF, SVG hoặc WebP · ảnh vuông khoảng 128×128 hiển thị tốt nhất
                </span>
              </label>

              {avatarUploadMessage && (
                <AppAlert variant="info" className="mt-4">
                  {avatarUploadMessage}
                </AppAlert>
              )}

              <SettingsFieldGroup title="Ảnh đại diện hiện có">
                {availableAvatars === null && !avatarsError && (
                  <p className="text-sm text-muted-foreground">Đang tải ảnh đại diện…</p>
                )}
                {avatarsError && <p className="text-sm text-muted-foreground">{avatarsError}</p>}
                {availableAvatars && availableAvatars.length === 0 && !avatarsError && (
                  <p className="text-sm text-muted-foreground">
                    Chưa có ảnh đại diện. Hãy tải ảnh lên ở khu vực phía trên.
                  </p>
                )}
                {availableAvatars && availableAvatars.length > 0 && (
                  <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
                    {availableAvatars.map((url) => (
                      <div
                        key={url}
                        className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted"
                      >
                        <img src={url} alt="" className="h-full w-full object-cover" />
                        <button
                          type="button"
                          aria-label="Xóa ảnh đại diện"
                          disabled={deletingAvatar === url}
                          onClick={() => handleDeleteAvatar(url)}
                          className={cn(
                            'absolute right-1 top-1 flex size-7 items-center justify-center rounded-md border border-border bg-background/90 text-muted-foreground opacity-0 shadow-sm transition hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100 focus-visible:opacity-100',
                            deletingAvatar === url && 'opacity-100',
                          )}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </SettingsFieldGroup>
            </SettingsSection>

            <SettingsSection
              id="security"
              icon={Lock}
              title="Bảo mật"
              description={
                isSuperAdmin
                  ? 'Quản lý tài khoản quản trị lưu trong cơ sở dữ liệu.'
                  : 'Cập nhật tên đăng nhập và mật khẩu quản trị.'
              }
            >
              {isSuperAdmin ? (
                <>
                  <AppAlert variant="warn" className="mb-4">
                    Bạn đang đăng nhập bằng tài khoản quản trị hệ thống. Mật khẩu được quản lý qua
                    biến môi trường <code>ADMIN_PASSWORD</code>.
                  </AppAlert>

                  {dbAdmins.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Không có tài khoản quản trị cơ sở dữ liệu.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-4">
                      {dbAdmins.map((admin) => (
                        <div
                          key={admin.id}
                          className="grid grid-cols-1 items-end gap-3 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-[1fr_1fr_auto]"
                        >
                          <div className="pb-2 font-semibold text-sm sm:pb-0">{admin.username}</div>
                          <Input
                            label="Mật khẩu mới"
                            type="password"
                            autoComplete="new-password"
                            placeholder="Nhập mật khẩu mới"
                            value={resetPasswords[admin.id] || ''}
                            onChange={(e) =>
                              setResetPasswords((prev) => ({
                                ...prev,
                                [admin.id]: e.target.value,
                              }))
                            }
                            noMargin
                          />
                          <Button
                            type="button"
                            size="sm"
                            disabled={resettingId === admin.id || !resetPasswords[admin.id]}
                            onClick={async () => {
                              setResettingId(admin.id);
                              try {
                                const { ok, data: err } = await api.post<{ error?: string }>(
                                  `/api/admin/admins/${admin.id}/reset-password`,
                                  { newPassword: resetPasswords[admin.id] },
                                );
                                if (ok) {
                                  await alert({
                                    message: `Đã đặt lại mật khẩu cho ${admin.username}.`,
                                  });
                                  setResetPasswords((prev) => ({ ...prev, [admin.id]: '' }));
                                } else {
                                  await alert({
                                    message: err?.error || 'Không thể đặt lại mật khẩu.',
                                  });
                                }
                              } catch {
                                await alert({ message: 'Không thể đặt lại mật khẩu.' });
                              } finally {
                                setResettingId(null);
                              }
                            }}
                          >
                            {resettingId === admin.id ? 'Đang đặt lại…' : 'Đặt lại'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="mb-4 rounded-lg border border-border bg-muted/30 p-4">
                    <p className="mb-1 text-xs text-muted-foreground">Tên đăng nhập hiện tại</p>
                    <p className="text-lg font-semibold">{adminUsername || '…'}</p>
                  </div>

                  <Input
                    label="Mật khẩu hiện tại"
                    type="password"
                    autoComplete="off"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Bắt buộc để xác nhận thay đổi"
                  />
                  <Input
                    label="Tên đăng nhập mới"
                    autoComplete="off"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder={adminUsername || 'admin'}
                    hint="Để trống để giữ tên đăng nhập hiện tại."
                  />
                  <Input
                    label="Mật khẩu mới"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Để trống để giữ mật khẩu hiện tại"
                    noMargin
                  />

                  <Button
                    type="button"
                    onClick={changePassword}
                    disabled={changingPassword}
                    className="mt-4"
                  >
                    {changingPassword ? 'Đang cập nhật…' : 'Cập nhật thông tin đăng nhập'}
                  </Button>

                  <AppAlert variant="warn" className="mt-4">
                    Sau khi thay đổi, bạn sẽ được đăng xuất và cần đăng nhập lại.
                  </AppAlert>
                </>
              )}
            </SettingsSection>
          </div>
        </div>
      </MainContent>
    </Page>
  );
}
