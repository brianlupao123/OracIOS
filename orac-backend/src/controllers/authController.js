import { generateToken, revokeSessions } from "../middleware/auth.js";
import { config } from "../config.js";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { RESET_TOKEN_TTL_MS, issueResetToken, verifyResetToken, clearResetToken, toPublicUser } from "../accountTokens.js";
import { hasActiveSetupToken, verifySetupToken, clearSetupToken } from "../setupTokens.js";
import { totpRequiredFor } from "../totpPolicy.js";
import { beginTotpChallenge } from "./totpController.js";
import { verifyGoogleIdToken, linkGoogleAccount } from "../services/googleOAuthService.js";
import { recordCommunicationEvidence } from "../services/communicationAuditService.js";
import { getTransportConfig, isRecipientPermitted, sendEmail } from "../services/communicationTransportService.js";

// Compared against when the account does not exist or is inactive, so the work
// done (and the response time) does not reveal whether an email has an account.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), 10);
const INVALID_LOGIN = { success: false, message: "Invalid credentials." };

export const loginDemoUser = async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = req.body.password;
  // A malformed/incomplete stored record must not turn a login attempt into a
  // 500. Treat missing email values as non-matches and continue with the same
  // generic invalid-credentials response.
  const user = req.db.users.find((item) => String(item?.email || "").trim().toLowerCase() === email && item.is_active);

  if (config.requirePassword || password) {
    if (!password) {
      // Decided before any lookup, so it says nothing about whether the account exists.
      return res.status(400).json({ success: false, message: "Password is required." });
    }
    // Asynchronous compare: a synchronous bcrypt call blocks the whole server
    // for its duration, which makes unauthenticated login attempts a cheap way
    // to stall every other user.
    const storedHash = user?.password_hash || DUMMY_PASSWORD_HASH;
    const matches = await bcrypt.compare(String(password), storedHash);
    if (!user || !user.password_hash || !matches) {
      return res.status(401).json(INVALID_LOGIN);
    }
  } else if (!user) {
    // Local development only: no password supplied and none required.
    return res.status(401).json(INVALID_LOGIN);
  }

  if (totpRequiredFor(user)) {
    res.setHeader("Cache-Control", "no-store");
    if (!user.totp?.secret) {
      return res.status(403).json({ success: false, message: "Authenticator enrollment required. Contact an administrator." });
    }
    if (user.totp.locked_until && Date.now() < user.totp.locked_until) {
      return res.status(429).json({ success: false, message: "Too many verification attempts. Please try again later." });
    }
    const challenge = beginTotpChallenge(user);
    req.store.audit(req.db, user, "user", user.id, "TOTP_CHALLENGE_ISSUED", null, { id: user.id });
    return res.json({ success: true, data: challenge });
  }

  const token = generateToken(user);
  res.json({
    success: true,
    data: {
      user: toPublicUser(user),
      token,
      note: "JWT Login successful"
    }
  });
};

export const getMe = (req, res) => {
  const user = req.db.users.find((item) => item.id === req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found." });
  }
  res.json({ success: true, data: toPublicUser(user) });
};

// -- Forgot / Reset Password ------------------------------------------------
// The public response is deliberately independent of account or delivery status.
// The persistence middleware writes the token digest before it sends the response.

function findUserByEmail(req, email) {
  const normalized = String(email || "").trim().toLowerCase();
  return req.db.users.find((u) => String(u?.email || "").trim().toLowerCase() === normalized);
}

function resetPageUrl() {
  try {
    const origin = new URL(process.env.FRONTEND_BASE_URL);
    if (origin.protocol !== "https:" || origin.username || origin.password
      || origin.pathname !== "/" || origin.search || origin.hash) return null;
    return new URL("/reset-password", origin);
  } catch {
    return null;
  }
}

function resetReissueCooldownMs() {
  const seconds = Number(process.env.ORAC_PASSWORD_RESET_REISSUE_COOLDOWN_SECONDS);
  return (Number.isInteger(seconds) && seconds >= 60 && seconds <= RESET_TOKEN_TTL_MS / 1000 ? seconds : 300) * 1000;
}

function handlePasswordResetRequest(req, res, deliver) {
  const email = req.body.email;
  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required." });
  }

  const user = findUserByEmail(req, email);

  // Always respond the same way whether or not the account exists, so this
  // endpoint can't be used to discover which emails have accounts.
  const genericResponse = {
    success: true,
    message: "If that email has an account, its recovery request has been received."
  };

  if (!user || !user.is_active) {
    return res.json(genericResponse);
  }

  const page = process.env.ORAC_PASSWORD_RESET_EMAIL_ENABLED === "true" ? resetPageUrl() : null;
  const transport = page && getTransportConfig();
  if (page && transport.isConfigured && !transport.dryRun && isRecipientPermitted(user.email)
    && typeof req.checkpointWrite === "function") {
    const now = Date.now();
    if (hasActiveSetupToken(user, now)) return res.json(genericResponse);
    const resetExpiry = Number(user.reset_token_expires_at);
    if (user.reset_token && resetExpiry > now
      && now < resetExpiry - RESET_TOKEN_TTL_MS + resetReissueCooldownMs()) {
      return res.json(genericResponse);
    }
    const { token } = issueResetToken(user, now);
    const recipient = user.email;
    page.hash = new URLSearchParams({ email: recipient, token }).toString();
    req.store.audit(req.db, user, "user", user.id, "PASSWORD_RESET_REQUESTED", null, { delivery: "scheduled_after_commit" });
    res.once("finish", () => {
      if (res.statusCode !== 200) return;
      void Promise.resolve().then(() => deliver({
        to: recipient,
        subject: "ORAC password reset",
        body: `Open this link to reset your ORAC password. It expires in 30 minutes and can be used once.\n\n${page.href}\n\nIf you did not request this, you can ignore this email.`
      })).catch(() => {
        // Provider errors may contain message data. Do not log them or retry an uncertain send.
        console.warn("ORAC account recovery mail attempt did not complete.");
      });
    });
    return res.json(genericResponse);
  }

  req.store.audit(req.db, user, "user", user.id, "PASSWORD_RESET_REQUESTED", null, { delivery: "not_configured" });

  try {
    recordCommunicationEvidence({
      entityType: "user",
      entityId: user.id,
      channel: "orac_system_dry_run",
      recipientEmail: user.email,
      recipientName: `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.username || user.email,
      subject: "Password Reset Request",
      notes: "Password reset requested; automated outbound email dispatch unconfigured (pilot security policy).",
      sentAt: new Date().toISOString(),
      recordedBy: user.id,
      status: "failed",
      transportMode: "none",
      templateVersion: "v1",
      failureReason: "Outbound email transport unconfigured in pilot mode.",
      audit: false,
      store: req.store,
      db: req.db
    });
  } catch (_err) {
    // non-fatal evidence recording
  }

  return res.json(genericResponse);
}

export function makePasswordResetRequest(deliver = sendEmail) {
  return (req, res) => handlePasswordResetRequest(req, res, deliver);
}

export const requestPasswordReset = makePasswordResetRequest();

export const resetPassword = (req, res) => {
  const { email, token, new_password } = req.body;

  if (!email || !token || !new_password) {
    return res.status(400).json({ success: false, message: "Email, token, and new password are required." });
  }
  const password = String(new_password);
  if (password.length < 10) {
    return res.status(400).json({ success: false, message: "Password must be at least 10 characters." });
  }
  // bcrypt only uses the first 72 bytes; refuse longer input instead of silently truncating it.
  if (Buffer.byteLength(password) > 72) {
    return res.status(400).json({ success: false, message: "Password must be at most 72 bytes." });
  }

  const user = findUserByEmail(req, email);
  if (!user || !user.is_active || !(verifyResetToken(user, token) || verifySetupToken(user, token))) {
    return res.status(400).json({ success: false, message: "Reset link is invalid or has expired." });
  }

  const before = { id: user.id, email: user.email };
  user.password_hash = bcrypt.hashSync(password, 10);
  // Ends every session issued before this moment (checked in middleware/auth.js).
  user.password_changed_at = new Date().toISOString();
  user.password_changed_by = user.id;
  revokeSessions(user);
  if (user.totp?.challenge) user.totp.challenge = null;
  clearResetToken(user);
  clearSetupToken(user);

  req.store.audit(req.db, user, "user", user.id, "PASSWORD_RESET_COMPLETED", before, { id: user.id, email: user.email });

  return res.json({ success: true, message: "Password updated. You can now sign in." });
};

// -- Google OAuth 2.0 SSO --------------------------------------------------
// POST /auth/google { id_token: "..." }
// Public endpoint (no authMiddleware). Verifies the Google-issued ID token,
// links the Google account to an existing ORAC user, and returns a JWT.
// Self-registration is NOT allowed: the user account must already exist.

export const loginWithGoogle = async (req, res) => {
  const idToken = req.body.id_token;
  if (!idToken) {
    return res.status(400).json({ success: false, message: "id_token is required." });
  }

  let payload;
  try {
    payload = await verifyGoogleIdToken(idToken);
  } catch (err) {
    const status = err.status || 401;
    return res.status(status).json({ success: false, message: err.message });
  }

  let user;
  try {
    user = linkGoogleAccount(req.db, req.store, payload);
  } catch (err) {
    const status = err.status || 403;
    return res.status(status).json({ success: false, message: err.message });
  }

  // TOTP policy still applies — Google SSO does not bypass 2FA.
  if (totpRequiredFor(user)) {
    res.setHeader("Cache-Control", "no-store");
    if (!user.totp?.secret) {
      return res.status(403).json({ success: false, message: "Authenticator enrollment required. Contact an administrator." });
    }
    if (user.totp.locked_until && Date.now() < user.totp.locked_until) {
      return res.status(429).json({ success: false, message: "Too many verification attempts. Please try again later." });
    }
    const challenge = beginTotpChallenge(user);
    req.store.audit(req.db, user, "user", user.id, "TOTP_CHALLENGE_ISSUED", null, { id: user.id, via: "google_sso" });
    return res.json({ success: true, data: challenge });
  }

  const token = generateToken(user);
  req.store.audit(req.db, user, "user", user.id, "GOOGLE_SSO_LOGIN", null, {
    google_sub: payload.sub,
    email: payload.email
  });

  res.json({
    success: true,
    data: {
      user: toPublicUser(user),
      token,
      note: "Google SSO login successful"
    }
  });
};
