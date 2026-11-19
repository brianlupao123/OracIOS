import React, { useState } from "react";
import Button from "./ui/Button.jsx";
import { reports } from "../api/client.js";
import { formatAmount } from "../quoteModel.js";

export default function PastelParallelReviewPanel({ invoices = [], user }) {
  const [downloading, setDownloading] = useState("");
  const [exportNotice, setExportNotice] = useState("");
  const [exportError, setExportError] = useState("");

  const canExport = ["Admin", "Finance"].includes(user?.role);

  async function handleDownload(type, action) {
    if (!canExport || downloading) return;
    setDownloading(type);
    setExportNotice("");
    setExportError("");
    try {
      await action();
      setExportNotice(`Export generated: ${type}. Remember that this file is strictly for comparison review and must not be posted directly into live accounts.`);
    } catch (err) {
      setExportError(err.message || `Failed to generate ${type} export.`);
    } finally {
      setDownloading("");
    }
  }

  return (
    <section aria-labelledby="pastel-review-title" className="rounded-xl border border-orac-border bg-orac-surface p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-orac-border pb-4">
        <div>
          <h2 id="pastel-review-title" className="text-ux-title font-semibold text-orac-text-primary">
            Sage Pastel Parallel Review & Reconciliation
          </h2>
          <p className="mt-1 text-ux-secondary text-orac-text-secondary">
            Parallel audit comparison ledger. Every export is strictly non-posting pending formal accountant layout validation.
          </p>
        </div>
        <div className="rounded-md border border-orac-warning-border bg-orac-warning-bg px-3 py-1.5 text-ux-caption font-semibold text-orac-warning-text">
          [PASTEL PARALLEL MODE — REVIEW ONLY / NOT POSTED]
        </div>
      </div>

      {exportNotice && (
        <div role="status" className="mt-3 rounded-lg border border-orac-border bg-orac-surface-muted px-4 py-3 text-ux-body text-orac-text-primary">
          {exportNotice}
        </div>
      )}

      {exportError && (
        <div role="alert" className="mt-3 rounded-lg border border-orac-danger-border bg-orac-danger-bg px-4 py-3 text-ux-body text-orac-danger-text">
          {exportError}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-orac-border bg-orac-surface-muted p-4">
          <div className="font-semibold text-ux-body text-orac-text-primary">Invoices Export</div>
          <div className="mt-1 text-ux-caption text-orac-text-muted">
            All billable invoice lines with GL codes, equipment tags, and USD totals.
          </div>
          <div className="mt-3">
            <Button
              variant="outline"
              size="sm"
              disabled={!canExport || downloading === "invoices"}
              onClick={() => handleDownload("invoices", () => reports.exportPastel())}
            >
              {downloading === "invoices" ? "Preparing..." : "Download Invoices CSV"}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-orac-border bg-orac-surface-muted p-4">
          <div className="font-semibold text-ux-body text-orac-text-primary">Quotes Review Export</div>
          <div className="mt-1 text-ux-caption text-orac-text-muted">
            Commercial pipeline quotes comparison data formatted for Sage review.
          </div>
          <div className="mt-3">
            <Button
              variant="outline"
              size="sm"
              disabled={!canExport || downloading === "quotes"}
              onClick={() => handleDownload("quotes", () => reports.exportPastelReviewQuotes())}
            >
              {downloading === "quotes" ? "Preparing..." : "Download Quotes CSV"}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-orac-border bg-orac-surface-muted p-4">
          <div className="font-semibold text-ux-body text-orac-text-primary">Invoice-Ready Work</div>
          <div className="mt-1 text-ux-caption text-orac-text-muted">
            Supervisor-approved dispatches with verified purchase orders ready to bill.
          </div>
          <div className="mt-3">
            <Button
              variant="outline"
              size="sm"
              disabled={!canExport || downloading === "invoice-ready"}
              onClick={() => handleDownload("invoice-ready", () => reports.exportPastelReviewInvoiceReady())}
            >
              {downloading === "invoice-ready" ? "Preparing..." : "Download Ready CSV"}
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-5 border-t border-orac-border pt-4">
        <h3 className="text-ux-body font-semibold text-orac-text-primary">
          Recent Reconciliation Entries ({invoices.length} Invoices On File)
        </h3>
        {invoices.length === 0 ? (
          <p className="mt-2 text-ux-caption text-orac-text-muted">No issued invoices available for parallel comparison.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {invoices.slice(0, 5).map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-orac-border bg-orac-surface-muted px-3.5 py-2.5">
                <div>
                  <span className="font-semibold text-ux-body text-orac-text-primary">{inv.invoice_number || inv.id}</span>
                  <span className="ml-2 text-ux-caption text-orac-text-muted">USD {formatAmount(inv.total_amount)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md border border-orac-border bg-orac-surface px-2 py-0.5 text-ux-caption text-orac-text-secondary">
                    Review Mode: Parallel
                  </span>
                  <span className="text-ux-caption font-medium text-orac-text-muted">
                    {inv.created_at ? new Date(inv.created_at).toLocaleDateString() : "Date unrecorded"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
