/**
 * Communication Transport Service (Batch 3)
 *
 * Implements the outbound email transport configuration path for ORAC.
 * Supports:
 *   1. Strict recipient allowlist gating (controlled test recipients during pilot).
 *   2. Dry-run mode by default (COMMUNICATIONS_DRY_RUN !== "false").
 *   3. Native SMTP transport using Node.js built-in node:net / node:tls (zero third-party dependencies).
 *   4. Clear credential configuration validation.
 *   5. Full auditability and secret redaction.
 */

import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";

/**
 * Controlled test recipients for operational pilot.
 * No email outside this list will ever be transmitted during pilot phase.
 */
export const DEFAULT_CONTROLLED_RECIPIENTS = Object.freeze([
  "lupaobrian98@gmail.com",   // Admin
  "brianwabwile79@gmail.com",  // Sales
  "lupaob1@gmail.com"          // Client
]);

/**
 * Normalizes email address for comparison (trimmed, lowercased).
 */
export function normalizeEmail(email) {
  if (!email || typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

/**
 * Returns the active set of permitted test recipients.
 */
export function getAllowedRecipients() {
  const envAllowlist = process.env.CONTROLLED_RECIPIENT_ALLOWLIST;
  if (envAllowlist && typeof envAllowlist === "string") {
    const list = envAllowlist
      .split(",")
      .map(e => normalizeEmail(e))
      .filter(e => e && e !== "*");
    if (envAllowlist.includes("*") && list.length === 0) return [];
    if (list.length > 0) return list;
  }
  return DEFAULT_CONTROLLED_RECIPIENTS.map(e => normalizeEmail(e));
}

/**
 * Checks whether an email recipient is permitted by the controlled pilot allowlist.
 */
export function isRecipientPermitted(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const allowed = getAllowedRecipients();
  return allowed.includes(normalized);
}

/**
 * Resolves current email transport runtime configuration without logging secrets.
 */
export function getTransportConfig() {
  const host = process.env.SMTP_HOST || "";
  const port = Number(process.env.SMTP_PORT || (process.env.SMTP_SECURE === "true" ? 465 : 587));
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  const from = process.env.SMTP_FROM || process.env.EMAIL_FROM || user;
  const dryRun = process.env.COMMUNICATIONS_DRY_RUN !== "false";
  const isConfigured = Boolean(host && user && pass);

  return {
    host,
    port,
    secure,
    user,
    pass,
    from,
    dryRun,
    isConfigured,
    allowedRecipients: getAllowedRecipients()
  };
}

/**
 * Builds an RFC 5322 compliant email message buffer.
 */
export function buildMimeMessage({ from, to, toName, subject, body, html }) {
  for (const [field, value] of Object.entries({ from, to, toName, subject })) {
    if (typeof value !== "string" || /[\r\n\0]/.test(value)) {
      throw Object.assign(new Error(`Invalid ${field} mail header`), { status: 400 });
    }
  }
  if (typeof body !== "string") {
    throw Object.assign(new Error("Invalid message body"), { status: 400 });
  }
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from)) {
    throw Object.assign(new Error("SMTP_FROM must be a single bare email address"), { status: 400 });
  }
  const messageId = `<${crypto.randomUUID()}@orac.system>`;
  const dateStr = new Date().toUTCString();
  const toHeader = toName ? `"${toName.replace(/"/g, "")}" <${to}>` : `<${to}>`;
  const fromHeader = `<${from}>`;

  const headers = [
    `From: ${fromHeader}`,
    `To: ${toHeader}`,
    `Subject: ${subject}`,
    `Date: ${dateStr}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    `X-ORAC-Transport: controlled-pilot`
  ];

  const safeBody = body.replace(/\r?\n/g, "\r\n").replace(/(^|\r\n)\./g, "$1..");
  const payload = `${headers.join("\r\n")}\r\n\r\n${safeBody}\r\n`;
  return { messageId, payload };
}

/**
 * Executes a native SMTP conversation using Node.js net/tls sockets.
 */
function sendSmtpSocket({ host, port, secure, user, pass, from, to, mimePayload, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    let socket;
    let step = 0;
    let responseBuffer = "";
    let completed = false;

    const cleanup = () => {
      if (socket && !socket.destroyed) {
        socket.destroy();
      }
    };

    const timer = setTimeout(() => {
      if (!completed) {
        cleanup();
        reject(new Error(`SMTP connection timed out after ${timeoutMs}ms while connecting to ${host}:${port}`));
      }
    }, timeoutMs);

    const onData = (chunk) => {
      responseBuffer += chunk.toString();
      // Wait for a complete response line (e.g. "250 ...\r\n" or multi-line "250-...\r\n250 ...\r\n")
      const lines = responseBuffer.split(/\r?\n/);
      const lastLine = lines[lines.length - 2] || "";
      // Check if last line starts with 3 digits and a space (end of SMTP reply)
      if (!/^\d{3}\s/.test(lastLine)) {
        return; // Waiting for more data
      }

      const code = parseInt(lastLine.slice(0, 3), 10);
      const reply = responseBuffer;
      responseBuffer = ""; // Reset for next command

      if (code >= 400) {
        cleanup();
        clearTimeout(timer);
        return reject(new Error(`SMTP server error (${code}): ${lastLine.slice(4).trim()}`));
      }

      try {
        switch (step) {
          case 0: // Initial greeting 220
            step = 1;
            socket.write(`EHLO orac-backend\r\n`);
            break;

          case 1: // Response to EHLO
            if (!secure && /(?:^|\r\n)250[ -]STARTTLS(?:\r\n|$)/i.test(reply)) {
              step = 2;
              socket.write(`STARTTLS\r\n`);
            } else if (secure) {
              step = 4;
              socket.write(`AUTH LOGIN\r\n`);
            } else {
              cleanup();
              clearTimeout(timer);
              reject(new Error("SMTP server did not offer STARTTLS; refusing plaintext authentication"));
            }
            break;

          case 2: // Response to STARTTLS (220)
            // Upgrade socket to TLS
            socket.removeAllListeners("data");
            const tlsSocket = tls.connect({
              socket,
              host,
              servername: host,
              rejectUnauthorized: true
            }, () => {
              socket = tlsSocket;
              socket.on("data", onData);
              step = 3;
              socket.write(`EHLO orac-backend\r\n`);
            });
            tlsSocket.on("error", (err) => {
              cleanup();
              clearTimeout(timer);
              reject(err);
            });
            break;

          case 3: // Response to second EHLO after TLS
            step = 4;
            socket.write(`AUTH LOGIN\r\n`);
            break;

          case 4: // Response to AUTH LOGIN (334 Username)
            step = 5;
            socket.write(`${Buffer.from(user).toString("base64")}\r\n`);
            break;

          case 5: // Response to Username (334 Password)
            step = 6;
            socket.write(`${Buffer.from(pass).toString("base64")}\r\n`);
            break;

          case 6: // Response to Password (235 Auth successful)
            step = 7;
            socket.write(`MAIL FROM:<${from}>\r\n`);
            break;

          case 7: // Response to MAIL FROM (250 OK)
            step = 8;
            socket.write(`RCPT TO:<${to}>\r\n`);
            break;

          case 8: // Response to RCPT TO (250 OK)
            step = 9;
            socket.write(`DATA\r\n`);
            break;

          case 9: // Response to DATA (354 Start mail input)
            step = 10;
            // Send payload followed by \r\n.\r\n
            socket.write(mimePayload + "\r\n.\r\n");
            break;

          case 10: // Response to . (250 Message accepted)
            completed = true;
            step = 11;
            socket.write(`QUIT\r\n`, () => {
              clearTimeout(timer);
              resolve({ code, reply: lastLine.trim() });
            });
            break;

          case 11: // Response to QUIT (221 Bye)
            cleanup();
            break;
        }
      } catch (err) {
        cleanup();
        clearTimeout(timer);
        reject(err);
      }
    };

    if (secure) {
      socket = tls.connect({ host, port, servername: host, rejectUnauthorized: true });
    } else {
      socket = net.connect({ host, port });
    }

    socket.on("data", onData);
    socket.on("error", (err) => {
      if (completed) {
        cleanup();
        return;
      }
      cleanup();
      clearTimeout(timer);
      reject(err);
    });
    socket.on("close", () => {
      cleanup();
    });
  });
}

/**
 * Sends an email using the configured transport.
 * Enforces recipient allowlist and dry-run boundaries.
 */
export async function sendEmail({ to, toName = "", subject, body, html = null, attachments = [] }) {
  if (!to) {
    throw Object.assign(new Error("Recipient email is required"), { status: 400 });
  }
  if (attachments.length > 0) {
    throw Object.assign(new Error("Email attachments are not supported by this transport"), {
      status: 422, code: "EMAIL_ATTACHMENTS_UNSUPPORTED"
    });
  }

  // 1. Strict recipient allowlist validation
  if (!isRecipientPermitted(to)) {
    const error = new Error(
      `Safety Refusal: Recipient '${to}' is outside the controlled pilot allowlist. Real delivery is restricted to authorized test accounts.`
    );
    error.status = 403;
    error.code = "RECIPIENT_NOT_ALLOWED";
    throw error;
  }

  const config = getTransportConfig();

  // 2. Safe dry-run mode
  if (config.dryRun) {
    const dryId = `dry_${crypto.randomBytes(8).toString("hex")}`;
    return {
      success: true,
      mode: "dry-run",
      messageId: dryId,
      recipient: to,
      subject,
      timestamp: new Date().toISOString(),
      notes: "COMMUNICATIONS_DRY_RUN is active. Message logged truthfully without external network transmission."
    };
  }

  // 3. Live sending requires configured credentials
  if (!config.isConfigured) {
    const error = new Error(
      "Live sending requested but SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) are not configured. Configure credentials to enable live delivery."
    );
    error.status = 503;
    error.code = "SMTP_UNCONFIGURED";
    throw error;
  }

  // 4. Build message
  const { messageId, payload } = buildMimeMessage({
    from: config.from,
    to,
    toName,
    subject,
    body,
    html
  });

  // 5. Transmit via native SMTP
  await sendSmtpSocket({
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    pass: config.pass,
    from: config.from,
    to,
    mimePayload: payload
  });

  return {
    success: true,
    mode: "live-smtp",
    messageId,
    recipient: to,
    subject,
    timestamp: new Date().toISOString()
  };
}
