import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { attendance } from "../api/client.js";
import {
  attendanceModeFor, createAttemptTracker, describeAttendanceError, describeStatus, isValidPin, normalizeBadgeToken,
  performClockAction, sanitizePinInput, scannerSupport
} from "../attendanceModel.js";
import { startBadgeScan, scanFailureMessage } from "../attendanceScanner.js";
import { formatDateTime } from "../lib/format.js";
import { ICONS } from "../components/icons.jsx";
import PageHeaderBanner from "../components/PageHeaderBanner.jsx";
import { PageLoadingSkeleton, RestrictedState } from "../components/PageStates.jsx";
import Button from "../components/ui/Button.jsx";
import Field from "../components/ui/Field.jsx";
import Input from "../components/ui/Input.jsx";
import Notice from "../components/ui/Notice.jsx";
import Panel from "../components/ui/Panel.jsx";
import SectionTitle from "../components/ui/SectionTitle.jsx";

// Attendance clock actions (Part 4). Technician: own badge + PIN on their own signed-in phone. Supervisor: shared
// kiosk, where the technician's badge and PIN are still required and the Supervisor is recorded as the person who
// entered it. Badge, PIN and scan data live only in this component's memory: never in browser storage, the URL, the
// console or any offline queue. This is a div group, not a <form>, so a stray submit can never put fields in the URL.
// Evidence only: nothing here shows or computes hours.

const COPY = {
  own: { title: "My attendance", subtitle: "Clock in and out with your own badge and PIN." },
  kiosk: { title: "Shared kiosk", subtitle: "Clock a technician in or out with their badge and PIN." }
};

export default function AttendancePage({ user }) {
  const mode = attendanceModeFor(user?.role);
  const [status, setStatus] = useState({ phase: "loading" });
  const [badge, setBadge] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [result, setResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
  const [online, setOnline] = useState(() => (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" ? navigator.onLine : true));
  const tracker = useMemo(() => createAttemptTracker(), []);
  const support = useMemo(() => scannerSupport(), []);
  const videoRef = useRef(null);
  const stopScanRef = useRef(null);

  const loadStatus = useCallback(async () => {
    setStatus({ phase: "loading" });
    try {
      const described = describeStatus(await attendance.status());
      setStatus(described.enabled ? { phase: "ready", pinLength: described.pinLength } : { phase: "disabled", message: described.message });
    } catch (error) {
      const info = describeAttendanceError(error);
      setStatus(info.kind === "disabled" ? { phase: "disabled", message: info.message } : { phase: "error", message: info.message });
    }
  }, []);

  useEffect(() => { if (mode) loadStatus(); }, [mode, loadStatus]);

  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  const stopScan = useCallback(() => {
    if (stopScanRef.current) { stopScanRef.current(); stopScanRef.current = null; }
    setScanning(false);
  }, []);

  useEffect(() => {
    if (!scanning) return undefined;
    let cancelled = false;
    startBadgeScan({
      video: videoRef.current,
      onToken: (token) => { stopScanRef.current = null; setBadge(token); setScanning(false); setScanMessage("Badge scanned."); },
      onUnreadable: () => setScanMessage("That QR code is not an attendance badge.")
    }).then((stop) => { if (cancelled) stop(); else stopScanRef.current = stop; })
      .catch((error) => { if (!cancelled) { setScanMessage(scanFailureMessage(error)); setScanning(false); } });
    const onHide = () => { if (document.hidden) stopScan(); };
    document.addEventListener("visibilitychange", onHide);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onHide); if (stopScanRef.current) { stopScanRef.current(); stopScanRef.current = null; } };
  }, [scanning, stopScan]);

  const pinLength = status.pinLength || 6;
  const badgeReady = Boolean(normalizeBadgeToken(badge));
  const pinReady = isValidPin(pin, pinLength);
  const canSubmit = status.phase === "ready" && badgeReady && pinReady && !busy && online;

  const resetAll = () => { stopScan(); setBadge(""); setPin(""); setNotice(null); setResult(null); setScanMessage(""); tracker.settle(); };

  const run = async (action) => {
    if (!canSubmit) return;
    stopScan(); setBusy(true); setNotice(null);
    const outcome = await performClockAction({ api: attendance, action, badgeToken: badge, pin, tracker, pinLength, operator: { name: user?.name } });
    setBusy(false); setPin("");
    if (outcome.ok) { setBadge(""); setScanMessage(""); setResult(outcome.summary); return; }
    if (outcome.info.kind === "disabled") { setStatus({ phase: "disabled", message: outcome.info.message }); return; }
    if (outcome.info.code === "ATTENDANCE_PIN_LOCKED" || outcome.info.code === "ATTENDANCE_PIN_NOT_SET") setBadge("");
    setNotice(outcome.info);
  };

  if (!mode) return <RestrictedState />;
  const copy = COPY[mode];

  return (
    <div className="space-y-5" data-attendance-mode={mode}>
      <PageHeaderBanner eyebrow="Field Work" title={copy.title} subtitle={copy.subtitle} iconPath={ICONS.clock} />

      {mode === "kiosk" && (
        <Notice variant="info" data-evidence="attendance-kiosk-attribution">
          Signed in as {user?.name || "Supervisor"}. Every action here is recorded as entered by you, on the technician’s behalf. The technician’s own badge and PIN are required each time.
        </Notice>
      )}

      {status.phase === "loading" && <PageLoadingSkeleton rows={2} label="Checking attendance" />}

      {status.phase === "error" && (
        <div className="space-y-3">
          <Notice variant="error">{status.message}</Notice>
          <Button variant="secondary" onClick={loadStatus}>Try again</Button>
        </div>
      )}

      {status.phase === "disabled" && <Notice variant="info" data-evidence="attendance-disabled">{status.message}</Notice>}

      {status.phase === "ready" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel header={<SectionTitle>{mode === "kiosk" ? "Technician badge and PIN" : "Your badge and PIN"}</SectionTitle>}>
            <div role="group" aria-label="Clock action" className="space-y-4">
              {!online && <Notice variant="warning">You are offline. Clock actions need a connection and are never saved for later.</Notice>}

              <Field id="attendance-badge" label="Badge code" required hint={badgeReady ? "Badge captured. It is cleared after each action." : "Scan the QR badge, or type the badge code."}>
                <Input id="attendance-badge" type="password" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                  value={badge} onChange={(event) => setBadge(event.target.value)} disabled={busy} />
              </Field>

              {support.supported ? (
                <div className="space-y-2">
                  {scanning ? (
                    <>
                      <video ref={videoRef} muted playsInline className="aspect-video w-full rounded-lg border border-orac-border-default bg-black object-cover" aria-label="Camera preview for scanning the badge" />
                      <Button variant="secondary" onClick={stopScan}>Stop scanning</Button>
                    </>
                  ) : (
                    <Button variant="secondary" onClick={() => { setScanMessage(""); setScanning(true); }} disabled={busy}>Scan QR badge</Button>
                  )}
                </div>
              ) : (
                <Notice variant="info" data-evidence="attendance-no-scanner">This browser cannot scan QR codes. Type the badge code instead.</Notice>
              )}
              {scanMessage && <p className="text-ux-secondary text-orac-text-secondary" role="status">{scanMessage}</p>}

              <Field id="attendance-pin" label={`${pinLength}-digit PIN`} required hint={mode === "kiosk" ? "The technician types their own PIN." : undefined}>
                <Input id="attendance-pin" type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={pinLength}
                  value={pin} onChange={(event) => setPin(sanitizePinInput(event.target.value, pinLength))} disabled={busy} />
              </Field>

              {notice && <Notice variant={notice.kind === "network" ? "warning" : "error"} data-evidence="attendance-error">{notice.message}</Notice>}

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button variant="primary" className="w-full sm:w-auto" loading={busy} disabled={!canSubmit} onClick={() => run("clock_in")}>Clock in</Button>
                <Button variant="secondary" className="w-full sm:w-auto" loading={busy} disabled={!canSubmit} onClick={() => run("clock_out")}>Clock out</Button>
              </div>
            </div>
          </Panel>

          <Panel header={<SectionTitle>Current state</SectionTitle>}>
            <div aria-live="polite" className="space-y-3" data-evidence="attendance-state">
              {result ? (
                <>
                  <p className="text-ux-section font-semibold text-orac-text-primary">{result.stateLabel}</p>
                  <p className="text-ux-body text-orac-text-secondary">
                    {result.replayed ? "This action was already saved; nothing new was recorded. " : ""}
                    {result.eventLabel} recorded{result.technicianName ? ` for ${result.technicianName}` : ""} at {formatDateTime(result.serverTime)}.
                  </p>
                  {result.state === "in" && result.openSince && <p className="text-ux-body text-orac-text-secondary">Clocked in since {formatDateTime(result.openSince)}.</p>}
                  {mode === "kiosk" && <p className="text-ux-body text-orac-text-secondary">Entered by {result.recordedBy || user?.name || "you"} on the shared kiosk.</p>}
                  {result.evidenceOnly && <p className="text-ux-secondary text-orac-text-muted">Attendance evidence only. It is not hours, pay or billing.</p>}
                  {mode === "kiosk" && <Button variant="secondary" onClick={resetAll}>Next technician</Button>}
                </>
              ) : (
                <p className="text-ux-body text-orac-text-secondary">
                  The current state is shown after you clock in or out. Nothing has been recorded in this visit yet.
                </p>
              )}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
