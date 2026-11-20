import crypto from "node:crypto";
import {
  sendEmail,
  isRecipientPermitted,
  getTransportConfig
} from "./communicationTransportService.js";

/**
 * Communication Queue Service — Batch 2 of 4.
 *
 * In-memory/DB queue with state machine: Draft → Queued → Dispatched | Failed → Cancelled.
 * Default DRY_RUN=true: transitions to Dispatched and logs payload to audit
 * WITHOUT initiating any network connections.
 *
 * Zero sending risk in dry-run mode. No mail imports, no SMTP.
 */

const VALID_STATES = ["Draft", "Queued", "Dispatched", "Failed", "Cancelled"];
const MAX_RETRIES = 3;

function generateId() {
  return `msg_${crypto.randomBytes(8).toString("hex")}`;
}

function isDryRun() {
  return process.env.COMMUNICATIONS_DRY_RUN !== "false";
}

// ── Queue Operations ─────────────────────────────────────────────────

/**
 * Creates a new message in the queue with Draft status.
 */
export function createMessage({ templateName, subject, body, recipientEmail, recipientName, entityType, entityId, attachments, createdBy, store, db }) {
  if (!subject) throw Object.assign(new Error("subject is required"), { status: 400 });
  if (!body) throw Object.assign(new Error("body is required"), { status: 400 });
  if (!recipientEmail) throw Object.assign(new Error("recipientEmail is required"), { status: 400 });

  if (!db.communication_queue) db.communication_queue = [];

  const message = {
    id: generateId(),
    template_name: templateName || null,
    subject,
    body,
    recipient_email: recipientEmail,
    recipient_name: recipientName || "",
    entity_type: entityType || null,
    entity_id: entityId || null,
    attachments: attachments || [],
    status: "Draft",
    created_by: createdBy,
    created_at: new Date().toISOString(),
    queued_at: null,
    dispatched_at: null,
    failed_at: null,
    cancelled_at: null,
    retry_count: 0,
    last_error: null,
    dry_run: isDryRun()
  };

  db.communication_queue.push(message);

  store.audit(db, { id: createdBy }, "communication_queue", message.id,
    "MESSAGE_DRAFTED", { subject, recipient_email: recipientEmail, entity_type: entityType, entity_id: entityId });

  return message;
}

/**
 * Transitions a Draft message to Queued.
 */
export function queueMessage({ messageId, userId, store, db }) {
  const msg = findMessage(messageId, db);
  if (msg.status !== "Draft") {
    throw Object.assign(new Error(`Cannot queue a message with status '${msg.status}'`), { status: 409 });
  }

  msg.status = "Queued";
  msg.queued_at = new Date().toISOString();

  store.audit(db, { id: userId }, "communication_queue", msg.id,
    "MESSAGE_QUEUED", { subject: msg.subject });

  return msg;
}

/**
 * Processes a Queued message. In dry-run mode, transitions to Dispatched
 * and logs the payload without any network activity.
 * Returns the updated message.
 */
export function processMessage({ messageId, userId, store, db }) {
  const msg = findMessage(messageId, db);
  if (msg.status !== "Queued") {
    throw Object.assign(new Error(`Cannot process a message with status '${msg.status}'`), { status: 409 });
  }

  // Check recipient allowlist safety gate ALWAYS (both dry-run and live)
  if (!isRecipientPermitted(msg.recipient_email)) {
    const errorMsg = `Safety Refusal: Recipient '${msg.recipient_email}' is outside the controlled pilot allowlist.`;
    msg.status = "Failed";
    msg.last_error = errorMsg;
    msg.failed_at = new Date().toISOString();
    store.audit(db, { id: userId }, "communication_queue", msg.id,
      "MESSAGE_REFUSED_SAFETY_ALLOWLIST", {
        recipient_email: msg.recipient_email,
        reason: errorMsg
      });
    throw Object.assign(new Error(errorMsg), { status: 403, code: "RECIPIENT_NOT_ALLOWED" });
  }

  if (isDryRun()) {
    // DRY RUN: mark as dispatched without sending
    msg.status = "Dispatched";
    msg.dispatched_at = new Date().toISOString();
    msg.dry_run = true;

    store.audit(db, { id: userId }, "communication_queue", msg.id,
      "MESSAGE_DISPATCHED_DRY_RUN", {
        subject: msg.subject,
        recipient_email: msg.recipient_email,
        body_length: msg.body.length,
        attachments_count: msg.attachments.length
      });

    return msg;
  }

  // LIVE MODE: Check configuration first
  const config = getTransportConfig();
  if (!config.isConfigured) {
    throw Object.assign(
      new Error("Live sending is not configured. Configure SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) before setting COMMUNICATIONS_DRY_RUN=false."),
      { status: 503 }
    );
  }

  // Return a promise for the live sending operation
  return (async () => {
    try {
      const sendResult = await sendEmail({
        to: msg.recipient_email,
        toName: msg.recipient_name,
        subject: msg.subject,
        body: msg.body,
        attachments: msg.attachments
      });

      msg.status = "Dispatched";
      msg.dispatched_at = new Date().toISOString();
      msg.dry_run = false;
      msg.provider_message_id = sendResult.messageId;

      store.audit(db, { id: userId }, "communication_queue", msg.id,
        "MESSAGE_DISPATCHED_LIVE", {
          subject: msg.subject,
          recipient_email: msg.recipient_email,
          provider_message_id: sendResult.messageId
        });

      return msg;
    } catch (err) {
      failMessage({ messageId: msg.id, error: err.message, userId, store, db });
      throw err;
    }
  })();
}

/**
 * Records a failure for a message. Increments retry counter.
 * If max retries exceeded, stays in Failed (dead letter).
 */
export function failMessage({ messageId, error, userId, store, db }) {
  const msg = findMessage(messageId, db);
  if (msg.status !== "Queued") {
    throw Object.assign(new Error(`Cannot fail a message with status '${msg.status}'`), { status: 409 });
  }

  msg.retry_count += 1;
  msg.last_error = error || "Unknown error";
  msg.failed_at = new Date().toISOString();
  msg.status = "Failed";

  store.audit(db, { id: userId }, "communication_queue", msg.id,
    "MESSAGE_FAILED", { error: msg.last_error, retry_count: msg.retry_count });

  return msg;
}

/**
 * Re-queues a Failed message if under the retry limit.
 */
export function retryMessage({ messageId, userId, store, db }) {
  const msg = findMessage(messageId, db);
  if (msg.status !== "Failed") {
    throw Object.assign(new Error(`Cannot retry a message with status '${msg.status}'`), { status: 409 });
  }
  if (msg.retry_count >= MAX_RETRIES) {
    throw Object.assign(
      new Error(`Max retries (${MAX_RETRIES}) exceeded. Message is in dead-letter state.`),
      { status: 409 }
    );
  }

  msg.status = "Queued";
  msg.queued_at = new Date().toISOString();
  msg.failed_at = null;
  msg.last_error = null;

  store.audit(db, { id: userId }, "communication_queue", msg.id,
    "MESSAGE_RETRIED", { retry_count: msg.retry_count });

  return msg;
}

/**
 * Cancels a Draft or Queued or Failed message.
 */
export function cancelMessage({ messageId, reason, userId, store, db }) {
  const msg = findMessage(messageId, db);
  if (!["Draft", "Queued", "Failed"].includes(msg.status)) {
    throw Object.assign(new Error(`Cannot cancel a message with status '${msg.status}'`), { status: 409 });
  }

  msg.status = "Cancelled";
  msg.cancelled_at = new Date().toISOString();

  store.audit(db, { id: userId }, "communication_queue", msg.id,
    "MESSAGE_CANCELLED", { reason: reason || null });

  return msg;
}

// ── Query Operations ─────────────────────────────────────────────────

export function listQueuedMessages({ db }) {
  return (db.communication_queue || []).filter(m => m.status === "Queued");
}

export function listFailedMessages({ db }) {
  return (db.communication_queue || []).filter(m => m.status === "Failed");
}

export function getMessageById({ messageId, db }) {
  return (db.communication_queue || []).find(m => m.id === messageId) || null;
}

export function getQueueStats({ db }) {
  const queue = db.communication_queue || [];
  return {
    total: queue.length,
    draft: queue.filter(m => m.status === "Draft").length,
    queued: queue.filter(m => m.status === "Queued").length,
    dispatched: queue.filter(m => m.status === "Dispatched").length,
    failed: queue.filter(m => m.status === "Failed").length,
    cancelled: queue.filter(m => m.status === "Cancelled").length,
    dry_run: isDryRun()
  };
}

// ── Internal ─────────────────────────────────────────────────────────

function findMessage(messageId, db) {
  const msg = (db.communication_queue || []).find(m => m.id === messageId);
  if (!msg) throw Object.assign(new Error("Message not found"), { status: 404 });
  return msg;
}
