/**
 * Communication Audit History & Digest Engine — Batch 4 of 4.
 *
 * 1. Entity-linked communication history: query messages by entity FK.
 * 2. Daily chase digest: aggregate unpaid invoices, overdue POs, stale dispatches.
 * 3. Evidence recording: "Sent via Company Outlook" / "Sent via ORAC" tags.
 *
 * Zero sending risk: this module reads queued/dispatched messages and
 * builds digest previews. It never touches transports or SMTP.
 */

import crypto from "node:crypto";

// ── Entity History ──────────────────────────────────────────────────

/**
 * Returns all communication messages linked to a given entity.
 * Sorted newest-first. Useful for entity audit trail integration.
 *
 * @param {{ entityType: string, entityId: string, db: object }} opts
 * @returns {Array} messages linked to the entity
 */
export function getEntityCommunicationHistory({ entityType, entityId, db }) {
  const queue = db.communication_queue || [];
  return queue
    .filter(m => m.entity_type === entityType && m.entity_id === entityId)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

/**
 * Returns aggregated communication stats for an entity.
 * Shows how many messages were drafted, queued, dispatched, failed.
 */
export function getEntityCommunicationStats({ entityType, entityId, db }) {
  const messages = getEntityCommunicationHistory({ entityType, entityId, db });
  return {
    entity_type: entityType,
    entity_id: entityId,
    total: messages.length,
    draft: messages.filter(m => m.status === "Draft").length,
    queued: messages.filter(m => m.status === "Queued").length,
    dispatched: messages.filter(m => m.status === "Dispatched").length,
    failed: messages.filter(m => m.status === "Failed").length,
    cancelled: messages.filter(m => m.status === "Cancelled").length,
    last_dispatched_at: messages.find(m => m.status === "Dispatched")?.dispatched_at || null
  };
}

// ── Evidence Recording ──────────────────────────────────────────────

/**
 * Records a manual communication evidence entry. Used when a user sends
 * a document via their own Outlook, WhatsApp, or hand-delivery and wants
 * to log it in the ORAC timeline.
 *
 * NOT a queue message — it's an evidence record. No state machine needed.
 */
export function recordCommunicationEvidence({
  entityType, entityId, channel, recipientEmail, recipientName,
  subject, notes, sentAt, recordedBy, store, db
}) {
  if (!entityType) throw Object.assign(new Error("entityType is required"), { status: 400 });
  if (!entityId) throw Object.assign(new Error("entityId is required"), { status: 400 });
  if (!channel) throw Object.assign(new Error("channel is required"), { status: 400 });

  const VALID_CHANNELS = [
    "company_outlook", "personal_email", "whatsapp", "phone_call",
    "hand_delivery", "courier", "orac_system", "other"
  ];
  if (!VALID_CHANNELS.includes(channel)) {
    throw Object.assign(
      new Error(`Invalid channel. Must be one of: ${VALID_CHANNELS.join(", ")}`),
      { status: 400 }
    );
  }

  if (!db.communication_evidence) db.communication_evidence = [];

  const evidence = {
    id: `cev_${crypto.randomBytes(8).toString("hex")}`,
    entity_type: entityType,
    entity_id: entityId,
    channel,
    recipient_email: recipientEmail || null,
    recipient_name: recipientName || null,
    subject: subject || null,
    notes: notes || null,
    sent_at: sentAt || new Date().toISOString(),
    recorded_by: recordedBy,
    recorded_at: new Date().toISOString()
  };

  db.communication_evidence.push(evidence);

  store.audit(db, { id: recordedBy }, "communication_evidence", evidence.id,
    "EVIDENCE_RECORDED", {
      entity_type: entityType,
      entity_id: entityId,
      channel,
      subject: evidence.subject
    });

  return evidence;
}

/**
 * Returns all evidence records for a given entity, newest-first.
 */
export function getEntityEvidenceHistory({ entityType, entityId, db }) {
  const evidence = db.communication_evidence || [];
  return evidence
    .filter(e => e.entity_type === entityType && e.entity_id === entityId)
    .sort((a, b) => (b.recorded_at || "").localeCompare(a.recorded_at || ""));
}

// ── Combined Timeline ───────────────────────────────────────────────

/**
 * Returns a unified timeline of all communications AND evidence for an
 * entity, interleaved by date. Each entry has { type, timestamp, ...data }.
 */
export function getEntityCommunicationTimeline({ entityType, entityId, db }) {
  const messages = getEntityCommunicationHistory({ entityType, entityId, db })
    .map(m => ({
      type: "queue_message",
      timestamp: m.dispatched_at || m.queued_at || m.created_at,
      id: m.id,
      status: m.status,
      subject: m.subject,
      recipient_email: m.recipient_email,
      channel: m.dry_run ? "orac_system_dry_run" : "orac_system",
      template_name: m.template_name
    }));

  const evidence = getEntityEvidenceHistory({ entityType, entityId, db })
    .map(e => ({
      type: "manual_evidence",
      timestamp: e.sent_at || e.recorded_at,
      id: e.id,
      status: "recorded",
      subject: e.subject,
      recipient_email: e.recipient_email,
      channel: e.channel,
      notes: e.notes
    }));

  return [...messages, ...evidence]
    .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
}

// ── Daily Chase Digest ──────────────────────────────────────────────

/**
 * Builds a daily chase digest: aggregates items that need follow-up.
 * Returns a structured digest object (NOT an email — just data).
 *
 * Categories:
 *  - unpaid_invoices: invoices with status not in [paid, void, cancelled]
 *  - pending_pos: quotes awaiting PO (status = "Sent" or "Approved")
 *  - stale_dispatches: dispatches older than staleDays without completion
 *  - overdue_worksheets: worksheets in "Draft" state for > draftDays
 *
 * @param {{ db: object, staleDays?: number, draftDays?: number }} opts
 * @returns {{ generated_at, items, summary }}
 */
export function buildChaseDigest({ db, staleDays = 14, draftDays = 7 }) {
  const now = new Date();
  const items = [];

  // 1. Unpaid invoices
  const invoices = db.invoices || [];
  const unpaid = invoices.filter(i =>
    i.status &&
    !["paid", "void", "voided", "cancelled"].includes(String(i.status).toLowerCase()) &&
    i.created_at
  );
  for (const inv of unpaid) {
    const age = daysBetween(inv.created_at, now);
    items.push({
      category: "unpaid_invoice",
      entity_type: "invoice",
      entity_id: inv.id,
      ref: inv.invoice_ref || inv.id,
      client_name: inv.client_name || "",
      age_days: age,
      amount: inv.totals?.total ?? inv.total_incl_vat ?? null,
      urgency: age > 60 ? "critical" : age > 30 ? "high" : "normal"
    });
  }

  // 2. Quotes awaiting PO
  const quotes = db.quotes || [];
  const pendingPo = quotes.filter(q =>
    q.status && ["Sent", "Approved"].includes(q.status) && q.created_at
  );
  for (const q of pendingPo) {
    const age = daysBetween(q.created_at, now);
    items.push({
      category: "pending_po",
      entity_type: "quote",
      entity_id: q.id,
      ref: q.quote_ref || q.id,
      client_name: q.client_name || "",
      age_days: age,
      amount: q.totals?.total ?? q.total_incl_vat ?? null,
      urgency: age > 30 ? "high" : "normal"
    });
  }

  // 3. Stale dispatches (open for > staleDays without completion)
  const dispatches = db.dispatch_cards || [];
  const stale = dispatches.filter(d => {
    if (!d.dispatch_date && !d.created_at) return false;
    const age = daysBetween(d.dispatch_date || d.created_at, now);
    const isComplete = d.status && ["Completed", "Invoiced", "Cancelled"].includes(d.status);
    return age > staleDays && !isComplete;
  });
  for (const d of stale) {
    items.push({
      category: "stale_dispatch",
      entity_type: "dispatch",
      entity_id: d.id,
      ref: d.dispatch_ref || d.id,
      client_name: d.client_name || "",
      age_days: daysBetween(d.dispatch_date || d.created_at, now),
      urgency: "high"
    });
  }

  // 4. Overdue draft worksheets
  const worksheets = db.worksheets || [];
  const overdueDrafts = worksheets.filter(w => {
    if (!w.created_at) return false;
    const age = daysBetween(w.created_at, now);
    return w.status === "Draft" && age > draftDays;
  });
  for (const w of overdueDrafts) {
    items.push({
      category: "overdue_worksheet",
      entity_type: "worksheet",
      entity_id: w.id,
      ref: w.worksheet_ref || w.id,
      client_name: "",
      age_days: daysBetween(w.created_at, now),
      urgency: "normal"
    });
  }

  // Sort by urgency (critical > high > normal), then by age descending
  const urgencyOrder = { critical: 0, high: 1, normal: 2 };
  items.sort((a, b) =>
    (urgencyOrder[a.urgency] || 2) - (urgencyOrder[b.urgency] || 2) ||
    (b.age_days || 0) - (a.age_days || 0)
  );

  return {
    generated_at: now.toISOString(),
    stale_threshold_days: staleDays,
    draft_threshold_days: draftDays,
    summary: {
      unpaid_invoices: items.filter(i => i.category === "unpaid_invoice").length,
      pending_pos: items.filter(i => i.category === "pending_po").length,
      stale_dispatches: items.filter(i => i.category === "stale_dispatch").length,
      overdue_worksheets: items.filter(i => i.category === "overdue_worksheet").length,
      total: items.length,
      critical: items.filter(i => i.urgency === "critical").length,
      high: items.filter(i => i.urgency === "high").length
    },
    items
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function daysBetween(dateStr, now) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 0;
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}
