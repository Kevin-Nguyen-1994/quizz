import { useEffect, useMemo, useState } from 'react';
import { Clock3, ShieldAlert } from 'lucide-react';
import { AppAlert } from '@/components/AppAlert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useAuthFetch } from '@/hooks/useAuthFetch';

type Analytics = {
  assignment: { assessmentPurpose: string | null };
  overview: {
    medianScore: number; highestScore: number; lowestScore: number; averageCorrectRate: number;
    totalNoAnswer: number; criticalQuestionCount: number; criticalAccuracy: number | null;
  };
  priorityQuestions: Question[];
  questions: Question[];
  categories: Array<{ code: string; name: string; responses: number; correct: number; timeout: number; accuracy: number; criticalAccuracy: number | null; sufficientData: boolean }>;
  levelDifficulty: Array<{ level: string; difficulty: string; responses: number; correct: number; accuracy: number }>;
  employees: Array<{ memberId: number; name: string; loginName: string | null; levelCode: string | null; score: number | null; scorePercent: number | null; correct: number; total: number; wrong: number; timeout: number; criticalCorrect: number; criticalTotal: number; criticalAccuracy: number | null }>;
  historicalMetadata: { complete: boolean; missingQuestionCount: number };
};

type Question = {
  questionId: number; questionNumber: number; text: string; categoryCode: string | null;
  levelCode: string | null; difficulty: string | null; critical: boolean; encountered: number;
  correct: number; wrong: number; timeout: number; correctRate: number; wrongRate: number;
  timeoutRate: number; averageAwardedScore: number; maxScore: number; timeSec: number;
  flags: string[];
};

const flagText: Record<string, string> = {
  NEEDS_GROUP_REVIEW: 'Cần chữa chung',
  HIGH_PRIORITY_GROUP_REVIEW: 'Yếu chung',
  TIMER_REVIEW: 'Cần xem lại thời gian',
  CRITICAL_REVIEW: 'Critical cần chữa',
  QUESTION_REVIEW: 'Rà soát câu hỏi/timer',
};

const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLocaleLowerCase('vi-VN');

function Metric({ label, value }: { label: string; value: string | number }) {
  return <Card><CardContent className="p-4"><strong className="text-2xl">{value}</strong><p className="text-sm text-muted-foreground">{label}</p></CardContent></Card>;
}

export function AssessmentAnalytics({ assignmentId }: { assignmentId: string | undefined }) {
  const api = useAuthFetch();
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employeeSort, setEmployeeSort] = useState<'name' | 'scoreHigh' | 'scoreLow' | 'critical' | 'timeout'>('name');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      const result = await api.get<Analytics & { error?: string }>(`/api/admin/assignments/${assignmentId}/analytics`);
      if (cancelled) return;
      if (result.ok && result.data) setData(result.data);
      else setError(result.data?.error ?? 'Không thể tải phân tích kết quả.');
      setLoading(false);
    })().catch(() => { if (!cancelled) { setError('Không thể kết nối máy chủ.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [api, assignmentId]);

  const visibleEmployees = useMemo(() => {
    const query = normalized(employeeSearch.trim());
    return (data?.employees ?? []).filter((employee) => !query || normalized(`${employee.name} ${employee.loginName ?? ''}`).includes(query)).map((employee, index) => ({ employee, index })).sort((a, b) => {
      const name = a.employee.name.localeCompare(b.employee.name, 'vi');
      if (employeeSort === 'name') return name || a.index - b.index;
      if (employeeSort === 'critical') return (b.employee.criticalAccuracy ?? -1) - (a.employee.criticalAccuracy ?? -1) || name;
      if (employeeSort === 'timeout') return b.employee.timeout - a.employee.timeout || name;
      const aScore = a.employee.score; const bScore = b.employee.score;
      if (aScore === null) return bScore === null ? name : 1;
      if (bScore === null) return -1;
      return employeeSort === 'scoreHigh' ? bScore - aScore || name : aScore - bScore || name;
    }).map(({ employee }) => employee);
  }, [data, employeeSearch, employeeSort]);
  if (loading) return <p className="text-sm text-muted-foreground">Đang tổng hợp phân tích…</p>;
  if (error) return <AppAlert variant="error">{error}</AppAlert>;
  if (!data) return null;
  return <section className="mt-8 space-y-6" aria-label="Phân tích kết quả">
    <div><h2 className="text-xl">Phân tích kết quả</h2><p className="mt-1 text-sm text-muted-foreground">Dùng kết quả hiệu lực sau rà soát; timeout vẫn được giữ riêng với sai kiến thức.</p></div>
    {!data.historicalMetadata.complete && <AppAlert variant="info">{data.historicalMetadata.missingQuestionCount} câu không có metadata lịch sử. Các phân tích theo nghiệp vụ, level và độ khó cho những câu này được đánh dấu chưa đủ dữ liệu.</AppAlert>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Điểm trung vị" value={data.overview.medianScore}/><Metric label="Điểm cao nhất" value={data.overview.highestScore}/><Metric label="Điểm thấp nhất" value={data.overview.lowestScore}/><Metric label="Đúng trung bình" value={`${data.overview.averageCorrectRate}%`}/><Metric label="No answer / Timeout" value={data.overview.totalNoAnswer}/><Metric label="Câu Critical" value={data.overview.criticalQuestionCount}/><Metric label="Critical accuracy" value={data.overview.criticalAccuracy === null ? '—' : `${data.overview.criticalAccuracy}%`}/><Metric label="Mục đích" value={data.assignment.assessmentPurpose ?? 'Chưa gắn nhãn'}/></div>
    <Card><CardContent className="p-4"><h3 className="mb-3 text-lg">Ưu tiên chữa bài</h3>{data.priorityQuestions.length === 0 ? <p className="text-sm text-muted-foreground">Chưa có dữ liệu hoàn thành để xếp ưu tiên.</p> : <div className="space-y-3">{data.priorityQuestions.slice(0, 8).map((question) => <div key={question.questionId} className="rounded-md border p-3"><div className="flex flex-wrap items-start justify-between gap-2"><p className="font-medium">#{question.questionNumber} · {question.text}</p><span className="font-semibold">{question.correctRate}% đúng</span></div><div className="mt-2 flex flex-wrap gap-1">{question.critical && <Badge variant="destructive"><ShieldAlert className="size-3"/> Critical</Badge>}{question.flags.map((flag) => <Badge key={flag} variant="secondary">{flagText[flag] ?? flag}</Badge>)}</div></div>)}</div>}</CardContent></Card>
    <Card className="overflow-hidden"><CardContent className="p-0"><div className="border-b p-4"><h3 className="text-lg">Theo câu hỏi</h3></div><div className="overflow-x-auto"><table className="w-full min-w-[1150px] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="p-3">Câu</th><th>Nội dung</th><th>Nhóm</th><th>Đúng</th><th>Sai</th><th>Timeout</th><th>Điểm TB</th><th>Giới hạn</th><th>Flags</th></tr></thead><tbody>{data.questions.map((question) => <tr key={question.questionId} className="border-b last:border-0"><td className="p-3 font-semibold">#{question.questionNumber}</td><td className="max-w-80 py-3">{question.text}</td><td>{question.categoryCode ?? '—'} · {question.levelCode ?? '—'} · {question.difficulty ?? '—'}</td><td>{question.correct}/{question.encountered} ({question.correctRate}%)</td><td>{question.wrong} ({question.wrongRate}%)</td><td>{question.timeout} ({question.timeoutRate}%)</td><td>{question.averageAwardedScore}/{question.maxScore}</td><td>{question.timeSec}s</td><td className="py-3"><div className="flex flex-wrap gap-1">{question.flags.map((flag)=><Badge key={flag} variant="secondary">{flagText[flag] ?? flag}</Badge>)}</div></td></tr>)}</tbody></table></div></CardContent></Card>
    <div className="grid gap-6 xl:grid-cols-2"><Card className="overflow-hidden"><CardContent className="p-0"><div className="border-b p-4"><h3 className="text-lg">Theo nghiệp vụ</h3><p className="text-sm text-muted-foreground">Dưới 5 phản hồi chỉ hiển thị “Chưa đủ dữ liệu”.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="p-3">Nghiệp vụ</th><th>Phản hồi</th><th>Accuracy</th><th>Critical</th><th>Timeout</th></tr></thead><tbody>{data.categories.map((category)=><tr key={category.code} className="border-b last:border-0"><td className="p-3">{category.name}</td><td>{category.responses}</td><td>{category.sufficientData ? `${category.accuracy}%` : 'Chưa đủ dữ liệu'}</td><td>{category.criticalAccuracy === null ? '—' : `${category.criticalAccuracy}%`}</td><td>{category.timeout}</td></tr>)}</tbody></table></div></CardContent></Card>
    <Card><CardContent className="p-4"><h3 className="mb-3 text-lg">CS × Độ khó</h3><div className="grid grid-cols-1 gap-2 sm:grid-cols-3">{data.levelDifficulty.map((cell)=><div key={`${cell.level}-${cell.difficulty}`} className="rounded-md border p-3"><p className="font-medium">{cell.level} / {cell.difficulty}</p><p className="text-xl">{cell.accuracy}%</p><p className="text-xs text-muted-foreground">n={cell.responses}</p></div>)}</div></CardContent></Card></div>
    <Card className="overflow-hidden"><CardContent className="p-0"><div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center"><h3 className="mr-auto text-lg">Nhân viên</h3><input value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} placeholder="Tìm nhân viên..." className="h-9 rounded-md border bg-background px-3 text-sm"/><select value={employeeSort} onChange={(event) => setEmployeeSort(event.target.value as typeof employeeSort)} className="h-9 rounded-md border bg-background px-3 text-sm"><option value="name">Tên A → Z</option><option value="scoreHigh">Điểm cao → thấp</option><option value="scoreLow">Điểm thấp → cao</option><option value="critical">Critical cao → thấp</option><option value="timeout">Timeout nhiều → ít</option></select></div>{visibleEmployees.length===0?<p className="p-8 text-center text-sm text-muted-foreground">Không tìm thấy nhân viên phù hợp.</p>:<div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="p-3">Họ tên</th><th>Level</th><th>Điểm</th><th>Đúng</th><th>Sai kiến thức</th><th><Clock3 className="inline size-3"/> Timeout</th><th>Critical</th></tr></thead><tbody>{visibleEmployees.map((employee)=><tr key={employee.memberId} className="border-b last:border-0"><td className="p-3"><strong className="block">{employee.name}</strong><span className="text-xs text-muted-foreground">{employee.loginName}</span></td><td>{employee.levelCode ?? '—'}</td><td>{employee.score === null ? '—' : `${employee.score} (${employee.scorePercent}%)`}</td><td>{employee.correct}/{employee.total}</td><td>{employee.wrong}</td><td>{employee.timeout}</td><td>{employee.criticalTotal ? `${employee.criticalCorrect}/${employee.criticalTotal}` : '—'}</td></tr>)}</tbody></table></div>}</CardContent></Card>
  </section>;
}
