import { Check, CircleDot, Circle, CircleAlert } from 'lucide-react';

export type StepStatus = 'DONE' | 'CURRENT' | 'UPCOMING' | 'FAILED';

export type Step = { key: string; label: string; status: StepStatus; statusLabel: string; date?: string };

const ICONS = {
  DONE: { icon: Check, className: 'text-success' },
  CURRENT: { icon: CircleDot, className: 'text-brand-strong' },
  UPCOMING: { icon: Circle, className: 'text-ink-muted' },
  FAILED: { icon: CircleAlert, className: 'text-danger' },
} as const;

export function Stepper({ steps }: { steps: readonly Step[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((step, index) => {
        const { icon: Icon, className } = ICONS[step.status];
        const isLast = index === steps.length - 1;
        return (
          <li key={step.key} aria-current={step.status === 'CURRENT' ? 'step' : undefined} className="flex gap-3">
            <div className="flex flex-col items-center">
              <Icon aria-hidden className={`size-6 shrink-0 ${className}`} />
              {isLast ? null : <div className="my-1 w-px grow bg-line-strong" />}
            </div>
            <div className={`flex min-w-0 grow flex-wrap items-baseline justify-between gap-x-3 ${isLast ? '' : 'pb-4'}`}>
              <div className="flex flex-col">
                <span className={step.status === 'CURRENT' ? 'font-semibold' : ''}>{step.label}</span>
                <span className="text-sm text-ink-muted">{step.statusLabel}</span>
              </div>
              {step.date ? <span className="text-sm tabular-nums text-ink-muted">{step.date}</span> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
