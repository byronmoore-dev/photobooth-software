import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { eventDraftIssues, isEventActive, isEventDraftComplete } from '@shared/defaults';
import { applyLayoutPreset, LAYOUT_PRESETS } from '@shared/layoutPresets';
import type { DiagnosticsResult, EventConfig, LogEntry, PrinterInfo, SessionSummary } from '@shared/types';
import { PrintQuantity } from '../components/PrintQuantity';

const tabs = [
  'Set Up',
  'Sessions',
  'Capture',
  'Layout',
  'Camera',
  'Printer',
  'Display',
  'Sharing',
  'Diagnostics',
  'Logs',
] as const;
type Tab = (typeof tabs)[number];
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'required';

const tabId = (tab: Tab) => tab.toLowerCase().replaceAll(' ', '-');
const cardClass = 'mb-6 max-w-6xl rounded-[2rem] bg-white/90 p-10 shadow-[0_16px_55px_rgba(63,55,46,0.055)]';
const inputClass =
  'min-h-14 w-full rounded-2xl bg-stone-100 px-4 text-sm text-stone-900 transition-[background-color,box-shadow] placeholder:text-stone-400 focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-[#8f7554]/15';
const actionClass =
  'min-h-12 rounded-2xl bg-stone-900 px-5 text-sm font-semibold text-white transition-[background-color,transform] hover:bg-stone-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45';
const quietActionClass =
  'min-h-12 rounded-2xl bg-stone-100 px-5 text-sm font-semibold text-stone-700 transition-[background-color,transform] hover:bg-stone-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45';

interface SetupScreenProps {
  config: EventConfig;
  onPersist(config: EventConfig): Promise<EventConfig>;
  onCreate(config: EventConfig): Promise<EventConfig>;
  onClose(config: EventConfig): Promise<EventConfig>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-2">
      <span className="pl-1 text-xs font-semibold text-stone-600">{label}</span>
      {children}
      {hint ? <small className="pl-1 text-[0.68rem] leading-4 text-stone-500">{hint}</small> : null}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange(value: boolean): void;
  label: string;
  description?: string;
}) {
  return (
    <button
      className="my-2 flex min-h-16 w-full items-center justify-between gap-4 rounded-2xl bg-stone-200/70 px-4 text-left transition-colors hover:bg-stone-200"
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span>
        <strong className="block text-sm font-semibold">{label}</strong>
        {description ? <span className="mt-0.5 block text-xs text-stone-500">{description}</span> : null}
      </span>
      <span
        className={`relative h-7 w-12 shrink-0 rounded-full p-[3px] transition-colors ${checked ? 'bg-stone-900' : 'bg-stone-400'}`}
        aria-hidden="true"
      >
        <span
          className={`block size-[22px] rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : ''}`}
        />
      </span>
    </button>
  );
}

const humanStatus = (status: string) => status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const logDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const sessionDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const eventDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' });
const dateInputToLocalDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const logDetails = (details: unknown) => {
  if (details === undefined || details === null || details === '') return '';
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
};

const trapDialogFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
  if (event.key !== 'Tab') return;
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  );
  if (!controls.length) return;
  const first = controls[0];
  const last = controls.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};

export function SetupScreen({ config, onPersist, onCreate, onClose }: SetupScreenProps) {
  const [draft, setDraft] = useState(config);
  const [tab, setTab] = useState<Tab>('Set Up');
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [preview, setPreview] = useState<{ path: string; dataUrl: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'error'>('info');
  const [messageTab, setMessageTab] = useState<Tab>('Set Up');
  const [layoutError, setLayoutError] = useState('');
  const [checks, setChecks] = useState<DiagnosticsResult[]>([]);
  const [recent, setRecent] = useState<SessionSummary[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionSummary | null>(null);
  const [reprintCopies, setReprintCopies] = useState(1);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logLevel, setLogLevel] = useState<'all' | LogEntry['level']>('all');
  const [confirmNewEvent, setConfirmNewEvent] = useState(false);
  const [newEventDraft, setNewEventDraft] = useState<EventConfig | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(isEventActive(config) ? 'idle' : 'required');
  const lastSaved = useRef(JSON.stringify(config));
  const saveQueue = useRef<Promise<EventConfig>>(Promise.resolve(config));
  const saveTimer = useRef<number | null>(null);
  const closing = useRef(false);
  const sessionCloseButton = useRef<HTMLButtonElement>(null);
  const newEventCancelButton = useRef<HTMLButtonElement>(null);
  const showError = (reason: unknown) => {
    setMessageTone('error');
    setMessageTab(tab);
    setMessage(reason instanceof Error ? reason.message : String(reason));
  };

  const refreshLogs = async () => {
    setBusy('logs');
    try {
      setLogs(await window.booth.system.logs());
    } catch (reason) {
      showError(reason);
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    let active = true;
    Promise.all([
      window.booth.printer.list(),
      isEventActive(config) ? window.booth.session.recent() : Promise.resolve([]),
    ])
      .then(([availablePrinters, sessions]) => {
        if (!active) return;
        setPrinters(availablePrinters);
        setRecent(sessions);
      })
      .catch((reason) => {
        if (active) showError(reason);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (tab !== 'Logs') return;
    void refreshLogs();
    const timer = window.setInterval(() => void refreshLogs(), 10_000);
    return () => window.clearInterval(timer);
  }, [tab]);

  const patch = <Key extends keyof EventConfig>(key: Key, value: EventConfig[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const patchNewEvent = <Key extends keyof EventConfig>(key: Key, value: EventConfig[Key]) => {
    setNewEventDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const queueSave = (next: EventConfig) => {
    const snapshot = JSON.stringify(next);
    if (snapshot === lastSaved.current) return saveQueue.current;
    setSaveStatus('saving');
    saveQueue.current = saveQueue.current
      .catch(() => config)
      .then(() => onPersist(next))
      .then((saved) => {
        lastSaved.current = JSON.stringify(saved);
        setDraft((current) => (JSON.stringify(current) === snapshot ? saved : current));
        setSaveStatus(isEventActive(saved) ? 'saved' : 'required');
        return saved;
      })
      .catch((reason) => {
        setSaveStatus('error');
        showError(reason);
        throw reason;
      });
    return saveQueue.current;
  };

  useEffect(() => {
    if (closing.current) return;
    const snapshot = JSON.stringify(draft);
    if (snapshot === lastSaved.current) return;
    saveTimer.current = window.setTimeout(() => {
      void queueSave(draft).catch(() => undefined);
    }, 600);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    };
  }, [draft]);

  const close = async () => {
    if (closing.current) return;
    closing.current = true;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    setBusy('close');
    try {
      await saveQueue.current.catch(() => config);
      await onClose(draft);
    } catch (reason) {
      closing.current = false;
      setSaveStatus('error');
      showError(reason);
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    if (!selectedSession) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sessionCloseButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedSession(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [selectedSession]);

  useEffect(() => {
    if (!confirmNewEvent) return;
    newEventCancelButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirmNewEvent(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmNewEvent]);

  useEffect(() => {
    if (!message || messageTone !== 'success') return;
    const timer = window.setTimeout(() => setMessage(''), 5_000);
    return () => window.clearTimeout(timer);
  }, [message, messageTone]);

  const chooseNewEventFolder = async () => {
    const folder = await window.booth.event.chooseFolder();
    if (folder) setNewEventDraft((current) => (current ? { ...current, baseFolder: folder } : current));
  };

  const chooseRailArtwork = async () => {
    setBusy('rail-artwork');
    try {
      const artwork = await window.booth.layout.chooseRailImage();
      if (!artwork) return;
      patch('layout', {
        ...draft.layout,
        railImageAssetId: artwork.assetId,
        railImageName: artwork.name,
      });
      setMessageTone('success');
      setMessageTab('Layout');
      setMessage('Rail artwork added.');
    } catch (reason) {
      showError(reason);
    } finally {
      setBusy('');
    }
  };

  const withFeedback = async (name: string, action: () => Promise<unknown>, success: string) => {
    setBusy(name);
    setMessage('');
    try {
      await action();
      setMessageTone('success');
      setMessageTab(tab);
      setMessage(success);
      return true;
    } catch (reason) {
      showError(reason);
      return false;
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    if (tab !== 'Layout') return;
    let active = true;
    const timer = window.setTimeout(() => {
      setBusy('preview');
      setLayoutError('');
      window.booth.layout
        .preview(draft.layout)
        .then((result) => {
          if (active) setPreview(result);
        })
        .catch((reason) => {
          if (active) {
            setLayoutError('The print preview could not be generated. Try again; if it continues, check Logs.');
            console.error(reason);
          }
        })
        .finally(() => {
          if (active) setBusy('');
        });
    }, 400);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [draft.layout, tab]);

  useEffect(() => {
    if (saveStatus !== 'saved') return;
    const timer = window.setTimeout(() => setSaveStatus('idle'), 1_200);
    return () => window.clearTimeout(timer);
  }, [saveStatus]);

  const createEvent = async () => {
    if (!newEventDraft || !isEventDraftComplete(newEventDraft) || busy === 'create-event') return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    setBusy('create-event');
    setMessage('');
    try {
      await saveQueue.current.catch(() => config);
      const creationDraft = {
        ...newEventDraft,
        layout: {
          ...newEventDraft.layout,
          detail:
            newEventDraft.layout.detail.trim() ||
            `${newEventDraft.description.trim()} · ${eventDate.format(dateInputToLocalDate(newEventDraft.eventDate))}`,
        },
      };
      const created = await onCreate(creationDraft);
      setDraft(created);
      setNewEventDraft(null);
      lastSaved.current = JSON.stringify(created);
      setSaveStatus('saved');
      setMessageTone('success');
      setMessageTab('Set Up');
      setMessage('Event created.');
      setRecent(await window.booth.session.recent());
    } catch (reason) {
      showError(reason);
    } finally {
      setBusy('');
    }
  };

  const beginNewEvent = () => {
    setConfirmNewEvent(false);
    setMessage('');
    setNewEventDraft({
      ...draft,
      id: '',
      createdAt: '',
      eventDate: '',
      description: '',
      layout: { ...draft.layout, detail: '' },
    });
    setTab('Set Up');
  };

  const runChecks = async () => {
    setBusy('checks');
    setMessage('');
    try {
      setChecks(await window.booth.diagnostics.run());
    } catch (reason) {
      showError(reason);
    } finally {
      setBusy('');
    }
  };

  const saveLabel =
    saveStatus === 'saving'
      ? 'Saving…'
      : saveStatus === 'saved'
        ? 'Saved'
        : saveStatus === 'error'
          ? 'Save failed'
          : '';
  const visibleLogs = logs.filter((entry) => logLevel === 'all' || entry.level === logLevel).slice(0, 50);
  const setupReady = isEventActive(draft);
  const completedSessions = setupReady ? recent.filter((item) => item.finalDataUrl) : [];
  const draftIssues = newEventDraft ? eventDraftIssues(newEventDraft) : [];
  return (
    <main className="grid h-full grid-cols-[17rem_minmax(0,1fr)] overflow-x-hidden bg-stone-100 text-stone-900">
      <a
        className="sr-only fixed top-4 left-4 z-50 rounded-xl bg-stone-950 px-4 py-3 text-sm font-semibold text-white focus:not-sr-only"
        href="#settings-content"
      >
        Skip to settings
      </a>
      <aside
        className="m-6 mr-0 flex min-h-0 flex-col rounded-[2.25rem] bg-white/90 p-5"
        aria-label="Settings sections"
        inert={selectedSession || confirmNewEvent ? true : undefined}
      >
        <h1 className="px-4 pt-4 pb-7 text-2xl font-semibold tracking-[-0.045em]">Settings</h1>
        <nav className="grid gap-1.5" role="tablist" aria-orientation="vertical">
          {tabs.map((item) => (
            <button
              key={item}
              id={`tab-${tabId(item)}`}
              className={`min-h-12 rounded-2xl px-4 text-left text-sm font-medium transition-[background-color,color] ${tab === item ? 'bg-stone-200/80 text-stone-950' : 'text-stone-500 hover:bg-stone-100 hover:text-stone-800'}`}
              type="button"
              role="tab"
              aria-selected={tab === item}
              aria-controls={`panel-${tabId(item)}`}
              tabIndex={tab === item ? 0 : -1}
              onClick={() => setTab(item)}
              onKeyDown={(event) => {
                if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const current = tabs.indexOf(item);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : (current + (event.key === 'ArrowUp' ? -1 : 1) + tabs.length) % tabs.length;
                const nextTab = tabs[next];
                setTab(nextTab);
                document.getElementById(`tab-${tabId(nextTab)}`)?.focus();
              }}
            >
              {item}
            </button>
          ))}
        </nav>
      </aside>

      <section
        id="settings-content"
        className="flex min-w-0 flex-col overflow-hidden"
        tabIndex={-1}
        inert={selectedSession || confirmNewEvent ? true : undefined}
      >
        <header className="flex min-h-36 items-center justify-between px-[clamp(3rem,6vw,6.5rem)]">
          <div>
            <h2 className="text-4xl font-semibold tracking-[-0.05em]">
              {tab === 'Set Up' && newEventDraft ? 'New Event' : tab}
            </h2>
            {saveLabel ? (
              <p
                className={`mt-1 text-xs ${saveStatus === 'error' ? 'text-red-700' : 'text-stone-500'}`}
                role="status"
                aria-live="polite"
              >
                {saveLabel}
              </p>
            ) : null}
          </div>
          <button
            className="grid size-13 place-items-center rounded-full bg-white text-stone-800 shadow-sm transition-[background-color,transform] hover:bg-stone-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            onClick={() => void close()}
            disabled={busy === 'close'}
            aria-label="Close settings"
            title="Close settings"
          >
            <svg
              className="size-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div
          id={`panel-${tabId(tab)}`}
          className="min-h-0 flex-1 [scrollbar-width:thin] [scrollbar-color:#c8c2b8_transparent] overflow-y-auto overscroll-contain px-[clamp(3rem,6vw,6.5rem)] pb-20"
          role="tabpanel"
          aria-labelledby={`tab-${tabId(tab)}`}
        >
          {message && messageTab === tab ? (
            <div
              className={`fixed right-8 bottom-8 z-40 flex max-w-sm items-center justify-between gap-4 rounded-[1.4rem] px-5 py-4 text-sm shadow-2xl ${messageTone === 'error' ? 'bg-red-950 text-red-50' : messageTone === 'success' ? 'bg-emerald-950 text-emerald-50' : 'bg-stone-900 text-stone-50'}`}
              role={messageTone === 'error' ? 'alert' : 'status'}
              aria-live="polite"
            >
              <span className="min-w-0 break-words">{message}</span>
              <button
                className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-stone-300/70 focus-visible:ring-4 focus-visible:ring-stone-400/25"
                type="button"
                aria-label="Dismiss notification"
                onClick={() => setMessage('')}
              >
                <svg
                  className="size-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          ) : null}

          {tab === 'Set Up' ? (
            newEventDraft ? (
              <section className={cardClass}>
                <div className="flex items-start justify-between gap-8">
                  <div>
                    <h3 className="text-2xl font-semibold tracking-[-0.035em]">Create a New Event</h3>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-stone-500">
                      Add the details for this event. Nothing is saved until you create it.
                    </p>
                  </div>
                  <button
                    className={quietActionClass}
                    type="button"
                    onClick={() => {
                      setNewEventDraft(null);
                      setMessage('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
                <div className="mt-10 grid gap-7 md:grid-cols-2">
                  <Field label="Event ID" hint="Letters, numbers, dashes, and underscores">
                    <input
                      className={inputClass}
                      name="eventId"
                      autoComplete="off"
                      spellCheck="false"
                      required
                      aria-invalid={!newEventDraft.id.trim()}
                      maxLength={80}
                      value={newEventDraft.id}
                      onChange={(event) => patchNewEvent('id', event.target.value)}
                      autoFocus
                    />
                  </Field>
                  <Field
                    label="Event Date"
                    hint={
                      newEventDraft.eventDate
                        ? eventDate.format(dateInputToLocalDate(newEventDraft.eventDate))
                        : 'Required'
                    }
                  >
                    <input
                      className={inputClass}
                      name="eventDate"
                      type="date"
                      autoComplete="off"
                      required
                      aria-invalid={!newEventDraft.eventDate}
                      value={newEventDraft.eventDate}
                      onChange={(event) => patchNewEvent('eventDate', event.target.value)}
                    />
                  </Field>
                  <Field label="Description" hint="Event name, host, or short identifier">
                    <input
                      className={inputClass}
                      name="eventDescription"
                      autoComplete="off"
                      required
                      aria-invalid={!newEventDraft.description.trim()}
                      maxLength={500}
                      value={newEventDraft.description}
                      onChange={(event) => patchNewEvent('description', event.target.value)}
                    />
                  </Field>
                  <Field label="Event Folder" hint="Each session is saved inside this folder">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <input
                        className={inputClass}
                        name="eventFolder"
                        value={newEventDraft.baseFolder}
                        required
                        aria-invalid={!newEventDraft.baseFolder.trim()}
                        readOnly
                      />
                      <button className={quietActionClass} type="button" onClick={() => void chooseNewEventFolder()}>
                        Choose
                      </button>
                    </div>
                  </Field>
                </div>
                <div className="mt-10 flex items-center gap-4">
                  <button
                    className={`${actionClass} min-w-48`}
                    type="button"
                    disabled={draftIssues.length > 0 || busy === 'create-event'}
                    onClick={() => void createEvent()}
                  >
                    {busy === 'create-event' ? 'Creating…' : 'Create Event'}
                  </button>
                  {draftIssues.length ? (
                    <p className="text-xs text-stone-500" aria-live="polite">
                      Complete every field to create the event.
                    </p>
                  ) : null}
                </div>
              </section>
            ) : setupReady ? (
              <section className={cardClass}>
                <div className="flex items-start justify-between gap-8">
                  <div>
                    <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                      Today’s Event
                    </span>
                    <h3 className="mt-5 text-3xl font-semibold tracking-[-0.045em] text-balance">
                      {draft.description}
                    </h3>
                  </div>
                  <button className={quietActionClass} type="button" onClick={() => setConfirmNewEvent(true)}>
                    New Event
                  </button>
                </div>
                <dl className="mt-10 grid gap-x-10 gap-y-7 md:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold text-stone-500">Event ID</dt>
                    <dd className="mt-2 text-base font-medium break-words text-stone-900">{draft.id}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-stone-500">Event Date</dt>
                    <dd className="mt-2 text-base font-medium text-stone-900">
                      {eventDate.format(dateInputToLocalDate(draft.eventDate))}
                    </dd>
                  </div>
                  <div className="md:col-span-2">
                    <dt className="text-xs font-semibold text-stone-500">Event Folder</dt>
                    <dd className="mt-2 text-sm font-medium break-all text-stone-700">{draft.baseFolder}</dd>
                  </div>
                </dl>
              </section>
            ) : (
              <section className="grid min-h-[28rem] max-w-6xl place-items-center rounded-[2.25rem] bg-white/90 p-10 text-center shadow-[0_16px_55px_rgba(63,55,46,0.055)]">
                <div className="max-w-lg">
                  <div
                    className="mx-auto grid size-16 place-items-center rounded-full bg-stone-100 text-stone-700"
                    aria-hidden="true"
                  >
                    <svg
                      className="size-7"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    >
                      <path d="M12 7v10M7 12h10" />
                    </svg>
                  </div>
                  <h3 className="mt-7 text-3xl font-semibold tracking-[-0.045em] text-balance">No Event Today</h3>
                  <p className="mt-3 text-sm leading-6 text-stone-500">
                    Create an event for today when you’re ready to open the booth.
                  </p>
                  <button className={`${actionClass} mt-8 min-w-44`} type="button" onClick={beginNewEvent}>
                    New Event
                  </button>
                </div>
              </section>
            )
          ) : null}

          {tab === 'Sessions' ? (
            <section className="max-w-6xl">
              {completedSessions.length ? (
                <div className="grid grid-cols-2 gap-x-8 gap-y-10 lg:grid-cols-3">
                  {completedSessions.map((item) => (
                    <button
                      className="group min-w-0 rounded-[1.5rem] text-left transition-transform hover:-translate-y-1 focus-visible:ring-4 focus-visible:ring-[#8f7554]/20 motion-reduce:transform-none"
                      type="button"
                      key={item.id}
                      onClick={() => {
                        setReprintCopies(draft.printer.defaultCopies);
                        setSelectedSession(item);
                      }}
                    >
                      <img
                        className="aspect-[2/3] w-full rounded-[1.5rem] bg-stone-200 object-cover shadow-[0_16px_45px_rgba(63,55,46,0.1)] transition-shadow group-hover:shadow-[0_22px_55px_rgba(63,55,46,0.16)]"
                        src={item.finalDataUrl}
                        alt={`Photo strip from ${sessionDate.format(new Date(item.createdAt))}`}
                        width={1200}
                        height={1800}
                        loading="lazy"
                      />
                      <time className="block truncate px-1 pt-3 text-sm font-semibold" dateTime={item.createdAt}>
                        {sessionDate.format(new Date(item.createdAt))}
                      </time>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid min-h-80 place-items-center rounded-[2rem] bg-white/80 p-10 text-center">
                  <div>
                    <h3 className="text-xl font-semibold">No Finished Sessions</h3>
                    <p className="mt-2 text-sm text-stone-500">Completed photo strips will appear here.</p>
                  </div>
                </div>
              )}
            </section>
          ) : null}

          {tab === 'Capture' ? (
            <section className={cardClass}>
              <h3 className="text-xl font-semibold tracking-[-0.025em]">Session timing</h3>
              <p className="mt-1 mb-7 text-sm text-stone-500">Set the pace of each three-photo session.</p>
              <div className="grid max-w-3xl gap-5 md:grid-cols-2">
                <Field label="Countdown" hint="Seconds">
                  <input
                    className={inputClass}
                    name="countdownSeconds"
                    type="number"
                    inputMode="numeric"
                    autoComplete="off"
                    min="1"
                    max="10"
                    value={draft.capture.countdownSeconds}
                    onChange={(event) =>
                      patch('capture', { ...draft.capture, countdownSeconds: Number(event.target.value) })
                    }
                  />
                </Field>
                <Field label="Photo preview" hint="Seconds">
                  <input
                    className={inputClass}
                    name="previewSeconds"
                    type="number"
                    inputMode="decimal"
                    autoComplete="off"
                    min="0.25"
                    max="10"
                    step="0.25"
                    value={draft.capture.previewMs / 1000}
                    onChange={(event) =>
                      patch('capture', { ...draft.capture, previewMs: Math.round(Number(event.target.value) * 1000) })
                    }
                  />
                </Field>
              </div>
              <div className="mt-5">
                <Toggle
                  checked={draft.capture.mirrorLiveView}
                  onChange={(mirrorLiveView) => patch('capture', { ...draft.capture, mirrorLiveView })}
                  label="Mirror the live view"
                  description="The saved photo is never mirrored"
                />
              </div>
            </section>
          ) : null}

          {tab === 'Layout' ? (
            <div className="grid max-w-6xl gap-5 xl:grid-cols-[minmax(30rem,1fr)_22rem]">
              <section className={cardClass}>
                <h3 className="text-xl font-semibold tracking-[-0.025em] text-balance">Print Layout</h3>
                <p className="mt-1 mb-7 text-sm text-stone-500">
                  Choose a complete design, then add the event text and optional rail artwork.
                </p>
                <div className="mb-7 grid gap-3" role="radiogroup" aria-label="Print layout preset">
                  {LAYOUT_PRESETS.map((preset) => {
                    const selected = draft.layout.preset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        className={`grid min-h-28 grid-cols-[4.5rem_1fr_auto] items-center gap-4 rounded-[1.4rem] p-4 text-left transition-colors ${selected ? 'bg-stone-900 text-white' : 'bg-stone-200/70 hover:bg-stone-200'}`}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => patch('layout', applyLayoutPreset(draft.layout, preset.id))}
                      >
                        <span
                          className={`grid aspect-[2/3] h-16 grid-cols-[1fr_3fr] overflow-hidden rounded-lg ${selected ? 'bg-stone-700' : 'bg-stone-300'}`}
                          aria-hidden="true"
                        >
                          <span className={selected ? 'bg-[#b8a485]' : 'bg-[#d3c6b3]'} />
                          <span className="grid grid-rows-3 gap-px bg-white/30">
                            <i className="bg-stone-50/80" />
                            <i className="bg-stone-50/70" />
                            <i className="bg-stone-50/60" />
                          </span>
                        </span>
                        <span className="min-w-0">
                          <strong className="block text-sm font-semibold">{preset.name}</strong>
                          <span
                            className={`mt-1 block text-xs leading-5 ${selected ? 'text-stone-300' : 'text-stone-500'}`}
                          >
                            {preset.description}
                          </span>
                        </span>
                        <span
                          className={`text-right text-[0.68rem] leading-5 ${selected ? 'text-stone-300' : 'text-stone-500'}`}
                        >
                          <b className="block font-semibold">{preset.printSize}</b>
                          {preset.photoSize}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="Rail Headline">
                    <input
                      className={inputClass}
                      name="layoutHeadline"
                      autoComplete="off"
                      maxLength={120}
                      value={draft.layout.text}
                      onChange={(event) => patch('layout', { ...draft.layout, text: event.target.value })}
                      placeholder="Congratulations…"
                    />
                  </Field>
                  <Field label="Event Details" hint="Event name, date, venue, or a short message">
                    <input
                      className={inputClass}
                      name="layoutDetails"
                      autoComplete="off"
                      maxLength={180}
                      value={draft.layout.detail}
                      onChange={(event) => patch('layout', { ...draft.layout, detail: event.target.value })}
                      placeholder="Summer Gala · August 2026…"
                    />
                  </Field>
                </div>
                <div className="mt-7 rounded-[1.5rem] bg-stone-100 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                      <strong className="block text-sm">Rail Artwork</strong>
                      <span className="mt-1 block truncate text-xs text-stone-500">
                        {draft.layout.railImageName || 'Use the selected design’s built-in rail'}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      {draft.layout.railImageAssetId ? (
                        <button
                          className={quietActionClass}
                          type="button"
                          onClick={() => patch('layout', { ...draft.layout, railImageAssetId: '', railImageName: '' })}
                        >
                          Remove
                        </button>
                      ) : null}
                      <button
                        className={actionClass}
                        type="button"
                        disabled={busy === 'rail-artwork'}
                        onClick={() => void chooseRailArtwork()}
                      >
                        {busy === 'rail-artwork'
                          ? 'Importing…'
                          : draft.layout.railImageAssetId
                            ? 'Replace PNG'
                            : 'Add PNG'}
                      </button>
                    </div>
                  </div>
                  <p className="mt-4 text-xs leading-5 text-stone-500">
                    Use a 300 × 1800 PNG for the sharpest 1 × 6 inch rail. Other tall images are centered and cropped.
                  </p>
                </div>
              </section>
              <section
                className="grid min-h-[34rem] place-items-center self-start rounded-[2rem] bg-stone-900 p-6 text-center text-stone-300"
                aria-live="polite"
              >
                {layoutError ? (
                  <div
                    className="max-w-xs rounded-2xl bg-red-950 px-5 py-4 text-left text-sm leading-6 text-red-100"
                    role="alert"
                  >
                    {layoutError}
                  </div>
                ) : null}
                {preview ? (
                  <img
                    className="max-h-[29rem] max-w-full rounded-xl object-contain shadow-2xl"
                    src={preview.dataUrl}
                    alt="4 by 6 print layout preview with a left information rail and three stacked photos"
                    width={draft.layout.width}
                    height={draft.layout.height}
                    loading="lazy"
                  />
                ) : (
                  <div>
                    <strong className="text-3xl font-medium">{busy === 'preview' ? 'Rendering…' : '4 × 6'}</strong>
                    <p className="mt-2 text-xs text-stone-500">Preparing the print preview…</p>
                  </div>
                )}
                {preview ? (
                  <button
                    className="mt-5 min-h-12 rounded-2xl bg-stone-50 px-5 text-sm font-semibold text-stone-900"
                    type="button"
                    onClick={() =>
                      void withFeedback(
                        'test-print',
                        () => window.booth.printer.testPrint(preview.path),
                        'Test print job sent.',
                      )
                    }
                  >
                    {busy === 'test-print' ? 'Sending…' : 'Test print'}
                  </button>
                ) : null}
              </section>
            </div>
          ) : null}

          {tab === 'Camera' ? (
            <section className={cardClass}>
              <h3 className="text-xl font-semibold tracking-[-0.025em]">Canon camera</h3>
              <p className="mt-1 mb-6 text-sm text-stone-500">
                Official Canon EDSDK connection for live view, autofocus, and capture.
              </p>
              <div className="rounded-[1.4rem] bg-stone-200/70 p-5">
                <strong className="block text-sm">Canon EOS Rebel T6i</strong>
                <span className="mt-1 block text-xs text-stone-500">USB live view and JPEG capture</span>
              </div>
              <button
                className={`${actionClass} mt-5`}
                type="button"
                disabled={busy === 'camera'}
                onClick={() => void withFeedback('camera', () => window.booth.camera.connect(), 'Camera connected.')}
              >
                {busy === 'camera' ? 'Connecting…' : 'Connect camera'}
              </button>
            </section>
          ) : null}

          {tab === 'Printer' ? (
            <>
              <section className={cardClass}>
                <h3 className="text-xl font-semibold tracking-[-0.025em]">Windows printer</h3>
                <p className="mt-1 mb-7 text-sm text-stone-500">Print through the installed Windows driver.</p>
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="Active printer">
                    <select
                      className={inputClass}
                      name="printerName"
                      value={draft.printer.name}
                      onChange={(event) => patch('printer', { ...draft.printer, name: event.target.value })}
                    >
                      <option value="">Windows default printer</option>
                      {printers.map((printer) => (
                        <option key={printer.name} value={printer.name}>
                          {printer.name}
                          {printer.isDefault ? ' (default)' : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Paper size">
                    <select
                      className={inputClass}
                      name="paperSize"
                      value={draft.printer.paperSize}
                      onChange={(event) => patch('printer', { ...draft.printer, paperSize: event.target.value })}
                    >
                      <option value="4 × 6 in">4 × 6 in</option>
                      <option value="5 × 7 in">5 × 7 in</option>
                    </select>
                  </Field>
                  <Field label="Orientation">
                    <select
                      className={inputClass}
                      name="printOrientation"
                      value={draft.printer.orientation}
                      onChange={(event) =>
                        patch('printer', {
                          ...draft.printer,
                          orientation: event.target.value as 'portrait' | 'landscape',
                        })
                      }
                    >
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </select>
                  </Field>
                  <Field label="Default copies">
                    <input
                      className={inputClass}
                      name="defaultCopies"
                      type="number"
                      inputMode="numeric"
                      autoComplete="off"
                      min="1"
                      max="20"
                      value={draft.printer.defaultCopies}
                      onChange={(event) =>
                        patch('printer', { ...draft.printer, defaultCopies: Number(event.target.value) })
                      }
                    />
                  </Field>
                  <Field label="Maximum copies">
                    <input
                      className={inputClass}
                      name="maximumCopies"
                      type="number"
                      inputMode="numeric"
                      autoComplete="off"
                      min="1"
                      max="20"
                      value={draft.printer.maxCopies}
                      onChange={(event) =>
                        patch('printer', { ...draft.printer, maxCopies: Number(event.target.value) })
                      }
                    />
                  </Field>
                </div>
              </section>
              <div className="max-w-5xl rounded-3xl bg-stone-200/75 p-5 text-xs leading-5 text-stone-600">
                The booth confirms when Windows accepts a print job. Physical completion depends on the printer driver
                and hardware.
              </div>
            </>
          ) : null}

          {tab === 'Display' ? (
            <section className={cardClass}>
              <h3 className="text-xl font-semibold tracking-[-0.025em]">Booth Display</h3>
              <div className="mt-7">
                <Toggle
                  checked={draft.display.kioskMode}
                  onChange={(kioskMode) => patch('display', { kioskMode })}
                  label="Kiosk Mode"
                  description="Keep the booth full-screen and prevent accidental navigation"
                />
              </div>
            </section>
          ) : null}

          {tab === 'Sharing' ? (
            <section className={cardClass}>
              <h3 className="text-xl font-semibold tracking-[-0.025em]">Cloud sharing</h3>
              <p className="mt-1 mb-5 text-sm text-stone-500">
                Optional. Capture and printing continue when the internet is unavailable.
              </p>
              <Toggle
                checked={draft.sharing.enabled}
                onChange={(enabled) => patch('sharing', { ...draft.sharing, enabled })}
                label="Enable cloud sharing"
              />
              {draft.sharing.enabled ? (
                <div className="mt-4 grid gap-3">
                  <Toggle
                    checked={draft.sharing.uploadOriginals}
                    onChange={(uploadOriginals) => patch('sharing', { ...draft.sharing, uploadOriginals })}
                    label="Upload original photos"
                  />
                  <Toggle
                    checked={draft.sharing.uploadFinal}
                    onChange={(uploadFinal) => patch('sharing', { ...draft.sharing, uploadFinal })}
                    label="Upload photo strip"
                  />
                  <Toggle
                    checked={draft.sharing.qrEnabled}
                    onChange={(qrEnabled) => patch('sharing', { ...draft.sharing, qrEnabled })}
                    label="Show QR code"
                  />
                  <div className="mt-3 grid gap-5">
                    <Field label="Supabase URL">
                      <input
                        className={inputClass}
                        name="supabaseUrl"
                        type="url"
                        inputMode="url"
                        autoComplete="url"
                        spellCheck="false"
                        value={draft.sharing.supabaseUrl}
                        onChange={(event) => patch('sharing', { ...draft.sharing, supabaseUrl: event.target.value })}
                        placeholder="https://project.supabase.co…"
                      />
                    </Field>
                    <Field label="Supabase anonymous key">
                      <input
                        className={inputClass}
                        name="supabaseAnonKey"
                        type="password"
                        autoComplete="off"
                        spellCheck="false"
                        value={draft.sharing.supabaseAnonKey}
                        onChange={(event) =>
                          patch('sharing', { ...draft.sharing, supabaseAnonKey: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Upload endpoint">
                      <input
                        className={inputClass}
                        name="uploadEndpoint"
                        type="url"
                        inputMode="url"
                        autoComplete="url"
                        spellCheck="false"
                        value={draft.sharing.uploadEndpoint}
                        onChange={(event) => patch('sharing', { ...draft.sharing, uploadEndpoint: event.target.value })}
                        placeholder="https://example.com/api/session…"
                      />
                    </Field>
                    <Field label="Public gallery URL">
                      <input
                        className={inputClass}
                        name="publicGalleryUrl"
                        type="url"
                        inputMode="url"
                        autoComplete="url"
                        spellCheck="false"
                        value={draft.sharing.publicBaseUrl}
                        onChange={(event) => patch('sharing', { ...draft.sharing, publicBaseUrl: event.target.value })}
                        placeholder="https://photos.example.com…"
                      />
                    </Field>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {tab === 'Diagnostics' ? (
            <>
              <section className="flex max-w-5xl items-center justify-between gap-8 rounded-[2rem] bg-white/90 p-8 shadow-[0_16px_55px_rgba(63,55,46,0.07)]">
                <div>
                  <h3 className="text-2xl font-semibold tracking-[-0.035em]">Check the Booth</h3>
                  <p className="mt-1 text-xs text-stone-500">
                    Storage, camera, printer, disk space, and optional cloud services.
                  </p>
                </div>
                <button
                  className={`${actionClass} shrink-0`}
                  type="button"
                  disabled={busy === 'checks' || !setupReady}
                  title={setupReady ? 'Run booth checks' : 'Complete today’s event setup first'}
                  onClick={() => void runChecks()}
                >
                  {busy === 'checks' ? 'Checking…' : 'Run check'}
                </button>
              </section>
              <section className="mt-4 grid max-w-5xl gap-1 rounded-[1.75rem] bg-white/90 p-2">
                {checks.length ? (
                  checks.map((check) => (
                    <div
                      className="grid min-h-16 grid-cols-[2.5rem_12rem_1fr] items-center gap-3 rounded-2xl px-4 even:bg-stone-100"
                      key={check.label}
                    >
                      <span
                        className={`grid size-7 place-items-center rounded-xl text-xs font-bold ${check.status === 'pass' ? 'bg-emerald-100 text-emerald-800' : check.status === 'warning' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}
                        aria-label={check.status}
                      >
                        {check.status === 'pass' ? '✓' : check.status === 'warning' ? '!' : '×'}
                      </span>
                      <strong className="text-sm">{check.label}</strong>
                      <span className="text-xs leading-5 text-stone-500">{check.detail}</span>
                    </div>
                  ))
                ) : (
                  <p className="p-5 text-sm text-stone-500">No check has been run yet.</p>
                )}
              </section>
              <div className="mt-4 flex max-w-5xl flex-wrap gap-2">
                <button
                  className={quietActionClass}
                  type="button"
                  disabled={!draft.id.trim()}
                  onClick={() =>
                    void withFeedback('folder', () => window.booth.event.openFolder(), 'Event folder opened.')
                  }
                >
                  Open event folder
                </button>
                <button
                  className={quietActionClass}
                  type="button"
                  onClick={() =>
                    void withFeedback('uploads', () => window.booth.upload.retryPending(), 'Pending uploads queued.')
                  }
                >
                  Retry uploads
                </button>
              </div>
            </>
          ) : null}

          {tab === 'Logs' ? (
            <>
              <section className="flex max-w-6xl flex-wrap items-center justify-between gap-5 rounded-[2rem] bg-stone-950 p-7 text-white shadow-[0_18px_60px_rgba(28,25,23,0.16)]">
                <div>
                  <h3 className="text-2xl font-semibold tracking-[-0.035em] text-balance">Application Logs</h3>
                  <p className="mt-1 text-xs text-stone-400">
                    Latest activity appears here and refreshes every 10 seconds.
                  </p>
                </div>
                <button
                  className="min-h-12 rounded-2xl bg-white px-5 text-sm font-semibold text-stone-900 transition-colors hover:bg-stone-100 disabled:opacity-50"
                  type="button"
                  disabled={busy === 'logs'}
                  onClick={() => void refreshLogs()}
                >
                  {busy === 'logs' ? 'Refreshing…' : 'Refresh Logs'}
                </button>
              </section>

              <section className="mt-4 max-w-6xl rounded-[1.75rem] bg-white/90 p-3 shadow-[0_14px_50px_rgba(63,55,46,0.05)]">
                <p className="sr-only" role="status" aria-live="polite">
                  {visibleLogs.length} matching log entries
                </p>
                <div className="mb-2 flex flex-wrap gap-2 p-2" role="group" aria-label="Filter log entries by severity">
                  {(['all', 'info', 'warn', 'error'] as const).map((level) => {
                    const selected = logLevel === level;
                    const count = level === 'all' ? logs.length : logs.filter((entry) => entry.level === level).length;
                    return (
                      <button
                        key={level}
                        className={`min-h-11 rounded-2xl px-4 text-xs font-semibold transition-colors ${selected ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setLogLevel(level)}
                      >
                        {level === 'all' ? 'All' : level === 'warn' ? 'Warnings' : humanStatus(level)}{' '}
                        <span className={selected ? 'text-stone-300' : 'text-stone-400'}>{count}</span>
                      </button>
                    );
                  })}
                </div>

                {visibleLogs.length ? (
                  <ol className="grid gap-1" aria-label="Latest application log entries">
                    {visibleLogs.map((entry, index) => {
                      const details = logDetails(entry.details);
                      return (
                        <li
                          key={`${entry.at}-${index}`}
                          className="grid min-w-0 grid-cols-[5.5rem_11rem_minmax(0,1fr)] items-start gap-3 rounded-2xl px-4 py-3 even:bg-stone-100"
                        >
                          <span
                            className={`mt-0.5 w-fit rounded-lg px-2 py-1 text-[0.62rem] font-bold tracking-wide uppercase ${entry.level === 'error' ? 'bg-red-100 text-red-800' : entry.level === 'warn' ? 'bg-amber-100 text-amber-800' : 'bg-stone-200 text-stone-600'}`}
                          >
                            {entry.level}
                          </span>
                          <time
                            className="pt-1 text-[0.68rem] leading-5 font-medium text-stone-500 tabular-nums"
                            dateTime={entry.at}
                          >
                            {logDate.format(new Date(entry.at))}
                          </time>
                          <div className="min-w-0">
                            <strong className="block text-xs leading-5 font-semibold text-pretty break-words">
                              {entry.message}
                            </strong>
                            {details ? (
                              <code className="mt-1 block text-[0.66rem] leading-5 break-words whitespace-pre-wrap text-stone-500">
                                {details}
                              </code>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <div className="grid min-h-44 place-items-center rounded-2xl bg-stone-100 p-6 text-center">
                    <div>
                      <strong className="text-sm">No matching entries</strong>
                      <p className="mt-1 text-xs text-stone-500">
                        New operational events will appear here automatically.
                      </p>
                    </div>
                  </div>
                )}
                {logs.length > 50 ? (
                  <p className="px-4 pt-4 pb-2 text-[0.68rem] text-stone-500">
                    Showing the latest 50 matching entries.
                  </p>
                ) : null}
              </section>
            </>
          ) : null}
        </div>
      </section>
      {selectedSession?.finalDataUrl ? (
        <div className="fixed inset-0 z-50 grid place-items-center overscroll-contain bg-stone-950/65 p-8 backdrop-blur-sm">
          <section
            className="grid max-h-full w-full max-w-5xl grid-cols-[minmax(18rem,1fr)_22rem] gap-8 overflow-y-auto overscroll-contain rounded-[2.5rem] bg-stone-50 p-8 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-dialog-title"
            onKeyDown={trapDialogFocus}
          >
            <div className="grid min-h-0 place-items-center rounded-[2rem] bg-stone-200 p-6">
              <img
                className="max-h-[70vh] max-w-full rounded-2xl object-contain shadow-xl"
                src={selectedSession.finalDataUrl}
                alt={`Photo strip from ${sessionDate.format(new Date(selectedSession.createdAt))}`}
                width={1200}
                height={1800}
              />
            </div>
            <div className="flex min-w-0 flex-col">
              <button
                ref={sessionCloseButton}
                className="grid size-12 place-items-center self-end rounded-full bg-stone-200 text-stone-700 hover:bg-stone-300 focus-visible:ring-4 focus-visible:ring-stone-400/30"
                type="button"
                aria-label="Close session"
                onClick={() => setSelectedSession(null)}
              >
                <svg
                  className="size-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
              <div className="my-auto py-8">
                <h3 id="session-dialog-title" className="text-3xl font-semibold tracking-[-0.045em] text-balance">
                  Reprint Session
                </h3>
                <time className="mt-2 block text-sm text-stone-500" dateTime={selectedSession.createdAt}>
                  {sessionDate.format(new Date(selectedSession.createdAt))}
                </time>
                <div className="mt-8">
                  <PrintQuantity value={reprintCopies} max={draft.printer.maxCopies} onChange={setReprintCopies} />
                </div>
                <button
                  className={`${actionClass} mt-4 w-full`}
                  type="button"
                  disabled={busy === `reprint-${selectedSession.id}`}
                  onClick={() =>
                    void withFeedback(
                      `reprint-${selectedSession.id}`,
                      () => window.booth.printer.print(selectedSession.id, reprintCopies),
                      `${reprintCopies} ${reprintCopies === 1 ? 'copy' : 'copies'} sent to the printer.`,
                    ).then(() => setSelectedSession(null))
                  }
                >
                  {busy === `reprint-${selectedSession.id}` ? 'Sending…' : `Print ${reprintCopies}`}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      {confirmNewEvent ? (
        <div className="fixed inset-0 z-50 grid place-items-center overscroll-contain bg-stone-950/65 p-8 backdrop-blur-sm">
          <section
            className="w-full max-w-lg rounded-[2.25rem] bg-stone-50 p-9 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-event-title"
            onKeyDown={trapDialogFocus}
          >
            <h3 id="new-event-title" className="text-3xl font-semibold tracking-[-0.045em] text-balance">
              Start a New Event?
            </h3>
            <p className="mt-3 text-sm leading-6 text-stone-500">
              The current event and its sessions stay safely stored. You’ll return to a blank event setup.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-3">
              <button
                ref={newEventCancelButton}
                className={quietActionClass}
                type="button"
                onClick={() => setConfirmNewEvent(false)}
              >
                Keep Current Event
              </button>
              <button className={actionClass} type="button" onClick={beginNewEvent}>
                Start New Event
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
