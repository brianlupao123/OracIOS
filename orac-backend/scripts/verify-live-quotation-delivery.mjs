/**
 * Operational Verification Script: Scoped Quotation-PDF Email Delivery
 *
 * Verifies end-to-end quotation PDF generation and SMTP delivery to an approved allowlist inbox.
 * Enforces:
 *  - Strict recipient allowlist check
 *  - Valid RFC 2045 multipart/mixed attachment transport
 *  - Controlled PDF generation and SHA-256 digest computation
 *  - Zero secret leakage in stdout/logs
 */

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sendEmail, isRecipientPermitted, getTransportConfig } from "../src/services/communicationTransportService.js";
import { generateQuotePdfBuffer } from "../src/services/quotationEmailService.js";

async function main() {
  console.log("=== ORAC Operational Email Delivery Verification ===");

  const config = getTransportConfig();
  console.log(`Transport Mode: ${config.dryRun ? "DRY-RUN (Safe Simulation)" : "LIVE-SMTP (Real Relay)"}`);
  console.log(`SMTP Host:      ${config.host || "(not set)"}`);
  console.log(`SMTP Port:      ${config.port}`);
  console.log(`SMTP Secure:    ${config.secure}`);
  console.log(`SMTP User:      ${config.user || "(not set)"}`);
  console.log(`SMTP From:      ${config.from || "(not set)"}`);
  console.log(`Allowlist:      ${config.allowedRecipients.join(", ")}`);

  const recipient = (process.env.TEST_RECIPIENT || "Lupaobrian98@gmail.com").trim().toLowerCase();
  console.log(`\nTarget Recipient: ${recipient}`);

  if (!isRecipientPermitted(recipient)) {
    console.error(`FAILED: Recipient '${recipient}' is not permitted by CONTROLLED_RECIPIENT_ALLOWLIST.`);
    process.exit(1);
  }

  // Load quote data from db.json
  const dbPath = resolve("data/db.json");
  const db = JSON.parse(readFileSync(dbPath, "utf8"));
  const quote = db.quotes?.[0];
  if (!quote) {
    console.error("FAILED: No quote found in data/db.json");
    process.exit(1);
  }

  console.log(`Generating controlled PDF for quote: ${quote.quote_number || quote.id}...`);
  const pdfBuffer = generateQuotePdfBuffer(db, quote.id);
  const pdfSha256 = crypto.createHash("sha256").update(pdfBuffer).digest("hex");
  const filename = `Quotation-${quote.quote_number || quote.id}.pdf`;

  console.log(`PDF Generated:   ${filename}`);
  console.log(`PDF Byte Length: ${pdfBuffer.length} bytes`);
  console.log(`PDF SHA-256:     ${pdfSha256}`);

  console.log("\nDispatching email via native SMTP transport...");
  const startTime = Date.now();
  const result = await sendEmail({
    to: recipient,
    toName: "Brian Lupao",
    subject: `ORAC Controlled Quotation ${quote.quote_number || quote.id}`,
    body: `Dear Brian Lupao,\r\n\r\nPlease find attached quotation ${quote.quote_number || quote.id} from ORAC Industrial Services for operational verification.\r\n\r\nDocument Hash: ${pdfSha256}\r\n\r\nBest regards,\r\nORAC Commercial Operations`,
    attachments: [{
      filename,
      contentType: "application/pdf",
      content: pdfBuffer
    }]
  });
  const durationMs = Date.now() - startTime;

  console.log("\n=== Delivery Evidence ===");
  console.log(`Mode:            ${result.mode}`);
  console.log(`Success:         ${result.success}`);
  console.log(`Message-ID:      ${result.messageId}`);
  console.log(`SMTP Response:   ${result.response}`);
  console.log(`Envelope From:   ${result.envelope?.from}`);
  console.log(`Envelope To:     ${JSON.stringify(result.envelope?.to)}`);
  console.log(`Duration:        ${durationMs}ms`);
  console.log(`Timestamp:       ${new Date().toISOString()}`);
  console.log("=========================");
}

main().catch((err) => {
  console.error("Verification failed:", err.message);
  process.exit(1);
});
