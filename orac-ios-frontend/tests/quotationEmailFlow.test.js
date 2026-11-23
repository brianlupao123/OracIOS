import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { submitQuotationEmail } from "../src/quotationEmailFlow.js";

// Polyfill import.meta.env and localStorage for testing client.js in Node.js
const clientSource = readFileSync(new URL("../src/api/client.js", import.meta.url), "utf8")
  .replaceAll("import.meta.env", "globalThis.__ORAC_TEST_ENV__");
globalThis.__ORAC_TEST_ENV__ = { PROD: false, VITE_API_BASE_URL: "http://api.test" };
globalThis.localStorage = {
  getItem: () => "mock-jwt-token",
  setItem: () => {},
  removeItem: () => {}
};

const { communications } = await import(`data:text/javascript;base64,${Buffer.from(clientSource).toString("base64")}`);

describe("Quotation Direct Email Flow Frontend Integration", () => {
  it("communications exports sendQuotationPdf", () => {
    assert.equal(typeof communications.sendQuotationPdf, "function");
  });

  it("sendQuotationPdf posts to /communications/send-quotation-pdf with JSON body", async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify({
          success: true,
          data: {
            success: true,
            mode: "live-smtp",
            messageId: "msg_test_123",
            recipient: "lupaobrian98@gmail.com",
            quoteNumber: "FX-Q-001",
            pdfFilename: "Quotation-FX-Q-001.pdf",
            pdfSha256: "abc123hash"
          }
        })
      };
    };

    try {
      const payload = {
        quote_id: "fx_q_001",
        recipient_email: "lupaobrian98@gmail.com",
        recipient_name: "Brian Lupao",
        subject: "ORAC Quotation FX-Q-001",
        body: "Please find attached quotation."
      };
      const res = await communications.sendQuotationPdf(payload);
      assert.equal(res.success, true);
      assert.equal(res.mode, "live-smtp");
      assert.equal(res.messageId, "msg_test_123");
      assert.equal(calls.length, 1);
      assert.ok(calls[0].url.includes("/communications/send-quotation-pdf"));
      assert.equal(calls[0].opts.method, "POST");
      const sentBody = JSON.parse(calls[0].opts.body);
      assert.deepEqual(sentBody, payload);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("sendQuotationPdf handles 403 RECIPIENT_NOT_ALLOWED without silent swallowed failure", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      return {
        ok: false,
        status: 403,
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify({
          success: false,
          code: "RECIPIENT_NOT_ALLOWED",
          message: "Safety Refusal: Recipient 'unlisted@outside.invalid' is outside the controlled pilot allowlist."
        })
      };
    };

    try {
      await assert.rejects(
        async () => {
          await communications.sendQuotationPdf({
            quote_id: "fx_q_001",
            recipient_email: "unlisted@outside.invalid"
          });
        },
        (err) => {
          assert.equal(err.status, 403);
          assert.equal(err.code, "RECIPIENT_NOT_ALLOWED");
          assert.ok(err.message.includes("outside the controlled pilot allowlist"));
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("dry-run and invalid results never advance the quotation", async () => {
    const pending = new Map();
    const payload = { quote_id: "q1" };
    const markSent = () => assert.fail("No confirmed live acceptance");
    const dryRun = { mode: "dry-run", status: "dry_run" };
    assert.equal(await submitQuotationEmail({ payload, pending, send: async () => dryRun, markSent }), dryRun);
    for (const outcome of [undefined, { mode: "live-smtp" }, { mode: "live-smtp", status: "send_uncertain" }]) {
      await assert.rejects(
        submitQuotationEmail({ payload, pending, send: async () => outcome, markSent }),
        /no confirmed send result/
      );
    }
    await assert.rejects(submitQuotationEmail({
      payload, pending, markSent, send: async () => { throw new Error("SMTP unavailable"); }
    }), /SMTP unavailable/);
    assert.equal(pending.size, 0);
  });

  it("after live acceptance a failed status save retries only the transition", async () => {
    const pending = new Map();
    const accepted = { mode: "live-smtp", status: "accepted", evidenceId: "e1" };
    let sends = 0;
    let writes = 0;
    const operation = {
      payload: { quote_id: "q1" }, pending,
      send: async () => { sends += 1; return accepted; },
      markSent: async (id) => {
        assert.equal(id, "q1");
        writes += 1;
        if (writes === 1) throw new Error("Write failed");
      }
    };
    await assert.rejects(submitQuotationEmail(operation), /without sending another email/);
    assert.equal(pending.get("q1"), accepted);
    assert.equal(await submitQuotationEmail(operation), accepted);
    assert.equal(sends, 1);
    assert.equal(writes, 2);
    assert.equal(pending.size, 0);
  });
});
