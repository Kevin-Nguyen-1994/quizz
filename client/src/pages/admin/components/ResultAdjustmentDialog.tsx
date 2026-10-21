import { useEffect, useMemo, useState } from 'react';
import { AppAlert } from '@/components/AppAlert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type { AssignmentQuestionDetail } from '@/types';

type Scope = 'individual' | 'question_regrade' | 'full_credit_all';
type Source = 'employee_appeal' | 'admin_review' | 'analytics_flag';
type Reason = 'MISSING_ACCEPTED_ANSWER' | 'WRONG_ANSWER_KEY' | 'AMBIGUOUS_QUESTION' | 'MANUAL_REVIEW' | 'ADMIN_SCORE_CORRECTION';

export function ResultAdjustmentDialog({ assignmentId, detail, open, onOpenChange, onApplied, appeal }: { assignmentId: string | undefined; detail: AssignmentQuestionDetail | null; open: boolean; onOpenChange: (open: boolean) => void; onApplied: () => Promise<void>; appeal?: { id: number; attemptId: number; reasonCode: string } | null; }) {
  const api = useAuthFetch();
  const candidates = useMemo(() => detail?.participants.filter((item) => item.attemptId !== null) ?? [], [detail]);
  const [scope, setScope] = useState<Scope>('individual');
  const [targetAttemptId, setTargetAttemptId] = useState('');
  const [score, setScore] = useState('');
  const [isCorrect, setIsCorrect] = useState<'true' | 'false'>('true');
  const [reasonCode, setReasonCode] = useState<Reason>('MANUAL_REVIEW');
  const [source, setSource] = useState<Source>('admin_review');
  const [reasonText, setReasonText] = useState('');
  const [acceptedVariantText, setAcceptedVariantText] = useState('');
  const [preview, setPreview] = useState<Array<{ attemptId: number; name: string; before: number; after: number; timeout: boolean }>>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !appeal) return;
    setSource('employee_appeal');
    setScope('individual');
    setTargetAttemptId(String(appeal.attemptId));
    setReasonCode(appeal.reasonCode === 'ANSWER_KEY_DISPUTE' ? 'WRONG_ANSWER_KEY' : appeal.reasonCode === 'QUESTION_AMBIGUOUS' ? 'AMBIGUOUS_QUESTION' : appeal.reasonCode === 'ANSWER_MARKED_WRONG' ? 'MISSING_ACCEPTED_ANSWER' : 'MANUAL_REVIEW');
    setPreview([]);
  }, [appeal, open]);
  const currentDetail = detail;
  if (!currentDetail) return null;
  const max = currentDetail.question.maxScore;
  const assignmentQuestionId = currentDetail.question.id;

  async function calculatePreview() {
    setError('');
    const proposedScore = Number(score || max);
    if (!Number.isInteger(proposedScore) || proposedScore < 0 || proposedScore > max) { setError(`Điểm phải từ 0 đến ${max}.`); return; }
    let targets = candidates;
    if (scope === 'question_regrade' && reasonCode === 'MISSING_ACCEPTED_ANSWER') {
      const acceptedVariants = acceptedVariantText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      const result = await api.post<{ targets?: Array<{ attemptId: number; adjustmentId: number | null }>; error?: string }>(`/api/admin/assignments/${assignmentId}/adjustments/preview-accepted-variants`, { assignmentQuestionId, adjudicationPayload: { acceptedVariants } });
      if (!result.ok) { setError(result.data?.error ?? 'Không thể xem trước các biến thể đáp án.'); return; }
      const ids = new Set((result.data?.targets ?? []).map((item) => item.attemptId));
      targets = candidates.filter((item) => item.attemptId !== null && ids.has(item.attemptId));
    }
    if (scope === 'individual') targets = candidates.filter((item) => String(item.attemptId) === targetAttemptId);
    if (scope === 'question_regrade' && reasonCode !== 'MISSING_ACCEPTED_ANSWER') targets = candidates.filter((item) => item.result === 'incorrect');
    if (!targets.length) { setError('Không có kết quả phù hợp để điều chỉnh.'); return; }
    setPreview(targets.map((item) => ({ attemptId: item.attemptId as number, name: item.name, before: item.score, after: scope === 'full_credit_all' ? max : proposedScore, timeout: item.result === 'no_answer' })));
  }

  async function apply() {
    if (!currentDetail) return;
    if (!reasonText.trim()) { setError('Cần ghi rõ lý do điều chỉnh.'); return; }
    if (!preview.length) { setError('Hãy xem trước ảnh hưởng trước khi xác nhận.'); return; }
    const participantByAttempt = new Map(candidates.map((item) => [item.attemptId, item]));
    setBusy(true); setError('');
    const acceptedVariants = acceptedVariantText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const result = await api.post<{ error?: string }>(`/api/admin/assignments/${assignmentId}/adjustments`, {
      assignmentQuestionId, scope, reasonCode, source, reasonText,
      adjudicationPayload: { previewedAt: Date.now(), mode: scope, acceptedVariants },
      targets: preview.map((item) => ({ attemptId: item.attemptId, adjustedIsCorrect: scope === 'full_credit_all' ? true : isCorrect === 'true', adjustedScore: item.after })),
      expectedCurrentAdjustmentIds: Object.fromEntries(preview.map((item) => [String(item.attemptId), participantByAttempt.get(item.attemptId)?.expectedCurrentAdjustmentId ?? null])),
      ...(appeal ? { appealId: appeal.id } : {}),
    });
    setBusy(false);
    if (!result.ok) { setError(result.data?.error ?? 'Không thể điều chỉnh kết quả.'); return; }
    setPreview([]); setReasonText(''); setAcceptedVariantText(''); onOpenChange(false); await onApplied();
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl" onInteractOutside={(event) => event.preventDefault()}><DialogHeader><DialogTitle>Điều chỉnh kết quả</DialogTitle><DialogDescription>Điểm gốc và câu trả lời gốc được giữ nguyên. Kết quả mới là một lớp rà soát có audit trail.</DialogDescription></DialogHeader>{error && <AppAlert variant="error">{error}</AppAlert>}<div className="space-y-4"><div className="rounded-md border p-3 text-sm"><strong>Câu {detail.question.questionNumber}</strong><p className="mt-1">{detail.question.text}</p></div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Hình thức</Label><Select value={scope} onValueChange={(value)=>{setScope(value as Scope);setPreview([]);}}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="individual">Điều chỉnh một nhân viên</SelectItem><SelectItem value="question_regrade">Chấm lại các phản hồi sai của câu</SelectItem><SelectItem value="full_credit_all">Cho toàn bộ người gặp câu đủ điểm</SelectItem></SelectContent></Select></div>{scope==='individual'&&<div className="space-y-2"><Label>Nhân viên</Label><Select value={targetAttemptId} onValueChange={(value)=>{setTargetAttemptId(value);setPreview([]);}}><SelectTrigger><SelectValue placeholder="Chọn nhân viên"/></SelectTrigger><SelectContent>{candidates.map((item)=><SelectItem key={item.attemptId} value={String(item.attemptId)}>{item.name} · lượt #{item.attemptNumber}</SelectItem>)}</SelectContent></Select></div>}</div>{scope==='question_regrade'&&reasonCode==='MISSING_ACCEPTED_ANSWER'&&<div className="space-y-2"><Label>Biến thể đáp án được chấp nhận</Label><Textarea value={acceptedVariantText} onChange={(event)=>{setAcceptedVariantText(event.target.value);setPreview([]);}} placeholder={'Mỗi dòng một đáp án, ví dụ:\nAirway Bill\nairwaybill'}/><p className="text-xs text-muted-foreground">Chỉ phản hồi đã trả lời và khớp chính xác sau chuẩn hóa khoảng trắng/chữ hoa thường mới được chấm lại. Timeout/no answer không đổi.</p></div>}{scope!=='full_credit_all'&&<div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Điểm hiệu lực</Label><Input type="number" min={0} max={max} value={score} placeholder={String(max)} onChange={(event)=>{setScore(event.target.value);setPreview([]);}}/></div><div className="space-y-2"><Label>Kết quả hiệu lực</Label><Select value={isCorrect} onValueChange={(value)=>{setIsCorrect(value as 'true'|'false');setPreview([]);}}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="true">Đúng</SelectItem><SelectItem value="false">Chưa đúng / điểm một phần</SelectItem></SelectContent></Select></div></div>}<div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Lý do</Label><Select value={reasonCode} onValueChange={(value)=>{setReasonCode(value as Reason);setPreview([]);}}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="MISSING_ACCEPTED_ANSWER">Thiếu đáp án chấp nhận</SelectItem><SelectItem value="WRONG_ANSWER_KEY">Đáp án chuẩn ban đầu sai</SelectItem><SelectItem value="AMBIGUOUS_QUESTION">Câu hỏi chưa rõ / nhiều cách hiểu</SelectItem><SelectItem value="MANUAL_REVIEW">Xem xét thủ công</SelectItem><SelectItem value="ADMIN_SCORE_CORRECTION">Điều chỉnh điểm khác</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Nguồn</Label><Select value={source} onValueChange={(value)=>setSource(value as Source)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="employee_appeal">Nhân viên khiếu nại</SelectItem><SelectItem value="admin_review">Admin tự rà soát</SelectItem><SelectItem value="analytics_flag">Phát hiện từ Analytics</SelectItem></SelectContent></Select></div></div><div className="space-y-2"><Label>Lý do chi tiết</Label><Textarea value={reasonText} onChange={(event)=>setReasonText(event.target.value)} placeholder="Nêu căn cứ điều chỉnh và quyết định của Admin."/></div><div className="flex justify-end"><Button variant="secondary" onClick={()=>void calculatePreview()}>Xem trước ảnh hưởng</Button></div>{preview.length>0&&<div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"><strong>Preview trước khi áp dụng</strong><p className="mt-1 text-muted-foreground">{preview.length} kết quả sẽ thay đổi. Timeout/no answer vẫn giữ trạng thái timeout trong Analytics.</p><ul className="mt-2 space-y-1">{preview.map((item)=><li key={item.attemptId}>{item.name}: {item.before} → {item.after}{item.timeout?' · timeout/no answer':''}</li>)}</ul></div>}<div className="flex justify-end gap-2"><Button variant="ghost" onClick={()=>onOpenChange(false)}>Hủy</Button><Button disabled={busy||preview.length===0} onClick={apply}>{busy?'Đang áp dụng…':'Xác nhận điều chỉnh'}</Button></div></div></DialogContent></Dialog>;
}
