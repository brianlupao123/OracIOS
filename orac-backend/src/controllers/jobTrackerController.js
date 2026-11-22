import { roles } from "../permissions.js";
import { getActor, isQuoteInSalesPortfolio } from "./coreController.js";
import { jobActuals } from "../jobActuals.js";
import { invoiceReadinessBlock } from "../invoiceReadiness.js";

const ALLOWED_ROLES = new Set([
  roles.ADMIN,
  roles.MANAGEMENT,
  roles.SALES,
  roles.OPERATIONS,
  roles.FINANCE
]);

/**
 * GET /api/job-tracker
 * Read-only Job Tracker endpoint.
 *
 * Authorization:
 * - Admin, Management, Sales, Operations, Finance only.
 * - 403 for Supervisor, Technician, Client Viewer.
 * - Sales is strictly portfolio-scoped.
 *
 * Statuses:
 * - Excludes Draft and Cancelled quotes.
 * - Waiting for Client PO: Approved_Pending_PO with no PO or PO pending verification.
 * - WIP: verified-PO dispatch only.
 * - Ready to prepare invoice: existing invoice readiness logic.
 * - Invoiced: issued invoice.
 * - Completed: settled invoice.
 *
 * Payload:
 * - Canonical fields only (no money, no rates/prices/amounts/VAT, no unmigrated PR/Pastel fields).
 */
export function getJobTracker(req, res) {
  const actor = getActor(req);
  if (!actor || !actor.is_active || !ALLOWED_ROLES.has(actor.role)) {
    return res.status(403).json({
      success: false,
      message: `Role ${actor?.role || "Unknown"} cannot access Jobs Tracker.`
    });
  }

  const db = req.db || {};
  const quotes = db.quotes || [];
  const dispatches = db.dispatch_cards || [];
  const purchaseOrders = db.purchase_orders || [];
  const invoices = db.invoices || [];
  const clients = db.clients || [];
  const mineSites = db.mine_sites || [];
  const users = db.users || [];

  const clientMap = new Map(clients.map((c) => [c.id, c.name]));
  const userMap = new Map(users.map((u) => [u.id, u.name || u.email]));
  const siteMap = new Map(mineSites.map((s) => [s.id, s.name]));

  // Quotes to process: exclude Draft and Cancelled
  const activeQuotes = quotes.filter((q) => {
    const s = String(q.status || "").toLowerCase();
    return s !== "draft" && s !== "cancelled";
  });

  // Sales portfolio filtering
  const accessibleQuotes = actor.role === roles.SALES
    ? activeQuotes.filter((q) => isQuoteInSalesPortfolio(q, actor, db))
    : activeQuotes;

  const jobs = [];

  for (const quote of accessibleQuotes) {
    const po = purchaseOrders.find((p) => p.quotation_id === quote.id || p.id === quote.purchase_order_id) || null;
    const isPoVerified = Boolean(
      po && (
        po.status === "Verified" ||
        po.status === "PO_Verified" ||
        po.verified_at ||
        quote.status === "PO_Verified" ||
        quote.status === "Field_Dispatch"
      )
    );

    const quoteDispatches = dispatches.filter((d) => d.quotation_id === quote.id);
    const quoteInvoices = invoices.filter((inv) =>
      inv.quotation_id === quote.id ||
      (quoteDispatches.length > 0 && quoteDispatches.some((d) => d.id === inv.dispatch_card_id))
    );

    const nonVoidInvoices = quoteInvoices.filter((inv) => String(inv.status || "").toLowerCase() !== "voided");

    // Aggregate actual hours across all quote dispatches
    let totalActuals = { total: 0, normal: 0, ot_15: 0, ot_20: 0 };
    for (const d of quoteDispatches) {
      const a = jobActuals(db, d.id);
      totalActuals.total += a.total;
      totalActuals.normal += a.normal;
      totalActuals.ot_15 += a.ot_15;
      totalActuals.ot_20 += a.ot_20;
    }

    // Work completion: derived strictly from explicit completion records
    const hasDispatches = quoteDispatches.length > 0;
    const allDispatchesCompleted = hasDispatches && quoteDispatches.every((d) =>
      Boolean(d.completion_record || d.completed_at || String(d.status || "").toLowerCase() === "completed")
    );
    const workStatus = !hasDispatches
      ? "Not_Started"
      : (allDispatchesCompleted ? "Completed" : "WIP");

    // Invoice status: derived strictly from invoice history
    const allSettled = nonVoidInvoices.length > 0 && nonVoidInvoices.every((inv) => {
      const s = String(inv.status || "").toLowerCase();
      return s === "settled" || s === "paid";
    });
    const invoiceStatus = allSettled
      ? "Settled"
      : (nonVoidInvoices.length > 0
        ? "Invoiced"
        : (hasDispatches && isPoVerified && quoteDispatches.some((d) => invoiceReadinessBlock(db, d) === null)
          ? "Ready_For_Invoice"
          : "Unbilled"));

    // Stage & display status: preserve backwards compatibility while decoupling work completion from payment
    let status = "Waiting_For_PO";
    let stage = "Waiting for Client PO";

    if (allSettled) {
      if (allDispatchesCompleted) {
        status = "Completed";
        stage = "Completed";
      } else {
        status = "Paid_WIP";
        stage = "Settled (Field Work Incomplete)";
      }
    } else if (nonVoidInvoices.length > 0) {
      status = "Invoiced";
      stage = "Invoiced";
    } else if (invoiceStatus === "Ready_For_Invoice") {
      status = "Ready_For_Invoice";
      stage = "Ready to prepare invoice";
    } else if (hasDispatches && isPoVerified) {
      status = "WIP";
      stage = "Work in Progress (WIP)";
    } else if (quote.status === "Approved_Pending_PO") {
      status = "Approved_Pending_PO";
      stage = "Waiting for Client PO";
    } else if (quote.status === "Sent") {
      status = "Sent";
      stage = "Sent (Awaiting Client Approval)";
    } else {
      status = quote.status || "Pending";
      stage = quote.status || "Pending";
    }

    const primaryDispatch = quoteDispatches[0] || null;
    const plannedStart = quoteDispatches.map((d) => d.scheduled_start).filter(Boolean).sort()[0] || "Not captured";
    const actualStart = quoteDispatches.map((d) => d.actual_start).filter(Boolean).sort()[0] || "Not captured";
    const completionRecord = quoteDispatches.map((d) => d.completion_record || d.completed_at).filter(Boolean).join("; ") || "Not captured";

    const commercialOwner = quote.sales_owner_id
      ? (userMap.get(quote.sales_owner_id) || quote.sales_owner_id)
      : "Unassigned";

    const siteName = quote.mine_site_id ? (siteMap.get(quote.mine_site_id) || "") : "";

    jobs.push({
      id: primaryDispatch ? primaryDispatch.id : `quote_${quote.id}`,
      quote_id: quote.id,
      quote_number: quote.quote_number,
      client_id: quote.client_id,
      client_name: clientMap.get(quote.client_id) || quote.client_id || "",
      site_id: quote.mine_site_id || null,
      site_name: siteName,
      status,
      stage,
      work_status: workStatus,
      invoice_status: invoiceStatus,
      payment_status: allSettled ? "Paid" : (nonVoidInvoices.length > 0 ? "Pending_Payment" : "Unbilled"),
      po_number: po?.po_number || po?.po_reference || "Not captured",
      po_status: po ? (isPoVerified ? "Verified" : "Pending_Verification") : "No_PO",
      client_pr: quote.client_pr_number || quote.client_pr || "Not captured",
      planned_start: plannedStart,
      actual_start: actualStart,
      completion_record: completionRecord,
      dispatch_id: primaryDispatch?.id || null,
      dispatch_number: quoteDispatches.map((d) => d.dispatch_number).filter(Boolean).join(", ") || null,
      dispatches_count: quoteDispatches.length,
      dispatches: quoteDispatches.map((d) => ({
        id: d.id,
        dispatch_number: d.dispatch_number,
        status: d.status,
        scheduled_start: d.scheduled_start || null,
        actual_start: d.actual_start || null,
        completion_record: d.completion_record || d.completed_at || null,
        actual_hours: jobActuals(db, d.id).total
      })),
      actual_hours: totalActuals.total,
      actual_hours_breakdown: {
        normal: totalActuals.normal,
        ot_15: totalActuals.ot_15,
        ot_20: totalActuals.ot_20
      },
      commercial_owner: commercialOwner,
      sales_owner_id: quote.sales_owner_id || null,
      created_at: primaryDispatch?.created_at || quote.created_at,
      updated_at: quote.updated_at || quote.created_at
    });
  }

  // Stable order: descending by created_at
  jobs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  res.json({
    success: true,
    data: jobs
  });
}
