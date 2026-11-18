// Google OAuth 2.0 ID-token verification service.
//
// Verifies Google-issued ID tokens WITHOUT adding a dependency:
//   - In production: fetches Google's public certs and verifies the JWT
//     signature + claims locally using Node's native crypto.
//   - Falls back to Google's tokeninfo endpoint when JWKS fetch fails.
//
// Environment: GOOGLE_CLIENT_ID (required when SSO is enabled).
//
// The service is a pure function layer: no Express, no DB, no side-effects.
// The controller handles user creation/linking.

import { config } from "../config.js";
import crypto from "node:crypto";

// ── Google JWKS certs cache ───────────────────────────────────────────────
let cachedCerts = null;
let certsExpireAt = 0;

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

// ── Helpers ───────────────────────────────────────────────────────────────

function base64urlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

function decodeJwtParts(idToken) {
  const parts = String(idToken).split(".");
  if (parts.length !== 3) throw Object.assign(new Error("Malformed ID token."), { status: 400 });
  const header = JSON.parse(base64urlDecode(parts[0]).toString("utf8"));
  const payload = JSON.parse(base64urlDecode(parts[1]).toString("utf8"));
  return { header, payload, signedContent: `${parts[0]}.${parts[1]}`, signature: parts[2] };
}

// ── JWKS fetch ────────────────────────────────────────────────────────────

async function fetchGoogleCerts() {
  const now = Date.now();
  if (cachedCerts && now < certsExpireAt) return cachedCerts;

  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) throw new Error(`Google JWKS fetch failed: ${res.status}`);

  const cacheControl = res.headers.get("cache-control") || "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const ttl = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 3600_000;

  const { keys } = await res.json();
  const certMap = {};
  for (const key of keys) {
    if (key.kty === "RSA" && key.use === "sig") {
      // Build PEM from JWK n/e
      const pubKey = crypto.createPublicKey({ key, format: "jwk" });
      certMap[key.kid] = pubKey;
    }
  }
  cachedCerts = certMap;
  certsExpireAt = now + ttl;
  return certMap;
}

// ── Local JWT verification (preferred) ────────────────────────────────────

async function verifyIdTokenLocal(idToken, clientId) {
  const { header, payload, signedContent, signature } = decodeJwtParts(idToken);

  if (header.alg !== "RS256") throw Object.assign(new Error("Unsupported algorithm."), { status: 400 });

  const certs = await fetchGoogleCerts();
  const pubKey = certs[header.kid];
  if (!pubKey) throw Object.assign(new Error("Unknown signing key."), { status: 401 });

  const isValid = crypto.verify(
    "sha256",
    Buffer.from(signedContent),
    pubKey,
    base64urlDecode(signature)
  );
  if (!isValid) throw Object.assign(new Error("Invalid token signature."), { status: 401 });

  validateClaims(payload, clientId);
  return payload;
}

// ── Tokeninfo fallback ───────────────────────────────────────────────────

async function verifyIdTokenRemote(idToken, clientId) {
  const res = await fetch(`${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`);
  if (!res.ok) throw Object.assign(new Error("Google token verification failed."), { status: 401 });
  const payload = await res.json();
  validateClaims(payload, clientId);
  return payload;
}

// ── Shared claim checks ──────────────────────────────────────────────────

function validateClaims(payload, clientId) {
  const now = Math.floor(Date.now() / 1000);

  if (!GOOGLE_ISSUERS.includes(payload.iss)) {
    throw Object.assign(new Error("Invalid token issuer."), { status: 401 });
  }

  if (payload.aud !== clientId) {
    throw Object.assign(new Error("Token audience mismatch."), { status: 401 });
  }

  // Allow 60 s clock skew.
  if (typeof payload.exp === "number" && payload.exp + 60 < now) {
    throw Object.assign(new Error("Token has expired."), { status: 401 });
  }

  if (!payload.email || !payload.email_verified) {
    throw Object.assign(new Error("Email not verified by Google."), { status: 401 });
  }
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Verify a Google ID token and return the parsed payload.
 *
 * @param {string} idToken  — raw JWT from the Google Sign-In client
 * @returns {Promise<{email: string, name: string, sub: string, picture?: string}>}
 */
export async function verifyGoogleIdToken(idToken) {
  if (!idToken || typeof idToken !== "string") {
    throw Object.assign(new Error("ID token is required."), { status: 400 });
  }

  const clientId = config.googleClientId;
  if (!clientId) {
    throw Object.assign(new Error("Google SSO is not configured."), { status: 503 });
  }

  try {
    return await verifyIdTokenLocal(idToken, clientId);
  } catch (localErr) {
    // Network issues fetching JWKS — fall back to tokeninfo.
    if (localErr.status) throw localErr; // Claim validation failures should not fall through.
    return await verifyIdTokenRemote(idToken, clientId);
  }
}

/**
 * Find or create an ORAC user from a verified Google payload.
 *
 * Rules:
 *  1. If a user with matching email exists → link google_sub, return user.
 *  2. If no user exists → reject (Admin must pre-create the account).
 *     Self-registration via SSO would bypass the access-request workflow.
 *
 * @param {object} db        — req.db (the JSON store / postgres rows)
 * @param {object} store     — req.store (audit helper)
 * @param {object} payload   — verified Google token payload
 * @returns {object} user record
 */
export function linkGoogleAccount(db, store, payload) {
  const email = String(payload.email).trim().toLowerCase();
  const user = db.users.find(
    (u) => String(u?.email || "").trim().toLowerCase() === email && u.is_active
  );

  if (!user) {
    throw Object.assign(
      new Error("No ORAC account exists for this email. Ask an administrator to create your account first."),
      { status: 403 }
    );
  }

  // Link Google sub if not already linked.
  if (!user.google_sub || user.google_sub !== payload.sub) {
    const before = { google_sub: user.google_sub || null };
    user.google_sub = payload.sub;
    if (payload.picture && !user.avatar_url) user.avatar_url = payload.picture;
    store.audit(db, user, "user", user.id, "GOOGLE_ACCOUNT_LINKED", before, {
      google_sub: payload.sub,
      email
    });
  }

  return user;
}

// ── Testing helpers (not for production use) ─────────────────────────────

export function _resetCertsCache() {
  cachedCerts = null;
  certsExpireAt = 0;
}

export { GOOGLE_ISSUERS, validateClaims, decodeJwtParts };
