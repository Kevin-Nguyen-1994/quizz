import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { sound } from '@/lib/sound';

interface Props {
  timeLeft: number;
  /** Total question time, used to compute the fill percentage. */
  totalSec: number;
  /** Layout extras for the row (margins, gap). */
  className?: string;
  /** Suppress the last-5-seconds tick sound (e.g. on a second device in the room). */
  silent?: boolean;
}

/**
 * Countdown bar + number row shared by the host question view and the player
 * question screen. Number color: default above 50% time left, `warn` between
 * 25–50%, `danger` below 25%; pulses during the last 5 seconds.
 */
export function TimerBar({ timeLeft, totalSec, className, silent }: Props) {
  useEffect(() => {
    if (!silent && timeLeft <= 5 && timeLeft > 0) sound.play('tick');
  }, [timeLeft, silent]);

  const pct = Math.max(0, (timeLeft / totalSec) * 100);
  const numClass = pct > 50 ? '' : pct > 25 ? 'warn' : 'danger';
  return (
    <div
      className={cn('flex items-center', className)}
      role="timer"
      aria-label={`Còn ${timeLeft} giây`}
    >
      <div
        className="timer-bar"
        role="progressbar"
        aria-label="Thời gian còn lại"
        aria-valuemin={0}
        aria-valuemax={totalSec}
        aria-valuenow={timeLeft}
      >
        <div className="timer-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className={cn('timer-num', numClass)} aria-hidden="true">
        {timeLeft}
      </span>
    </div>
  );
}
