import { RefreshCw, Rocket } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { DynamicLivePreview } from '@/types';

interface Props {
  preview: DynamicLivePreview;
  loading: boolean;
  onRegenerate(): void;
  onConfirm(): void;
  onClose(): void;
}

export function DynamicLivePreviewModal({
  preview,
  loading,
  onRegenerate,
  onConfirm,
  onClose,
}: Props) {
  return (
    <Dialog open onOpenChange={(open) => !open && !loading && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Đề Live xem trước</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Đây là bộ câu chính xác dùng chung cho tất cả người chơi trong phiên. Chỉ khi xác nhận,
            hệ thống mới tạo và đóng băng phiên Live.
          </p>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Badge>{preview.totalQuestions} câu</Badge>
          {Object.entries(preview.levelCounts).map(([code, count]) => (
            <Badge key={code} variant="outline">
              {code}: {count}
            </Badge>
          ))}
          <Badge variant="destructive">Critical: {preview.criticalCount}</Badge>
          <Badge variant="outline">Điểm tối đa: {preview.totalScore}</Badge>
          <Badge variant="outline">Thời gian: {preview.recommendedTotalSeconds} giây</Badge>
        </div>
        <ol className="max-h-[52vh] space-y-2 overflow-y-auto rounded-lg border p-2">
          {preview.questions.map((question, index) => (
            <li key={`${question.id}-${index}`} className="rounded-lg bg-muted/40 p-3">
              <strong className="text-sm">
                {index + 1}. {question.text}
              </strong>
              <p className="mt-1 text-xs text-muted-foreground">
                {question.time_sec} giây · {question.base_score} điểm
              </p>
            </li>
          ))}
        </ol>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Hủy
          </Button>
          <Button variant="secondary" onClick={onRegenerate} disabled={loading}>
            <RefreshCw className="size-4" /> {loading ? 'Đang tạo…' : 'Tạo lại'}
          </Button>
          <Button onClick={onConfirm} disabled={loading}>
            <Rocket className="size-4" /> {loading ? 'Đang bắt đầu…' : 'Bắt đầu Live Game'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
