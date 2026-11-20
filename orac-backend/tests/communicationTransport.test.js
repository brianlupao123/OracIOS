import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import {
  isRecipientPermitted,
  getAllowedRecipients,
  getTransportConfig,
  sendEmail,
  buildMimeMessage,
  DEFAULT_CONTROLLED_RECIPIENTS
} from "../src/services/communicationTransportService.js";

describe("Communication Transport Service (Batch 3 - Controlled Pilot)", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    process.env.COMMUNICATIONS_DRY_RUN = "true";
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("permits all default controlled recipients regardless of casing", () => {
    assert.equal(isRecipientPermitted("Lupaobrian98@gmail.com"), true);
    assert.equal(isRecipientPermitted("brianwabwile79@gmail.com"), true);
    assert.equal(isRecipientPermitted("lupaob1@gmail.com"), true);
    assert.equal(isRecipientPermitted("  LUPAOB1@GMAIL.COM  "), true);
  });

  it("strictly refuses any recipient outside the controlled allowlist", () => {
    assert.equal(isRecipientPermitted("attacker@evil.com"), false);
    assert.equal(isRecipientPermitted("admin@competitor.co.zw"), false);
    assert.equal(isRecipientPermitted("random@gmail.com"), false);
    assert.equal(isRecipientPermitted(""), false);
    assert.equal(isRecipientPermitted(null), false);
  });

  it("respects CONTROLLED_RECIPIENT_ALLOWLIST override", () => {
    process.env.CONTROLLED_RECIPIENT_ALLOWLIST = "custom1@orac.test, Custom2@orac.test";
    const allowed = getAllowedRecipients();
    assert.deepEqual(allowed, ["custom1@orac.test", "custom2@orac.test"]);
    assert.equal(isRecipientPermitted("custom1@orac.test"), true);
    assert.equal(isRecipientPermitted("lupaob1@gmail.com"), false);
  });

  it("buildMimeMessage creates valid RFC 5322 formatted message", () => {
    const { messageId, payload } = buildMimeMessage({
      from: "notifications@orac-systems.com",
      to: "lupaob1@gmail.com",
      toName: "Pilot Client",
      subject: "Quotation QT-PILOT-01",
      body: "Hello,\nPlease find quote attached."
    });

    assert.ok(messageId.startsWith("<") && messageId.endsWith("@orac.system>"));
    assert.ok(payload.includes("From: <notifications@orac-systems.com>"));
    assert.ok(payload.includes('To: "Pilot Client" <lupaob1@gmail.com>'));
    assert.ok(payload.includes("Subject: Quotation QT-PILOT-01"));
    assert.ok(payload.includes("Please find quote attached."));
  });

  it("sendEmail refuses unlisted recipient with 403 before any network activity", async () => {
    await assert.rejects(
      async () => {
        await sendEmail({
          to: "stranger@external.com",
          subject: "Test",
          body: "Hello"
        });
      },
      (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, "RECIPIENT_NOT_ALLOWED");
        assert.ok(err.message.includes("outside the controlled pilot allowlist"));
        return true;
      }
    );
  });

  it("sendEmail in dry-run mode returns safe dry-run descriptor", async () => {
    process.env.COMMUNICATIONS_DRY_RUN = "true";
    const result = await sendEmail({
      to: "lupaob1@gmail.com",
      subject: "Pilot Quote",
      body: "Quote details here"
    });

    assert.equal(result.success, true);
    assert.equal(result.mode, "dry-run");
    assert.ok(result.messageId.startsWith("dry_"));
    assert.equal(result.recipient, "lupaob1@gmail.com");
  });

  it("sendEmail in live mode throws 503 if SMTP credentials are missing", async () => {
    process.env.COMMUNICATIONS_DRY_RUN = "false";
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    await assert.rejects(
      async () => {
        await sendEmail({
          to: "lupaob1@gmail.com",
          subject: "Pilot Quote",
          body: "Quote details here"
        });
      },
      (err) => {
        assert.equal(err.status, 503);
        assert.equal(err.code, "SMTP_UNCONFIGURED");
        assert.ok(err.message.includes("SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) are not configured"));
        return true;
      }
    );
  });

  it("sendEmail successfully communicates with a live mock SMTP server", async () => {
    // Spin up an in-process RFC-compliant mock SMTP server
    const serverTranscript = [];

    const server = net.createServer((socket) => {
      socket.write("220 mock.smtp.orac.test ESMTP Service Ready\r\n");
      let dataBuffer = "";
      let inData = false;

      socket.on("data", (chunk) => {
        dataBuffer += chunk.toString();
        const lines = dataBuffer.split("\r\n");
        // Keep remainder
        dataBuffer = lines.pop();

        for (const line of lines) {
          serverTranscript.push(line);
          if (inData) {
            if (line === ".") {
              inData = false;
              socket.write("250 2.0.0 Message accepted for delivery\r\n");
            }
          } else if (line.startsWith("EHLO")) {
            socket.write("250-mock.smtp.orac.test\r\n250 AUTH LOGIN\r\n");
          } else if (line === "AUTH LOGIN") {
            socket.write("334 VXNlcm5hbWU6\r\n"); // "Username:" in base64
          } else if (line === Buffer.from("pilot_user").toString("base64")) {
            socket.write("334 UGFzc3dvcmQ6\r\n"); // "Password:" in base64
          } else if (line === Buffer.from("pilot_pass").toString("base64")) {
            socket.write("235 2.7.0 Authentication successful\r\n");
          } else if (line.startsWith("MAIL FROM:")) {
            socket.write("250 2.1.0 Sender OK\r\n");
          } else if (line.startsWith("RCPT TO:")) {
            socket.write("250 2.1.5 Recipient OK\r\n");
          } else if (line === "DATA") {
            inData = true;
            socket.write("354 Start mail input; end with <CRLF>.<CRLF>\r\n");
          } else if (line === "QUIT") {
            socket.write("221 2.0.0 Service closing transmission channel\r\n");
            socket.end();
          }
        }
      });
    });

    await new Promise((res) => server.listen(0, "127.0.0.1", res));
    const port = server.address().port;

    try {
      process.env.COMMUNICATIONS_DRY_RUN = "false";
      process.env.SMTP_HOST = "127.0.0.1";
      process.env.SMTP_PORT = String(port);
      process.env.SMTP_SECURE = "false";
      process.env.SMTP_USER = "pilot_user";
      process.env.SMTP_PASS = "pilot_pass";
      process.env.SMTP_FROM = "pilot@orac-systems.com";

      const result = await sendEmail({
        to: "Lupaobrian98@gmail.com",
        toName: "Brian Lupao",
        subject: "Pilot Verification Email",
        body: "This is a real SMTP conversation test."
      });

      assert.equal(result.success, true);
      assert.equal(result.mode, "live-smtp");
      assert.equal(result.recipient, "Lupaobrian98@gmail.com");

      // Allow tick for mock server to process QUIT command
      await new Promise((r) => setTimeout(r, 20));

      // Verify the SMTP server received the full protocol sequence
      assert.ok(serverTranscript.some((l) => l.startsWith("EHLO")));
      assert.ok(serverTranscript.includes("AUTH LOGIN"));
      assert.ok(serverTranscript.includes("MAIL FROM:<pilot@orac-systems.com>"));
      assert.ok(serverTranscript.includes("RCPT TO:<Lupaobrian98@gmail.com>"));
      assert.ok(serverTranscript.includes("DATA"));
      assert.ok(serverTranscript.some((l) => l.includes("This is a real SMTP conversation test.")));
      assert.ok(serverTranscript.includes("."));
      assert.ok(serverTranscript.includes("QUIT"));
    } finally {
      await new Promise((res) => server.close(res));
    }
  });
});
