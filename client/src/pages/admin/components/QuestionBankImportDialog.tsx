import { FileJson, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { AppAlert } from '@/components/AppAlert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type { QuestionBankImportResult } from '@/types';

interface Props {
  open: boolean;
  onClose(): void;
  onImported(result: QuestionBankImportResult): void;
}

function Breakdown({ title, values }: { title: string; values: Record<string, number> }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(values).map(([key, count]) => (
          <Badge key={key} variant="outline">
            {key}: {count}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export function QuestionBankImportDialog({ open, onClose, onImported }: Props) {
  const api = useAuthFetch();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [result, setResult] = useState<QuestionBankImportResult | null>(null);
  const [selectedUpdates, setSelectedUpdates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setFileName('');
    setSourceText('');
    setResult(null);
    setSelectedUpdates(new Set());
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  }

  function close() {
    if (loading) return;
    reset();
    onClose();
  }

  async function selectFile(file: File | undefined) {
    if (!file) return;
    setError('');
    setResult(null);
    if (!file.name.toLowerCase().endsWith('.json')) {
      setError('Vui lòng chọn file JSON của TiL Question Bank Import.');
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setSourceText(text);
    setLoading(true);
    const response = await api.post<{ result?: QuestionBankImportResult; error?: string }>(
      '/api/admin/question-bank/imports/dry-run',
      { sourceText: text, sourceFilename: file.name },
    );
    setLoading(false);
    if (!response.ok || !response.data.result) {
      setError(response.data.error ?? 'Không thể kiểm tra file JSON.');
      return;
    }
    setResult(response.data.result);
    setSelectedUpdates(new Set());
  }

  async function applyImport() {
    if (!result || !sourceText) return;
    setLoading(true);
    setError('');
    const response = await api.post<{ result?: QuestionBankImportResult; error?: string }>(
      '/api/admin/question-bank/imports/apply',
      {
        sourceText,
        sourceFilename: fileName,
        updateSourceQuestionIds: [...selectedUpdates],
      },
    );
    setLoading(false);
    if (!response.ok || !response.data.result) {
      setError(
        response.data.error ?? 'Không thể nhập Question Bank. Không có dữ liệu nào được ghi.',
      );
      return;
    }
    onImported(response.data.result);
    reset();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        className="sm:max-w-3xl"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Import JSON vào Ngân hàng câu hỏi</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Nhập câu hỏi từ file TiL Question Bank Import. Thao tác này không tạo Bộ đề hoặc Bài
            kiểm tra.
          </p>
        </DialogHeader>

        {error && <AppAlert variant="error">{error}</AppAlert>}
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(event) => selectFile(event.target.files?.[0])}
        />
        {!result ? (
          <button
            type="button"
            className="grid min-h-44 place-items-center rounded-xl border-2 border-dashed border-border p-6 text-center hover:border-primary/60 hover:bg-muted/30"
            onClick={() => inputRef.current?.click()}
            disabled={loading}
          >
            <span>
              {loading ? (
                'Đang kiểm tra toàn bộ file…'
              ) : (
                <>
                  <FileJson className="mx-auto mb-3 size-9 text-primary" />
                  <strong className="block">Chọn question-bank.json</strong>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    Hệ thống luôn chạy dry-run và validate trước khi ghi.
                  </span>
                </>
              )}
            </span>
          </button>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-4">
              <div className="rounded-lg bg-muted p-3">
                <strong className="block text-xl">{result.questionCount}</strong>
                <span className="text-xs text-muted-foreground">Tổng số câu</span>
              </div>
              <div className="rounded-lg bg-emerald-500/10 p-3">
                <strong className="block text-xl text-emerald-700">{result.insertedCount}</strong>
                <span className="text-xs">Câu mới</span>
              </div>
              <div className="rounded-lg bg-muted p-3">
                <strong className="block text-xl">{result.skippedCount}</strong>
                <span className="text-xs text-muted-foreground">Không thay đổi</span>
              </div>
              <div className="rounded-lg bg-amber-500/10 p-3">
                <strong className="block text-xl text-amber-700">{result.conflictCount}</strong>
                <span className="text-xs">Có phiên bản mới</span>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Breakdown title="Theo bậc" values={result.levels} />
              <Breakdown title="Theo loại" values={result.types} />
              <Breakdown title="Theo nhóm" values={result.categories} />
              <Breakdown title="Theo độ khó" values={result.difficulties} />
            </div>
            {result.conflicts.length > 0 && (
              <div className="space-y-2">
                <div>
                  <p className="font-semibold">Câu có phiên bản nội dung mới</p>
                  <p className="text-xs text-muted-foreground">
                    Không câu nào bị ghi đè tự động. Chỉ các câu được chọn mới tăng revision.
                  </p>
                </div>
                <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border p-2">
                  {result.conflicts.map((conflict) => (
                    <div
                      key={conflict.sourceQuestionId}
                      className="flex gap-3 rounded-lg p-2 hover:bg-muted"
                    >
                      <Checkbox
                        aria-label={`Cập nhật ${conflict.sourceQuestionId}`}
                        checked={selectedUpdates.has(conflict.sourceQuestionId)}
                        onCheckedChange={(checked) =>
                          setSelectedUpdates((current) => {
                            const next = new Set(current);
                            if (checked === true) next.add(conflict.sourceQuestionId);
                            else next.delete(conflict.sourceQuestionId);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0">
                        <strong className="text-sm">
                          {conflict.sourceQuestionId} · Rev {conflict.existingRevision}
                        </strong>
                        <span className="block text-xs text-muted-foreground">
                          {conflict.topic || 'Chưa có topic'}
                        </span>
                        <span className="block truncate text-sm">{conflict.text}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={loading}>
            Đóng
          </Button>
          {result && (
            <>
              <Button
                variant="secondary"
                onClick={() => inputRef.current?.click()}
                disabled={loading}
              >
                Chọn file khác
              </Button>
              <Button onClick={applyImport} disabled={loading}>
                <Upload className="size-4" />
                {loading ? 'Đang nhập…' : 'Nhập vào Ngân hàng'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
