# Camera Booth

Production Windows photo booth for attendant-operated one-, two-, or three-photo sessions. Camera Booth is a native Electron application that uses Canon's official EDSDK over USB for live view, autofocus, and print-ready JPEG capture.

## Install

Run `dist\Camera-Booth-Setup-0.21.0.exe`. The installer includes the x64 .NET camera bridge, Canon runtime DLLs, bundled layout-preview photographs, and the session-video encoder, so an event operator does not install either SDK separately.

Before opening Camera Booth:

1. Connect the Canon EOS Rebel T6i directly over USB and turn it on.
2. Set the mode dial to **P**, set the lens switch to **AF**, raise the built-in flash, set flash firing to **On**, and disable the camera's Wi-Fi/NFC connection.
3. Close Canon EOS Utility and any other application that may have opened the camera.
4. Connect the photo printer and install its Windows driver.

The T6i's installed firmware 1.0.0 can remain as-is. Camera Booth does not update firmware. When the selected camera mode permits it, the app requests Auto White Balance, Auto ISO, zero exposure compensation, single-shot drive, Auto Picture Style, and sRGB. It captures Canon Small 1 Fine JPEGs (2976 × 1984, about 5.9 MP), which are appropriate for a 5 × 7 print without storing unnecessary full-resolution originals.

The app begins Canon's autofocus-and-capture operation 500 ms before the last countdown tick finishes. The bridge holds autofocus for 450 ms, then sends the shutter request just before visual zero to compensate for the T6i's physical shutter and pre-flash latency. Every downloaded JPEG is checked for Canon's flash-fired EXIF bit; a missed flash is rejected and the attendant can retry only that photo without losing the session. The captured photo appears for 2 seconds by default; change this under **Settings → Capture → Photo preview**.

The app always opens on the public booth screen. If there is no event for today, that screen shows **Event setup required** with an **Open Settings** button; Settings can always be closed again without creating an event. In **Settings → Set Up**, choose **New Event**. Event ID, event date, and description always begin completely blank in this separate creation view and are not saved until **Create Event** is chosen. Select the event's print layout and required rail-artwork PNG in the same flow; that selection fixes the session's photo count. The entire Event Date field opens a large touch-optimized calendar; selecting a day closes it and returns focus to the field. Settings uses large type, generous spacing, and 56–64 pixel touch targets across navigation, fields, toggles, actions, session controls, diagnostics, and logs. A finger tap on any editable field explicitly opens the native Windows Touch Keyboard, even when Windows desktop-mode settings or an attached hardware keyboard would otherwise suppress it. The Layout preview uses the bundled real photo-booth photographs and can change the active event's layout or artwork later. Once created, the event is shown read-only and every session remains associated with it. The Set Up page shows a current event only when its date matches the computer’s current local date; otherwise it returns to **No Event Today** while the older event remains safely stored. Choose the printer, run **Diagnostics → Run Check**, then make a physical test print from the Layout screen. Kiosk mode is enabled by default and can be changed under Display settings.

In guest mode, attendant Settings has no visible icon. Tap the invisible 96-pixel target in the upper-right corner, or press and hold it for 1.5 seconds, to open Settings.

Finished strips appear as a visual grid under **Settings → Sessions**. Select a strip, choose the number of copies, and reprint without finding files in Windows Explorer.

Silent session video is opt-in under **Settings → Capture → Record each session**. When enabled, the app records the Canon live view from Start through the final verified photo, including countdowns and flash retries. Full-resolution flash JPEG capture remains unchanged and always takes priority. The encoder consumes a bounded frame queue, so slow encoding drops video frames instead of delaying the camera. Each shutter time is encoded into the raw-video and recap filenames as a video-relative millisecond offset, while `session.json` retains recovery state for the app.

After the printable JPEG is safely created and the print screen can appear, a below-normal-priority background queue generates one recap at a time. The vertical H.264 recap retains the entire session recording, accelerates the movement between shots, returns to real time exactly one second before each shutter, reveals each corresponding full-resolution photo, and closes on the finished branded 4 × 6 print. A typical booth session is paced to approximately 13.5 seconds. Recap failure never affects the print, originals, raw recording, or the next photo session. **Settings → Sessions** shows generation progress and provides Print, Recap, and Full video views with a manual retry when needed.

Every preset renders a true 300-DPI 4 × 6 print. Branding and event copy are supplied exclusively by the required rail-artwork PNG; the app does not add a headline or event details:

- **Landscape Feature:** one 5 × 4 photo beside a 1 × 4 left rail on a 6 × 4 landscape print. Artwork target: 300 × 1200 pixels.
- **Center Rail Pair:** two 4 × 2.5 photos above and below a 4 × 1 center rail on a 4 × 6 portrait print. Artwork target: 1200 × 300 pixels.
- **Side Rail Trio:** three 3 × 2 photos beside a 1 × 6 left rail on a 4 × 6 portrait print. Artwork target: 300 × 1800 pixels.

The selected layout is stored on the event and snapshotted into every session, so changing a later event setting cannot alter an existing session's reprint.

## Reliability and recovery

Configuration and session metadata are written through same-folder temporary files, flushed before replacement, and retain a last-known-good backup. Session metadata updates are serialized so print and upload updates cannot overwrite one another. On startup, the app:

- recovers metadata from backups when necessary;
- preserves interrupted sessions and their valid originals;
- rebuilds a missing final print when every original required by that session survived;
- resets interrupted uploads to pending and retries them;
- validates captured and rendered JPEGs before committing their paths.
- quarantines interrupted partial session videos and leaves every photo recoverable.

Operational logs are stored under the app's Windows user-data folder and rotate at 5 MB. View the latest structured entries, filter by severity, and refresh them directly from **Settings → Logs**.

## Development

Requirements are current Node.js and npm releases plus a supported .NET SDK on Windows x64. Canon's EDSDK distribution must be present under `vendor\canon-edsdk`; its proprietary files are intentionally ignored by Git.

```powershell
npm install
npm run dev
```

Run all release checks:

```powershell
npm run typecheck
npm test
npm run check:dead-code
npm audit
npm outdated
npm run dist
```

The installer is written to `dist\`.

## Stored files

The default base folder is `Documents\Camera Booth Events`. Each event uses this structure:

```text
{event-id}/
  event.json
  diagnostics/
    test-capture.jpg
    test-layout.jpg
    test-session-video.mp4
  sessions/{session-id}/
    original-01.jpg
    original-02.jpg (two- and three-photo layouts)
    original-03.jpg (three-photo layout)
    final.jpg
    session-video__shots-{offsets}.mp4
    session-recap__shots-{offsets}.mp4
    session.json
```

Printing uses Electron's Windows printing API and the installed printer driver. A successful result means Windows accepted the job; paper, ink, and hardware completion remain the printer driver's responsibility.

## Optional cloud contract

Cloud sharing is disabled by default and the booth continues to capture and print offline. When sharing is enabled, the configured service receives the event and session identifiers and returns short-lived presigned upload URLs plus a controlled gallery URL. Permanent AWS credentials are never stored in the desktop app. Successfully uploaded file paths are committed individually, making retries idempotent after a restart.

## Event release checklist

- Run the diagnostic check with the actual T6i, USB cable, booth computer, and printer.
- If session video is enabled, confirm Diagnostics reports the measured live-view frame rate and dropped-frame count.
- Make a physical test print and calibrate borderless, media, quality, and color settings in the printer driver.
- Use Canon ACK-E18 AC power for event-length operation; the T6i is not powered over USB.
- Run an event-length soak test and disable Windows sleep and USB selective suspend.
- Add an Authenticode code-signing certificate before broad distribution.
- Preserve Canon's EDSDK license terms.
