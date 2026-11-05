'use client';

/** A real switch, so a screen reader says on or off. */
export function Toggle({
  checked,
  disabled,
  busy,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  /** Ignores taps for now, without disabling the control, which would throw keyboard focus away. */
  busy?: boolean;
  label: string;
  onChange(checked: boolean): void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      aria-busy={busy || undefined}
      onClick={() => {
        if (!busy) onChange(!checked);
      }}
      className="flex min-h-12 min-w-12 shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className={`flex h-7 w-12 items-center rounded-pill border border-line-strong p-0.5 transition-colors duration-150 ${checked ? 'bg-brand' : 'bg-surface-alt'}`}>
        <span className={`size-5 rounded-pill bg-surface shadow-float transition-transform duration-150 ${checked ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  );
}
