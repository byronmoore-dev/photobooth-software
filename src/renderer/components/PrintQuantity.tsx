interface PrintQuantityProps {
  value: number;
  max: number;
  onChange(value: number): void;
  variant?: 'compact' | 'hero';
}

export function PrintQuantity({ value, max, onChange, variant = 'compact' }: PrintQuantityProps) {
  if (variant === 'hero') {
    return (
      <div
        className="mx-auto flex min-h-64 max-w-xl items-center justify-center gap-10"
        role="group"
        aria-label="Print copies"
      >
        <output className="grid min-w-64 place-content-center text-center" aria-live="polite">
          <strong className="text-[clamp(10rem,18vw,16rem)] leading-[0.72] font-semibold tracking-[-0.1em]">
            {value}
          </strong>
        </output>
        <div className="grid gap-3">
          <button
            className="grid size-18 place-items-center rounded-full bg-white/90 text-[#0b1f44] transition hover:bg-white focus-visible:ring-4 focus-visible:ring-[#ff2f92]/25 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
            type="button"
            onClick={() => onChange(Math.min(max, value + 1))}
            disabled={value >= max}
            aria-label="Increase copies"
          >
            <svg
              className="size-7"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            className="grid size-18 place-items-center rounded-full bg-white/90 text-[#0b1f44] transition hover:bg-white focus-visible:ring-4 focus-visible:ring-[#ff2f92]/25 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
            type="button"
            onClick={() => onChange(Math.max(1, value - 1))}
            disabled={value <= 1}
            aria-label="Decrease copies"
          >
            <svg
              className="size-7"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M5 12h14" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-[4.5rem_1fr_4.5rem] rounded-[1.4rem] bg-[#e7edf7] text-[#0b1f44]"
      role="group"
      aria-label="Print copies"
    >
      <button
        className="min-h-20 rounded-l-[1.4rem] text-3xl transition hover:bg-[#d8e1ef] focus-visible:ring-4 focus-visible:ring-[#ff2f92]/25 disabled:cursor-not-allowed disabled:opacity-30"
        type="button"
        onClick={() => onChange(Math.max(1, value - 1))}
        disabled={value <= 1}
        aria-label="Decrease copies"
      >
        &minus;
      </button>
      <output className="grid min-h-20 place-content-center border-x border-[#cbd6e6] text-center" aria-live="polite">
        <strong className="text-3xl leading-none font-semibold">{value}</strong>
        <span className="mt-1 text-[0.65rem] font-semibold tracking-[0.14em] text-[#53657f] uppercase">
          {value === 1 ? 'copy' : 'copies'}
        </span>
      </output>
      <button
        className="min-h-20 rounded-r-[1.4rem] text-3xl transition hover:bg-[#d8e1ef] focus-visible:ring-4 focus-visible:ring-[#ff2f92]/25 disabled:cursor-not-allowed disabled:opacity-30"
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="Increase copies"
      >
        +
      </button>
    </div>
  );
}
