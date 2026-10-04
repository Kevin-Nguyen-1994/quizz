import { ArrowLeft, Search } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppAlert } from '@/components/AppAlert';
import AdminNav from '@/components/AdminNav';
import { MainContent, Page, Subtitle } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import type { AdminAssignmentDetail, Quiz, UserAccount } from '@/types';

function toLocalInput(timestamp: number) {
  const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

function errorMessage(value: unknown, fallback: string) {
  return value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
    ? value.error
    : fallback;
}

export default function AssignmentEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const api = useAuthFetch();
  const { confirm } = useDialog();
  const editingId = id ? Number(id) : null;
  const [assignmentId, setAssignmentId] = useState<number | null>(editingId);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [title, setTitle] = useState('');
  const [quizId, setQuizId] = useState('');
  const [opensAt, setOpensAt] = useState(toLocalInput(Date.now()));
  const [deadline, setDeadline] = useState(toLocalInput(Date.now() + 7 * 24 * 60 * 60 * 1000));
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [shuffleOptions, setShuffleOptions] = useState(true);
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'draft' | 'published' | 'closed' | 'archived'>('draft');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [quizResult, userResult] = await Promise.all([
        api.get<Quiz[]>('/api/admin/quizzes'),
        api.get<{ users?: UserAccount[] }>('/api/admin/users'),
      ]);
      if (cancelled) return;
      if (quizResult.ok) setQuizzes(Array.isArray(quizResult.data) ? quizResult.data : []);
      if (userResult.ok) setUsers(userResult.data?.users ?? []);
      if (!quizResult.ok || !userResult.ok)
        setError('Không thể tải quiz hoặc danh sách nhân viên.');

      if (editingId) {
        const result = await api.get<AdminAssignmentDetail & { error?: string }>(
          `/api/admin/assignments/${editingId}`,
        );
        if (cancelled) return;
        if (!result.ok || !result.data?.assignment) {
          setError(errorMessage(result.data, 'Không thể tải bài kiểm tra.'));
        } else {
          const assignment = result.data.assignment;
          setTitle(assignment.title);
          setQuizId(String(assignment.quiz_id ?? ''));
          setOpensAt(toLocalInput(assignment.opens_at_ms));
          setDeadline(assignment.deadline_at_ms ? toLocalInput(assignment.deadline_at_ms) : '');
          setMaxAttempts(assignment.max_attempts);
          setShuffleQuestions(assignment.shuffle_questions === 1);
          setShuffleOptions(assignment.shuffle_options === 1);
          setSelectedUsers(result.data.members.flatMap((member) => member.user_id ?? []));
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

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi');
    if (!query) return users;
    return users.filter((user) =>
      `${user.username} ${user.login_name} ${user.email ?? ''}`
        .toLocaleLowerCase('vi')
        .includes(query),
    );
  }, [search, users]);
  const selectedQuiz = quizzes.find((quiz) => quiz.id === Number(quizId));
  const allFilteredSelected =
    filteredUsers.length > 0 && filteredUsers.every((user) => selectedUsers.includes(user.id));

  function toggleUser(userId: number, checked: boolean) {
    setSelectedUsers((current) =>
      checked ? [...new Set([...current, userId])] : current.filter((value) => value !== userId),
    );
  }

  function toggleAllFiltered() {
    const ids = filteredUsers.map((user) => user.id);
    setSelectedUsers((current) =>
      allFilteredSelected
        ? current.filter((value) => !ids.includes(value))
        : [...new Set([...current, ...ids])],
    );
  }

  function validate() {
    if (!title.trim()) return 'Vui lòng nhập tên bài kiểm tra.';
    if (!quizId) return 'Vui lòng chọn quiz nguồn.';
    if (!opensAt || !Number.isFinite(new Date(opensAt).getTime()))
      return 'Thời gian mở không hợp lệ.';
    if (deadline && new Date(deadline).getTime() <= new Date(opensAt).getTime()) {
      return 'Hạn hoàn thành phải sau thời gian mở.';
    }
    if (selectedUsers.length === 0) return 'Vui lòng chọn ít nhất một nhân viên.';
    return '';
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
      maxAttempts,
      shuffleQuestions,
      shuffleOptions,
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
    const memberResult = await api.put<{ error?: string }>(
      `/api/admin/assignments/${savedId}/members`,
      { userIds: selectedUsers },
    );
    if (!memberResult.ok) {
      setError(
        errorMessage(
          memberResult.data,
          'Đã lưu bài kiểm tra nhưng chưa lưu được danh sách nhân viên.',
        ),
      );
      return null;
    }
    setAssignmentId(savedId);
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

  async function handlePublish() {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    const proceed = await confirm({
      title: 'Phát hành bài kiểm tra?',
      message: (
        <div className="space-y-1">
          <p>
            <strong>{title.trim()}</strong>
          </p>
          <p>
            Quiz: {selectedQuiz?.title ?? '—'} · {selectedQuiz?.question_count ?? 0} câu
          </p>
          <p>
            {selectedUsers.length} nhân viên · {maxAttempts} lượt/người
          </p>
          <p>Mở: {new Date(opensAt).toLocaleString('vi-VN')}</p>
          <p>Hạn: {deadline ? new Date(deadline).toLocaleString('vi-VN') : 'Không giới hạn'}</p>
          <p>Sau khi phát hành, nội dung và cấu hình bài kiểm tra sẽ không thể chỉnh sửa.</p>
        </div>
      ),
      confirmText: 'Phát hành',
      cancelText: 'Kiểm tra lại',
    });
    if (!proceed) return;
    setSaving(true);
    try {
      const savedId = await saveDraft();
      if (!savedId) return;
      const result = await api.post<{ error?: string }>(
        `/api/admin/assignments/${savedId}/publish`,
        {},
      );
      if (!result.ok) setError(errorMessage(result.data, 'Không thể phát hành bài kiểm tra.'));
      else navigate(`/admin/assignments/${savedId}`);
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

  if (status !== 'draft') {
    return (
      <Page>
        <AdminNav />
        <MainContent>
          <AppAlert variant="warn">Bài kiểm tra đã phát hành nên không thể chỉnh sửa.</AppAlert>
          <Button asChild>
            <Link to={`/admin/assignments/${assignmentId}`}>Xem chi tiết</Link>
          </Button>
        </MainContent>
      </Page>
    );
  }

  return (
    <Page>
      <AdminNav />
      <MainContent>
        <Button variant="ghost" size="sm" asChild className="mb-3">
          <Link to="/admin/assignments">
            <ArrowLeft className="size-4" /> Danh sách
          </Link>
        </Button>
        <h1>{assignmentId ? 'Chỉnh sửa bài kiểm tra' : 'Tạo bài kiểm tra'}</h1>
        <Subtitle className="mb-6">Thiết lập lịch làm bài và chọn nhân viên được giao.</Subtitle>
        {error && <AppAlert variant="error">{error}</AppAlert>}

        <form onSubmit={handleSave} className="space-y-5">
          <Card>
            <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="assignment-title">Tên bài kiểm tra</Label>
                <Input
                  id="assignment-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={160}
                  placeholder="Ví dụ: Kiểm tra DNCX tháng 10/2026"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Quiz nguồn</Label>
                <Select value={quizId} onValueChange={setQuizId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn quiz" />
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
              <div className="space-y-2">
                <Label htmlFor="max-attempts">Số lượt làm cho phép</Label>
                <Input
                  id="max-attempts"
                  type="number"
                  min={1}
                  max={20}
                  value={maxAttempts}
                  onChange={(event) => setMaxAttempts(Math.max(1, Number(event.target.value) || 1))}
                />
              </div>
              <div className="space-y-3 pt-1">
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
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg">Nhân viên được giao</h2>
                  <p className="text-sm text-muted-foreground">
                    Đã chọn {selectedUsers.length}/{users.length}
                  </p>
                </div>
                <Button type="button" size="sm" variant="secondary" onClick={toggleAllFiltered}>
                  {allFilteredSelected ? 'Bỏ chọn danh sách lọc' : 'Chọn tất cả danh sách lọc'}
                </Button>
              </div>
              <div className="relative mb-3">
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
                  <p className="p-4 text-sm text-muted-foreground">Không tìm thấy nhân viên.</p>
                ) : (
                  filteredUsers.map((user) => (
                    <label
                      key={user.id}
                      htmlFor={`assignment-member-${user.id}`}
                      className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/50"
                    >
                      <Checkbox
                        id={`assignment-member-${user.id}`}
                        checked={selectedUsers.includes(user.id)}
                        onCheckedChange={(checked) => toggleUser(user.id, checked === true)}
                      />
                      <span className="min-w-0">
                        <strong className="block truncate text-sm">{user.username}</strong>
                        <span className="block truncate text-xs text-muted-foreground">
                          {user.login_name}
                          {user.email ? ` · ${user.email}` : ''}
                        </span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

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
