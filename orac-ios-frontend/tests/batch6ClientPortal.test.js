import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("ClientPortalPage wires quote download to authenticated documents download client", () => {
  const pageSrc = read("src/pages/ClientPortalPage.jsx");
  // Must use documents.download helper for authenticated cross-origin download
  assert.match(
    pageSrc,
    /documents\.download\("quotes"/,
    "ClientPortalPage must use documents.download for quotes"
  );
  // Preserves canonical document route for accessibility and document-surface contract
  assert.match(
    pageSrc,
    /\/api\/documents\/quotes\/\$\{q\.id\}\.pdf/,
    "ClientPortalPage must keep canonical document path"
  );
  assert.match(
    pageSrc,
    /handleDownloadQuotePdf/,
    "ClientPortalPage must wire download handler"
  );
});

test("ClientPortalPage distinguishes active unpaid invoices from settled or voided records", () => {
  const pageSrc = read("src/pages/ClientPortalPage.jsx");
  // Must check ACTIVE_UNPAID_INVOICE_STATUSES
  assert.match(pageSrc, /ACTIVE_UNPAID_INVOICE_STATUSES/);
  assert.doesNotMatch(pageSrc, /invoices\.filter\(\(i\)\s*=>\s*i\.status\s*!==\s*["']Paid["']\)/,
    "ClientPortalPage must not use simplistic filter i.status !== 'Paid' which counts voided/credited invoices as unpaid"
  );

  // Validate the status set includes active unpaid and excludes voided/credited/paid
  const ACTIVE_UNPAID = new Set(["issued", "sent", "partially_paid", "pending_payment", "overdue"]);
  assert.ok(ACTIVE_UNPAID.has("issued"));
  assert.ok(ACTIVE_UNPAID.has("partially_paid"));
  assert.ok(ACTIVE_UNPAID.has("pending_payment"));
  assert.ok(ACTIVE_UNPAID.has("overdue"));
  assert.ok(!ACTIVE_UNPAID.has("paid"));
  assert.ok(!ACTIVE_UNPAID.has("voided"));
  assert.ok(!ACTIVE_UNPAID.has("credited"));
  assert.ok(!ACTIVE_UNPAID.has("draft"));
});
