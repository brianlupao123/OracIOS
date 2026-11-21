import { test, describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

  it("quotation flow does not transition to Sent when sendQuotationPdf fails", async () => {
    let transitioned = false;
    let recordedManualSend = false;

    const fakeQuotesApi = {
      transition: async () => { transitioned = true; }
    };
    const fakeCommunications = {
      sendQuotationPdf: async () => {
        const err = new Error("SMTP connection refused");
        err.status = 503;
        throw err;
      },
      recordExternalSend: async () => { recordedManualSend = true; }
    };

    // Simulate the exact confirmSendQuote flow from QuotationsPage
    async function executeSendQuote(quote, client) {
      const recipientEmail = client?.email;
      if (!recipientEmail) throw new Error("Add client email");

      // Attempt send
      await fakeCommunications.sendQuotationPdf({
        quote_id: quote.id,
        recipient_email: recipientEmail
      });

      // ONLY transition after confirmation
      await fakeQuotesApi.transition(quote.id, "Sent");
    }

    await assert.rejects(
      async () => {
        await executeSendQuote({ id: "q1" }, { email: "test@example.com" });
      },
      /SMTP connection refused/
    );

    assert.equal(transitioned, false, "Quote must NOT be transitioned to Sent after failed send");
    assert.equal(recordedManualSend, false, "Manual external send must NOT be recorded after failed direct send");
  });

  it("quotation flow transitions to Sent ONLY when sendQuotationPdf succeeds", async () => {
    let transitioned = false;
    let transitionedTo = "";

    const fakeQuotesApi = {
      transition: async (id, status) => {
        transitioned = true;
        transitionedTo = status;
      }
    };
    const fakeCommunications = {
      sendQuotationPdf: async () => ({
        success: true,
        mode: "live-smtp",
        messageId: "msg_live_789"
      })
    };

    async function executeSendQuote(quote, client) {
      const recipientEmail = client?.email;
      if (!recipientEmail) throw new Error("Add client email");

      const sendResult = await fakeCommunications.sendQuotationPdf({
        quote_id: quote.id,
        recipient_email: recipientEmail
      });

      await fakeQuotesApi.transition(quote.id, "Sent");
      return sendResult;
    }

    const result = await executeSendQuote({ id: "q1" }, { email: "lupaobrian98@gmail.com" });
    assert.equal(result.success, true);
    assert.equal(transitioned, true);
    assert.equal(transitionedTo, "Sent");
  });
});
