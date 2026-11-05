import { CheckCircle2, CircleAlert, Clock3, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export type Tone = 'success' | 'warning' | 'danger' | 'neutral';

const TONES: Readonly<Record<Tone, { box: string; text: string; icon: LucideIcon }>> = {
  success: { box: 'bg-success-tint border-success', text: 'text-success', icon: CheckCircle2 },
  warning: { box: 'bg-warning-tint border-warning', text: 'text-warning', icon: TriangleAlert },
  danger: { box: 'bg-danger-tint border-danger', text: 'text-danger', icon: CircleAlert },
  neutral: { box: 'bg-surface-alt border-line-strong', text: 'text-ink-muted', icon: Info },
};

/** Status always has an icon and words, never colour alone. */
export function Badge({ tone, children, icon }: { tone: Tone; children: ReactNode; icon?: LucideIcon }) {
  const { box, text, icon: DefaultIcon } = TONES[tone];
  const Icon = icon ?? DefaultIcon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-sm font-medium ${box} ${text}`}>
      <Icon aria-hidden className="size-4 shrink-0" />
      {children}
    </span>
  );
}

export function Notice({ tone, title, children, live = false }: { tone: Tone; title?: string; children?: ReactNode; live?: boolean }) {
  const { box, text, icon: Icon } = TONES[tone];
  return (
    <div role={live ? 'status' : undefined} className={`flex gap-3 rounded-card border p-4 ${box}`}>
      <Icon aria-hidden className={`mt-0.5 size-5 shrink-0 ${text}`} />
      <div className="flex min-w-0 flex-col gap-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-ink">{children}</div> : null}
      </div>
    </div>
  );
}

export function Skeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      <div className="h-6 w-2/3 animate-pulse rounded-control bg-surface-alt" />
      <div className="h-24 animate-pulse rounded-card bg-surface-alt" />
      <div className="h-24 animate-pulse rounded-card bg-surface-alt" />
    </div>
  );
}

export const PendingIcon = Clock3;
