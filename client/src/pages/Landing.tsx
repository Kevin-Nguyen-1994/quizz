import { Link } from 'react-router-dom';
import { BrandLogo } from '@/components/BrandLogo';
import { AuthCard, PageCenter } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { useApp } from '../context/AppContext';

export default function Landing() {
  const { displayName } = useApp();

  return (
    <PageCenter className="brand-motif bg-[linear-gradient(135deg,var(--brand-blue-50),var(--page-background)_56%,var(--brand-red-50))]">
      <AuthCard maxWidth="lg" className="max-w-[420px]">
        <div className="mb-7 text-center">
          <BrandLogo className="justify-center" />
          <span className="mx-auto my-5 block h-1 w-10 rounded-full bg-[var(--brand-accent)]" />
          <h1>{displayName}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Đào tạo &amp; Kiểm tra nội bộ</p>
        </div>
        <div className="flex flex-col gap-3">
          <Button asChild variant="default" size="lg" className="w-full">
            <Link to="/play">Tham gia Live Game</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="w-full">
            <Link to="/login">Đăng nhập</Link>
          </Button>
        </div>
      </AuthCard>
    </PageCenter>
  );
}
