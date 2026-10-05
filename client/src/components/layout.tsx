import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import CreatorNav from './CreatorNav';

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col overflow-x-hidden', className)}>{children}</div>
  );
}

export function PageCenter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex min-h-screen flex-1 flex-col items-center justify-center p-4 sm:p-6',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageVCenter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex min-h-screen flex-1 flex-col items-center justify-center px-4 py-8',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function MainContent({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('mx-auto w-full max-w-[var(--content-max)] flex-1 px-4 py-5 sm:p-6', className)}
    >
      {children}
    </div>
  );
}

type AuthCardProps = {
  children: ReactNode;
  className?: string;
  maxWidth?: 'sm' | 'md' | 'lg';
};

const maxWidthClass = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

export function AuthCard({ children, className, maxWidth = 'md' }: AuthCardProps) {
  return (
    <Card
      className={cn('w-full shadow-[var(--shadow-card)] ring-foreground/10', maxWidthClass[maxWidth], className)}
    >
      <CardContent className="p-6 sm:p-8">{children}</CardContent>
    </Card>
  );
}

export function AppLogo({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'bg-gradient-to-br from-blue-600 to-blue-400 bg-clip-text text-2xl font-extrabold text-transparent',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Subtitle({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-sm text-muted-foreground', className)}>{children}</p>;
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-sm font-semibold text-primary">{eyebrow}</p>
        )}
        <h1 className="break-words">{title}</h1>
        {description && <Subtitle className="mt-1">{description}</Subtitle>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="px-6 py-12 text-center sm:py-14">
        {icon && <div className="mx-auto mb-3 flex justify-center text-muted-foreground">{icon}</div>}
        <h2>{title}</h2>
        {description && <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{description}</p>}
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </CardContent>
    </Card>
  );
}

/** Full-page loading (or error) placeholder shown under the creator nav. */
export function PageLoading({ message = 'Đang tải…', nav }: { message?: string; nav?: ReactNode }) {
  return (
    <Page>
      {nav ?? <CreatorNav />}
      <PageCenter>
        <p className="text-muted-foreground">{message}</p>
      </PageCenter>
    </Page>
  );
}

export function FormRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2', className)}>{children}</div>;
}

export function SectionDivider({ className }: { className?: string }) {
  return <div className={cn('my-5 border-t border-border', className)} />;
}
