import { QuadOptionGrid } from '@/components/game/QuadOptionGrid';
import { TimerBar } from '@/components/game/TimerBar';
import { MainContent } from '@/components/layout';
import { OptionText } from '@/components/OptionText';
import { QuestionImage } from '@/components/QuestionImage';
import { QuestionMedia } from '@/components/QuestionMedia';
import { QuestionText } from '@/components/QuestionText';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { hasQuestionImage, quadColor } from '@/helpers';
import type { QuestionPayload } from '../../../types';

interface Props {
  question: QuestionPayload;
  timeLeft: number;
  answeredCount: number;
  totalPlayers: number;
  onEndGame: () => void;
  onFinishQuestion: () => void;
}

export function GameQuestion({
  question,
  timeLeft,
  answeredCount,
  totalPlayers,
  onEndGame,
  onFinishQuestion,
}: Props) {
  const showImage = hasQuestionImage(question.imageUrl);
  // Only these types are "pick a tile" answers — ordering/geo/fill_blank/open_text/closest_to
  // don't have a single correct option to highlight, so they get their own message below.
  const isOptionBased =
    question.questionType === 'multiple_choice' ||
    question.questionType === 'true_false' ||
    question.questionType === 'multi_select';

  const options =
    question.questionType === 'true_false' && question.options.length === 0
      ? ['True', 'False']
      : question.options;

  return (
    <MainContent>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <Button type="button" size="sm" onClick={onFinishQuestion}>
          Kết thúc câu hỏi
        </Button>
        <Button type="button" variant="destructive" size="sm" onClick={onEndGame}>
          Kết thúc trò chơi
        </Button>
      </div>

      <Card className="w-full max-w-5xl">
        <CardContent className="flex flex-col p-4 sm:p-8 md:p-10">
          {/* Counter row */}
          <div className="mb-4 flex items-center justify-between">
            <span className="mono-label">
              Câu {question.questionIndex + 1} / {question.totalQuestions}
            </span>
            <span className="mono-label">{question.timeSec}s</span>
          </div>

          {question.mediaType ? (
            <QuestionMedia url={question.mediaUrl} kind={question.mediaType} className="mb-5" />
          ) : (
            showImage && (
              <QuestionImage src={question.imageUrl} className="question-image-host mb-5" />
            )
          )}

          {/* Big centered question */}
          <div
            className="mx-auto mb-5 max-w-[820px] text-center font-extrabold"
            style={{
              fontSize: 'clamp(1.6rem, 4vw, 42px)',
              lineHeight: 1.16,
              letterSpacing: '-0.02em',
            }}
          >
            <QuestionText text={question.text} />
          </div>

          {/* Timer bar + number */}
          <TimerBar timeLeft={timeLeft} totalSec={question.timeSec} className="mb-2 gap-4" />

          <div className="mb-6 text-center text-[13px] text-[#64748b]">
            {answeredCount} / {totalPlayers} đã trả lời
          </div>

          {isOptionBased && (
            <QuadOptionGrid
              options={options}
              interactive={false}
              glyphSize={26}
              staggerSec={0.07}
            />
          )}

          {question.questionType === 'closest_to' && (
            <div className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-center">
              <p className="text-sm text-muted-foreground">
                Câu số gần đúng — người chơi chọn một số từ{' '}
                <strong>
                  {question.rangeMin ?? 0} đến {question.rangeMax ?? 100}
                </strong>
              </p>
            </div>
          )}
          {question.questionType === 'open_text' && (
            <div className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-center">
              <p className="text-sm text-muted-foreground">
                Câu trả lời ngắn — người chơi nhập câu trả lời
              </p>
            </div>
          )}
          {question.questionType === 'ordering' && (
            <div className="mx-auto flex w-full max-w-xl flex-col gap-2">
              <p className="mb-1 text-center text-sm text-muted-foreground">
                Câu sắp xếp — người chơi đang kéo các mục theo đúng thứ tự
              </p>
              {options.map((opt, pos) => (
                <div
                  key={opt}
                  className="flex items-center gap-2 rounded-lg border border-border bg-[var(--surface2)] p-3"
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.8rem] font-extrabold text-white"
                    style={{ background: quadColor(pos) }}
                  >
                    {pos + 1}
                  </span>
                  <span className="flex-1">
                    <OptionText value={opt} imgClassName="option-img-sm" />
                  </span>
                </div>
              ))}
            </div>
          )}
          {question.questionType === 'matching' && (
            <div className="mx-auto grid w-full max-w-2xl grid-cols-2 gap-6">
              <div className="flex flex-col gap-2">
                <p className="mb-1 text-center text-xs text-muted-foreground">Vế trái</p>
                {options.map((opt, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: left items may repeat text
                    key={`left-${i}`}
                    className="flex items-center gap-2 rounded-lg border border-border bg-[var(--surface2)] p-3"
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.8rem] font-extrabold text-white"
                      style={{ background: quadColor(i) }}
                    >
                      {i + 1}
                    </span>
                    <span className="flex-1">
                      <OptionText value={opt} imgClassName="option-img-sm" />
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                <p className="mb-1 text-center text-xs text-muted-foreground">Vế phải (đã trộn)</p>
                {(question.rightOptions ?? []).map((opt, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: shuffled right column, values may repeat
                    key={`right-${i}`}
                    className="flex items-center gap-2 rounded-lg border border-border bg-[var(--surface2)] p-3"
                  >
                    <span className="flex-1">
                      <OptionText value={opt} imgClassName="option-img-sm" />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {question.questionType === 'geo' && (
            <div className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-center">
              <p className="text-sm text-muted-foreground">
                Câu bản đồ — người chơi chọn một vị trí trên bản đồ
              </p>
            </div>
          )}
          {question.questionType === 'fill_blank' && (
            <div className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-center">
              <p className="text-sm text-muted-foreground">
                Câu điền chỗ trống — người chơi điền {question.blankCount ?? 0} chỗ trống
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </MainContent>
  );
}
