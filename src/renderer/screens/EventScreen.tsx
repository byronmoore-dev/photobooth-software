import { useEffect, useRef } from 'react';
import type { AppState, PhotoCount } from '@shared/types';
import { PhotoSlots } from '../components/PhotoSlots';

interface EventScreenProps {
  state: AppState;
  frame: string;
  photos: string[];
  photoCount: PhotoCount;
  connected: boolean;
  setupRequired: boolean;
  mirrored: boolean;
  countdown: number;
  error: string;
  onStart(): void;
  onSettings(): void;
  onRetry(): void;
  onRetryFlash(): void;
}

export function EventScreen({
  state,
  frame,
  photos,
  photoCount,
  connected,
  setupRequired,
  mirrored,
  countdown,
  error,
  onStart,
  onSettings,
  onRetry,
  onRetryFlash,
}: EventScreenProps) {
  const active = state === 'COUNTDOWN' || state === 'CAPTURING' ? photos.length : undefined;
  const unavailable = !setupRequired && (state === 'ERROR' || (state === 'IDLE' && !connected));
  const settingsHoldTimer = useRef<number | null>(null);
  const settingsOpenedByHold = useRef(false);

  const cancelSettingsHold = () => {
    if (settingsHoldTimer.current !== null) window.clearTimeout(settingsHoldTimer.current);
    settingsHoldTimer.current = null;
  };

  const beginSettingsHold = () => {
    cancelSettingsHold();
    settingsOpenedByHold.current = false;
    settingsHoldTimer.current = window.setTimeout(() => {
      settingsHoldTimer.current = null;
      settingsOpenedByHold.current = true;
      onSettings();
    }, 1_500);
  };

  const activateSettings = () => {
    cancelSettingsHold();
    if (settingsOpenedByHold.current) {
      settingsOpenedByHold.current = false;
      return;
    }
    onSettings();
  };

  useEffect(() => cancelSettingsHold, []);

  return (
    <main className="relative h-full overflow-hidden bg-stone-950 text-white">
      <section className="absolute inset-0" aria-label="Camera viewfinder">
        {frame ? (
          <img
            className={`absolute inset-0 h-full w-full object-cover ${mirrored ? '-scale-x-100' : ''}`}
            src={frame}
            alt="Camera live view"
            width="1280"
            height="720"
            fetchPriority="high"
          />
        ) : null}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/15 via-transparent to-black/45" />

        {setupRequired ? (
          <div className="absolute inset-0 z-30 grid place-items-center bg-stone-950 px-6 text-center" role="status">
            <div className="max-w-md">
              <div
                className="mx-auto grid size-16 place-items-center rounded-[1.4rem] bg-[#b8a485] text-stone-950"
                aria-hidden="true"
              >
                <svg
                  className="size-8"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <path d="M12 7v10M7 12h10" />
                </svg>
              </div>
              <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em]">Event setup required</h1>
              <p className="mt-2 text-sm leading-6 text-stone-400">
                No event is configured for today. Open Settings to create one before using the booth.
              </p>
              <button
                className="mt-6 min-h-12 rounded-2xl bg-stone-50 px-7 font-semibold text-stone-900 transition hover:bg-white active:scale-[0.98]"
                type="button"
                onClick={onSettings}
              >
                Open Settings
              </button>
            </div>
          </div>
        ) : null}

        {unavailable ? (
          <div className="absolute inset-0 z-30 grid place-items-center bg-stone-950/95 px-6 text-center" role="alert">
            <div className="max-w-md">
              <div className="mx-auto grid size-16 place-items-center rounded-[1.4rem] bg-[#b8a485]" aria-hidden="true">
                <svg className="size-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1.1-1.5h6.4L16.3 6h1.2A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" />
                  <circle cx="12" cy="12.5" r="3.5" />
                </svg>
              </div>
              <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em]">Camera unavailable</h1>
              <p className="mt-2 text-sm leading-6 text-stone-400">
                {error || 'Check the camera connection and try again.'}
              </p>
              <button
                className="mt-6 min-h-12 rounded-2xl bg-stone-50 px-7 font-semibold text-stone-900 transition hover:bg-white"
                type="button"
                onClick={onRetry}
              >
                Retry
              </button>
              <button
                className="ml-3 min-h-12 rounded-2xl px-5 text-sm text-stone-300 transition hover:bg-white/10"
                type="button"
                onClick={onSettings}
              >
                Settings
              </button>
            </div>
          </div>
        ) : null}

        {state === 'FLASH_RETRY' ? (
          <div
            className="absolute inset-0 z-30 grid place-items-center bg-stone-950/90 px-6 text-center backdrop-blur-md"
            role="alert"
          >
            <div className="max-w-md">
              <div
                className="mx-auto grid size-16 place-items-center rounded-full bg-[#faf7f1] text-stone-950"
                aria-hidden="true"
              >
                <svg
                  className="size-8"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m13 2-7 11h6l-1 9 7-12h-6z" />
                </svg>
              </div>
              <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em]">Flash didn’t fire</h1>
              <p className="mt-2 text-sm leading-6 text-stone-300">{error}</p>
              <button
                className="mt-6 min-h-14 rounded-full bg-[#faf7f1] px-8 text-base font-semibold text-stone-950 shadow-xl transition hover:bg-white active:scale-[0.98]"
                type="button"
                onClick={onRetryFlash}
              >
                Retry photo
              </button>
            </div>
          </div>
        ) : null}

        {state === 'COUNTDOWN' ? (
          <div
            className="absolute inset-0 z-20 grid place-items-center bg-black/10"
            aria-live="assertive"
            aria-atomic="true"
          >
            <div key={countdown} className="relative grid size-[clamp(15rem,27vw,22rem)] place-items-center">
              <svg
                className="absolute inset-0 size-full -rotate-90 drop-shadow-xl"
                viewBox="0 0 100 100"
                fill="none"
                aria-hidden="true"
              >
                <circle cx="50" cy="50" r="46" stroke="rgb(255 255 255 / 22%)" strokeWidth="1.5" />
                <circle
                  className="countdown-ring"
                  cx="50"
                  cy="50"
                  r="46"
                  pathLength="1"
                  stroke="rgb(255 255 255 / 88%)"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
              </svg>
              <strong className="countdown-pop text-[clamp(7rem,18vw,14rem)] leading-none font-semibold tracking-[-0.08em] drop-shadow-2xl">
                {countdown}
              </strong>
            </div>
          </div>
        ) : null}
        {state === 'CAPTURING' ? (
          <div className="capture-flash absolute inset-0 z-40 bg-white" aria-hidden="true" />
        ) : null}

        {state === 'IDLE' && connected ? (
          <button
            className="group absolute top-1/2 left-1/2 z-10 grid min-h-[5.75rem] min-w-[21rem] -translate-x-1/2 -translate-y-1/2 grid-cols-[4.5rem_1fr_4.5rem] items-center rounded-full bg-[#faf7f1]/95 p-2 text-stone-950 shadow-[0_24px_70px_rgba(19,17,14,0.24)] backdrop-blur-2xl transition-[background-color,transform,box-shadow] hover:-translate-y-[53%] hover:bg-white hover:shadow-[0_30px_80px_rgba(19,17,14,0.3)] active:scale-[0.98]"
            type="button"
            onClick={onStart}
          >
            <span aria-hidden="true" />
            <span className="text-center text-xl font-semibold tracking-[-0.025em]">Start</span>
            <span
              className="grid size-[4.5rem] place-items-center rounded-full bg-stone-900 text-white transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            >
              <svg
                className="size-6"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h13M13 7l5 5-5 5" />
              </svg>
            </span>
          </button>
        ) : null}

        {state === 'IDLE' ? (
          <button
            className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] z-20 size-24 touch-none rounded-[2rem] bg-transparent"
            type="button"
            aria-label="Open attendant settings"
            onClick={activateSettings}
            onPointerDown={beginSettingsHold}
            onPointerUp={cancelSettingsHold}
            onPointerCancel={cancelSettingsHold}
            onPointerLeave={cancelSettingsHold}
            onContextMenu={(event) => event.preventDefault()}
          >
            <span className="sr-only">Tap or hold for 1.5 seconds</span>
          </button>
        ) : null}

        <PhotoSlots photos={photos} photoCount={photoCount} active={active} />
      </section>
    </main>
  );
}
