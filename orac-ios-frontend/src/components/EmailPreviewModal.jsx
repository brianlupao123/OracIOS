import React, { useState } from "react";
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
  confirmLabel = "Copy to Clipboard & Confirm Send"
}) {
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  async function handleCopyAndSend() {
    setSubmitting(true);
    try {
      const fullEmail = `To: ${recipient || "N/A"}\nSubject: ${subject || "N/A"}\n\n${bodyText || ""}`;
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(fullEmail);
      }
      setCopied(true);
      if (onConfirmSend) {
        await onConfirmSend();
      }
    } catch (err) {
      console.error("Failed to copy or confirm send:", err);
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
        {/* Dry-run safety warning banner */}
        <div className="rounded-lg border border-orac-warning-border bg-orac-warning-bg p-4 text-orac-warning-text shadow-xs">
          <div className="flex items-center gap-2 font-bold text-orac-warning-text">
            <span>[DRY-RUN PREVIEW ONLY — NO REAL OUTBOUND EMAIL DISPATCHED]</span>
          </div>
          <p className="mt-1 text-ux-caption text-orac-warning-text leading-relaxed">
            Automated outbound email dispatch is strictly restricted during pilot operations.
            Review the generated message content below and copy it to your desktop mail client (Outlook / Thunderbird) for manual dispatch.
          </p>
        </div>

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

        {copied && (
          <div className="rounded-md border border-orac-success-border bg-orac-success-bg p-2 text-ux-caption font-semibold text-orac-success-text">
            Copied to clipboard! Message status updated.
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3 pt-3 border-t border-orac-border-default">
          <Button
            variant="secondary"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={submitting}
            onClick={handleCopyAndSend}
          >
            {submitting ? "Processing..." : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
