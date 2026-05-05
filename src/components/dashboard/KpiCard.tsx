import { type LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KpiCardProps {
  title: string;
  value: string;
  delta?: number;
  deltaLabel?: string;
  icon: LucideIcon;
  iconColor?: 'primary' | 'secondary' | 'success' | 'warning';
}

const iconColorMap = {
  primary: 'bg-primary/10 text-primary',
  secondary: 'bg-secondary/10 text-secondary',
  success: 'bg-green-100 text-success',
  warning: 'bg-orange-100 text-warning',
};

export function KpiCard({
  title,
  value,
  delta,
  deltaLabel,
  icon: Icon,
  iconColor = 'primary',
}: KpiCardProps) {
  const isPositive = delta !== undefined && delta >= 0;

  return (
    <div className="bg-card rounded-lg p-[30px] shadow-card card-hover flex items-start gap-5">
      <div
        className={cn(
          'w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0',
          iconColorMap[iconColor],
        )}
        aria-hidden="true"
      >
        <Icon className="w-6 h-6" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-foreground leading-tight">{value}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{title}</p>
        {delta !== undefined && deltaLabel && (
          <p
            className={cn(
              'flex items-center gap-1 text-xs font-semibold mt-2',
              isPositive ? 'text-success' : 'text-danger',
            )}
          >
            {isPositive ? (
              <TrendingUp className="w-3.5 h-3.5" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5" />
            )}
            {isPositive ? '+' : ''}
            {delta}% {deltaLabel}
          </p>
        )}
      </div>
    </div>
  );
}
