import React, { useEffect, useState } from "react";
import Modal from "./Modal.jsx";
import Button from "./ui/Button.jsx";
import Input from "./ui/Input.jsx";

export default function EmailPreviewModal({
  isOpen,
  onClose,
  recipient,
  subject,
  bodyText,
  referenceId,
  docType = "Document",
  onConfirmSend,
  onDownloadDocument,
  confirmLabel = "Send quotation email via ORAC",
  directSend = true
}) {
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCopied(false);
    setDownloaded(false);
    setError("");
  }, [isOpen, referenceId]);

  if (!isOpen) return null;

  const hasRecipient = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient || "");

  async function handleCopy() {
    setSubmitting(true);
    setError("");
    try {
      const fullEmail = `To: ${recipient || "N/A"}\nSubject: ${subject || "N/A"}\n\n${bodyText || ""}`;
      if (!navigator?.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this browser.");
      await navigator.clipboard.writeText(fullEmail);
      setCopied(true);
    } catch (err) {
      setError(err.message || "Could not copy the email draft.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDownload() {
    setSubmitting(true);
    setError("");
    try {
      await onDownloadDocument();
      setDownloaded(true);
    } catch (err) {
      setError(err.message || "Could not download the quotation PDF.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmSent() {
    if (!hasRecipient) return;
    if (!directSend && (!copied || !downloaded)) return;
    setSubmitting(true);
    setError("");
    try {
      await onConfirmSend();
    } catch (err) {
      setError(err.message || (directSend ? "Could not send quotation email." : "Could not record the external send."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={`Email Preview — ${docType} ${referenceId ? `(${referenceId})` : ""}`}
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
    >
      <div className="space-y-4 text-ux-body" data-evidence="email-preview-modal">
        {directSend ? (
          <div className="rounded-lg border border-orac-border-default bg-orac-surface p-4 text-orac-text-primary shadow-xs">
            <div className="flex items-center gap-2 font-bold text-orac-blue">
              <span>Quotation Email Dispatch — Direct SMTP Delivery</span>
            </div>
            <p className="mt-1 text-ux-caption text-orac-text-secondary leading-relaxed">
              When confirmed, ORAC will attach the generated controlled PDF and dispatch the email directly via SMTP to the allowlisted recipient.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-orac-warning-border bg-orac-warning-bg p-4 text-orac-warning-text shadow-xs">
            <div className="flex items-center gap-2 font-bold text-orac-warning-text">
              <span>Manual email preparation — ORAC has not sent this message</span>
            </div>
            <p className="mt-1 text-ux-caption text-orac-warning-text leading-relaxed">
              Download the quotation PDF, copy this email draft, attach the PDF in your mail app, and send it there. Confirm below only after sending.
            </p>
          </div>
        )}

        <div>
          <label className="block text-ux-caption font-semibold uppercase tracking-wider text-orac-text-secondary mb-1">
            Recipient
          </label>
          <Input
            readOnly
            value={recipient || "No email address found"}
          />
        </div>

        <div>
          <label className="block text-ux-caption font-semibold uppercase tracking-wider text-orac-text-secondary mb-1">
            Subject Line
          </label>
          <Input
            readOnly
            value={subject || ""}
          />
        </div>

        <div>
          <label className="block text-ux-caption font-semibold uppercase tracking-wider text-orac-text-secondary mb-1">
            Rendered Communication Content
          </label>
          <div className="max-h-64 overflow-y-auto rounded-md border border-orac-border-default bg-orac-surface p-3 font-mono text-ux-caption leading-relaxed text-orac-text-primary whitespace-pre-wrap select-all">
            {bodyText || "No content generated."}
          </div>
        </div>

        {!directSend && (copied || downloaded) && (
          <div className="rounded-md border border-orac-success-border bg-orac-success-bg p-2 text-ux-caption font-semibold text-orac-success-text">
            {downloaded ? "PDF downloaded. " : ""}{copied ? "Draft copied. " : ""}The quote is still Draft until you confirm the external send.
          </div>
        )}
        {error && <p role="alert" className="text-orac-error">{error}</p>}

        <div className="flex flex-wrap items-center justify-end gap-3 pt-3 border-t border-orac-border-default">
          <Button
            variant="secondary"
            onClick={onClose}
          >
            Cancel
          </Button>
          {onDownloadDocument && <Button variant="secondary" disabled={submitting} onClick={handleDownload}>Download quotation PDF</Button>}
          <Button variant="secondary" disabled={submitting || !hasRecipient} onClick={handleCopy}>Copy email draft</Button>
          <Button
            variant="primary"
            disabled={submitting || !hasRecipient || (!directSend && (!copied || !downloaded))}
            onClick={handleConfirmSent}
          >
            {submitting ? (directSend ? "Transmitting email..." : "Processing...") : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
