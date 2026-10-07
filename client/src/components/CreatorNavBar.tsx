import { LogOut, Menu, Play, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BrandLogo } from '@/components/BrandLogo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

const navBtn =
  'rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-[var(--interactive-accent)] hover:text-[var(--interactive-accent-foreground)] focus-visible:bg-[var(--interactive-accent)] focus-visible:text-[var(--interactive-accent-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40';

interface Props {
  basePath: string;
  loginPath: string;
  showUsers?: boolean;
  showAssignments?: boolean;
  showQuestionBank?: boolean;
  showMyGames?: boolean;
  userNavigation?: boolean;
  assignmentCount?: number;
  playLabel?: string;
}

export default function CreatorNavBar({
  basePath,
  loginPath,
  showUsers = false,
  showAssignments = false,
  showQuestionBank = false,
  showMyGames = false,
  userNavigation = false,
  assignmentCount = 0,
  playLabel = 'Chơi ngay ↗',
}: Props) {
  const { logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { appName } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);

  const active = (path: string) => {
    const isActive =
      location.pathname === path ||
      (path !== basePath && location.pathname.startsWith(`${path}/`)) ||
      (path === basePath && /\/quiz\/(new|\d+\/edit)$/.test(location.pathname));
    return cn(navBtn, isActive && 'bg-primary/10 text-primary');
  };

  const links = userNavigation
    ? [
        { to: basePath, label: 'Trang chủ' },
        {
          to: `${basePath}/assignments`,
          label: `Bài kiểm tra của tôi${assignmentCount > 0 ? ` (${assignmentCount})` : ''}`,
        },
        { to: `${basePath}/my-games`, label: 'Lịch sử trò chơi' },
        { to: `${basePath}/settings`, label: 'Cài đặt' },
      ]
    : [
        { to: basePath, label: 'Bộ câu hỏi' },
        ...(showAssignments ? [{ to: `${basePath}/assignments`, label: 'Bài kiểm tra' }] : []),
        ...(showQuestionBank
          ? [{ to: `${basePath}/question-bank`, label: 'Ngân hàng câu hỏi' }]
          : []),
        ...(showUsers ? [{ to: `${basePath}/users`, label: 'Nhân viên' }] : []),
        { to: `${basePath}/history`, label: 'Lịch sử' },
        ...(showMyGames ? [{ to: `${basePath}/my-games`, label: 'Trò chơi của tôi' }] : []),
        { to: `${basePath}/settings`, label: 'Cài đặt' },
      ];

  async function handleLogout() {
    setMenuOpen(false);
    await logout();
    navigate(loginPath);
  }

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-card">
      <div className="mx-auto flex min-h-16 w-full max-w-[var(--content-max)] items-center gap-2 px-3 sm:px-4">
        <Link
          to={basePath}
          className="mr-1 flex min-w-0 items-center sm:mr-3"
          aria-label={`${appName || 'TiL Quiz'} – Trang chủ`}
        >
          <BrandLogo compact productName={appName || 'TiL Quiz'} />
        </Link>

        <div className="hidden flex-wrap items-center gap-1 md:flex">
          {links.map(({ to, label }) => (
            <Link key={to} to={to} className={active(to)}>
              {label}
            </Link>
          ))}
        </div>

        <div className="flex-1" />

        <div className="hidden items-center gap-1.5 md:flex">
          <a href="/play" target="_blank" className={navBtn} rel="noopener">
            {playLabel}
          </a>
          <Button type="button" onClick={handleLogout} variant="ghost" size="sm">
            Đăng xuất
          </Button>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Đóng menu' : 'Mở menu'}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>
      </div>

      {menuOpen && (
        <div className="border-t border-border bg-card px-3 py-3 md:hidden">
          <div className="flex flex-col gap-1">
            {links.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className={cn(active(to), 'block px-3 py-2.5')}
                onClick={() => setMenuOpen(false)}
              >
                {label}
              </Link>
            ))}
            <a
              href="/play"
              target="_blank"
              rel="noopener"
              className={cn(navBtn, 'flex items-center gap-2 px-3 py-2.5')}
              onClick={() => setMenuOpen(false)}
            >
              <Play className="size-4" /> {playLabel}
            </a>
            <Button
              type="button"
              variant="ghost"
              className="justify-start px-3"
              onClick={handleLogout}
            >
              <LogOut className="size-4" /> Đăng xuất
            </Button>
          </div>
        </div>
      )}
    </nav>
  );
}
