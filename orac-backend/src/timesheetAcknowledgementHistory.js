// backend/src/timesheetAcknowledgementHistory.js
//
// Shared implementation for Batch C Commit 3 client acknowledgement history.
// Provides deterministic canonical JSON hashing, hash chaining, and safe
// allowlisting for Client Viewer responses.

import { createHash } from "node:crypto";

/**
 * Deterministic recursive JSON stringification.
 * Keys at all object levels are sorted alphabetically.
 * 'content_hash' is excluded from hashing.
 */
export function canonicalJson(val) {
  if (val === null || typeof val !== "object") {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return "[" + val.map(canonicalJson).join(",") + "]";
  }
  const keys = Object.keys(val).filter((k) => k !== "content_hash").sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(val[k])).join(",") + "}";
}

/**
 * Compute SHA-256 hash over deterministic canonical JSON representation of the entry.
 */
export function computeContentHash(entry) {
  const canonical = canonicalJson(entry);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Append an immutable entry to worksheet acknowledgement history with hash chaining.
 */
export function appendHistoryEntry(worksheet, entry) {
  const history = worksheet.acknowledgement_history || [];
  entry.prior_hash = history.length > 0 ? history[history.length - 1].content_hash : null;
  entry.content_hash = computeContentHash(entry);
  worksheet.acknowledgement_history = [...history, entry];
}

/**
 * Allowlist safe fields for Client Viewer response.
 * Never exposes rates, billing, payroll, or internal database metadata.
 */
export function sanitizeHistoryForClient(entry) {
  return {
    id: entry.id,
    kind: entry.kind,
    signer_name: entry.signer_name || null,
    signer_role: entry.signer_role || null,
    timestamp: entry.timestamp,
    evidence_reference: entry.evidence_reference || null,
    return_reason: entry.return_reason || null,
    supersession_reason: entry.supersession_reason || null,
    superseded_by: entry.superseded_by || null,
    content_hash: entry.content_hash,
    prior_hash: entry.prior_hash || null
  };
}
