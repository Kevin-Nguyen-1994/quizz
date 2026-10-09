import { ArrowDown, ArrowRight, ArrowUp, Check, GripVertical, X } from 'lucide-react';
import { useState } from 'react';
import { type LatLng, MapPicker } from '@/components/GeoMap';
import { QuadOptionGrid } from '@/components/game/QuadOptionGrid';
import { TimerBar } from '@/components/game/TimerBar';
import { IntegerInput } from '@/components/Input';
import { OptionText } from '@/components/OptionText';
import { QuestionImage } from '@/components/QuestionImage';
import { QuestionMedia } from '@/components/QuestionMedia';
import { QuestionText } from '@/components/QuestionText';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { countBlanks, hasQuestionImage, quadColor } from '@/helpers';
import { arrayMove, usePointerReorder } from '@/hooks/usePointerReorder';
import { cn } from '@/lib/utils';
import type { AssignmentAnswerSubmission, AssignmentQuestionPayload } from '@/types';

export function AssignmentQuestion({
  question,
  assignmentTitle,
  timeLeft,
  submitting,
  onSubmit,
}: {
  question: AssignmentQuestionPayload;
  assignmentTitle: string;
  timeLeft: number;
  submitting: boolean;
  onSubmit: (answer: AssignmentAnswerSubmission) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [text, setText] = useState('');
  const [numberValue, setNumberValue] = useState(question.rangeMin ?? 0);
  const [numberValid, setNumberValid] = useState(true);
  const blankCount = question.blankCount ?? countBlanks(question.text);
  const [fillValues, setFillValues] = useState<string[]>(() =>
    Array.from({ length: blankCount }, () => ''),
  );
  const [order, setOrder] = useState<number[]>(() => question.options.map((_, index) => index));
  const [pinPoint, setPinPoint] = useState<LatLng | null>(null);
  const [selectedLeft, setSelectedLeft] = useState<number | null>(null);
  const [links, setLinks] = useState<Array<number | null>>(() => question.options.map(() => null));
  const disabled = submitting || timeLeft <= 0;
  const moveOrder = (from: number, to: number) =>
    setOrder((current) => arrayMove(current, from, to));
  const reorder = usePointerReorder(moveOrder, disabled);

  const submit = (payload: Omit<AssignmentAnswerSubmission, 'questionId'>) => {
    if (!disabled) onSubmit({ questionId: question.questionId, ...payload });
  };

  function toggleMulti(index: number) {
    if (disabled) return;
    setSelectedIndices((current) =>
      current.includes(index) ? current.filter((value) => value !== index) : [...current, index],
    );
  }

  function tapRight(slot: number) {
    if (disabled || selectedLeft === null) return;
    setLinks((current) => {
      const next = current.map((value) => (value === slot ? null : value));
      next[selectedLeft] = slot;
      return next;
    });
    setSelectedLeft(null);
  }

  const isFill = question.questionType === 'fill_blank';
  const showImage = hasQuestionImage(question.imageUrl);
  const body = (() => {
    if (question.questionType === 'multiple_choice' || question.questionType === 'true_false') {
      const isTrueFalse = question.questionType === 'true_false';
      return (
        <div className="space-y-4">
          <QuadOptionGrid
            options={isTrueFalse ? ['Đúng', 'Sai'] : question.options}
            selectedIndex={selectedIndex}
            disabled={disabled}
            variant="assessment"
            lockOnSelection={false}
            colorFor={isTrueFalse ? (index) => (index === 0 ? '#047857' : '#b91c1c') : undefined}
            badgeFor={
              isTrueFalse
                ? (index) => (index === 0 ? <Check className="size-5" /> : <X className="size-5" />)
                : undefined
            }
            onSelect={setSelectedIndex}
          />
          <Button
            className="w-full"
            size="lg"
            disabled={disabled || selectedIndex === null}
            onClick={() => submit({ chosenIndex: selectedIndex })}
          >
            Gửi câu trả lời <ArrowRight className="size-4" />
          </Button>
        </div>
      );
    }
    if (question.questionType === 'multi_select') {
      return (
        <div className="space-y-4">
          <p className="text-center text-sm text-muted-foreground">Chọn tất cả đáp án đúng.</p>
          <QuadOptionGrid
            options={question.options}
            selectedIndices={selectedIndices}
            selectedBadge={<Check className="size-5" />}
            disabled={disabled}
            variant="assessment"
            lockOnSelection={false}
            onSelect={toggleMulti}
          />
          <Button
            className="w-full"
            size="lg"
            disabled={disabled || selectedIndices.length === 0}
            onClick={() => submit({ chosenIndices: selectedIndices })}
          >
            Gửi {selectedIndices.length > 0 ? `(${selectedIndices.length} đáp án)` : ''}{' '}
            <ArrowRight className="size-4" />
          </Button>
        </div>
      );
    }
    if (question.questionType === 'open_text') {
      return (
        <div className="space-y-3">
          <label htmlFor="assignment-text-answer" className="text-sm font-medium">
            Câu trả lời của bạn
          </label>
          <Input
            id="assignment-text-answer"
            value={text}
            disabled={disabled}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) =>
              event.key === 'Enter' && text.trim() && submit({ chosenText: text.trim() })
            }
            placeholder="Nhập câu trả lời…"
          />
          <Button
            className="w-full"
            size="lg"
            disabled={disabled || !text.trim()}
            onClick={() => submit({ chosenText: text.trim() })}
          >
            Gửi câu trả lời <ArrowRight className="size-4" />
          </Button>
        </div>
      );
    }
    if (question.questionType === 'closest_to') {
      const min = question.rangeMin ?? 0;
      const max = question.rangeMax ?? 100;
      const outOfRange =
        !numberValid || !Number.isInteger(numberValue) || numberValue < min || numberValue > max;
      return (
        <div className="space-y-3">
          <label htmlFor="assignment-number-answer" className="text-sm font-medium">
            Nhập số nguyên từ {min} đến {max}
          </label>
          <IntegerInput
            id="assignment-number-answer"
            min={min}
            max={max}
            value={numberValue}
            disabled={disabled}
            onValueChange={setNumberValue}
            onValidityChange={setNumberValid}
            className="text-center text-lg"
          />
          {outOfRange && (
            <p className="text-sm text-destructive">
              Giá trị phải là số nguyên từ {min} đến {max}.
            </p>
          )}
          <Button
            className="w-full"
            size="lg"
            disabled={disabled || outOfRange}
            onClick={() => submit({ chosenText: String(numberValue) })}
          >
            Gửi câu trả lời <ArrowRight className="size-4" />
          </Button>
        </div>
      );
    }
    if (isFill) {
      const fragments = question.text.split(/_{3,}/);
      return (
        <div className="space-y-4">
          <p className="text-base leading-loose">
            {fragments.map((fragment, index) => (
              <span key={`${index}-${fragment}`}>
                {fragment}
                {index < blankCount && (
                  <input
                    aria-label={`Ô trống ${index + 1}`}
                    value={fillValues[index] ?? ''}
                    disabled={disabled}
                    onChange={(event) =>
                      setFillValues((current) =>
                        current.map((value, position) =>
                          position === index ? event.target.value : value,
                        ),
                      )
                    }
                    className="mx-1 my-1 inline-block min-h-11 w-[min(8rem,70vw)] rounded-md border border-border bg-background px-2 py-2 text-center"
                  />
                )}
              </span>
            ))}
          </p>
          <Button
            className="w-full"
            size="lg"
            disabled={disabled || fillValues.some((value) => !value.trim())}
            onClick={() =>
              submit({ chosenText: JSON.stringify(fillValues.map((value) => value.trim())) })
            }
          >
            Gửi câu trả lời <ArrowRight className="size-4" />
          </Button>
        </div>
      );
    }
    if (question.questionType === 'ordering') {
      return (
        <div className="space-y-4">
          <p className="text-center text-sm text-muted-foreground">
            Kéo để sắp xếp theo đúng thứ tự.
          </p>
          <div
            className={cn(
              'flex flex-col gap-2',
              reorder.dragPos !== null && 'touch-none select-none',
            )}
            {...reorder.listProps}
          >
            {order.map((optionIndex, position) => (
              <div
                key={optionIndex}
                style={reorder.dragStyle(position)}
                className={cn(
                  'flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/40 p-3',
                  reorder.dragPos === position && 'z-20 scale-[1.02] border-primary shadow-xl',
                )}
              >
                <button
                  type="button"
                  aria-label="Kéo hoặc dùng phím mũi tên để sắp xếp"
                  disabled={disabled}
                  {...reorder.handleProps(position)}
                  className="flex size-11 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-lg text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                >
                  <GripVertical className="size-5" />
                </button>
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ background: quadColor(position) }}
                >
                  {position + 1}
                </span>
                <span className="min-w-0 flex-1 break-words">
                  <OptionText value={question.options[optionIndex]} imgClassName="option-img-sm" />
                </span>
                <span className="flex shrink-0 flex-col gap-1 sm:flex-row">
                  <button
                    type="button"
                    aria-label={`Di chuyển mục ở vị trí ${position + 1} lên`}
                    disabled={disabled || position === 0}
                    onClick={() => moveOrder(position, position - 1)}
                    className="flex size-11 items-center justify-center rounded-lg border border-border bg-background text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35 sm:size-9"
                  >
                    <ArrowUp className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Di chuyển mục ở vị trí ${position + 1} xuống`}
                    disabled={disabled || position === order.length - 1}
                    onClick={() => moveOrder(position, position + 1)}
                    className="flex size-11 items-center justify-center rounded-lg border border-border bg-background text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35 sm:size-9"
                  >
                    <ArrowDown className="size-4" aria-hidden />
                  </button>
                </span>
              </div>
            ))}
          </div>
          <Button
            className="w-full"
            size="lg"
            disabled={disabled}
            onClick={() => submit({ chosenIndices: order })}
          >
            Gửi thứ tự <ArrowRight className="size-4" />
          </Button>
        </div>
      );
    }
    if (question.questionType === 'geo') {
      return (
        <div className="space-y-4">
          <p className="text-center text-sm text-muted-foreground">Chạm vào bản đồ để đặt ghim.</p>
          <MapPicker
            value={pinPoint}
            onChange={disabled ? () => {} : setPinPoint}
            height="min(48vh, 420px)"
          />
          <Button
            className="w-full"
            size="lg"
            disabled={disabled || !pinPoint}
            onClick={() => pinPoint && submit({ chosenText: JSON.stringify(pinPoint) })}
          >
            Gửi vị trí <ArrowRight className="size-4" />
          </Button>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <p className="text-center text-sm text-muted-foreground">
          Chọn một mục bên trái, sau đó chọn mục tương ứng bên phải.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Chọn nội dung
            </legend>
            {question.options.map((left, index) => (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: matching labels may repeat and positions are the answer identity
                key={`left-${index}`}
                type="button"
                disabled={disabled}
                onClick={() => setSelectedLeft((current) => (current === index ? null : index))}
                className={cn(
                  'min-h-12 rounded-lg border p-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selectedLeft === index
                    ? 'border-primary ring-2 ring-primary'
                    : links[index] !== null
                      ? 'border-primary bg-primary/15'
                      : 'border-border bg-muted/40',
                )}
              >
                <OptionText value={left} imgClassName="option-img-sm" />
              </button>
            ))}
          </fieldset>
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Ghép với
            </legend>
            {(question.rightOptions ?? []).map((right, slot) => (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: matching labels may repeat and positions are the answer identity
                key={`right-${slot}`}
                type="button"
                disabled={disabled}
                onClick={() => tapRight(slot)}
                className={cn(
                  'min-h-12 rounded-lg border p-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  links.includes(slot)
                    ? 'border-primary bg-primary/15'
                    : 'border-border bg-muted/40',
                )}
              >
                <OptionText value={right} imgClassName="option-img-sm" />
              </button>
            ))}
          </fieldset>
        </div>
        <Button
          className="w-full"
          size="lg"
          disabled={disabled || links.some((value) => value === null)}
          onClick={() => submit({ chosenIndices: links })}
        >
          Gửi kết quả nối <ArrowRight className="size-4" />
        </Button>
      </div>
    );
  })();

  return (
    <div className="assignment-question mx-auto w-full max-w-3xl px-4 py-5 sm:py-8">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Bài kiểm tra</p>
        <h1 className="mb-2 mt-1 break-words text-lg leading-snug sm:text-xl">
          {assignmentTitle}
        </h1>
        <div className="mb-2 flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            Câu {question.questionIndex + 1}/{question.totalQuestions}
          </span>
          <span className="text-right">
            {submitting ? 'Đang gửi…' : `Còn ${timeLeft} giây`}
          </span>
        </div>
        <TimerBar timeLeft={timeLeft} totalSec={question.timeSec} />
      </div>
      <Card>
        <CardContent className="p-4 sm:p-6">
          {question.mediaType ? (
            <QuestionMedia url={question.mediaUrl} kind={question.mediaType} className="mb-4" />
          ) : (
            <QuestionImage src={question.imageUrl} className="question-image mb-4" />
          )}
          {!isFill && (
            <div className={cn('question-text mb-5', (showImage || question.mediaType) && 'mt-3')}>
              <QuestionText text={question.text} />
            </div>
          )}
          {body}
        </CardContent>
      </Card>
    </div>
  );
}
