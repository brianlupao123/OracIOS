import React, { useId, useRef, useState } from "react";
import { communications } from "../api/client.js";
import Modal from "./Modal.jsx";
import Button from "./ui/Button.jsx";
import Field from "./ui/Field.jsx";
import Select from "./ui/Select.jsx";
import Textarea from "./ui/Textarea.jsx";

export default function QuotationEmailRecovery({ quote }) {
  const [open, setOpen] = useState(false);
  const [timeline, setTimeline] = useState([]);
  const [selected, setSelected] = useState("");
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const fieldId = useId();

  const attempts = timeline.filter(row => row.send_kind === "quotation_pdf" &&
    row.transport_mode === "live-smtp" && ["send_attempted", "send_uncertain"].includes(row.evidence_status));
  const attempt = attempts.find(row => row.id === selected);
  const replacement = attempt && timeline.find(row => row.supersedes === attempt.id);
  const refresh = async () => {
    const data = await communications.getTimeline("quote", quote.id);
    setTimeline(data.timeline || []);
  };

  async function act(work, message = "") {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await work();
      if (message) setNotice(message);
      return result;
    } catch (failure) {
      setError(failure.message || "The action could not be completed.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function openActivity() {
    setTimeline([]);
    setSelected("");
    setOutcome("");
    setNote("");
    setOpen(true);
    void act(refresh);
  }

  async function save(event) {
    event.preventDefault();
    await act(async () => {
      await communications.resolveQuotationSend({
        quote_id: quote.id, evidence_id: attempt.id, outcome, note
      });
      await refresh();
    }, "Recovery decision recorded.");
  }

  async function resend() {
    await act(async () => {
      try {
        const result = await communications.sendQuotationPdf({
          quote_id: quote.id, recipient_email: attempt.recipient_email,
          recipient_name: attempt.recipient_name, resend_of: attempt.id,
          resend_reason: "Verified non-acceptance recorded in email activity.",
          idempotency_key: `recovery-${attempt.id}`
        });
        setNotice(result.data?.status === "accepted" || result.status === "accepted"
          ? "Mail server accepted the replacement. Recipient receipt is unconfirmed."
          : "The action completed in dry-run mode. No replacement email was sent.");
      } finally {
        await refresh().catch(() => {});
      }
    });
  }

  return (
    <>
      <Button onClick={openActivity} className="mt-3">
        Quotation email recovery
      </Button>
      {open && <Modal isOpen={open} title="Quotation email recovery" onClose={() => { if (!pending.current) setOpen(false); }}>
        <div className="space-y-3 text-ux-body">
          <p>Check provider records or direct recipient confirmation. Leave unknown outcomes blocked.</p>
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          {busy && <p role="status">Working…</p>}
          {!busy && !error && attempts.length === 0 && <p>No interrupted or uncertain attempts for this quotation.</p>}
          {attempts.length > 0 && (
            <Field id={fieldId + "-attempt"} label="Send attempt">
              <Select id={fieldId + "-attempt"} value={selected} disabled={busy} onChange={event => {
                setSelected(event.target.value); setOutcome(""); setNote(""); setNotice(""); setError("");
              }}>
                <option value="">Choose an attempt</option>
                {attempts.map(row => <option key={row.id} value={row.id}>{row.recipient_email} · {row.recorded_at} · {row.id}</option>)}
              </Select>
            </Field>
          )}
          {attempt && !attempt.recovery && !replacement && (
            <form onSubmit={save} className="space-y-3">
              <Field id={fieldId + "-outcome"} label="Verified outcome" required>
                <Select id={fieldId + "-outcome"} required value={outcome} onChange={event => setOutcome(event.target.value)}>
                  <option value="">Choose a verified outcome</option>
                  <option value="receipt_confirmed">Recipient confirmed receipt</option>
                  <option value="provider_not_accepted">Provider confirmed non-acceptance</option>
                </Select>
              </Field>
              <Field id={fieldId + "-evidence"} label="Evidence and reason" required>
                <Textarea id={fieldId + "-evidence"} required minLength={10} maxLength={500} value={note}
                  onChange={event => setNote(event.target.value)} />
              </Field>
              <Button type="submit" variant="primary" disabled={busy || !outcome || note.trim().length < 10}>Record decision</Button>
            </form>
          )}
          {attempt?.recovery && <p>{attempt.recovery.outcome === "receipt_confirmed" ? "Receipt confirmed by an administrator." : "Provider non-acceptance verified."} {attempt.recovery.note}</p>}
          {replacement && <p>A replacement attempt is already recorded ({replacement.id}).</p>}
          {!replacement && attempt?.recovery?.outcome === "provider_not_accepted" && (
            <div className="space-y-2">
              <p>A resend uses the current quotation PDF and the original recipient.</p>
              <Button onClick={resend} disabled={busy}>Send one replacement</Button>
            </div>
          )}
        </div>
      </Modal>}
    </>
  );
}
