'use client';

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

const CONTROL = 'min-h-12 w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-base text-ink';

type FieldShellProps = { label: string; hint?: string; error?: string | null; id: string; children: ReactNode };

function FieldShell({ label, hint, error, id, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, hint?: string, error?: string | null) =>
  [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string | null };

export function TextField({ label, hint, error, className = '', ...rest }: TextFieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        {...rest}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`${CONTROL} ${className}`}
      />
    </FieldShell>
  );
}

type SelectOption = { value: string; label: string };
type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  error?: string | null;
  options: readonly SelectOption[];
};

export function SelectField({ label, hint, error, options, ...rest }: SelectFieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <select {...rest} id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} className={CONTROL}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

type CheckboxFieldProps = { label: string; checked: boolean; onChange(checked: boolean): void; name?: string };

/** Unticked unless the owner ticks it. Consent is never preselected. */
export function CheckboxField({ label, checked, onChange, name }: CheckboxFieldProps) {
  return (
    <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-control py-2">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 size-5 shrink-0 accent-brand"
      />
      <span>{label}</span>
    </label>
  );
}
