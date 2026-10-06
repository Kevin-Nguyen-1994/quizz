import { Crown, Dices, PartyPopper, Play, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AvatarDisplay } from '@/components/AvatarPicker';
import { Confetti } from '@/components/game/Confetti';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { sound } from '@/lib/sound';

interface PlayerLike {
  rank: number;
  username: string;
  totalScore: number;
  avatar?: string;
}

interface Props {
  players: PlayerLike[];
}

type Phase = 'idle' | 'falling' | 'done';

interface Peg {
  x: number;
  y: number;
}

interface Ball {
  username: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  landed: boolean;
  el: HTMLDivElement | null;
}

const BALL_R = 12;
const PEG_R = 5;
const PEG_ROW_GAP = 34;
const PEG_COL_GAP = 34;
const GRAVITY = 480; // px/s^2
const MAX_FALL_SPEED = 480; // terminal velocity, keeps a ball from tunneling through a peg in one frame
const WALL_RESTITUTION = 0.55;
const PEG_RESTITUTION = 0.6;
const PEG_KICK = 70; // px/s random sideways nudge on every peg hit — keeps the drop chaotic, not deterministic
const BALL_RESTITUTION = 0.5;
const HARD_TIMEOUT_MS = 20000; // safety net: force-settle stragglers so the drop can never hang

function buildPegs(W: number, H: number): Peg[] {
  const marginX = 22;
  const topY = 46;
  const bottomY = H - 90;
  const rows = Math.max(3, Math.floor((bottomY - topY) / PEG_ROW_GAP));

  // Center the lattice so `floor()`'s leftover width splits evenly on both
  // sides instead of piling up as one dead, unpegged lane on the right.
  const usableWidth = W - marginX * 2;
  const cols = Math.max(3, Math.floor(usableWidth / PEG_COL_GAP) + 1);
  const rowWidth = (cols - 1) * PEG_COL_GAP;
  const leftX = marginX + (usableWidth - rowWidth) / 2;

  const pegs: Peg[] = [];
  for (let row = 0; row < rows; row++) {
    const y = topY + row * PEG_ROW_GAP;
    const isOffsetRow = row % 2 === 1;
    const rowCols = isOffsetRow ? cols - 1 : cols;
    const rowStartX = isOffsetRow ? leftX + PEG_COL_GAP / 2 : leftX;
    for (let col = 0; col < rowCols; col++) {
      pegs.push({ x: rowStartX + col * PEG_COL_GAP, y });
    }
  }
  return pegs;
}

/** Reflects a ball's velocity off a fixed point (peg, wall corner, resting ball) it's moving into. */
function bounceOffFixed(ball: Ball, nx: number, ny: number, restitution: number, kick = 0) {
  const vDotN = ball.vx * nx + ball.vy * ny;
  if (vDotN < 0) {
    const factor = (1 + restitution) * vDotN;
    ball.vx -= factor * nx;
    ball.vy -= factor * ny;
  }
  if (kick) ball.vx += (Math.random() - 0.5) * kick;
}

/**
 * Final-podium "next quiz maker" picker. Host checks any subset of players,
 * then their avatars drop from the top of a Plinko-style board, bouncing
 * off pegs and each other on the way down — whoever lands last makes the
 * next quiz. Purely presentational, nothing persisted. The outcome is a
 * genuine physics result (no rigged pre-pick): each peg hit adds a small
 * random kick specifically so the drop never plays out the same way twice.
 */
export function QuizMakerPicker({ players }: Props) {
  // Players are identified by username (unique per session) — ranks can tie.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>('idle');
  const [winner, setWinner] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [dropList, setDropList] = useState<PlayerLike[]>([]);
  const [pegs, setPegs] = useState<Peg[]>([]);

  const arenaRef = useRef<HTMLDivElement | null>(null);
  const elementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const ballsRef = useRef<Ball[]>([]);
  const landedOrderRef = useRef<string[]>([]);
  const rafRef = useRef<number | null>(null);

  const stopLoop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  useEffect(() => () => stopLoop(), [stopLoop]);

  const finish = useCallback(
    (username: string) => {
      stopLoop();
      sound.stop('drumroll');
      sound.play('fanfare');
      setWinner(username);
      setPhase('done');
      setCelebrate(true);
    },
    [stopLoop],
  );

  useEffect(() => {
    if (phase !== 'falling') return;
    const arena = arenaRef.current;
    if (!arena) return;

    const W = arena.clientWidth;
    const H = arena.clientHeight;

    const pegList = buildPegs(W, H);
    setPegs(pegList);

    const marginX = BALL_R + 4;
    ballsRef.current = dropList.map((p) => ({
      username: p.username,
      x: marginX + Math.random() * (W - marginX * 2),
      y: -BALL_R - Math.random() * 60,
      vx: (Math.random() - 0.5) * 40,
      vy: 0,
      landed: false,
      el: elementsRef.current.get(p.username) ?? null,
    }));
    landedOrderRef.current = [];

    const start = performance.now();
    let last = start;

    const frame = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;

      const balls = ballsRef.current;

      for (const ball of balls) {
        if (ball.landed) continue;

        ball.vy = Math.min(MAX_FALL_SPEED, ball.vy + GRAVITY * dt);
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;

        if (ball.x < BALL_R) {
          ball.x = BALL_R;
          ball.vx = Math.abs(ball.vx) * WALL_RESTITUTION;
        } else if (ball.x > W - BALL_R) {
          ball.x = W - BALL_R;
          ball.vx = -Math.abs(ball.vx) * WALL_RESTITUTION;
        }

        for (const peg of pegList) {
          const dx = ball.x - peg.x;
          const dy = ball.y - peg.y;
          const dist = Math.hypot(dx, dy) || 0.001;
          const minDist = BALL_R + PEG_R;
          if (dist >= minDist) continue;
          const nx = dx / dist;
          const ny = dy / dist;
          ball.x += nx * (minDist - dist);
          ball.y += ny * (minDist - dist);
          bounceOffFixed(ball, nx, ny, PEG_RESTITUTION, PEG_KICK);
        }

        if (ball.y > H - BALL_R) {
          ball.y = H - BALL_R;
          ball.vx *= 0.3;
          ball.vy = 0;
          ball.landed = true;
          landedOrderRef.current.push(ball.username);
        }
      }

      for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
          const a = balls[i];
          const b = balls[j];
          if (a.landed && b.landed) continue;

          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.001;
          const minDist = BALL_R * 2;
          if (dist >= minDist) continue;

          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minDist - dist;

          if (a.landed) {
            b.x += nx * overlap;
            b.y += ny * overlap;
            bounceOffFixed(b, nx, ny, BALL_RESTITUTION);
          } else if (b.landed) {
            a.x -= nx * overlap;
            a.y -= ny * overlap;
            bounceOffFixed(a, -nx, -ny, BALL_RESTITUTION);
          } else {
            a.x -= (nx * overlap) / 2;
            a.y -= (ny * overlap) / 2;
            b.x += (nx * overlap) / 2;
            b.y += (ny * overlap) / 2;
            const rvx = b.vx - a.vx;
            const rvy = b.vy - a.vy;
            const velAlongNormal = rvx * nx + rvy * ny;
            if (velAlongNormal < 0) {
              const impulse = (-(1 + BALL_RESTITUTION) * velAlongNormal) / 2;
              a.vx -= impulse * nx;
              a.vy -= impulse * ny;
              b.vx += impulse * nx;
              b.vy += impulse * ny;
            }
          }
        }
      }

      for (const ball of balls) {
        ball.el?.style.setProperty(
          'transform',
          `translate3d(${ball.x - BALL_R}px, ${ball.y - BALL_R}px, 0) rotate(${Math.max(-40, Math.min(40, ball.vx * 0.15))}deg)`,
        );
      }

      const timedOut = now - start > HARD_TIMEOUT_MS;
      if (timedOut) {
        // Force-settle stragglers so the drop always ends — furthest-from-the-floor lands last.
        const stragglers = balls.filter((b) => !b.landed).sort((a, b) => a.y - b.y);
        for (const b of stragglers) {
          b.landed = true;
          b.y = H - BALL_R;
          b.vx = 0;
          b.vy = 0;
          landedOrderRef.current.push(b.username);
        }
      }

      if (balls.every((b) => b.landed)) {
        finish(landedOrderRef.current[landedOrderRef.current.length - 1]);
        return;
      }

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => stopLoop();
  }, [phase, dropList, finish, stopLoop]);

  function toggle(username: string) {
    if (phase === 'falling') return;
    setWinner(null);
    setCelebrate(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  }

  const candidates = players.filter((p) => selected.has(p.username));

  function startDrop() {
    if (candidates.length === 0 || phase === 'falling') return;
    setDropList(candidates);
    setWinner(null);
    setCelebrate(false);
    setPhase('falling');
    sound.play('drumroll');
  }

  const winnerPlayer = players.find((p) => p.username === winner);
  const canStart = candidates.length > 0 && phase !== 'falling';

  return (
    <Card className="relative mx-auto mb-8 w-full max-w-xl overflow-hidden border-blue-500/40 bg-blue-500/[0.06]">
      {celebrate && <Confetti count={40} spread="center" durationRange={[0.6, 2]} />}
      <CardContent className="p-6">
        <div className="mb-1 flex items-center justify-center gap-2 text-lg font-extrabold">
          <Dices className="size-5" /> Người tạo bộ câu hỏi tiếp theo
        </div>
        <p className="mb-4 text-center text-sm text-muted-foreground">
          {phase === 'falling'
            ? 'Đang thả… người về đích cuối cùng sẽ tạo bộ câu hỏi!'
            : 'Chọn người chơi tham gia quay số, sau đó bắt đầu.'}
        </p>

        {phase === 'falling' ? (
          <div
            ref={arenaRef}
            className="relative mb-4 h-[380px] w-full overflow-hidden rounded-xl border border-indigo-500/40 bg-[radial-gradient(circle_at_50%_0%,#1e293b,#020617_75%)]"
          >
            {pegs.map((peg) => (
              <span
                key={`peg-${peg.x}-${peg.y}`}
                className="absolute rounded-full bg-white/35"
                style={{
                  width: PEG_R * 2,
                  height: PEG_R * 2,
                  left: peg.x - PEG_R,
                  top: peg.y - PEG_R,
                }}
              />
            ))}
            {dropList.map((p) => (
              <div
                key={p.username}
                ref={(el) => {
                  if (el) elementsRef.current.set(p.username, el);
                  else elementsRef.current.delete(p.username);
                }}
                className="absolute top-0 left-0 drop-shadow-[0_0_6px_rgba(0,0,0,.6)]"
                style={{ willChange: 'transform' }}
              >
                <AvatarDisplay avatar={p.avatar} size={BALL_R * 2} />
              </div>
            ))}
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
          </div>
        ) : (
          <ul className="mb-4 flex flex-col gap-2">
            {players.map((p) => {
              const isWin = winner === p.username;
              return (
                <li key={p.username}>
                  {/* biome-ignore lint/a11y/noLabelWithoutControl: Checkbox renders the control */}
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-all ${
                      isWin
                        ? 'border-[#fbbf24] bg-[rgba(251,191,36,.12)]'
                        : 'border-border bg-muted/30'
                    }`}
                  >
                    <Checkbox
                      checked={selected.has(p.username)}
                      onCheckedChange={() => toggle(p.username)}
                    />
                    <AvatarDisplay avatar={p.avatar} size={30} />
                    <span className="flex-1 font-semibold">{p.username}</span>
                    {isWin && <Crown className="size-5 text-[#fbbf24]" />}
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {winnerPlayer ? (
          <div className="mb-3 rounded-xl border border-[#fbbf24]/50 bg-[rgba(251,191,36,.1)] px-4 py-3 text-center">
            <span className="inline-flex items-center gap-1.5 text-[1.05rem] font-extrabold text-[#fbbf24]">
              <PartyPopper className="size-5" /> {winnerPlayer.username} về đích cuối cùng và sẽ
              tạo bộ câu hỏi tiếp theo!
            </span>
          </div>
        ) : null}

        <Button type="button" size="lg" className="w-full" onClick={startDrop} disabled={!canStart}>
          {phase === 'falling' ? (
            'Đang thả…'
          ) : winner ? (
            <>
              Thả lại <RotateCw className="size-4" />
            </>
          ) : (
            <>
              Bắt đầu ({candidates.length}) <Play className="size-4" />
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
