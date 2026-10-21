import { useState } from 'react';
import { AppAlert } from '@/components/AppAlert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { AssignmentAttemptQuestionDetail } from '@/types';

const reasons = [
  ['ANSWER_MARKED_WRONG', 'Tôi cho rằng câu trả lời của mình đúng'],
  ['ANSWER_KEY_DISPUTE', 'Tôi cho rằng đáp án chuẩn chưa đúng / chưa đầy đủ'],
  ['QUESTION_AMBIGUOUS', 'Câu hỏi chưa rõ hoặc có nhiều cách hiểu'],
  ['TIMER_OR_SYSTEM_ISSUE', 'Không đủ thời gian / gặp lỗi hệ thống'],
  ['OTHER', 'Khác'],
] as const;

export function AssignmentAppealDialog({ open, onOpenChange, question, onSubmit }: {
  open: boolean; onOpenChange: (value: boolean) => void; question: AssignmentAttemptQuestionDetail | null;
  onSubmit: (reasonCode: string, message: string) => Promise<string | null>;
}) {
  const [reasonCode, setReasonCode] = useState<(typeof reasons)[number][0]>('ANSWER_MARKED_WRONG');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!question) return null;
  async function submit() {
    if (message.trim().length < 10) { setError('Vui lòng mô tả phản hồi ít nhất 10 ký tự.'); return; }
    setBusy(true); setError('');
    const failure = await onSubmit(reasonCode, message.trim());
    setBusy(false);
    if (failure) { setError(failure); return; }
    setMessage(''); onOpenChange(false);
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl" onInteractOutside={(event) => event.preventDefault()}>
      <DialogHeader><DialogTitle>Khiếu nại / phản hồi</DialogTitle><DialogDescription>Phản hồi được gửi để Admin xem xét, không tự thay đổi kết quả.</DialogDescription></DialogHeader>
      {error && <AppAlert variant="error">{error}</AppAlert>}
      <div className="space-y-4">
        <div className="rounded-md border p-3 text-sm"><strong>Câu {question.questionNumber}</strong><p className="mt-1 whitespace-pre-wrap">{question.text}</p><p className="mt-2 text-muted-foreground">Kết quả hiện tại: {question.score}/{question.maxScore} điểm</p></div>
        <div className="space-y-2"><Label>Lý do</Label><Select value={reasonCode} onValueChange={(value) => setReasonCode(value as typeof reasonCode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{reasons.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label>Nội dung phản hồi</Label><Textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Mô tả rõ lý do để Admin có thể xem xét." rows={5} /></div>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Hủy</Button><Button disabled={busy} onClick={() => void submit()}>{busy ? 'Đang gửi…' : 'Gửi phản hồi'}</Button></div>
      </div>
    </DialogContent>
  </Dialog>;
}
