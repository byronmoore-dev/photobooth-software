import { useEffect, useRef, useState } from 'react';

const monthTitle = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const selectedDateTitle = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});
const accessibleDateTitle = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const dateToInputValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const inputValueToDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return dateToInputValue(date) === value ? date : null;
};

export const calendarGrid = (year: number, month: number) => {
  const first = new Date(year, month, 1, 12);
  const gridStart = new Date(year, month, 1 - first.getDay(), 12);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
};

const sameDate = (left: Date | null, right: Date) =>
  Boolean(
    left &&
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate(),
  );
const localToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
};

interface TouchDatePickerProps {
  value: string;
  onChange(value: string): void;
  invalid?: boolean;
}

export function TouchDatePicker({ value, onChange, invalid = false }: TouchDatePickerProps) {
  const selected = inputValueToDate(value);
  const [today, setToday] = useState(localToday);
  const [viewMonth, setViewMonth] = useState(
    () => new Date((selected ?? today).getFullYear(), (selected ?? today).getMonth(), 1, 12),
  );
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    dialog.current?.close();
    window.requestAnimationFrame(() => trigger.current?.focus());
  };

  const show = () => {
    const currentToday = localToday();
    const initial = selected ?? currentToday;
    setToday(currentToday);
    setViewMonth(new Date(initial.getFullYear(), initial.getMonth(), 1, 12));
    setOpen(true);
  };

  useEffect(() => {
    if (!open || !dialog.current) return;
    if (!dialog.current.open) dialog.current.showModal();
    const preferred = dialog.current.querySelector<HTMLButtonElement>('[data-selected="true"]');
    const todayButton = dialog.current.querySelector<HTMLButtonElement>('[aria-current="date"]');
    (
      preferred ??
      todayButton ??
      dialog.current.querySelector<HTMLButtonElement>('[data-current-month="true"]')
    )?.focus();
  }, [open]);

  const days = calendarGrid(viewMonth.getFullYear(), viewMonth.getMonth());
  const selectedInView =
    selected?.getFullYear() === viewMonth.getFullYear() && selected.getMonth() === viewMonth.getMonth();
  const todayInView = today.getFullYear() === viewMonth.getFullYear() && today.getMonth() === viewMonth.getMonth();
  const shiftMonth = (amount: number) =>
    setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1, 12));
  const focusRelativeDate = (date: Date, amount: number) => {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    if (next.getMonth() !== viewMonth.getMonth() || next.getFullYear() !== viewMonth.getFullYear()) {
      setViewMonth(new Date(next.getFullYear(), next.getMonth(), 1, 12));
    }
    window.requestAnimationFrame(() =>
      dialog.current?.querySelector<HTMLButtonElement>(`[data-date="${dateToInputValue(next)}"]`)?.focus(),
    );
  };
  const choose = (date: Date) => {
    onChange(dateToInputValue(date));
    close();
  };

  return (
    <>
      <button
        ref={trigger}
        className="group grid min-h-18 w-full grid-cols-[3.25rem_minmax(0,1fr)_3rem] items-center gap-3 rounded-[1.35rem] bg-stone-100 px-3 text-left text-stone-900 transition-[background-color,box-shadow,transform] hover:bg-stone-200/75 focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-[#8f7554]/15 active:scale-[0.995]"
        type="button"
        aria-label={selected ? `Event date, ${accessibleDateTitle.format(selected)}` : 'Event date, choose a date'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={invalid}
        onClick={show}
      >
        <span
          className="grid size-13 place-items-center rounded-[1rem] bg-[#e8dfd1] text-[#6f5940] transition-colors group-hover:bg-[#ded1bf]"
          aria-hidden="true"
        >
          <svg
            className="size-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7 3v3M17 3v3M4.5 9h15" />
            <rect x="3" y="5" width="18" height="16" rx="3" />
            <path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" strokeWidth="2.5" />
          </svg>
        </span>
        <span
          className={`block min-w-0 truncate text-base font-semibold ${selected ? 'text-stone-900' : 'text-stone-500'}`}
        >
          {selected ? selectedDateTitle.format(selected) : 'Choose a date'}
        </span>
        <span
          className="grid size-12 place-items-center rounded-full text-stone-500 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        >
          <svg
            className="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </span>
      </button>

      <dialog
        ref={dialog}
        className="m-auto max-h-[calc(100vh-2rem)] w-[min(94vw,34rem)] max-w-none overflow-y-auto overscroll-contain rounded-[2.25rem] bg-[#fbfaf7] p-0 text-stone-900 shadow-[0_40px_120px_rgba(28,25,23,0.28)] backdrop:bg-stone-950/35 backdrop:backdrop-blur-sm"
        aria-labelledby="event-date-picker-title"
        onClose={() => setOpen(false)}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            close();
        }}
      >
        <div className="p-7 sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <h2 id="event-date-picker-title" className="text-xl font-semibold tracking-[-0.035em]">
              Event date
            </h2>
            <button
              className="grid size-13 place-items-center rounded-full bg-stone-100 text-stone-600 transition-colors hover:bg-stone-200 active:bg-stone-300"
              type="button"
              aria-label="Close calendar"
              onClick={close}
            >
              <svg
                className="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          <div className="mt-7 grid grid-cols-[3.25rem_1fr_3.25rem] items-center gap-3">
            <button
              className="grid size-13 place-items-center rounded-full bg-stone-100 text-stone-700 transition-[background-color,transform] hover:bg-stone-200 active:scale-95"
              type="button"
              aria-label="Previous month"
              onClick={() => shiftMonth(-1)}
            >
              <svg
                className="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <p className="text-center text-lg font-semibold tracking-[-0.025em]" aria-live="polite">
              {monthTitle.format(viewMonth)}
            </p>
            <button
              className="grid size-13 place-items-center rounded-full bg-stone-100 text-stone-700 transition-[background-color,transform] hover:bg-stone-200 active:scale-95"
              type="button"
              aria-label="Next month"
              onClick={() => shiftMonth(1)}
            >
              <svg
                className="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>

          <div className="mt-6 grid grid-cols-7 gap-1" role="grid" aria-label={monthTitle.format(viewMonth)}>
            <div className="contents" role="row">
              {weekdays.map((weekday) => (
                <span
                  key={weekday}
                  className="py-2 text-center text-[0.68rem] font-semibold tracking-[0.04em] text-stone-400"
                  role="columnheader"
                >
                  {weekday}
                </span>
              ))}
            </div>
            {Array.from({ length: 6 }, (_, rowIndex) => (
              <div className="contents" role="row" key={dateToInputValue(days[rowIndex * 7])}>
                {days.slice(rowIndex * 7, rowIndex * 7 + 7).map((date) => {
                  const inMonth = date.getMonth() === viewMonth.getMonth();
                  const isSelected = sameDate(selected, date);
                  const isToday = sameDate(today, date);
                  return (
                    <button
                      key={dateToInputValue(date)}
                      className={`mx-auto grid size-12 place-items-center rounded-full text-sm font-semibold transition-[background-color,color,transform,box-shadow] active:scale-90 ${
                        isSelected
                          ? 'bg-stone-950 text-white shadow-[0_8px_24px_rgba(28,25,23,0.22)]'
                          : isToday
                            ? 'bg-[#e8dfd1] text-[#5f4c36] hover:bg-[#ded1bf]'
                            : inMonth
                              ? 'text-stone-800 hover:bg-stone-200/80'
                              : 'text-stone-300 hover:bg-stone-100'
                      }`}
                      type="button"
                      role="gridcell"
                      tabIndex={
                        isSelected ||
                        (!selectedInView && isToday) ||
                        (!selectedInView && !todayInView && inMonth && date.getDate() === 1)
                          ? 0
                          : -1
                      }
                      aria-label={accessibleDateTitle.format(date)}
                      aria-current={isToday ? 'date' : undefined}
                      aria-selected={isSelected}
                      data-date={dateToInputValue(date)}
                      data-current-month={inMonth}
                      data-selected={isSelected}
                      onClick={() => choose(date)}
                      onKeyDown={(event) => {
                        const amount =
                          event.key === 'ArrowLeft'
                            ? -1
                            : event.key === 'ArrowRight'
                              ? 1
                              : event.key === 'ArrowUp'
                                ? -7
                                : event.key === 'ArrowDown'
                                  ? 7
                                  : 0;
                        if (!amount) return;
                        event.preventDefault();
                        focusRelativeDate(date, amount);
                      }}
                    >
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="mt-7 flex justify-end">
            <button
              className="min-h-14 rounded-full bg-stone-100 px-6 text-base font-semibold text-stone-700 transition-[background-color,transform] hover:bg-stone-200 active:scale-95"
              type="button"
              onClick={() => choose(today)}
            >
              Today
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
