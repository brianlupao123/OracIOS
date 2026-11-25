// Optional in-browser QR scanning for the attendance badge. Uses getUserMedia + BarcodeDetector only when the browser
// has both (see scannerSupport in attendanceModel.js). Frames are decoded in memory; nothing is stored, uploaded,
// logged or put in the URL. The caller receives a payload only after it passes acceptScannedPayload().
import { acceptScannedPayload } from "./attendanceModel.js";

export async function startBadgeScan({ video, onToken, onUnreadable, env = globalThis }) {
  const nav = env.navigator;
  const detector = new env.BarcodeDetector({ formats: ["qr_code"] });
  const stream = await nav.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  let stopped = false; let timer = null;

  const stop = () => {
    stopped = true;
    if (timer) env.clearTimeout(timer);
    for (const track of stream.getTracks()) track.stop();
    if (video) { video.pause?.(); video.srcObject = null; }
  };

  video.srcObject = stream;
  video.setAttribute?.("playsinline", "true");
  await video.play?.();

  const tick = async () => {
    if (stopped) return;
    try {
      const found = await detector.detect(video);
      if (stopped) return;
      if (found.length > 0) {
        const accepted = acceptScannedPayload(found[0].rawValue);
        if (accepted.ok) { stop(); onToken(accepted.token); return; }
        onUnreadable?.(); // a QR that is not an attendance badge: dropped, never kept
      }
    } catch { /* a failed frame is skipped */ }
    if (!stopped) timer = env.setTimeout(tick, 250);
  };
  timer = env.setTimeout(tick, 250);
  return stop;
}

export function scanFailureMessage(error) {
  const name = error?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera access was not allowed. Enter the badge code manually instead.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found. Enter the badge code manually instead.";
  return "The camera could not be started. Enter the badge code manually instead.";
}
