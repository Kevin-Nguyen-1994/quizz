import { Plus } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { AppAlert } from '@/components/AppAlert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type { EmployeeLevel } from '@/types';

type EditableLevel = EmployeeLevel & { draftName: string; draftSort: string };

export function EmployeeLevelCatalog() {
  const api = useAuthFetch();
  const [levels, setLevels] = useState<EditableLevel[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [busyId, setBusyId] = useState<number | 'new' | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const result = await api.get<{ levels?: EmployeeLevel[]; error?: string }>(
      '/api/admin/employee-levels',
    );
    if (!result.ok) {
      setError(result.data?.error ?? 'Không thể tải danh mục cấp bậc.');
      return;
    }
    setLevels(
      (result.data?.levels ?? []).map((level) => ({
        ...level,
        draftName: level.name,
        draftSort: String(level.sort_order),
      })),
    );
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  async function createLevel(event: FormEvent) {
    event.preventDefault();
    setBusyId('new');
    setError('');
    const result = await api.post<{ error?: string }>('/api/admin/employee-levels', {
      code,
      name,
      sortOrder: Number(sortOrder),
    });
    setBusyId(null);
    if (!result.ok) {
      setError(result.data?.error ?? 'Không thể thêm cấp bậc.');
      return;
    }
    setCode('');
    setName('');
    setSortOrder('0');
    await load();
  }

  async function updateLevel(level: EditableLevel, isActive = level.is_active === 1) {
    setBusyId(level.id);
    setError('');
    const result = await api.patch<{ error?: string }>(`/api/admin/employee-levels/${level.id}`, {
      name: level.draftName,
      sortOrder: Number(level.draftSort),
      isActive,
    });
    setBusyId(null);
    if (!result.ok) {
      setError(result.data?.error ?? 'Không thể cập nhật cấp bậc.');
      return;
    }
    await load();
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Mã cấp bậc là định danh ổn định và không thể sửa. Bậc ngừng sử dụng vẫn được giữ trong dữ
        liệu lịch sử.
      </p>
      {error && <AppAlert variant="error">{error}</AppAlert>}
      <div className="space-y-3">
        {levels.map((level) => (
          <div
            key={level.id}
            className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-[100px_1fr_110px_150px_auto] md:items-end"
          >
            <div>
              <span className="mb-2 block text-sm font-medium">Mã</span>
              <Badge variant="outline">{level.code}</Badge>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`level-name-${level.id}`}>Tên hiển thị</Label>
              <Input
                id={`level-name-${level.id}`}
                value={level.draftName}
                onChange={(event) =>
                  setLevels((current) =>
                    current.map((item) =>
                      item.id === level.id ? { ...item, draftName: event.target.value } : item,
                    ),
                  )
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`level-sort-${level.id}`}>Thứ tự</Label>
              <Input
                id={`level-sort-${level.id}`}
                type="number"
                value={level.draftSort}
                onChange={(event) =>
                  setLevels((current) =>
                    current.map((item) =>
                      item.id === level.id ? { ...item, draftSort: event.target.value } : item,
                    ),
                  )
                }
              />
            </div>
            <label
              htmlFor={`level-active-${level.id}`}
              className="flex min-h-10 items-center justify-between gap-3 text-sm"
            >
              <span>{level.is_active ? 'Đang sử dụng' : 'Ngừng sử dụng'}</span>
              <Switch
                id={`level-active-${level.id}`}
                checked={level.is_active === 1}
                disabled={busyId === level.id}
                onCheckedChange={(checked) => updateLevel(level, checked)}
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              disabled={busyId === level.id || !level.draftName.trim()}
              onClick={() => updateLevel(level)}
            >
              {busyId === level.id ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </div>
        ))}
      </div>

      <form onSubmit={createLevel} className="rounded-lg border border-dashed border-border p-4">
        <h3 className="mb-3 text-base">Thêm cấp bậc</h3>
        <div className="grid gap-3 md:grid-cols-[140px_1fr_120px_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="new-level-code">Mã</Label>
            <Input
              id="new-level-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              maxLength={32}
              placeholder="CS4"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-level-name">Tên hiển thị</Label>
            <Input
              id="new-level-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-level-sort">Thứ tự</Label>
            <Input
              id="new-level-sort"
              type="number"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={busyId === 'new'}>
            <Plus className="size-4" /> {busyId === 'new' ? 'Đang thêm…' : 'Thêm bậc'}
          </Button>
        </div>
      </form>
    </div>
  );
}
