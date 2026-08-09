import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { AppState, SessionView } from '@shared/types';
import { PrintQuantity } from '../components/PrintQuantity';

interface ResultScreenProps {
  state: AppState;
  session: SessionView;
  copies: number;
  maxCopies: number;
  qrEnabled: boolean;
  onCopies(value: number): void;
  onPrint(): void;
  onFinish(): void;
  error?: string;
}

export function ResultScreen({
  state,
  session,
  copies,
  maxCopies,
  qrEnabled,
  onCopies,
  onPrint,
  onFinish,
  error,
}: ResultScreenProps) {
  const [qrCode, setQrCode] = useState('');
  const [qrError, setQrError] = useState(false);
  const printing = state === 'PRINTING';
  const complete = state === 'COMPLETE';

  useEffect(() => {
    let active = true;
    setQrCode('');
    setQrError(false);
    if (!qrEnabled || !session.qrUrl)
      return () => {
        active = false;
      };
    QRCode.toDataURL(session.qrUrl, { width: 220, margin: 1, color: { dark: '#1c1b1a', light: '#ffffff' } })
      .then((value) => {
        if (active) setQrCode(value);
      })
      .catch(() => {
        if (active) setQrError(true);
      });
    return () => {
      active = false;
    };
  }, [qrEnabled, session.qrUrl]);

  return (
    <main className="grid h-full grid-cols-[minmax(20rem,0.95fr)_minmax(28rem,1.05fr)] items-center gap-[clamp(2rem,3vw,4rem)] overflow-hidden bg-[radial-gradient(circle_at_12%_10%,#fff_0,transparent_36%),radial-gradient(circle_at_88%_88%,#f6e7dc_0,transparent_42%),linear-gradient(145deg,#f7f3ec,#eee8df)] px-[clamp(4rem,8vw,8rem)] py-[clamp(2rem,6vw,5.5rem)] text-stone-900">
      <section className="grid h-full min-h-0 place-items-center" aria-label="Completed photo strip">
        {session.finalDataUrl ? (
          <div className="aspect-[2/3] h-[min(78vh,48rem)] max-h-full -rotate-1 overflow-hidden rounded-[0.45rem] shadow-[0_28px_80px_rgba(55,47,39,0.2)]">
            <img
              className="h-full w-full object-contain"
              src={session.finalDataUrl}
              alt="Completed photo strip"
              width="1200"
              height="1800"
              fetchPriority="high"
            />
          </div>
        ) : null}
      </section>

      <section className="w-full max-w-2xl" aria-live="polite">
        {printing || complete ? (
          <h1 className="text-[clamp(2.75rem,5vw,4.5rem)] leading-none font-semibold tracking-[-0.06em]">
            {printing ? 'Printing…' : 'All set!'}
          </h1>
        ) : null}

        {!printing && !complete ? (
          <div className="space-y-3">
            <PrintQuantity value={copies} max={maxCopies} onChange={onCopies} variant="hero" />
            <button
              className="mx-auto flex min-h-18 w-full max-w-sm items-center justify-between rounded-full bg-stone-900 px-7 text-base font-semibold text-white transition hover:bg-stone-800 active:scale-[0.99]"
              type="button"
              onClick={onPrint}
            >
              <span>{copies === 1 ? 'Print one copy' : `Print ${copies} copies`}</span>
              <svg
                className="size-6"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
                <path d="M7 14h10v6H7z" />
              </svg>
            </button>
            <button
              className="mx-auto block min-h-16 w-full max-w-sm rounded-full bg-stone-200/75 font-semibold text-stone-700 transition hover:bg-stone-300/80"
              type="button"
              onClick={onFinish}
            >
              Done
            </button>
          </div>
        ) : null}

        {printing ? (
          <div className="mt-9 flex gap-2" role="status" aria-label="Sending print job">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="printing-dot size-3 rounded-full bg-[#b8a485]"
                style={{ animationDelay: `${index * 150}ms` }}
              />
            ))}
          </div>
        ) : null}

        {complete ? (
          <button
            className="mt-8 min-h-16 w-full rounded-[1.35rem] bg-stone-900 px-6 font-semibold text-white transition hover:bg-stone-800"
            type="button"
            onClick={onFinish}
          >
            Next
          </button>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
            {error}
          </p>
        ) : null}

        {session.uploadEnabled && qrEnabled ? (
          <div className="mt-5 flex min-h-24 items-center gap-4 rounded-[1.4rem] bg-stone-100 p-4">
            {qrCode ? (
              <img
                className="size-16 rounded-xl bg-white"
                src={qrCode}
                alt="QR code for this photo session"
                width="64"
                height="64"
              />
            ) : (
              <div className="size-16 animate-pulse rounded-xl bg-stone-200" aria-hidden="true" />
            )}
            <span className="text-sm font-semibold text-stone-700">
              {qrError ? 'Sharing unavailable' : qrCode ? 'Scan for photos' : 'Preparing sharing…'}
            </span>
          </div>
        ) : null}
      </section>
    </main>
  );
}
