/**
 * Local fixture quotation-PDF SMTP probe.
 *
 * Reads data/db.json. A dry run proves PDF/MIME construction only; a live run
 * proves SMTP relay acceptance only. Neither proves the deployed portal,
 * PostgreSQL quotation state, or receipt in the target inbox.
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
import { requireLocalEmailProbe } from "../src/verificationScriptGuards.js";

async function main() {
  console.log("=== ORAC Local Fixture Quotation Email Probe ===");

  const config = getTransportConfig();
  const { fixturePath, quoteId } = requireLocalEmailProbe(process.argv.slice(2), process.env, config.dryRun);
  console.log("Source: explicitly supplied local JSON fixture; not the live PostgreSQL store or portal.");
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

  // Load only the explicitly named local fixture and quotation.
  const dbPath = resolve(fixturePath);
  const db = JSON.parse(readFileSync(dbPath, "utf8"));
  const quote = db.quotes?.find((item) => item.id === quoteId || item.quote_number === quoteId);
  if (!quote) {
    console.error("FAILED: Requested quote not found in the supplied local fixture.");
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

  if (!result.success) throw new Error("The local fixture email probe did not succeed.");
  console.log(config.dryRun ? "\n=== Simulated Transport Result ===" : "\n=== SMTP Relay Acceptance (Inbox Receipt Unverified) ===");
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
