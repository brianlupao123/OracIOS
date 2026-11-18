import React, { useEffect, useState } from "react";
import { collections } from "../api/client.js";
import { canAccessRoute } from "../accessPolicy.js";
import DataTable from "./DataTable.jsx";
import RecordLink from "./RecordLink.jsx";
import StatusBadge from "./StatusBadge.jsx";
import { PageLoadingSkeleton, ErrorBanner } from "./PageStates.jsx";
import Button from "./ui/Button.jsx";
import { csvCell } from "../csvSafe.js";
import { formatNumber, formatBusinessDate } from "../lib/format.js";

export default function JobsTrackerPanel({ user }) {
  const [jobs, setJobs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const canQuote = canAccessRoute(user.role, "/quotations");
  const canJobCards = canAccessRoute(user.role, "/job-cards");
  const canInvoiceReadiness = canAccessRoute(user.role, "/invoice-readiness");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    collections.list("job-tracker")
      .then((data) => {
        if (!cancelled) setJobs(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load jobs tracker data.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  function handleExportCsv() {
    if (!jobs || jobs.length === 0) return;
    const columnNames = [
      "id",
      "quote_number",
      "client_name",
      "site_name",
      "stage",
      "status",
      "po_number",
      "po_status",
      "dispatch_id",
      "dispatch_number",
      "actual_field_hours",
      "commercial_owner",
      "created_at"
    ];
    const headers = columnNames.join(",");
    const rows = jobs.map((row) =>
      columnNames.map((col) => {
        let val = row[col];
        if (col === "actual_field_hours" && val === undefined) val = row.actual_hours;
        if (col === "po_number" && val === undefined) val = row.po_reference;
        if (col === "id" && val === undefined) val = row.job_id;
        return csvCell(val);
      }).join(",")
    );
    const csv = [headers, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const bizDate = formatBusinessDate(new Date());
    a.download = `orac-jobs-tracker-${bizDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <PageLoadingSkeleton rows={4} label="Loading jobs tracker" />;
  }

  if (error) {
    return <ErrorBanner message={error} />;
  }

  const list = jobs || [];
  const waitingPo = list.filter((r) => r.status === "Waiting_For_PO" || r.status === "Approved_Pending_PO").length;
  const wip = list.filter((r) => r.status === "WIP" || r.status === "Field_Dispatch").length;
  const readyInvoice = list.filter((r) => r.status === "Ready_For_Invoice" || r.status === "Ready_To_Prepare_Invoice").length;
  const invoiced = list.filter((r) => r.status === "Invoiced" || r.status === "Completed" || r.status === "Settled").length;
  const totalActualHours = list.reduce((sum, r) => sum + Number(r.actual_field_hours ?? r.actual_hours ?? 0), 0);

  return (
    <div data-evidence="jobs-tracker-panel" className="space-y-5 py-2">
      <section aria-labelledby="jobs-tracker-header" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="jobs-tracker-header" className="text-lg font-bold text-orac-text-primary">
              Jobs Lifecycle Tracker
            </h2>
            <p className="mt-1 text-ux-body text-orac-text-secondary">
              Read-only operations view tracking quote acceptance through verified PO, fieldwork hours, and billing handoff.
            </p>
          </div>
          <div>
            <Button
              variant="primary"
              onClick={handleExportCsv}
              disabled={list.length === 0}
              data-evidence="jobs-export-csv"
            >
              Export CSV
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-orac-border-default bg-orac-surface p-5 shadow-xs">
            <div className="text-lg font-bold text-orac-text-primary">Total Active Jobs</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums text-orac-text-secondary">{list.length}</div>
            <div className="mt-1 text-ux-caption text-orac-text-muted">{formatNumber(totalActualHours)} total actual hrs</div>
          </div>
          <div className="rounded-xl border border-orac-border-default bg-orac-surface p-5 shadow-xs">
            <div className="text-lg font-bold text-orac-text-primary">Waiting for Client PO</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums text-orac-text-secondary">{waitingPo}</div>
            <div className="mt-1 text-ux-caption text-orac-text-muted">PO verification required before dispatch</div>
          </div>
          <div className="rounded-xl border border-orac-border-default bg-orac-surface p-5 shadow-xs">
            <div className="text-lg font-bold text-orac-text-primary">Work in Progress</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums text-orac-text-secondary">{wip}</div>
            <div className="mt-1 text-ux-caption text-orac-text-muted">Field operations underway</div>
          </div>
          <div className="rounded-xl border border-orac-border-default bg-orac-surface p-5 shadow-xs">
            <div className="text-lg font-bold text-orac-text-primary">Ready to Invoice</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums text-orac-text-secondary">{readyInvoice}</div>
            <div className="mt-1 text-ux-caption text-orac-text-muted">{invoiced} invoiced or settled</div>
          </div>
        </div>
      </section>

      <DataTable
        title={`Jobs Register (${list.length})`}
        columns={["Job / Quote", "Client & Site", "Stage", "PO Status", "Dispatch", "Actual Hours"]}
        rows={list}
        renderActions={(row) => (
          <div className="flex flex-wrap items-center gap-2">
            {canQuote && row.quote_id && (
              <RecordLink user={user} path="/quotations" param="quote" id={row.quote_id} what="quote" name={row.quote_number || row.quote_id} />
            )}
            {canJobCards && row.dispatch_id && (
              <RecordLink user={user} path="/job-cards" param="id" id={row.dispatch_id} what="job card" name={row.dispatch_number || row.dispatch_id} />
            )}
            {canInvoiceReadiness && (row.status === "Ready_For_Invoice" || row.status === "Ready_To_Prepare_Invoice") && row.dispatch_id && (
              <RecordLink user={user} path="/invoice-readiness" param="id" id={row.dispatch_id} what="invoice readiness" name={row.dispatch_number || row.dispatch_id} />
            )}
          </div>
        )}
        emptyStateClassName="px-5 py-6 flex flex-col items-center justify-center text-center"
        emptyText="No jobs found."
        renderRow={(row) => (
          <tr key={row.id || row.job_id} className="hover:bg-orac-surface-muted/50">
            <td className="px-5 py-3.5 font-medium text-orac-text-primary">
              <div>{row.quote_number || row.quote_id}</div>
              {row.commercial_owner && <div className="text-ux-caption text-orac-text-muted">{row.commercial_owner}</div>}
            </td>
            <td className="px-5 py-3.5 text-orac-text-secondary">
              <div>{row.client_name || row.client_id || "\u2014"}</div>
              {(row.site_name || row.site_id) && <div className="text-ux-caption text-orac-text-muted">{row.site_name || row.site_id}</div>}
            </td>
            <td className="px-5 py-3.5">
              <StatusBadge status={row.status} />
            </td>
            <td className="px-5 py-3.5 text-orac-text-secondary">
              <div>{row.po_number || row.po_reference || "\u2014"}</div>
              <div className="text-ux-caption text-orac-text-muted">{(row.po_status || "").replace(/_/g, " ")}</div>
            </td>
            <td className="px-5 py-3.5 text-orac-text-secondary">
              {row.dispatch_number || (row.dispatch_id ? row.dispatch_id : "\u2014")}
            </td>
            <td className="px-5 py-3.5 text-orac-text-primary">
              <span className="font-semibold">{formatNumber(row.actual_field_hours ?? row.actual_hours ?? 0)} hrs</span>
              {row.actual_hours_breakdown && (row.actual_hours_breakdown.ot_15 > 0 || row.actual_hours_breakdown.ot_20 > 0) && (
                <div className="text-ux-caption text-orac-text-muted">
                  {row.actual_hours_breakdown.normal}h N / {row.actual_hours_breakdown.ot_15}h 1.5x / {row.actual_hours_breakdown.ot_20}h 2.0x
                </div>
              )}
            </td>
          </tr>
        )}
      />
    </div>
  );
}
