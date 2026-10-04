import { useCallback, useEffect, useState } from 'react';
import type { MyAssignmentListItem } from '@/types';
import { useAuthFetch } from './useAuthFetch';

export function useMyAssignments() {
  const api = useAuthFetch();
  const [assignments, setAssignments] = useState<MyAssignmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<{ assignments?: MyAssignmentListItem[]; error?: string }>(
        '/api/assignments/mine',
      );
      if (!result.ok) {
        setError('Không thể tải danh sách bài kiểm tra. Vui lòng thử lại.');
        return;
      }
      setAssignments(result.data?.assignments ?? []);
    } catch {
      setError('Không thể kết nối máy chủ. Hãy kiểm tra mạng LAN và thử lại.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { assignments, loading, error, reload };
}
