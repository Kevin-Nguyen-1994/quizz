import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface PlayerAnswer {
  questionId: number;
  questionText: string;
  score: number;
  isCorrect: boolean;
}

interface Props {
  playerName: string;
  answers: PlayerAnswer[];
  onRemovePoints: (questionId: number) => void;
  onClose: () => void;
}

export function RemovePointsModal({ playerName, answers, onClose, onRemovePoints }: Props) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-6">
      <Card className="z-[201] max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <CardContent className="p-6">
          <h2 className="mb-1">Trừ điểm — {playerName}</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Chọn câu hỏi cần xóa điểm của người chơi này.
          </p>

          {answers.length === 0 && <p className="text-muted-foreground">Không có câu trả lời.</p>}

          <div className="flex flex-col gap-2">
            {answers.map((a) => (
              <div
                key={a.questionId}
                className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="mb-0.5 text-[0.9rem] font-semibold">{a.questionText}</p>
                  <p className="text-sm text-muted-foreground">
                    {a.isCorrect ? 'Đúng' : 'Sai'} — {a.score} điểm
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={a.score === 0}
                  onClick={() => onRemovePoints(a.questionId)}
                  className="shrink-0 text-destructive disabled:opacity-40"
                >
                  Trừ điểm
                </Button>
              </div>
            ))}
          </div>

          <div className="mt-6 flex gap-2">
            <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
              Đóng
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
