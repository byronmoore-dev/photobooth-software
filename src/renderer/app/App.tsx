import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState, CapturedPhoto, EventConfig, SessionView } from '@shared/types';
import { isEventActive, localDateInputValue } from '@shared/defaults';
import { getLayoutPreset } from '@shared/layoutPresets';
import { EventScreen } from '../screens/EventScreen';
import { ResultScreen } from '../screens/ResultScreen';
import { SetupScreen } from '../screens/SetupScreen';
import { captureErrorMessage, isRecoverableFlashError } from './captureErrors';
import { findTouchKeyboardTarget } from './touchKeyboard';
import { windowsCameraRecorder } from '../video/windowsCamera';

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const AUTOFOCUS_LEAD_MS = 500;
const MIN_CAPTURE_FLASH_MS = 320;
const FRAME_STALE_MS = 4_000;

export function App() {
  const [state, setState] = useState<AppState>('IDLE');
  const [config, setConfig] = useState<EventConfig | null>(null);
  const [connected, setConnected] = useState(false);
  const [frame, setFrame] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [countdown, setCountdown] = useState(3);
  const [session, setSession] = useState<SessionView | null>(null);
  const [copies, setCopies] = useState(1);
  const [error, setError] = useState('');
  const [today, setToday] = useState(localDateInputValue);
  const running = useRef(false);
  const connecting = useRef(false);
  const acceptLiveFrames = useRef(true);
  const lastFrameAt = useRef(0);
  const retryFlashShot = useRef<(() => void) | null>(null);

  const connect = useCallback(async () => {
    if (connecting.current) return;
    connecting.current = true;
    acceptLiveFrames.current = true;
    setError('');
    try {
      const status = await window.booth.camera.connect();
      const live = await window.booth.camera.startLiveView();
      setConnected(status.connected && live.status.liveView);
      setFrame(live.frame);
      lastFrameAt.current = performance.now();
    } catch (reason) {
      setConnected(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      connecting.current = false;
    }
  }, []);

  useEffect(() => {
    let active = true;
    window.booth.event
      .load()
      .then(async (loaded) => {
        if (!active) return;
        setConfig(loaded);
        setCopies(loaded.printer.defaultCopies);
        await window.booth.system.setKiosk(loaded.display.kioskMode);
        if (!isEventActive(loaded)) return;
        await window.booth.session.recover();
        await connect();
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    return () => {
      active = false;
    };
  }, [connect]);

  useEffect(() => {
    const timer = window.setInterval(() => setToday(localDateInputValue()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const openTouchKeyboard = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      const target = findTouchKeyboardTarget(event.composedPath());
      if (!target) return;

      target.focus({ preventScroll: false });
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
      const virtualKeyboard = (navigator as Navigator & { virtualKeyboard?: { show(): void } }).virtualKeyboard;
      try {
        virtualKeyboard?.show();
      } catch {
        // Windows TabTip below remains the reliable packaged-app fallback.
      }
      void window.booth.system.showTouchKeyboard().catch(() => undefined);
    };

    document.addEventListener('pointerup', openTouchKeyboard, true);
    return () => document.removeEventListener('pointerup', openTouchKeyboard, true);
  }, []);

  const eventActive = Boolean(config && isEventActive(config, today));
  const photoCount = getLayoutPreset(config?.layout.preset ?? 'side-rail-three-stack').photoCount;

  useEffect(() => {
    if (eventActive || state !== 'IDLE' || !connected) return;
    setConnected(false);
    setFrame('');
    void window.booth.camera.disconnect().catch(() => undefined);
  }, [connected, eventActive, state]);

  useEffect(
    () =>
      window.booth.camera.onFrame((nextFrame) => {
        lastFrameAt.current = performance.now();
        setConnected(true);
        if (acceptLiveFrames.current) setFrame(nextFrame);
      }),
    [],
  );

  useEffect(
    () =>
      window.booth.camera.onStatus((status) => {
        setConnected(status.connected && status.liveView);
        if (!status.connected) setError(status.message);
      }),
    [],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (state !== 'IDLE' || !connected || performance.now() - lastFrameAt.current < FRAME_STALE_MS) return;
      setConnected(false);
      setError('Live view stopped updating. Reconnecting…');
      void connect();
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [connect, connected, state]);

  useEffect(() => {
    if (!session?.uploadEnabled || !['RESULT', 'COMPLETE'].includes(state)) return;
    const timer = window.setInterval(() => {
      window.booth.session
        .get(session.id)
        .then((fresh) => {
          setSession(fresh);
          if (fresh.uploadStatus === 'complete') window.clearInterval(timer);
        })
        .catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [session?.id, session?.uploadEnabled, state]);

  const start = async () => {
    if (!config || !isEventActive(config) || running.current || !connected) return;
    running.current = true;
    acceptLiveFrames.current = true;
    setError('');
    setPhotos([]);
    let current: SessionView | null = null;
    const startSessionVideo = async (view: SessionView) => {
      if (!view.videoEnabled || view.videoSource !== 'windows-camera') return window.booth.session.startVideo(view.id);
      try {
        return await windowsCameraRecorder.start(view.id, config.capture.windowsVideoDeviceId);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        return window.booth.session.failVideo(view.id, message);
      }
    };
    const stopSessionVideo = async (view: SessionView) => {
      if (view.videoSource !== 'windows-camera') return window.booth.session.stopVideo(view.id);
      try {
        return await windowsCameraRecorder.stop(view.id);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        return window.booth.session.failVideo(view.id, message);
      }
    };
    try {
      current = await window.booth.session.create(false);
      setSession(current);
      current = await startSessionVideo(current);
      setSession(current);
      for (let index = 0; index < photoCount; index++) {
        let photo: CapturedPhoto | null = null;
        while (!photo) {
          setState('COUNTDOWN');
          let capture: Promise<CapturedPhoto> | null = null;
          for (let number = config.capture.countdownSeconds; number >= 1; number--) {
            setCountdown(number);
            const tickEndsAt = performance.now() + 1_000;
            if (number === 1) {
              await wait(1_000 - AUTOFOCUS_LEAD_MS);
              capture = window.booth.camera.capture(current.id, index);
            }
            await wait(Math.max(0, tickEndsAt - performance.now()));
          }
          setState('CAPTURING');
          if (!capture) throw new Error('Capture timing did not start');
          try {
            [photo] = await Promise.all([capture, wait(MIN_CAPTURE_FLASH_MS)]);
          } catch (reason) {
            if (!isRecoverableFlashError(reason)) throw reason;
            setError(captureErrorMessage(reason));
            setState('FLASH_RETRY');
            await new Promise<void>((resolve) => {
              retryFlashShot.current = resolve;
            });
            retryFlashShot.current = null;
            setError('');
            const live = await window.booth.camera.startLiveView();
            setFrame(live.frame);
            lastFrameAt.current = performance.now();
            acceptLiveFrames.current = true;
          }
        }
        acceptLiveFrames.current = false;
        setPhotos((currentPhotos) => [...currentPhotos, photo.dataUrl]);
        setFrame(photo.dataUrl);
        setState('PHOTO_PREVIEW');
        if (index === photoCount - 1) {
          const video = stopSessionVideo(current);
          const [rendered] = await Promise.all([
            window.booth.session.render(current.id),
            wait(config.capture.previewMs),
          ]);
          setSession(rendered);
          setState('RESULT');
          void video.catch(() => undefined);
          return;
        }
        await wait(config.capture.previewMs);
        const live = await window.booth.camera.startLiveView();
        setFrame(live.frame);
        lastFrameAt.current = performance.now();
        acceptLiveFrames.current = true;
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setState('ERROR');
      if (current) await stopSessionVideo(current).catch(() => undefined);
      await window.booth.session.recover().catch(() => undefined);
    } finally {
      running.current = false;
    }
  };

  const print = async () => {
    if (!session) return;
    setState('PRINTING');
    setError('');
    try {
      const result = await window.booth.printer.print(session.id, copies);
      if (!result.submitted) throw new Error(result.message);
      setSession(await window.booth.session.get(session.id));
      setState('COMPLETE');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setState('RESULT');
    }
  };

  const reset = async () => {
    setPhotos([]);
    setSession(null);
    setError('');
    setState('IDLE');
    await connect();
  };

  const persistSettings = async (next: EventConfig) => {
    const saved = await window.booth.event.save(next);
    setConfig(saved);
    setCopies(saved.printer.defaultCopies);
    await window.booth.system.setKiosk(saved.display.kioskMode);
    return saved;
  };

  const createEvent = async (next: EventConfig) => {
    const created = await window.booth.event.create(next);
    setConfig(created);
    setCopies(created.printer.defaultCopies);
    await window.booth.system.setKiosk(created.display.kioskMode);
    return created;
  };

  const closeSettings = async (next: EventConfig) => {
    const saved = await persistSettings(next);
    setError('');
    setState('IDLE');
    if (isEventActive(saved)) {
      await window.booth.session.recover();
      await connect();
    } else {
      setConnected(false);
      setFrame('');
      await window.booth.camera.disconnect().catch(() => undefined);
    }
    return saved;
  };

  if (!config) {
    return (
      <main className="grid h-full place-items-center bg-stone-950 text-stone-100" aria-live="polite">
        <span className="size-10 animate-pulse rounded-full bg-stone-100/20" aria-label="Preparing…" />
      </main>
    );
  }

  if (state === 'SETUP') {
    return <SetupScreen config={config} onPersist={persistSettings} onCreate={createEvent} onClose={closeSettings} />;
  }

  if (session && ['RESULT', 'PRINTING', 'COMPLETE'].includes(state)) {
    return (
      <ResultScreen
        state={state}
        session={session}
        copies={copies}
        maxCopies={config.printer.maxCopies}
        qrEnabled={config.sharing.qrEnabled}
        onCopies={setCopies}
        onPrint={print}
        onFinish={reset}
        error={error}
      />
    );
  }

  return (
    <EventScreen
      state={state}
      frame={frame}
      photos={photos}
      photoCount={photoCount}
      connected={connected}
      setupRequired={!eventActive}
      mirrored={config.capture.mirrorLiveView}
      countdown={countdown}
      error={error}
      onStart={start}
      onSettings={() => setState('SETUP')}
      onRetry={async () => {
        await connect();
        setState('IDLE');
      }}
      onRetryFlash={() => retryFlashShot.current?.()}
    />
  );
}
