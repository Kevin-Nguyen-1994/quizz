import { Link } from 'react-router-dom';
import { AppAlert } from '@/components/AppAlert';
import { AppLogo, AuthCard, PageCenter, Subtitle } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { useApp } from '../../context/AppContext';

export default function UserRegister() {
  const { appName } = useApp();

  return (
    <PageCenter>
      <AuthCard>
        <div className="text-center mb-6">
          <AppLogo>{appName || 'TiL Quiz'}</AppLogo>
          <Subtitle className="mt-2">Tài khoản nhân viên do quản trị viên cấp</Subtitle>
        </div>

        <AppAlert variant="warn" className="mb-4">
          Tự đăng ký đã được tắt. Vui lòng liên hệ quản trị viên để được tạo tài khoản.
        </AppAlert>
        <Button asChild variant="default" size="lg" className="w-full">
          <Link to="/login">Đến trang đăng nhập</Link>
        </Button>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link to="/play">Tham gia Live Game</Link> · <Link to="/">Trang chủ</Link>
        </p>
      </AuthCard>
    </PageCenter>
  );
}
