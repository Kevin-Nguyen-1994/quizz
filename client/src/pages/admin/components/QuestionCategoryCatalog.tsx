import { Plus } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { AppAlert } from '@/components/AppAlert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type { QuestionCategory } from '@/types';

type Row = QuestionCategory & { draftName: string; draftSort: string };
export function QuestionCategoryCatalog() {
  const api = useAuthFetch();
  const [rows, setRows] = useState<Row[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sort, setSort] = useState('0');
  const [busy, setBusy] = useState<number | 'new' | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api.get<{ categories: QuestionCategory[] }>(
      '/api/admin/question-bank/categories',
    );
    if (r.ok)
      setRows(
        r.data.categories.map((x) => ({
          ...x,
          draftName: x.name,
          draftSort: String(x.sort_order),
        })),
      );
    else setError('Không thể tải danh mục câu hỏi.');
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);
  async function update(r: Row, active = r.is_active === 1) {
    setBusy(r.id);
    const x = await api.put<{ error?: string }>(`/api/admin/question-bank/categories/${r.id}`, {
      name: r.draftName,
      sortOrder: Number(r.draftSort),
      isActive: active,
    });
    setBusy(null);
    if (!x.ok) setError(x.data?.error ?? 'Không thể cập nhật danh mục.');
    else load();
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy('new');
    const r = await api.post<{ error?: string }>('/api/admin/question-bank/categories', {
      code,
      name,
      sortOrder: Number(sort),
    });
    setBusy(null);
    if (!r.ok) return setError(r.data?.error ?? 'Không thể thêm danh mục.');
    setCode('');
    setName('');
    setSort('0');
    load();
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Mã danh mục là định danh ổn định. Danh mục đã dùng chỉ nên ngừng hoạt động, không đổi mã
        hoặc xóa.
      </p>
      {error && <AppAlert variant="error">{error}</AppAlert>}
      {rows.map((r) => (
        <div
          key={r.id}
          className="grid gap-3 rounded-lg border p-3 md:grid-cols-[170px_1fr_100px_150px_auto] md:items-end"
        >
          <div>
            <Label>Mã</Label>
            <div className="mt-2">
              <Badge variant="outline">{r.code}</Badge>
              <span className="ml-2 text-xs text-muted-foreground">{r.question_count} câu</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Tên hiển thị</Label>
            <Input
              value={r.draftName}
              onChange={(e) =>
                setRows((xs) =>
                  xs.map((x) => (x.id === r.id ? { ...x, draftName: e.target.value } : x)),
                )
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Thứ tự</Label>
            <Input
              type="number"
              value={r.draftSort}
              onChange={(e) =>
                setRows((xs) =>
                  xs.map((x) => (x.id === r.id ? { ...x, draftSort: e.target.value } : x)),
                )
              }
            />
          </div>
          <label
            htmlFor={`category-active-${r.id}`}
            className="flex min-h-10 items-center justify-between gap-2"
          >
            <span>{r.is_active ? 'Đang dùng' : 'Đã tắt'}</span>
            <Switch
              id={`category-active-${r.id}`}
              checked={r.is_active === 1}
              onCheckedChange={(v) => update(r, v)}
            />
          </label>
          <Button variant="secondary" disabled={busy === r.id} onClick={() => update(r)}>
            Lưu
          </Button>
        </div>
      ))}
      <form
        onSubmit={create}
        className="grid gap-3 rounded-lg border border-dashed p-4 md:grid-cols-[170px_1fr_100px_auto] md:items-end"
      >
        <div className="space-y-2">
          <Label>Mã mới</Label>
          <Input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </div>
        <div className="space-y-2">
          <Label>Tên hiển thị</Label>
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Thứ tự</Label>
          <Input type="number" value={sort} onChange={(e) => setSort(e.target.value)} />
        </div>
        <Button type="submit" disabled={busy === 'new'}>
          <Plus className="size-4" />
          Thêm
        </Button>
      </form>
    </div>
  );
}
