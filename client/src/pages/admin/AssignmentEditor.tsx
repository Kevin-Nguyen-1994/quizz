import { ArrowLeft, RefreshCw, Search, Sparkles, Users } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import AdminNav from '@/components/AdminNav';
import { AppAlert } from '@/components/AppAlert';
import { MainContent, Page, PageHeader } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useDialog } from '@/context/DialogContext';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type {
  AdminAssignmentDetail,
  AssignmentKind,
  AssignmentTargetMode,
  AssignmentTargetOverride,
  AssignmentTargetPreview,
  EmployeeLevel,
  QuestionSelectionPreview,
  Quiz,
  UserAccount,
} from '@/types';

function toLocalInput(timestamp: number) {
  const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

function errorMessage(value: unknown, fallback: string) {
  return value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
    ? value.error
    : fallback;
}

function levelLabel(user: UserAccount) {
  return user.employee_level_code ?? 'Chưa phân bậc';
}

const KIND_LABELS: Record<AssignmentKind, string> = {
  general: 'Thông thường',
  periodic: 'Kiểm tra định kỳ',
  promotion: 'Thi lên bậc',
};

const MODE_LABELS: Record<AssignmentTargetMode, string> = {
  current_level: 'Theo bậc hiện tại',
  promotion: 'Thi lên bậc',
  manual: 'Chọn thủ công',
};

const TARGET_WARNING_LABELS: Record<string, string> = {
  OVERRIDE_USER_MISSING: 'Một nhân viên trong danh sách ngoại lệ không còn tồn tại.',
  OVERRIDE_USER_BANNED: 'Một nhân viên trong danh sách ngoại lệ đã bị vô hiệu hóa.',
  OVERRIDE_OUTSIDE_TARGET_LEVEL: 'Có nhân viên được thêm ngoài bậc đối tượng.',
};

export default function AssignmentEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const api = useAuthFetch();
  const { confirm } = useDialog();
  const editingId = id ? Number(id) : null;
  const [assignmentId, setAssignmentId] = useState<number | null>(editingId);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [levels, setLevels] = useState<EmployeeLevel[]>([]);
  const [title, setTitle] = useState('');
  const [quizId, setQuizId] = useState('');
  const [opensAt, setOpensAt] = useState(toLocalInput(Date.now()));
  const [deadline, setDeadline] = useState(toLocalInput(Date.now() + 7 * 24 * 60 * 60 * 1000));
  const [maxAttempts, setMaxAttempts] = useState('1');
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [shuffleOptions, setShuffleOptions] = useState(true);
  const [assignmentKind, setAssignmentKind] = useState<AssignmentKind>('general');
  const [targetMode, setTargetMode] = useState<AssignmentTargetMode>('manual');
  const [targetLevelId, setTargetLevelId] = useState('');
  const [promotionTargetLevelId, setPromotionTargetLevelId] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const [targetOverrides, setTargetOverrides] = useState<AssignmentTargetOverride[]>([]);
  const [preview, setPreview] = useState<AssignmentTargetPreview | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [questionPreview, setQuestionPreview] = useState<QuestionSelectionPreview | null>(null);
  const [questionFingerprint, setQuestionFingerprint] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'draft' | 'published' | 'closed' | 'archived'>('draft');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [quizResult, userResult, levelResult, assignmentResult] = await Promise.all([
        api.get<Quiz[]>('/api/admin/quizzes'),
        api.get<{ users?: UserAccount[] }>('/api/admin/users'),
        api.get<{ levels?: EmployeeLevel[] }>('/api/admin/employee-levels'),
        editingId
          ? api.get<AdminAssignmentDetail & { error?: string }>(
              `/api/admin/assignments/${editingId}`,
            )
          : Promise.resolve(null),
      ]);
      if (cancelled) return;
      const loadedUsers = userResult.ok ? (userResult.data?.users ?? []) : [];
      setQuizzes(quizResult.ok && Array.isArray(quizResult.data) ? quizResult.data : []);
      setUsers(loadedUsers);
      setLevels((levelResult.data?.levels ?? []).filter((level) => level.is_active === 1));
      if (!quizResult.ok || !userResult.ok || !levelResult.ok) {
        setError('Không thể tải dữ liệu cần thiết để tạo bài kiểm tra.');
      }

      if (assignmentResult) {
        if (!assignmentResult.ok || !assignmentResult.data?.assignment) {
          setError(errorMessage(assignmentResult.data, 'Không thể tải bài kiểm tra.'));
        } else {
          const detail = assignmentResult.data;
          const assignment = detail.assignment;
          setTitle(assignment.title);
          setQuizId(String(assignment.quiz_id ?? ''));
          setOpensAt(toLocalInput(assignment.opens_at_ms));
          setDeadline(assignment.deadline_at_ms ? toLocalInput(assignment.deadline_at_ms) : '');
          setMaxAttempts(String(assignment.max_attempts));
          setShuffleQuestions(assignment.shuffle_questions === 1);
          setShuffleOptions(assignment.shuffle_options === 1);
          setAssignmentKind(assignment.assignment_kind);
          setTargetMode(assignment.target_mode);
          setTargetLevelId(assignment.target_level_id ? String(assignment.target_level_id) : '');
          setPromotionTargetLevelId(
            assignment.promotion_target_level_id
              ? String(assignment.promotion_target_level_id)
              : '',
          );
          setTargetOverrides(detail.targetOverrides ?? []);
          if (assignment.target_mode === 'manual') {
            setSelectedUsers(detail.members.flatMap((member) => member.user_id ?? []));
          } else if (assignment.target_mode === 'promotion') {
            setSelectedUsers(
              (detail.targetOverrides ?? [])
                .filter((item) => item.action === 'include')
                .map((item) => item.userId),
            );
          } else {
            const base = loadedUsers
              .filter(
                (user) => !user.is_banned && user.employee_level_id === assignment.target_level_id,
              )
              .map((user) => user.id);
            const overrideMap = new Map(
              (detail.targetOverrides ?? []).map((item) => [item.userId, item.action]),
            );
            setSelectedUsers([
              ...new Set([
                ...base.filter((userId) => overrideMap.get(userId) !== 'exclude'),
                ...(detail.targetOverrides ?? [])
                  .filter((item) => item.action === 'include')
                  .map((item) => item.userId),
              ]),
            ]);
          }
          setStatus(assignment.status);
        }
      }
      setLoading(false);
    }
    load().catch(() => {
      if (!cancelled) {
        setError('Không thể kết nối máy chủ.');
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [api, editingId]);

  const selectedQuiz = quizzes.find((quiz) => quiz.id === Number(quizId));
  const selectedTargetLevel = levels.find((level) => level.id === Number(targetLevelId));
  const selectedPromotionLevel = levels.find(
    (level) => level.id === Number(promotionTargetLevelId),
  );
  const eligibleSourceUsers = useMemo(
    () =>
      users.filter((user) => !user.is_banned && user.employee_level_id === Number(targetLevelId)),
    [targetLevelId, users],
  );
  const selectableUsers = targetMode === 'promotion' ? eligibleSourceUsers : users;
  const filteredUsers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi');
    if (!query) return selectableUsers;
    return selectableUsers.filter((user) =>
      `${user.username} ${user.login_name}`.toLocaleLowerCase('vi').includes(query),
    );
  }, [search, selectableUsers]);

  const clientMismatch = useMemo(() => {
    const recommended = selectedQuiz?.recommended_level_id;
    const expected =
      targetMode === 'promotion' ? Number(promotionTargetLevelId) : Number(targetLevelId);
    if (targetMode === 'manual' || !recommended || !expected || recommended === expected) return '';
    const recommendedLevel = levels.find((level) => level.id === recommended);
    const expectedLevel = levels.find((level) => level.id === expected);
    return `Bộ câu hỏi này được khuyến nghị cho ${recommendedLevel?.code ?? 'bậc khác'} nhưng bài kiểm tra đang hướng đến ${expectedLevel?.code ?? 'bậc đã chọn'}.`;
  }, [levels, promotionTargetLevelId, selectedQuiz, targetLevelId, targetMode]);

  function invalidatePreview() {
    setPreview(null);
    setFingerprint(null);
  }

  function invalidateQuestionPreview() {
    setQuestionPreview(null);
    setQuestionFingerprint(null);
  }

  function chooseMode(mode: AssignmentTargetMode) {
    setTargetMode(mode);
    setAssignmentKind(
      mode === 'promotion'
        ? 'promotion'
        : assignmentKind === 'promotion'
          ? 'general'
          : assignmentKind,
    );
    setTargetLevelId('');
    setPromotionTargetLevelId('');
    setSelectedUsers([]);
    setTargetOverrides([]);
    invalidatePreview();
  }

  function chooseTargetLevel(value: string) {
    setTargetLevelId(value);
    setSelectedUsers(
      targetMode === 'current_level'
        ? users
            .filter((user) => !user.is_banned && user.employee_level_id === Number(value))
            .map((user) => user.id)
        : [],
    );
    setTargetOverrides([]);
    invalidatePreview();
  }

  function toggleUser(userId: number, checked: boolean) {
    setSelectedUsers((current) =>
      checked ? [...new Set([...current, userId])] : current.filter((value) => value !== userId),
    );
    invalidatePreview();
  }

  function validate() {
    if (!title.trim()) return 'Vui lòng nhập tên bài kiểm tra.';
    if (!quizId) return 'Vui lòng chọn bộ câu hỏi nguồn.';
    if (!opensAt || !Number.isFinite(new Date(opensAt).getTime()))
      return 'Thời gian mở không hợp lệ.';
    if (deadline && new Date(deadline).getTime() <= new Date(opensAt).getTime())
      return 'Hạn hoàn thành phải sau thời gian mở.';
    const parsedMaxAttempts = Number(maxAttempts);
    if (!/^\d+$/.test(maxAttempts) || !Number.isInteger(parsedMaxAttempts))
      return 'Số lượt làm phải là số nguyên từ 1 đến 20.';
    if (parsedMaxAttempts < 1 || parsedMaxAttempts > 20) return 'Số lượt làm phải từ 1 đến 20.';
    if (targetMode === 'manual' && selectedUsers.length === 0)
      return 'Vui lòng chọn ít nhất một nhân viên.';
    if (targetMode !== 'manual' && !targetLevelId) return 'Vui lòng chọn bậc hiện tại.';
    if (targetMode === 'promotion') {
      if (!promotionTargetLevelId) return 'Vui lòng chọn bậc thi lên.';
      if (targetLevelId === promotionTargetLevelId) return 'Hai bậc nâng cấp phải khác nhau.';
    }
    return '';
  }

  function buildOverrides(): AssignmentTargetOverride[] {
    if (targetMode === 'promotion')
      return selectedUsers.map((userId) => ({ userId, action: 'include' }));
    if (targetMode !== 'current_level') return [];
    const baseIds = new Set(eligibleSourceUsers.map((user) => user.id));
    return [
      ...eligibleSourceUsers
        .filter((user) => !selectedUsers.includes(user.id))
        .map((user) => ({ userId: user.id, action: 'exclude' as const })),
      ...selectedUsers
        .filter((userId) => !baseIds.has(userId))
        .map((userId) => ({ userId, action: 'include' as const })),
    ];
  }

  async function saveDraft(): Promise<number | null> {
    const validation = validate();
    if (validation) {
      setError(validation);
      return null;
    }
    setError('');
    const payload = {
      quizId: Number(quizId),
      title: title.trim(),
      audienceMode: 'members',
      opensAtMs: new Date(opensAt).getTime(),
      deadlineAtMs: deadline ? new Date(deadline).getTime() : null,
      maxAttempts: Number(maxAttempts),
      shuffleQuestions,
      shuffleOptions,
      assignmentKind,
      targetMode,
      targetLevelId: targetMode === 'manual' ? null : Number(targetLevelId),
      promotionTargetLevelId: targetMode === 'promotion' ? Number(promotionTargetLevelId) : null,
    };
    const result = assignmentId
      ? await api.put<{ assignment?: { id: number }; error?: string }>(
          `/api/admin/assignments/${assignmentId}`,
          payload,
        )
      : await api.post<{ assignment?: { id: number }; error?: string }>(
          '/api/admin/assignments',
          payload,
        );
    if (!result.ok || !result.data?.assignment) {
      setError(errorMessage(result.data, 'Không thể lưu bản nháp.'));
      return null;
    }
    const savedId = result.data.assignment.id;
    const overrides = buildOverrides();
    const targetResult =
      targetMode === 'manual'
        ? await api.put<{ error?: string }>(`/api/admin/assignments/${savedId}/members`, {
            userIds: selectedUsers,
          })
        : await api.put<{ error?: string }>(`/api/admin/assignments/${savedId}/target-overrides`, {
            overrides,
          });
    if (!targetResult.ok) {
      setError(errorMessage(targetResult.data, 'Đã lưu cấu hình nhưng chưa lưu được đối tượng.'));
      return null;
    }
    setAssignmentId(savedId);
    setTargetOverrides(overrides);
    return savedId;
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const savedId = await saveDraft();
      if (savedId) navigate(`/admin/assignments/${savedId}`);
    } catch {
      setError('Không thể kết nối máy chủ. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  }

  async function handlePreview() {
    setSaving(true);
    try {
      const savedId = await saveDraft();
      if (!savedId) return;
      const result = await api.post<{ preview?: AssignmentTargetPreview; error?: string }>(
        `/api/admin/assignments/${savedId}/target-preview`,
        {},
      );
      if (!result.ok || !result.data?.preview) {
        setError(errorMessage(result.data, 'Không thể xem trước người nhận.'));
        return;
      }
      setPreview(result.data.preview);
      setFingerprint(result.data.preview.fingerprint);
    } catch {
      setError('Không thể kết nối máy chủ. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  }

  async function handleQuestionPreview() {
    setSaving(true);
    setError('');
    try {
      const savedId = await saveDraft();
      if (!savedId) return;
      const result = await api.post<{
        preview?: QuestionSelectionPreview;
        error?: string;
        code?: string;
      }>(`/api/admin/assignments/${savedId}/question-preview`, {});
      if (!result.ok || !result.data?.preview) {
        setError(
          result.data?.code === 'QUESTION_POOL_INSUFFICIENT'
            ? 'Ngân hàng không còn đủ câu hỏi cho một hoặc nhiều nhóm điều kiện.'
            : errorMessage(result.data, 'Không thể tạo đề xem trước.'),
        );
        return;
      }
      setQuestionPreview(result.data.preview);
      setQuestionFingerprint(result.data.preview.selectionFingerprint);
    } catch {
      setError('Không thể kết nối máy chủ. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    if (targetMode !== 'manual' && (!preview || !fingerprint)) {
      setError('Danh sách người nhận chưa được xác nhận. Hãy xem trước trước khi phát hành.');
      return;
    }
    if (
      selectedQuiz?.quiz_mode === 'bank_generated' &&
      (!questionPreview || !questionFingerprint)
    ) {
      setError('Đề xem trước chưa hợp lệ. Hãy tạo đề xem trước trước khi phát hành.');
      return;
    }
    const finalCount = targetMode === 'manual' ? selectedUsers.length : (preview?.finalCount ?? 0);
    const proceed = await confirm({
      title: 'Phát hành bài kiểm tra',
      message: (
        <div className="space-y-1 text-left">
          <p>
            <strong>{title.trim()}</strong>
          </p>
          <p>Loại: {KIND_LABELS[assignmentKind]}</p>
          <p>
            Đối tượng:{' '}
            {targetMode === 'promotion'
              ? `${selectedTargetLevel?.code ?? '—'} → ${selectedPromotionLevel?.code ?? '—'}`
              : targetMode === 'current_level'
                ? (selectedTargetLevel?.code ?? '—')
                : 'Chọn thủ công'}
          </p>
          <p>Số nhân viên: {finalCount}</p>
          <p>Số câu: {selectedQuiz?.question_count ?? 0}</p>
          {questionPreview && (
            <>
              <p>Điểm tối đa: {questionPreview.totalScore.toLocaleString('vi-VN')}</p>
              <p>
                Thời gian khuyến nghị: {Math.ceil(questionPreview.recommendedTotalSeconds / 60)}{' '}
                phút
              </p>
              <p>
                Critical:{' '}
                {questionPreview.selected.filter((item) => item.question.critical === 1).length}
              </p>
            </>
          )}
          <p>Hạn: {deadline ? new Date(deadline).toLocaleString('vi-VN') : 'Không giới hạn'}</p>
          {targetOverrides.length > 0 && (
            <p>Có {targetOverrides.length} điều chỉnh thủ công trong danh sách người nhận.</p>
          )}
          <p>Sau khi phát hành, đối tượng và nội dung sẽ chuyển sang chỉ đọc.</p>
        </div>
      ),
      confirmText: `Phát hành cho ${finalCount} nhân viên`,
      cancelText: 'Quay lại',
    });
    if (!proceed) return;
    setSaving(true);
    try {
      const savedId = await saveDraft();
      if (!savedId) return;
      const result = await api.post<{
        error?: string;
        code?: string;
        details?: { preview?: AssignmentTargetPreview };
      }>(`/api/admin/assignments/${savedId}/publish`, {
        ...(targetMode === 'manual' ? {} : { targetFingerprint: fingerprint }),
        ...(questionFingerprint ? { questionFingerprint } : {}),
      });
      if (!result.ok) {
        if (result.status === 409 && result.data?.code === 'QUESTION_POOL_CHANGED') {
          setQuestionPreview(null);
          setQuestionFingerprint(null);
          setError(
            'Ngân hàng câu hỏi đã thay đổi kể từ lần xem trước. Vui lòng tạo lại đề trước khi phát hành.',
          );
        } else if (result.status === 409 && result.data?.code === 'TARGET_CHANGED') {
          const fresh = result.data.details?.preview;
          if (fresh) {
            setPreview(fresh);
            setFingerprint(fresh.fingerprint);
            setSelectedUsers(fresh.members.map((member) => member.id));
            const userResult = await api.get<{ users?: UserAccount[] }>('/api/admin/users');
            if (userResult.ok) setUsers(userResult.data?.users ?? []);
          } else setFingerprint(null);
          setError(
            'Danh sách nhân viên đã thay đổi kể từ lần xem trước. Hãy xem lại danh sách và xác nhận phát hành lần nữa.',
          );
        } else setError(errorMessage(result.data, 'Không thể phát hành bài kiểm tra.'));
      } else navigate(`/admin/assignments/${savedId}`);
    } catch {
      setError('Không thể kết nối máy chủ. Vui lòng thử lại.');
    } finally {
      setSaving(false);
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
  if (status !== 'draft')
    return (
      <Page>
        <AdminNav />
        <MainContent>
          <PageHeader
            title={title || 'Bài kiểm tra'}
            description="Bài kiểm tra đã phát hành; cấu hình đối tượng hiện chỉ đọc."
          />
          <Card className="mb-4">
            <CardContent className="grid gap-3 p-5 sm:grid-cols-3">
              <div>
                <span className="block text-sm text-muted-foreground">Loại bài</span>
                {KIND_LABELS[assignmentKind]}
              </div>
              <div>
                <span className="block text-sm text-muted-foreground">Phương thức</span>
                {MODE_LABELS[targetMode]}
              </div>
              <div>
                <span className="block text-sm text-muted-foreground">Đối tượng ban đầu</span>
                {targetMode === 'promotion'
                  ? `${selectedTargetLevel?.code ?? '—'} → ${selectedPromotionLevel?.code ?? '—'}`
                  : (selectedTargetLevel?.code ?? 'Chọn thủ công')}
              </div>
            </CardContent>
          </Card>
          <AppAlert variant="warn">
            Không thể chỉnh đối tượng hoặc thành viên sau khi phát hành.
          </AppAlert>
          <Button asChild>
            <Link to={`/admin/assignments/${assignmentId}`}>Xem chi tiết</Link>
          </Button>
        </MainContent>
      </Page>
    );

  return (
    <Page>
      <AdminNav />
      <MainContent>
        <Button variant="ghost" size="sm" asChild className="mb-3">
          <Link to="/admin/assignments">
            <ArrowLeft className="size-4" /> Danh sách
          </Link>
        </Button>
        <PageHeader
          title={assignmentId ? 'Chỉnh sửa bài kiểm tra' : 'Tạo bài kiểm tra'}
          description="Thiết lập nội dung, thời gian và đối tượng nhân viên tham gia."
        />
        {error && (
          <div ref={errorRef}>
            <AppAlert variant="error">{error}</AppAlert>
          </div>
        )}
        <form onSubmit={handleSave} className="space-y-5">
          <Card>
            <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <h2 className="text-lg">Thông tin bài kiểm tra</h2>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="assignment-title">Tên bài kiểm tra</Label>
                <Input
                  id="assignment-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={160}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Bộ câu hỏi</Label>
                <Select
                  value={quizId}
                  onValueChange={(value) => {
                    setQuizId(value);
                    invalidatePreview();
                    invalidateQuestionPreview();
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn bộ câu hỏi" />
                  </SelectTrigger>
                  <SelectContent>
                    {quizzes.map((quiz) => (
                      <SelectItem key={quiz.id} value={String(quiz.id)}>
                        {quiz.title} ({quiz.question_count} câu)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Loại bài</Label>
                <Select
                  value={assignmentKind}
                  onValueChange={(value) => setAssignmentKind(value as AssignmentKind)}
                  disabled={targetMode === 'promotion'}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">Thông thường</SelectItem>
                    <SelectItem value="periodic">Kiểm tra định kỳ</SelectItem>
                    <SelectItem value="promotion">Thi lên bậc</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-attempts">Số lượt làm</Label>
                <Input
                  id="max-attempts"
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  inputMode="numeric"
                  value={maxAttempts}
                  onChange={(event) => setMaxAttempts(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="opens-at">Thời gian mở</Label>
                <Input
                  id="opens-at"
                  type="datetime-local"
                  value={opensAt}
                  onChange={(event) => setOpensAt(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="deadline">Hạn hoàn thành</Label>
                <Input
                  id="deadline"
                  type="datetime-local"
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                />
              </div>
              <label
                htmlFor="shuffle-questions"
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span>Trộn thứ tự câu hỏi</span>
                <Switch
                  id="shuffle-questions"
                  checked={shuffleQuestions}
                  onCheckedChange={setShuffleQuestions}
                />
              </label>
              <label
                htmlFor="shuffle-options"
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span>Trộn thứ tự đáp án</span>
                <Switch
                  id="shuffle-options"
                  checked={shuffleOptions}
                  onCheckedChange={setShuffleOptions}
                />
              </label>
            </CardContent>
          </Card>

          {selectedQuiz?.quiz_mode === 'bank_generated' && (
            <Card>
              <CardContent className="space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg">
                      <Sparkles className="size-5" />
                      Đề xem trước
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Xác nhận chính xác câu hỏi trước khi chọn và phát hành cho nhân viên.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={questionPreview ? 'secondary' : 'default'}
                    onClick={handleQuestionPreview}
                    disabled={saving}
                  >
                    {questionPreview ? (
                      <>
                        <RefreshCw className="size-4" />
                        Tạo lại đề
                      </>
                    ) : (
                      'Tạo đề xem trước'
                    )}
                  </Button>
                </div>
                {questionPreview ? (
                  <>
                    <div className="grid gap-3 rounded-lg bg-muted/40 p-4 sm:grid-cols-3">
                      <div>
                        <span className="text-xs text-muted-foreground">Số câu</span>
                        <strong className="block text-xl">{questionPreview.totalQuestions}</strong>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Điểm tối đa</span>
                        <strong className="block text-xl">
                          {questionPreview.totalScore.toLocaleString('vi-VN')}
                        </strong>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Khuyến nghị</span>
                        <strong className="block text-xl">
                          ~{Math.ceil(questionPreview.recommendedTotalSeconds / 60)} phút
                        </strong>
                      </div>
                    </div>
                    <div className="divide-y rounded-lg border">
                      {questionPreview.selected.map((item, i) => (
                        <div
                          key={`${item.question.id}-${i}`}
                          className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start"
                        >
                          <span className="font-semibold text-primary">{i + 1}.</span>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium">{item.question.text}</p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              <Badge variant="outline">{item.question.source_question_id}</Badge>
                              <Badge variant="outline">{item.question.category_code}</Badge>
                              <Badge variant="outline">{item.question.minimum_level_code}</Badge>
                              {item.question.difficulty && (
                                <Badge variant="outline">{item.question.difficulty}</Badge>
                              )}
                              {item.question.critical === 1 && (
                                <Badge variant="destructive">Critical</Badge>
                              )}
                            </div>
                          </div>
                          <span className="shrink-0 text-sm text-muted-foreground">
                            {item.effectiveScore} điểm · {item.effectiveTimeSec}s
                          </span>
                        </div>
                      ))}
                    </div>
                    <AppAlert variant="info">
                      Nếu thay đổi bộ đề động, đề xem trước này sẽ hết hiệu lực và cần tạo lại.
                    </AppAlert>
                  </>
                ) : (
                  <AppAlert variant="info">
                    Bộ đề động cần một đề xem trước hợp lệ trước khi phát hành.
                  </AppAlert>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-5 p-5">
              <div>
                <h2 className="text-lg">Đối tượng làm bài</h2>
                <p className="text-sm text-muted-foreground">
                  Chọn cách xác định nhân viên nhận bài kiểm tra.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {(['current_level', 'promotion', 'manual'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={targetMode === mode}
                    onClick={() => chooseMode(mode)}
                    className={`relative min-h-20 rounded-lg border p-4 text-left text-sm font-semibold transition ${targetMode === mode ? 'border-primary bg-primary/10 text-primary shadow-sm' : 'border-border bg-card text-muted-foreground hover:border-[var(--border-strong)] hover:bg-muted/50'}`}
                  >
                    {MODE_LABELS[mode]}
                    {targetMode === mode && (
                      <span
                        className="absolute right-3 top-3 size-2 rounded-full bg-primary"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                ))}
              </div>
              {targetMode !== 'manual' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{targetMode === 'promotion' ? 'Bậc hiện tại' : 'Bậc'}</Label>
                    <Select value={targetLevelId} onValueChange={chooseTargetLevel}>
                      <SelectTrigger>
                        <SelectValue placeholder="Chọn bậc" />
                      </SelectTrigger>
                      <SelectContent>
                        {levels.map((level) => (
                          <SelectItem key={level.id} value={String(level.id)}>
                            {level.code} — {level.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {targetMode === 'promotion' && (
                    <div className="space-y-2">
                      <Label>Thi lên</Label>
                      <Select
                        value={promotionTargetLevelId}
                        onValueChange={(value) => {
                          setPromotionTargetLevelId(value);
                          invalidatePreview();
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Chọn bậc đích" />
                        </SelectTrigger>
                        <SelectContent>
                          {levels.map((level) => (
                            <SelectItem
                              key={level.id}
                              value={String(level.id)}
                              disabled={String(level.id) === targetLevelId}
                            >
                              {level.code} — {level.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}
              {clientMismatch && <AppAlert variant="warn">{clientMismatch}</AppAlert>}
              {targetMode === 'promotion' && (
                <AppAlert variant="info">
                  Chọn nhân viên được tham gia kỳ thi nâng bậc. Kết quả không tự động thay đổi bậc
                  hiện tại.
                </AppAlert>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <strong>
                    {targetMode === 'manual'
                      ? 'Nhân viên được giao'
                      : targetMode === 'promotion'
                        ? 'Ứng viên được chọn'
                        : 'Danh sách theo bậc và ngoại lệ'}
                  </strong>
                  <p className="text-sm text-muted-foreground">
                    Đã chọn {selectedUsers.length} nhân viên
                  </p>
                </div>
                {targetMode !== 'manual' && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handlePreview}
                    disabled={saving || !targetLevelId}
                  >
                    {saving ? 'Đang xử lý…' : 'Xem trước người nhận'}
                  </Button>
                )}
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Tìm theo họ tên hoặc tên đăng nhập"
                  className="pl-9"
                />
              </div>
              <div className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {filteredUsers.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    Không tìm thấy nhân viên phù hợp.
                  </p>
                ) : (
                  filteredUsers.map((user) => {
                    const disabled = user.is_banned === 1;
                    const outsideLevel =
                      targetMode === 'current_level' &&
                      user.employee_level_id !== Number(targetLevelId);
                    return (
                      <label
                        key={user.id}
                        htmlFor={`target-user-${user.id}`}
                        className={`flex min-h-14 items-center gap-3 px-4 py-3 ${disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer hover:bg-muted/50'}`}
                      >
                        <input
                          type="checkbox"
                          id={`target-user-${user.id}`}
                          aria-label={`${selectedUsers.includes(user.id) ? 'Bỏ chọn' : 'Chọn'} ${user.username} (${user.login_name})`}
                          checked={selectedUsers.includes(user.id)}
                          disabled={disabled}
                          onChange={(event) => toggleUser(user.id, event.target.checked)}
                          className="size-5 shrink-0 cursor-pointer accent-[var(--primary)] disabled:cursor-not-allowed"
                        />
                        <span className="min-w-0 flex-1">
                          <strong className="block truncate text-sm">{user.username}</strong>
                          <span className="block truncate text-xs text-muted-foreground">
                            {user.login_name} · {levelLabel(user)}
                          </span>
                        </span>
                        {outsideLevel && selectedUsers.includes(user.id) && (
                          <Badge variant="outline">Ngoại lệ</Badge>
                        )}
                        {disabled && <Badge variant="outline">Đã khóa</Badge>}
                      </label>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>

          {preview && (
            <Card>
              <CardContent className="space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg">
                      <Users className="size-5" /> Người nhận bài kiểm tra
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Phù hợp theo điều kiện: {preview.matchedCount} · Sau ngoại lệ:{' '}
                      {preview.finalCount}
                    </p>
                  </div>
                  <Badge variant="outline">Đã xác nhận preview</Badge>
                </div>
                {preview.warnings.map((warning) => (
                  <AppAlert key={`${warning.code}-${warning.userId ?? ''}`} variant="warn">
                    {warning.code === 'QUIZ_LEVEL_MISMATCH'
                      ? clientMismatch ||
                        'Bậc khuyến nghị của bộ câu hỏi không phù hợp với đối tượng.'
                      : warning.code === 'OVERRIDE_OUTSIDE_TARGET_LEVEL'
                        ? `Có nhân viên được thêm ngoài bậc ${selectedTargetLevel?.code ?? 'đối tượng'}.`
                        : (TARGET_WARNING_LABELS[warning.code] ?? warning.message)}
                  </AppAlert>
                ))}
                <div className="divide-y divide-border rounded-lg border border-border">
                  {preview.members.map((member) => (
                    <div
                      key={member.id}
                      className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-3"
                    >
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate">{member.displayName}</strong>
                        <span className="text-xs text-muted-foreground">
                          {member.loginName} · {member.levelCode ?? 'Chưa phân bậc'}
                        </span>
                      </span>
                      <Badge variant="outline">
                        {member.source === 'override_include' ? 'Ngoại lệ thêm' : 'Theo điều kiện'}
                      </Badge>
                    </div>
                  ))}
                  {targetOverrides
                    .filter((item) => item.action === 'exclude')
                    .map((item) => {
                      const user = users.find((candidate) => candidate.id === item.userId);
                      return user ? (
                        <div
                          key={`excluded-${user.id}`}
                          className="flex min-h-14 items-center gap-3 px-4 py-3 opacity-65"
                        >
                          <span className="min-w-0 flex-1">
                            <strong className="block truncate">{user.username}</strong>
                            <span className="text-xs text-muted-foreground">
                              {user.login_name} · {levelLabel(user)}
                            </span>
                          </span>
                          <Badge variant="outline">Ngoại lệ loại</Badge>
                        </div>
                      ) : null;
                    })}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" asChild>
              <Link to="/admin/assignments">Hủy</Link>
            </Button>
            <Button type="submit" variant="secondary" disabled={saving}>
              {saving ? 'Đang lưu…' : 'Lưu bản nháp'}
            </Button>
            <Button type="button" onClick={handlePublish} disabled={saving}>
              {saving ? 'Đang xử lý…' : 'Phát hành'}
            </Button>
          </div>
        </form>
      </MainContent>
    </Page>
  );
}
