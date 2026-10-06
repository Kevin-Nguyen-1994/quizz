import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AppAlert } from '@/components/AppAlert';
import { BrandLogo } from '@/components/BrandLogo';
import { AuthCard } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Input } from '../../components/Input';
import { useAuth } from '../../context/AuthContext';

export default function UserLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await login(identifier, password);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const returnTo = searchParams.get('returnTo');
    const safeReturnTo = returnTo?.startsWith('/assignment/') ? returnTo : null;
    navigate(result.role === 'super_admin' ? '/admin' : (safeReturnTo ?? '/u'));
  }

  return (
    <main className="grid min-h-screen bg-card lg:grid-cols-[minmax(22rem,0.9fr)_minmax(28rem,1.1fr)]">
      <section className="brand-motif hidden flex-col justify-between bg-[var(--brand-blue-900)] p-12 text-white lg:flex">
        <p className="text-sm font-semibold tracking-[0.16em] text-blue-100">TIỆN ÍCH NỘI BỘ</p>
        <div className="max-w-lg">
          <span className="mb-5 block h-1 w-14 rounded-full bg-[var(--brand-accent)]" />
          <h1 className="text-4xl leading-tight text-white">TiL Quiz</h1>
          <p className="mt-3 text-lg text-blue-100">Đào tạo &amp; Kiểm tra nội bộ</p>
        </div>
        <p className="text-sm text-blue-200">THUDO Invest &amp; Logistics</p>
      </section>

      <section className="brand-motif flex items-center justify-center bg-background px-4 py-8 sm:px-8">
        <AuthCard className="max-w-md border-0 sm:border">
          <div className="mb-7">
            <BrandLogo compact className="justify-center [&_img]:w-[180px] sm:[&_img]:w-[195px]" />
            <div className="mt-5 text-center lg:hidden">
              <h1 className="text-2xl">TiL Quiz</h1>
              <p className="mt-1 text-sm text-muted-foreground">Đào tạo &amp; Kiểm tra nội bộ</p>
            </div>
          </div>

          <div className="mb-6 text-center lg:text-left">
            <h2 className="text-2xl">Đăng nhập</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Sử dụng tài khoản nội bộ được cấp để tiếp tục.
            </p>
          </div>

          {error && <AppAlert variant="error">{error}</AppAlert>}

          <form onSubmit={handleSubmit}>
            <Input
              id="identifier"
              label="Tên đăng nhập"
              type="text"
              autoComplete="username"
              placeholder="Ví dụ: LOG01"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
            <Input
              id="password"
              label="Mật khẩu"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button
              type="submit"
              disabled={loading}
              variant="default"
              size="lg"
              className="mt-2 w-full"
            >
              {loading ? 'Đang đăng nhập…' : 'Đăng nhập'}
            </Button>
          </form>

          <p className="mt-3 text-center text-sm text-muted-foreground">
            <Link to="/play">Tham gia Live Game</Link> · <Link to="/">Trang chủ</Link>
          </p>
        </AuthCard>
      </section>
    </main>
  );
}
