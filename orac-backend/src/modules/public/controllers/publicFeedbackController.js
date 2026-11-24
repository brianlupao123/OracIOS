// Public anonymous guest feedback (QR entry). No login.
//
// Privacy-minimised by design: ONLY a 1-5 rating and an optional comment are accepted and
// stored. Any other property in the request body (name, email, phone, client, site...) is
// ignored and never persisted; the client IP and user agent are not recorded.
//
// A submission becomes one record in the existing feedback register (client_job_feedbacks)
// tagged source "PUBLIC_QR" with client_id null, so the existing staff triage works
// unchanged. The public answer is only a reference, never the stored record.
import crypto from "node:crypto";
import {
  IDEMPOTENCY_REPLAY_HEADER,
  buildKeyRecord,
  findActiveKey,
  pruneExpiredKeys
} from "../../../idempotency.js";
import { PUBLIC_FEEDBACK_SOURCE } from "../../../services/publicFeedbackPolicy.js";

export const PUBLIC_FEEDBACK_SCOPE = "POST /api/public/feedback";
export const MAX_COMMENT_LENGTH = 1000;

// req.nowMs exists only so tests can fix the clock; a client cannot set it.
const clock = (req) => (typeof req.nowMs === "number" ? req.nowMs : Date.now());

// Control characters other than TAB (09) and LF (0A); CR is dropped so "\r\n" becomes "\n".
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/** Pure validation. Refuses (never truncates) out-of-bounds input. */
export function validatePublicFeedback(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { errors: ["Request body must be a JSON object."], value: null };
  }
  const errors = [];
  const rating = body.rating_stars;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    errors.push("Rating must be a whole number from 1 to 5.");
  }
  let comments = "";
  if (body.comments !== undefined && body.comments !== null) {
    if (typeof body.comments !== "string") errors.push("Comments must be text.");
    else {
      comments = body.comments.replace(CONTROL, "").trim();
      if (comments.length > MAX_COMMENT_LENGTH) {
        errors.push(`Comments must be ${MAX_COMMENT_LENGTH} characters or fewer.`);
        comments = "";
      }
    }
  }
  return errors.length ? { errors, value: null } : { errors, value: { rating_stars: rating, comments } };
}

// Fixed-position array: independent of property order and of ignored properties.
export function feedbackRequestHash(v) {
  return crypto.createHash("sha256").update(JSON.stringify(["feedback.public.v2", v.rating_stars, v.comments])).digest("hex");
}

// POST /public/feedback
export function createPublicFeedback(req, res) {
  const body = req.body;
  // Honeypot: real visitors never fill this hidden field. Non-2xx so nothing is saved for bots.
  if (body && typeof body === "object" && body.website) {
    return res.status(400).json({ success: false, message: "Request rejected." });
  }
  // Without a key a retry after a lost response would save a second record.
  if (!req.idempotencyKey) {
    return res.status(400).json({
      success: false,
      code: "IDEMPOTENCY_KEY_REQUIRED",
      message: "Send an Idempotency-Key header so a retry cannot create a duplicate."
    });
  }
  const { errors, value } = validatePublicFeedback(body);
  if (errors.length) return res.status(400).json({ success: false, message: errors.join(" ") });

  const nowMs = clock(req);
  const key = req.idempotencyKey;
  const requestHash = feedbackRequestHash(value);
  const existing = findActiveKey(req.db, PUBLIC_FEEDBACK_SCOPE, key, nowMs);
  if (existing) {
    if (existing.request_hash !== requestHash) {
      return res.status(409).json({
        success: false,
        code: "IDEMPOTENCY_KEY_CONFLICT",
        message: "This request key belongs to different feedback details."
      });
    }
    res.set(IDEMPOTENCY_REPLAY_HEADER, "true");
    return res.status(existing.status_code).json(existing.response);
  }

  const reference = crypto.randomBytes(4).toString("hex").toUpperCase();
  const lowRating = value.rating_stars <= 3;
  const record = {
    id: req.store.id("fb"),
    reference,
    source: PUBLIC_FEEDBACK_SOURCE,
    client_id: null, // never tied to a client account, so no Client Viewer scope can match it
    client_name: null,
    dispatch_card_id: null,
    equipment_tag_id: null,
    rating_stars: value.rating_stars,
    comments: value.comments,
    triage_required: lowRating,
    triage_status: lowRating ? "PENDING_REVIEW" : "NONE",
    triage_notes: null,
    submitted_by_id: null,
    submitted_by_name: "Anonymous guest",
    submitted_at: new Date(nowMs).toISOString()
  };
  req.db.client_job_feedbacks = req.db.client_job_feedbacks || [];
  req.db.client_job_feedbacks.push(record);

  // Null actor -> "system". Distinct entity/action names on purpose: the existing
  // client-feedback audit actions drive notification text that has not been reviewed
  // for anonymous content. The audit entry omits the comment.
  req.store.audit(req.db, null, "public_feedback", record.id,
    lowRating ? "PUBLIC_FEEDBACK_TRIAGE_REQUIRED" : "PUBLIC_FEEDBACK_SUBMITTED", null,
    { source: PUBLIC_FEEDBACK_SOURCE, rating_stars: record.rating_stars, triage_required: lowRating });

  const response = { success: true, data: { reference } };
  pruneExpiredKeys(req.db, nowMs);
  req.db.idempotency_keys.push(buildKeyRecord({
    scope: PUBLIC_FEEDBACK_SCOPE, key, requestHash, leadId: record.id, statusCode: 201, response, nowMs
  }));
  return res.status(201).json(response);
}
