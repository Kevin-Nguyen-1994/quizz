import { ArrowRight, Check, GripVertical, SkipForward, X } from 'lucide-react';
import { useState } from 'react';
import { type LatLng, MapPicker } from '@/components/GeoMap';
import { QuadOptionGrid } from '@/components/game/QuadOptionGrid';
import { TimerBar } from '@/components/game/TimerBar';
import { IntegerInput } from '@/components/Input';
import { PageVCenter } from '@/components/layout';
import { OptionText } from '@/components/OptionText';
import { QuestionImage } from '@/components/QuestionImage';
import { QuestionMedia } from '@/components/QuestionMedia';
import { QuestionText } from '@/components/QuestionText';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { countBlanks, hasQuestionImage, quadColor } from '@/helpers';
import { arrayMove, usePointerReorder } from '@/hooks/usePointerReorder';
import { cn } from '@/lib/utils';
import type { QuestionPayload } from '@/types';

interface Props {
  question: QuestionPayload;
  timeLeft: number;
  selectedIndex: number | null;
  selectedIndices: number[];
  multiSelectSubmitted: boolean;
  openTextInput: string;
  openTextSubmitted: boolean;
  closestValue: number;
  closestSubmitted: boolean;
  eliminatedIndices: number[];
  answeredCount: number;
  totalPlayers: number;
  jokersEnabled: { pass: boolean; fiftyFifty: boolean };
  jokersUsed: { pass: boolean; fiftyFifty: boolean };
  onAnswer: (index: number) => void;
  onToggleMultiSelect: (index: number) => void;
  onMultiSelectSubmit: () => void;
  onOpenTextChange: (value: string) => void;
  onOpenTextSubmit: () => void;
  onClosestChange: (value: number) => void;
  onClosestSubmit: () => void;
  onPassJoker: () => void;
  onFiftyFiftyJoker: () => void;
  onFillSubmit: (answers: string[]) => void;
  onOrderSubmit: (order: number[]) => void;
  onGeoSubmit: (lat: number, lng: number) => void;
  onMatchingSubmit: (links: Array<number | null>) => void;
}

export function QuestionScreen({
  question,
  timeLeft,
  selectedIndex,
  selectedIndices,
  multiSelectSubmitted,
  openTextInput,
  openTextSubmitted,
  closestValue,
  closestSubmitted,
  eliminatedIndices,
  answeredCount,
  totalPlayers,
  jokersEnabled,
  jokersUsed,
  onAnswer,
  onToggleMultiSelect,
  onMultiSelectSubmit,
  onOpenTextChange,
  onOpenTextSubmit,
  onClosestChange,
  onClosestSubmit,
  onPassJoker,
  onFiftyFiftyJoker,
  onFillSubmit,
  onOrderSubmit,
  onGeoSubmit,
  onMatchingSubmit,
}: Props) {
  const isTrueFalse = question.questionType === 'true_false';
  const isOpenText = question.questionType === 'open_text';
  const isClosestTo = question.questionType === 'closest_to';
  const isMultiSelect = question.questionType === 'multi_select';
  const isMultipleChoice = question.questionType === 'multiple_choice';
  const isFillBlank = question.questionType === 'fill_blank';
  const isOrdering = question.questionType === 'ordering';
  const isGeo = question.questionType === 'geo';
  const isMatching = question.questionType === 'matching';
  const rangeMin = question.rangeMin ?? 0;
  const rangeMax = question.rangeMax ?? 100;

  // Ephemeral answer state for the newer types. Lazy-initialised from the
  // question (this component remounts per question), then reset below if the
  // same instance ever receives a new questionId.
  const blankCount = question.blankCount ?? countBlanks(question.text);
  const [fillValues, setFillValues] = useState<string[]>(() =>
    Array.from({ length: blankCount }, () => ''),
  );
  const [order, setOrder] = useState<number[]>(() => question.options.map((_, i) => i));
  const [localSubmitted, setLocalSubmitted] = useState(false);
  const [pinPoint, setPinPoint] = useState<LatLng | null>(null);
  const [closestInputIsInteger, setClosestInputIsInteger] = useState(() =>
    Number.isInteger(closestValue),
  );
  const [selectedLeft, setSelectedLeft] = useState<number | null>(null);
  const [links, setLinks] = useState<Array<number | null>>(() => question.options.map(() => null));
  const reorder = usePointerReorder(
    (from, to) => setOrder((prev) => arrayMove(prev, from, to)),
    localSubmitted,
  );

  // Reset ephemeral answer state when a new question arrives — the React
  // "reset state on prop change" pattern (runs during render, no effect needed).
  const [renderedFor, setRenderedFor] = useState(question.questionId);
  if (renderedFor !== question.questionId) {
    setRenderedFor(question.questionId);
    setFillValues(Array.from({ length: blankCount }, () => ''));
    setOrder(question.options.map((_, i) => i));
    setLocalSubmitted(false);
    setPinPoint(null);
    setClosestInputIsInteger(Number.isInteger(closestValue));
    setSelectedLeft(null);
    setLinks(question.options.map(() => null));
  }

  const hasAnswered =
    selectedIndex !== null ||
    openTextSubmitted ||
    multiSelectSubmitted ||
    closestSubmitted ||
    localSubmitted;
  const showImage = hasQuestionImage(question.imageUrl);

  function submitFill() {
    if (localSubmitted) return;
    setLocalSubmitted(true);
    onFillSubmit(fillValues);
  }

  function submitOrder() {
    if (localSubmitted) return;
    setLocalSubmitted(true);
    onOrderSubmit(order);
  }

  function submitGeo() {
    if (localSubmitted || !pinPoint) return;
    setLocalSubmitted(true);
    onGeoSubmit(pinPoint.lat, pinPoint.lng);
  }

  function tapLeft(i: number) {
    if (localSubmitted) return;
    setSelectedLeft((cur) => (cur === i ? null : i));
  }

  function tapRight(slot: number) {
    if (localSubmitted || selectedLeft === null) return;
    const left = selectedLeft;
    setLinks((prev) => {
      const next = [...prev];
      // Each right slot can serve at most one left item — clear it elsewhere first.
      for (let i = 0; i < next.length; i++) if (next[i] === slot) next[i] = null;
      next[left] = slot;
      return next;
    });
    setSelectedLeft(null);
  }

  function submitMatching() {
    if (localSubmitted) return;
    setLocalSubmitted(true);
    onMatchingSubmit(links);
  }

  return (
    <PageVCenter>
      <div
        className={
          showImage ? 'mx-auto w-full max-w-[min(900px,95vw)]' : 'mx-auto w-full max-w-[700px]'
        }
      >
        <div className="question-header">
          <div className="question-counter">
            Câu {question.questionIndex + 1} / {question.totalQuestions}
          </div>
          {question.mediaType ? (
            <QuestionMedia url={question.mediaUrl} kind={question.mediaType} className="my-3" />
          ) : (
            <QuestionImage src={question.imageUrl} className="question-image" />
          )}
          <div
            className="question-text"
            style={{ marginTop: question.mediaType || showImage ? 12 : 0 }}
          >
            <QuestionText text={question.text} />
          </div>
          {isClosestTo && (
            <p
              style={{
                fontSize: '0.8rem',
                color: 'var(--text2)',
                margin: '4px 0 0',
                textAlign: 'center',
              }}
            >
              Chọn số gần đáp án nhất ({rangeMin}–{rangeMax})
            </p>
          )}
          {isMultiSelect && (
            <p
              style={{
                fontSize: '0.8rem',
                color: 'var(--text2)',
                margin: '4px 0 0',
                textAlign: 'center',
              }}
            >
              Chọn tất cả đáp án đúng
            </p>
          )}
          <TimerBar timeLeft={timeLeft} totalSec={question.timeSec} className="mt-4 gap-3" />
          {/* Answer counter */}
          {totalPlayers > 0 && (
            <div className="answer-counter">
              {answeredCount} / {totalPlayers} người đã trả lời
            </div>
          )}
        </div>

        {/* Joker buttons */}
        {(jokersEnabled.pass || jokersEnabled.fiftyFifty) && !hasAnswered && (
          <div
            style={{
              display: 'flex',
              gap: 10,
              padding: '0 20px 4px',
              justifyContent: 'flex-end',
            }}
          >
            {jokersEnabled.pass && (
              <Button
                type="button"
                variant="warning"
                size="sm"
                disabled={jokersUsed.pass}
                title={
                  jokersUsed.pass
                    ? 'Bạn đã dùng quyền bỏ qua'
                    : 'Bỏ qua câu hỏi và nhận điểm cơ bản'
                }
                onClick={onPassJoker}
              >
                <span className="inline-flex items-center gap-1.5">
                  {jokersUsed.pass ? (
                    <Check className="size-4" />
                  ) : (
                    <SkipForward className="size-4" />
                  )}{' '}
                  Bỏ qua
                </span>
              </Button>
            )}
            {jokersEnabled.fiftyFifty && isMultipleChoice && (
              <Button
                type="button"
                variant="warning"
                size="sm"
                disabled={jokersUsed.fiftyFifty}
                title={jokersUsed.fiftyFifty ? 'Bạn đã dùng quyền 50/50' : 'Loại hai đáp án sai'}
                onClick={onFiftyFiftyJoker}
              >
                <span className="inline-flex items-center gap-1.5">
                  {jokersUsed.fiftyFifty && <Check className="size-4" />} 50/50
                </span>
              </Button>
            )}
          </div>
        )}

        {isTrueFalse ? (
          <QuadOptionGrid
            className="p-5"
            options={['Đúng', 'Sai']}
            selectedIndex={selectedIndex}
            colorFor={(i) => (i === 0 ? '#047857' : '#b91c1c')}
            badgeFor={(i) => (i === 0 ? <Check className="size-5" /> : <X className="size-5" />)}
            optionClassName="justify-center"
            labelClassName="flex-none"
            onSelect={onAnswer}
          />
        ) : isClosestTo ? (
          <div style={{ padding: '20px' }}>
            <div
              className="option-stagger"
              style={{
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '20px',
              }}
            >
              {(() => {
                const outOfRange =
                  !closestInputIsInteger ||
                  !Number.isInteger(closestValue) ||
                  closestValue < rangeMin ||
                  closestValue > rangeMax;
                return (
                  <>
                    <label
                      htmlFor="closest-answer"
                      className="mb-2 block text-sm font-medium text-muted-foreground"
                    >
                      Câu trả lời — số nguyên từ {rangeMin} đến {rangeMax}
                    </label>
                    <IntegerInput
                      id="closest-answer"
                      min={rangeMin}
                      max={rangeMax}
                      value={closestValue}
                      randomOnInvalid
                      disabled={closestSubmitted}
                      aria-invalid={outOfRange}
                      onValueChange={onClosestChange}
                      onValidityChange={setClosestInputIsInteger}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !closestSubmitted && !outOfRange) {
                          onClosestSubmit();
                        }
                      }}
                      className="mb-2 text-center text-lg"
                    />
                    <p
                      className={`mb-3 text-sm ${outOfRange ? 'text-destructive' : 'text-muted-foreground'}`}
                    >
                      {outOfRange
                        ? `Nhập số nguyên từ ${rangeMin} đến ${rangeMax}.`
                        : `Khoảng: ${rangeMin} – ${rangeMax}`}
                    </p>
                    <Button
                      type="button"
                      variant="default"
                      size="lg"
                      className="w-full"
                      onClick={onClosestSubmit}
                      disabled={closestSubmitted || outOfRange}
                    >
                      {closestSubmitted ? (
                        'Đã gửi'
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          Gửi câu trả lời <ArrowRight className="size-4" />
                        </span>
                      )}
                    </Button>
                  </>
                );
              })()}
            </div>
          </div>
        ) : isOpenText ? (
          <div style={{ padding: '20px' }}>
            <div
              className="option-stagger"
              style={{
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '20px',
              }}
            >
              <label
                htmlFor="open-text-answer"
                style={{
                  display: 'block',
                  color: 'var(--text2)',
                  fontSize: '0.85rem',
                  marginBottom: 10,
                  fontWeight: 500,
                }}
              >
                Câu trả lời của bạn
              </label>
              <Input
                id="open-text-answer"
                type="text"
                value={openTextInput}
                onChange={(e) => onOpenTextChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !openTextSubmitted && onOpenTextSubmit()}
                disabled={openTextSubmitted}
                placeholder="Nhập câu trả lời…"
                className="mb-3 text-lg"
              />
              <Button
                type="button"
                variant="default"
                size="lg"
                className="w-full"
                onClick={onOpenTextSubmit}
                disabled={openTextSubmitted || !openTextInput.trim()}
              >
                {openTextSubmitted ? (
                  'Đã gửi'
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    Gửi câu trả lời <ArrowRight className="size-4" />
                  </span>
                )}
              </Button>
            </div>
          </div>
        ) : isMultiSelect ? (
          <div className="p-5">
            <QuadOptionGrid
              options={question.options}
              selectedIndices={selectedIndices}
              selectedBadge={<Check className="size-5" />}
              disabled={multiSelectSubmitted}
              onSelect={onToggleMultiSelect}
            />
            <Button
              type="button"
              variant="default"
              size="lg"
              className="mt-4 w-full"
              onClick={onMultiSelectSubmit}
              disabled={multiSelectSubmitted || selectedIndices.length === 0}
            >
              {multiSelectSubmitted ? (
                'Đã gửi'
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  Gửi {selectedIndices.length > 0 ? `(${selectedIndices.length} đáp án)` : ''}
                  <ArrowRight className="size-4" />
                </span>
              )}
            </Button>
          </div>
        ) : isFillBlank ? (
          <div className="p-5">
            <div
              className="option-stagger"
              style={{
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '20px',
              }}
            >
              <p className="text-[1.05rem] leading-loose">
                {question.text.split(/_{3,}/).map((frag, fi) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fragments are positional
                  <span key={fi}>
                    {frag}
                    {fi < blankCount && (
                      <input
                        type="text"
                        value={fillValues[fi] ?? ''}
                        disabled={localSubmitted}
                        onChange={(e) =>
                          setFillValues((v) => {
                            const n = [...v];
                            n[fi] = e.target.value;
                            return n;
                          })
                        }
                        onKeyDown={(e) => e.key === 'Enter' && submitFill()}
                        placeholder={`#${fi + 1}`}
                        aria-label={`Ô trống ${fi + 1}`}
                        className="mx-1 my-1 inline-block min-h-11 w-[min(120px,70vw)] rounded-md border border-border bg-background px-2 py-2 text-center align-middle text-base"
                      />
                    )}
                  </span>
                ))}
              </p>
              <Button
                type="button"
                variant="default"
                size="lg"
                className="mt-4 w-full"
                onClick={submitFill}
                disabled={localSubmitted || fillValues.slice(0, blankCount).some((v) => !v.trim())}
              >
                {localSubmitted ? (
                  'Đã gửi'
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    Gửi câu trả lời <ArrowRight className="size-4" />
                  </span>
                )}
              </Button>
            </div>
          </div>
        ) : isOrdering ? (
          <div className="p-5">
            <p className="mb-2 text-center text-sm" style={{ color: 'var(--text2)' }}>
              Kéo thả hoặc dùng phím mũi tên để sắp xếp đúng thứ tự.
            </p>
            <div
              className={cn(
                'flex flex-col gap-2',
                reorder.dragPos !== null && 'touch-none select-none',
              )}
              {...reorder.listProps}
            >
              {order.map((optIdx, pos) => (
                <div
                  key={optIdx}
                  style={reorder.dragStyle(pos)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border bg-[var(--surface2)] p-3',
                    reorder.dragPos === pos
                      ? 'scale-[1.02] cursor-grabbing border-primary shadow-2xl ring-2 ring-primary'
                      : 'border-border transition-transform',
                    reorder.dragPos !== null && reorder.dragPos !== pos && 'opacity-60',
                  )}
                >
                  <button
                    type="button"
                    aria-label="Kéo hoặc dùng phím mũi tên để sắp xếp"
                    disabled={localSubmitted}
                    {...reorder.handleProps(pos)}
                    className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-default disabled:opacity-40"
                  >
                    <GripVertical className="size-5" />
                  </button>
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.8rem] font-extrabold text-white"
                    style={{ background: quadColor(pos) }}
                  >
                    {pos + 1}
                  </span>
                  <span className="flex-1">
                    <OptionText value={question.options[optIdx]} imgClassName="option-img-sm" />
                  </span>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="default"
              size="lg"
              className="mt-4 w-full"
              onClick={submitOrder}
              disabled={localSubmitted}
            >
              {localSubmitted ? (
                'Đã gửi'
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  Gửi thứ tự <ArrowRight className="size-4" />
                </span>
              )}
            </Button>
          </div>
        ) : isGeo ? (
          <div className="p-5">
            <p className="mb-2 text-center text-sm" style={{ color: 'var(--text2)' }}>
              Chạm vào bản đồ để đặt ghim gần vị trí đúng nhất.
            </p>
            <MapPicker
              value={pinPoint}
              onChange={localSubmitted ? () => {} : setPinPoint}
              height="52vh"
            />
            <Button
              type="button"
              variant="default"
              size="lg"
              className="mt-4 w-full"
              onClick={submitGeo}
              disabled={localSubmitted || !pinPoint}
            >
              {localSubmitted ? (
                'Đã gửi'
              ) : pinPoint ? (
                <span className="inline-flex items-center gap-1.5">
                  Gửi vị trí <ArrowRight className="size-4" />
                </span>
              ) : (
                'Chạm vào bản đồ để đặt ghim'
              )}
            </Button>
          </div>
        ) : isMatching ? (
          <div className="p-5">
            <p className="mb-3 text-center text-sm" style={{ color: 'var(--text2)' }}>
              Chọn một nội dung, sau đó chọn nội dung tương ứng.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Chọn nội dung
                </p>
                {question.options.map((left, i) => {
                  const linkedSlot = links[i];
                  const isSelected = selectedLeft === i;
                  return (
                    <button
                      // biome-ignore lint/suspicious/noArrayIndexKey: left items may repeat text
                      key={`left-${i}`}
                      type="button"
                      disabled={localSubmitted}
                      onClick={() => tapLeft(i)}
                      className={cn(
                        'min-h-12 flex items-center gap-2 rounded-lg border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default',
                        isSelected
                          ? 'border-primary ring-2 ring-primary'
                          : linkedSlot !== null
                            ? 'border-transparent text-white'
                            : 'border-border bg-[var(--surface2)]',
                      )}
                      style={
                        linkedSlot !== null && !isSelected ? { background: quadColor(i) } : undefined
                      }
                    >
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.8rem] font-extrabold text-white"
                        style={{ background: quadColor(i) }}
                      >
                        {i + 1}
                      </span>
                      <span className="flex-1">
                        <OptionText value={left} imgClassName="option-img-sm" />
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Ghép với
                </p>
                {(question.rightOptions ?? []).map((right, slot) => {
                  const linkedLeft = links.indexOf(slot);
                  return (
                    <button
                      // biome-ignore lint/suspicious/noArrayIndexKey: right column is a shuffled, possibly-duplicate list
                      key={`right-${slot}`}
                      type="button"
                      disabled={localSubmitted}
                      onClick={() => tapRight(slot)}
                      className={cn(
                        'min-h-12 flex items-center gap-2 rounded-lg border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default',
                        linkedLeft !== -1 ? 'border-transparent text-white' : 'border-border bg-[var(--surface2)]',
                      )}
                      style={linkedLeft !== -1 ? { background: quadColor(linkedLeft) } : undefined}
                    >
                      <span className="flex-1">
                        <OptionText value={right} imgClassName="option-img-sm" />
                      </span>
                      {linkedLeft !== -1 && (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/20 text-[0.8rem] font-extrabold text-white">
                          {linkedLeft + 1}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <Button
              type="button"
              variant="default"
              size="lg"
              className="mt-4 w-full"
              onClick={submitMatching}
              disabled={localSubmitted}
            >
              {localSubmitted ? (
                'Đã gửi'
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  Gửi kết quả nối <ArrowRight className="size-4" />
                </span>
              )}
            </Button>
          </div>
        ) : (
          <QuadOptionGrid
            className="p-5"
            options={question.options}
            selectedIndex={selectedIndex}
            eliminatedIndices={eliminatedIndices}
            onSelect={onAnswer}
          />
        )}
      </div>
    </PageVCenter>
  );
}
