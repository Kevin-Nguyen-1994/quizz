import { Link } from 'react-router-dom';
import { AppLogo, AuthCard, PageCenter, Subtitle } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { useApp } from '../context/AppContext';

export default function Landing() {
  const { displayName } = useApp();

  return (
    <PageCenter>
      <AuthCard maxWidth="lg" className="max-w-[420px]">
        <div className="text-center mb-6">
          <AppLogo>{displayName}</AppLogo>
          <Subtitle className="mt-2">Đào tạo &amp; Kiểm tra nội bộ</Subtitle>
        </div>
        <div className="flex flex-col gap-3">
          <Button asChild variant="default" size="lg" className="w-full">
            <Link to="/play">Tham gia Live Game</Link>
          </Button>
          <Button asChild variant="secondary" size="lg" className="w-full">
            <Link to="/login">Đăng nhập</Link>
          </Button>
        </div>
      </AuthCard>
    </PageCenter>
  );
}
