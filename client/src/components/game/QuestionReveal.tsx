import { Check, MapPin } from 'lucide-react';
import { MapReveal } from '@/components/GeoMap';
import { OptionText } from '@/components/OptionText';
import { QuestionExplanation } from '@/components/QuestionExplanation';
import { optionLetter } from '@/helpers';
import type { QuestionResults } from '@/types';

interface Props {
  results: Pick<
    QuestionResults,
    | 'questionType'
    | 'correctAnswer'
    | 'correctIndex'
    | 'correctIndices'
    | 'correctBlanks'
    | 'correctOrder'
    | 'correctPairs'
    | 'geo'
    | 'imageUrl'
    | 'options'
    | 'rangeMin'
    | 'rangeMax'
    | 'explanation'
  >;
  /** Player view: highlight chosen vs correct options */
  myChosenIndex?: number | null;
  myChosenIndices?: number[] | null;
  /** Player view: where this player dropped their pin, for geo questions */
  myChosenPoint?: { lat: number; lng: number } | null;
  animate?: boolean;
}

export function QuestionReveal({
  results,
  myChosenIndex,
  myChosenIndices,
  myChosenPoint,
  animate = false,
}: Props) {
  const isOpenText = results.questionType === 'open_text';
  const isMultiSelect = results.questionType === 'multi_select';
  const isClosestTo = results.questionType === 'closest_to';
  const isFillBlank = results.questionType === 'fill_blank';
  const isOrdering = results.questionType === 'ordering';
  const isGeo = results.questionType === 'geo';
  const isMatching = results.questionType === 'matching';

  return (
    <>
      {isFillBlank ? (
        <div className="result-reveal-correct rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <p className="mb-2 text-[0.78rem] text-muted-foreground">Các đáp án đúng</p>
          <ol className="list-decimal space-y-1 pl-5">
            {(results.correctBlanks ?? []).map((ans, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional blanks
              <li key={i} className="font-bold text-emerald-500">
                {ans}
              </li>
            ))}
          </ol>
        </div>
      ) : isOrdering ? (
        <div className="result-reveal-correct rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <p className="mb-2 text-[0.78rem] text-muted-foreground">Thứ tự đúng</p>
          <ol className="list-decimal space-y-1 pl-5">
            {(results.correctOrder ?? results.options).map((item, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional order
              <li key={i} className="font-semibold text-emerald-500">
                {item}
              </li>
            ))}
          </ol>
        </div>
      ) : isMatching ? (
        <div className="result-reveal-correct rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <p className="mb-2 text-[0.78rem] text-muted-foreground">Các cặp đúng</p>
          <ul className="space-y-1">
            {(results.correctPairs ?? []).map((p, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: left items may repeat text
                key={`pair-${i}`}
                className="flex items-center gap-2 font-semibold text-emerald-500"
              >
                <span>{p.left}</span>
                <span className="text-muted-foreground">→</span>
                <span>{p.right}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : isGeo ? (
        <div className="result-reveal-correct rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
          <p className="mb-2 text-[0.78rem] text-muted-foreground">Vị trí đúng</p>
          {results.geo ? (
            <MapReveal correct={results.geo} guess={myChosenPoint ?? undefined} height={300} />
          ) : (
            <p className="text-sm text-muted-foreground">Vị trí được hiển thị trên màn hình quản trị.</p>
          )}
          <p className="mt-2 flex items-center justify-center gap-1 text-center text-xs text-muted-foreground">
            <Check className="size-3.5 text-emerald-500" /> vị trí đúng
            {myChosenPoint ? (
              <>
                · <MapPin className="size-3.5" /> vị trí của bạn
              </>
            ) : null}
          </p>
        </div>
      ) : isClosestTo ? (
        <div className="result-reveal-correct rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <p className="mb-1 text-[0.78rem] text-muted-foreground">Đáp án đúng</p>
          <p className="text-[1.8rem] font-bold text-emerald-500">{results.correctAnswer}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Khoảng: {results.rangeMin}–{results.rangeMax}
          </p>
        </div>
      ) : isOpenText ? (
        <div className="result-reveal-correct rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <p className="mb-1 text-[0.78rem] text-muted-foreground">Đáp án đúng</p>
          <p className="text-[1.1rem] font-bold text-emerald-500">{results.correctAnswer}</p>
        </div>
      ) : (
        <div className={`options-grid ${animate ? 'gap-2 p-0' : ''}`}>
          {results.options.map((opt, i) => {
            const isCorrect = isMultiSelect
              ? (results.correctIndices ?? []).includes(i)
              : i === results.correctIndex;
            const myChoice =
              myChosenIndex !== undefined || myChosenIndices !== undefined
                ? isMultiSelect
                  ? (myChosenIndices ?? []).includes(i)
                  : myChosenIndex === i
                : false;
            return (
              <div
                key={optionLetter(i)}
                className={`option-btn ${animate ? 'result-reveal' : ''} ${isCorrect ? 'correct' : myChoice ? 'wrong' : ''}`}
                style={{
                  cursor: 'default',
                  ...(animate ? { animationDelay: `${i * 0.06}s` } : {}),
                }}
              >
                <div className="option-letter">{optionLetter(i)}</div>
                <div className="option-text">
                  <OptionText value={opt} imgClassName="option-img-sm" />
                </div>
                {isCorrect && <Check className="ml-auto size-4" />}
              </div>
            );
          })}
        </div>
      )}
      <QuestionExplanation explanation={results.explanation} />
    </>
  );
}
