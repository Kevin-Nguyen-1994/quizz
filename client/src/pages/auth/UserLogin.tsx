import { Zap } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AppAlert } from '@/components/AppAlert';
import { AppLogo, AuthCard, PageCenter, Subtitle } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Input } from '../../components/Input';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';

export default function UserLogin() {
  const { login } = useAuth();
  const { appName } = useApp();
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
    <PageCenter>
      <AuthCard>
        <div className="text-center mb-6">
          <AppLogo>
            {appName || (
              <span className="inline-flex items-center gap-1.5">
                <Zap className="size-4" /> TiL Quiz
              </span>
            )}
          </AppLogo>
          <Subtitle className="mt-2">Đăng nhập hệ thống đào tạo nội bộ</Subtitle>
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

        <p className="text-center text-muted-foreground text-sm mt-2">
          <Link to="/play">Tham gia Live Game</Link> · <Link to="/">Trang chủ</Link>
        </p>
      </AuthCard>
    </PageCenter>
  );
}
