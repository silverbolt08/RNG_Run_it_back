import type { ReactNode } from 'react';

export function Card({ children, selected = false, className = '' }: { children: ReactNode; selected?: boolean; className?: string }) {
  return (
    <div className={`rounded-card border p-4 ${selected ? 'border-brand-strong bg-brand-tint' : 'border-line bg-surface'} ${className}`}>
      {children}
    </div>
  );
}

export function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold leading-8">{title}</h1>
      {children}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold leading-7">{title}</h2>
      {children}
    </section>
  );
}

/** The screen's one primary action, kept in reach of a thumb. */
export function StickyBar({ children }: { children: ReactNode }) {
  return (
    <div className="safe-bottom sticky bottom-0 z-10 -mx-4 mt-2 flex flex-col gap-2 border-t border-line bg-surface px-4 pt-3 shadow-float">
      {children}
    </div>
  );
}

export function Identifier({ children }: { children: ReactNode }) {
  return <span className="font-mono break-all">{children}</span>;
}
