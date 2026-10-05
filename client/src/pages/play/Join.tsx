import { ArrowRight, Zap } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppAlert } from '@/components/AppAlert';
import {
  AvatarDisplay,
  AvatarPicker,
  loadSavedAvatar,
  saveAvatar,
} from '@/components/AvatarPicker';
import { Input } from '@/components/Input';
import { AppLogo, AuthCard, PageCenter, Subtitle } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { localeName } from '@/helpers/locale';
import {
  cleanPin,
  clearPlayerSession,
  loadPlayerSession,
  savePlayerSession,
} from '@/helpers/playerSession';
import { getSocket, useSocketEvent } from '@/hooks/useSocket';
import { apiFetch } from '@/lib/api';

import type { AuthUser } from '@/types';

function defaultJoinName(user: AuthUser | null): string {
  if (!user) return '';
  return (user.playDisplayName?.trim() || user.username || '').slice(0, 50);
}

function defaultJoinAvatar(user: AuthUser | null): string {
  if (user?.playAvatar?.trim()) return user.playAvatar.trim();
  return loadSavedAvatar();
}

function joinError(message: string): string {
  if (message === 'Invalid PIN') return 'Mã PIN không hợp lệ.';
  if (message === 'Game has ended') return 'Trò chơi đã kết thúc.';
  if (message.toLowerCase().includes('full')) return 'Phòng chơi đã đủ người.';
  return 'Không thể tham gia trò chơi. Vui lòng kiểm tra PIN và thử lại.';
}

export default function Join() {
  const { pin: pinParam } = useParams<{ pin?: string }>();
  const navigate = useNavigate();
  const socket = getSocket();
  const { token, user, role } = useAuth();

  const { appName, appSubtitle } = useApp();
  const [pin, setPin] = useState(pinParam ?? '');
  const [username, setUsername] = useState('');
  const [avatar, setAvatar] = useState<string>(() => loadSavedAvatar());
  const [locale, setLocale] = useState<string>(() => loadPlayerSession().locale || 'base');
  const [availableLocales, setAvailableLocales] = useState<string[]>([]);
  const [baseLocale, setBaseLocale] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);
  const [step, setStep] = useState<'form' | 'avatar'>('form');

  useEffect(() => {
    if (!user) return;
    setUsername((prev) => prev || defaultJoinName(user));
    setAvatar((prev) => prev || defaultJoinAvatar(user));
  }, [user]);

  useEffect(() => {
    const stored = loadPlayerSession();

    if (!stored.playerId || !stored.username || !stored.pin || !stored.sessionId) return;

    setJoining(true);

    // socket.io buffers emits until connected — no 'connect' listener needed.
    socket.connect();
    socket.emit('player:join', {
      pin: stored.pin,
      username: stored.username,
      avatar: stored.avatar ?? '',
      playerId: Number(stored.playerId),
      authToken: token ?? undefined,
      locale: stored.locale || 'base',
    });
  }, [socket, token]);

  useSocketEvent<{ playerId: number; sessionId: number; status: string; username?: string }>(
    'player:joined',
    (data) => {
      savePlayerSession({
        playerId: data.playerId,
        sessionId: data.sessionId,
        username: data.username,
        avatar,
        pin: cleanPin(pin),
        locale,
      });
      if (avatar) saveAvatar(avatar);
      navigate(`/play/game/${data.sessionId}`);
    },
  );

  useSocketEvent<{ message: string }>('player:error', (data) => {
    setError(joinError(data.message));
    setJoining(false);
    setStep('form');
    // Only clear session on hard failures — keep storage for retry on reload/reconnect
    if (data.message === 'Invalid PIN' || data.message === 'Game has ended') {
      clearPlayerSession();
    }
  });

  function handleFormNext(e: FormEvent) {
    e.preventDefault();
    setError('');
    const cleanedPin = cleanPin(pin);
    const cleanName = username.trim();
    if (!cleanedPin || cleanedPin.length < 4) {
      setError('Vui lòng nhập mã PIN hợp lệ.');
      return;
    }
    if (!cleanName) {
      setError('Vui lòng nhập tên của bạn.');
      return;
    }
    setStep('avatar');
    // Best-effort: populate the language selector. Never blocks joining if
    // this fails or the quiz has no translations — the selector still shows
    // "Original" and the server falls back to the base language regardless.
    apiFetch<{ baseLocale: string | null; locales: string[] }>(
      `/api/play/sessions/${cleanedPin}/locales`,
    )
      .then(({ ok, data }) => {
        setAvailableLocales(ok ? data.locales : []);
        setBaseLocale(ok ? data.baseLocale : null);
      })
      .catch(() => {
        setAvailableLocales([]);
        setBaseLocale(null);
      });
  }

  function handleJoin() {
    if (joining) return;
    setError('');
    setJoining(true);

    // socket.io buffers emits until connected — no 'connect' listener needed.
    socket.connect();
    socket.emit('player:join', {
      pin: cleanPin(pin),
      username: username.trim(),
      avatar,
      authToken: token ?? undefined,
      locale,
    });
  }

  return (
    <PageCenter className="min-h-screen bg-background">
      <AuthCard maxWidth="lg" className="max-w-[420px]">
        <div className="text-center mb-6">
          <AppLogo>
            {appName ? (
              appName
            ) : (
              <span className="inline-flex items-center gap-1">
                <Zap className="size-4" /> TiL Quiz
              </span>
            )}
          </AppLogo>
          {appSubtitle && step === 'form' && (
            <p className="mt-2 text-base font-medium text-foreground">{appSubtitle}</p>
          )}
          <Subtitle className="mt-2">
            {step === 'form'
              ? `Nhập mã PIN để tham gia${appName ? ` ${appName}` : ''}`
              : 'Chọn ảnh đại diện'}
          </Subtitle>
        </div>

        {error && <AppAlert variant="error">{error}</AppAlert>}

        {step === 'form' ? (
          <form onSubmit={handleFormNext}>
            <Input
              id="pin"
              label="Mã PIN trò chơi"
              type="text"
              inputMode="numeric"
              maxLength={8}
              placeholder="123456"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="text-center text-[1.6rem] font-bold tracking-[0.12em]"
              autoFocus={!pinParam}
              required
            />
            <Input
              id="username"
              label="Tên của bạn"
              type="text"
              maxLength={50}
              placeholder="Ví dụ: Minh Anh"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus={!!pinParam}
              required
            />
            <Button type="submit" variant="default" size="lg" className="mt-2 w-full">
              <span className="inline-flex items-center gap-1.5">
                Tiếp theo: Chọn ảnh đại diện <ArrowRight className="size-4" />
              </span>
            </Button>
          </form>
        ) : (
          <div>
            <div className="mb-6 flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3.5 py-2.5">
              <AvatarDisplay avatar={avatar} size={40} />
              <div className="flex-1">
                <p className="text-base font-bold">{username}</p>
                <p className="text-[0.78rem] text-muted-foreground">PIN: {pin}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-[0.78rem]"
                onClick={() => setStep('form')}
              >
                Sửa
              </Button>
            </div>

            <AvatarPicker
              value={avatar}
              onChange={(a) => {
                setAvatar(a);
                saveAvatar(a);
              }}
            />

            <label htmlFor="locale" className="mt-4 block text-sm font-medium text-foreground">
              Ngôn ngữ
            </label>
            <select
              id="locale"
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="mt-2 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm"
            >
              <option value="base">{baseLocale ? localeName(baseLocale) : 'Ngôn ngữ gốc'}</option>
              {availableLocales.map((code) => (
                <option key={code} value={code}>
                  {localeName(code)}
                </option>
              ))}
            </select>
            {availableLocales.length > 0 && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Câu hỏi chưa được dịch sẽ hiển thị bằng ngôn ngữ gốc của quiz.
              </p>
            )}

            <Button
              type="button"
              variant="default"
              size="lg"
              className="mt-5 w-full"
              onClick={handleJoin}
              disabled={joining}
            >
              {joining ? (
                'Đang tham gia…'
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  Tham gia trò chơi <ArrowRight className="size-4" />
                </span>
              )}
            </Button>
          </div>
        )}

        <p className="mt-4 text-center text-sm text-muted-foreground">
          {user && role === 'user' ? (
            <>
              Đã đăng nhập: {user.username} · <a href="/u/my-games">Lịch sử trò chơi</a> ·{' '}
              <a href="/">Trang chủ</a>
            </>
          ) : user ? (
            <>
              Đã đăng nhập: {user.username} · <a href="/">Trang chủ</a>
            </>
          ) : (
            <>
              <a href="/login">Đăng nhập</a> · <a href="/">Trang chủ</a>
            </>
          )}
        </p>
      </AuthCard>
    </PageCenter>
  );
}
