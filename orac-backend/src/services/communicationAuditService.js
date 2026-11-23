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
 * Strips any sensitive credentials, tokens, or payment details from text.
 */
export function sanitizeAuditText(text) {
  if (!text || typeof text !== "string") return text;
  let out = text
    .replace(/(bearer\s+)[a-zA-Z0-9_\-\.]+/gi, "$1[REDACTED]")
    .replace(/(token[=:]\s*)[a-zA-Z0-9_\-\.]+/gi, "$1[REDACTED]")
    .replace(/(secret[=:]\s*)[a-zA-Z0-9_\-\.]+/gi, "$1[REDACTED]")
    .replace(/(password[=:]\s*)[^\s&]+/gi, "$1[REDACTED]");
  // Provider error text can echo credentials back; scrub the configured SMTP
  // password verbatim (pattern rules above only catch labelled secrets).
  const smtpPass = process.env.SMTP_PASS;
  if (typeof smtpPass === "string" && smtpPass.length >= 4) out = out.split(smtpPass).join("[REDACTED]");
  return out;
}

/** Recursively sanitizes every string inside a JSON-like value. */
function sanitizeAuditValue(value) {
  if (typeof value === "string") return sanitizeAuditText(value);
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeAuditValue(v)]));
  }
  return value;
}

/**
 * Truthful lifecycle states for system-recorded email evidence.
 *  send_attempted   write-ahead intent, recorded BEFORE any SMTP conversation
 *  accepted         SMTP provider accepted the message (proves nothing about the mailbox)
 *  send_uncertain   failure after DATA was sent: the message MAY have been accepted
 *  send_failed      definitive failure: the provider did not accept the message
 *  receipt_confirmed  a HUMAN recorded that the recipient received it (separate evidence row)
 * Only the system recorders below may write these; the public recorder refuses them
 * so a caller of the generic evidence endpoint cannot forge them.
 */
export const SYSTEM_EVIDENCE_STATUSES = Object.freeze([
  "send_attempted", "accepted", "send_uncertain", "send_failed", "receipt_confirmed"
]);
/** ORAC cannot observe mailbox delivery, so this status is never writable by anyone. */
const NEVER_WRITABLE_STATUSES = Object.freeze(["delivered"]);

/** Channels a caller may name. direct_smtp = ORAC's own SMTP transport (live mode). */
const VALID_CHANNELS = [
  "company_outlook", "personal_email", "whatsapp", "phone_call",
  "hand_delivery", "courier", "orac_system", "orac_system_dry_run", "direct_smtp", "other"
];

/** Extra evidence fields the system recorders may set; they can never override the base record. */
const SYSTEM_EXTRA_FIELDS = Object.freeze([
  "send_kind", "attempt_number", "idempotency_key_hash", "supersedes", "resend_reason",
  "pdf_sha256", "pdf_filename", "message_id_header", "accepted_at", "audit_gap",
  "related_evidence_id", "receipt_method", "receipt_reported_at", "confirmed_by", "confirmed_at"
]);

function buildEvidence(opts, { system }) {
  const {
    entityType, entityId, channel, recipientEmail, recipientName,
    subject, notes, sentAt, recordedBy, approvedBy = null,
    status = "manual-external", transportMode = "manual-external",
    templateVersion = "v1", providerMessageId = null, failureReason = null,
    extra = null, db
  } = opts;

  if (!entityType) throw Object.assign(new Error("entityType is required"), { status: 400 });
  if (!entityId) throw Object.assign(new Error("entityId is required"), { status: 400 });
  if (!channel) throw Object.assign(new Error("channel is required"), { status: 400 });

  if (!VALID_CHANNELS.includes(channel)) {
    throw Object.assign(
      new Error(`Invalid channel. Must be one of: ${VALID_CHANNELS.join(", ")}`),
      { status: 400 }
    );
  }
  if (NEVER_WRITABLE_STATUSES.includes(status)) {
    throw Object.assign(
      new Error(`Status '${status}' cannot be recorded: ORAC cannot observe mailbox delivery.`),
      { status: 400, code: "EVIDENCE_STATUS_NOT_ALLOWED" }
    );
  }
  if (!system && SYSTEM_EVIDENCE_STATUSES.includes(status)) {
    throw Object.assign(
      new Error(`Status '${status}' is reserved for system-recorded send evidence.`),
      { status: 400, code: "EVIDENCE_STATUS_RESERVED" }
    );
  }

  if (!db.communication_evidence) db.communication_evidence = [];

  const evidence = {
    id: `cev_${crypto.randomBytes(8).toString("hex")}`,
    entity_type: entityType,
    entity_id: entityId,
    business_record_type: entityType,
    business_record_id: entityId,
    template_version: templateVersion,
    channel,
    recipient_email: recipientEmail || null,
    recipient_name: recipientName || null,
    subject: sanitizeAuditText(subject) || null,
    notes: sanitizeAuditText(notes) || null,
    status,
    transport_mode: transportMode,
    requested_by: recordedBy,
    recorded_by: recordedBy,
    approved_by: approvedBy,
    provider_message_id: providerMessageId,
    failure_reason: sanitizeAuditText(failureReason) || null,
    sent_at: system && sentAt === null ? null : (sentAt || new Date().toISOString()),
    recorded_at: new Date().toISOString()
  };

  if (system) {
    evidence.status_history = [{ status, at: evidence.recorded_at }];
    for (const [key, value] of Object.entries(extra || {})) {
      if (SYSTEM_EXTRA_FIELDS.includes(key)) evidence[key] = sanitizeAuditValue(value);
    }
  }
  return evidence;
}

/**
 * Records a durable communication evidence entry fulfilling Gap 19:
 * Persists business record type/id, template version, recipient, requested_by,
 * approved_by, status, transport mode, timestamps, provider message id, retry/failure reason.
 * Zero secrets/tokens/payment data in audit logs.
 *
 * Public recorder: refuses system-only statuses (see SYSTEM_EVIDENCE_STATUSES) and
 * never accepts "delivered".
 */
export function recordCommunicationEvidence(opts) {
  const { audit = true, store, db } = opts;
  const evidence = buildEvidence(opts, { system: false });
  db.communication_evidence.push(evidence);

  if (audit && store?.audit) {
    store.audit(db, { id: opts.recordedBy }, "communication_evidence", evidence.id,
      "EVIDENCE_RECORDED", {
        entity_type: opts.entityType,
        entity_id: opts.entityId,
        channel: opts.channel,
        status: evidence.status,
        transport_mode: evidence.transport_mode,
        subject: evidence.subject
      });
  }

  return evidence;
}

/**
 * System recorder for send-lifecycle and human-receipt evidence.
 * Unlike the public recorder it (a) may write SYSTEM_EVIDENCE_STATUSES, (b) REQUIRES a
 * working store.audit, and (c) is atomic: if the audit write throws, the evidence row is
 * removed again and the error propagates, so a row never exists without its audit event.
 * Callers decide what a failure means (before SMTP: refuse to send; after SMTP: report
 * an untraceable send).
 */
export function recordSystemCommunicationEvidence(opts) {
  const { store, db, auditAction = "EVIDENCE_RECORDED" } = opts;
  if (!store || typeof store.audit !== "function") {
    throw Object.assign(new Error("Audit store unavailable; evidence not recorded"), { status: 500, code: "COMMUNICATION_AUDIT_UNAVAILABLE" });
  }
  const evidence = buildEvidence(opts, { system: true });
  db.communication_evidence.push(evidence);
  try {
    store.audit(db, { id: opts.recordedBy }, "communication_evidence", evidence.id, auditAction, {
      entity_type: opts.entityType,
      entity_id: opts.entityId,
      channel: opts.channel,
      status: evidence.status,
      transport_mode: evidence.transport_mode,
      subject: evidence.subject,
      ...(evidence.related_evidence_id ? { related_evidence_id: evidence.related_evidence_id } : {})
    });
  } catch (err) {
    const index = db.communication_evidence.indexOf(evidence);
    if (index !== -1) db.communication_evidence.splice(index, 1);
    throw err;
  }
  return evidence;
}

/**
 * Moves a system-recorded evidence row to a new lifecycle status IN PLACE and audits it.
 * The in-memory row is updated BEFORE the audit call, so if the audit throws the ledger
 * still shows what really happened (e.g. "accepted") rather than a stale "send_attempted".
 * The caller must handle an audit throw; this function never swallows it.
 */
export function transitionCommunicationEvidence({ evidence, toStatus, patch = {}, actorId, auditAction, store, db }) {
  if (NEVER_WRITABLE_STATUSES.includes(toStatus)) {
    throw Object.assign(new Error(`Status '${toStatus}' cannot be recorded`), { status: 400, code: "EVIDENCE_STATUS_NOT_ALLOWED" });
  }
  if (!SYSTEM_EVIDENCE_STATUSES.includes(toStatus) && toStatus !== "dry-run") {
    throw Object.assign(new Error(`Unsupported evidence transition '${toStatus}'`), { status: 400 });
  }
  const at = new Date().toISOString();
  for (const [key, value] of Object.entries(patch)) {
    if (["notes", "failure_reason", "sent_at", "transport_mode", "channel"].includes(key) || SYSTEM_EXTRA_FIELDS.includes(key)) {
      evidence[key] = sanitizeAuditValue(value);
    }
  }
  evidence.status = toStatus;
  (evidence.status_history ||= []).push({ status: toStatus, at });
  if (!store || typeof store.audit !== "function") {
    throw Object.assign(new Error("Audit store unavailable; transition not audited"), { status: 500, code: "COMMUNICATION_AUDIT_UNAVAILABLE" });
  }
  store.audit(db, { id: actorId }, "communication_evidence", evidence.id, auditAction, {
    entity_type: evidence.entity_type,
    entity_id: evidence.entity_id,
    channel: evidence.channel,
    status: toStatus,
    transport_mode: evidence.transport_mode
  });
  return evidence;
}

/**
 * Records a truthful external-send evidence record for communications
 * sent through Outlook, Pastel, or external mail.
 * Truthfully states that ORAC logged the event; never claims ORAC delivered it.
 */
export function recordExternalSend({
  businessRecordType,
  businessRecordId,
  channel = "company_outlook",
  recipientEmail,
  recipientName,
  subject,
  notes,
  recordedBy,
  store,
  db
}) {
  return recordCommunicationEvidence({
    entityType: businessRecordType,
    entityId: businessRecordId,
    channel,
    recipientEmail,
    recipientName,
    subject,
    notes: notes ? `[EXTERNAL SEND] ${notes}` : "[EXTERNAL SEND] Manually dispatched via external mail client. Logged by ORAC.",
    sentAt: new Date().toISOString(),
    recordedBy,
    status: "manual-external",
    transportMode: "manual-external",
    templateVersion: "v1",
    store,
    db
  });
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
export function getEntityCommunicationTimeline({ entityType, entityId, db, includeRecovery = false }) {
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
      evidence_status: e.status || null,
      related_evidence_id: e.related_evidence_id || null,
      subject: e.subject,
      recipient_email: e.recipient_email,
      channel: e.channel,
      notes: e.notes,
      ...(includeRecovery && e.send_kind === "quotation_pdf" ? {
        send_kind: e.send_kind,
        transport_mode: e.transport_mode,
        recipient_name: e.recipient_name,
        recorded_at: e.recorded_at,
        supersedes: e.supersedes || null,
        recovery: e.recovery || null
      } : {})
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
