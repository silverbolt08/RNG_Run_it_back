import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Readonly<Record<Variant, string>> = {
  primary: 'bg-brand text-surface hover:bg-brand-strong active:bg-brand-strong',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-alt',
  ghost: 'bg-transparent text-ink underline underline-offset-4 hover:bg-surface-alt',
  danger: 'bg-danger text-surface hover:opacity-90',
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
};

export function Button({ variant = 'primary', loading = false, fullWidth = false, disabled, className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-control px-4 py-2 text-center font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {loading ? <LoaderCircle aria-hidden className="size-5 animate-spin" /> : null}
      {children}
    </button>
  );
}
