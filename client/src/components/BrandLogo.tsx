import { cn } from '@/lib/utils';

type BrandLogoProps = {
  className?: string;
  compact?: boolean;
  productName?: string;
};

export function BrandLogo({
  className,
  compact = false,
  productName = 'TiL Quiz',
}: BrandLogoProps) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-3', className)}>
      <img
        src="/brand/thudo-logo.png"
        alt="THUDO Invest & Logistics"
        width={2032}
        height={774}
        decoding="async"
        className={cn('h-auto w-[150px] shrink-0 object-contain', compact && 'w-[112px]')}
      />
      {!compact && (
        <span className="hidden min-w-0 border-l border-border pl-3 lg:block">
          <span className="block truncate text-base font-bold leading-tight text-foreground">
            {productName}
          </span>
          <span className="block truncate text-[0.68rem] leading-tight text-muted-foreground">
            Đào tạo &amp; Kiểm tra nội bộ
          </span>
        </span>
      )}
    </span>
  );
}
