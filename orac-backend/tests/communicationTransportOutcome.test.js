import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { sendEmail, markSmtpOutcome } from "../src/services/communicationTransportService.js";

// Reserved .test addresses only; no real mailbox or credential.
describe("SMTP failure outcome tagging (SMTP cannot be rolled back)", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.COMMUNICATIONS_DRY_RUN = "false";
    process.env.CONTROLLED_RECIPIENT_ALLOWLIST = "pilot-a@example.test";
  });
  afterEach(() => { process.env = { ...originalEnv }; });

  it("markSmtpOutcome: a failure after DATA was sent is uncertain; before DATA it is definitive", () => {
    const after = markSmtpOutcome(new Error("x"), { dataSent: true });
    assert.equal(after.outcomeUncertain, true);
    assert.equal(after.smtpStage, "after_data");
    const before = markSmtpOutcome(new Error("x"), { dataSent: false });
    assert.equal(before.outcomeUncertain, false);
    assert.equal(before.smtpStage, "before_data");
  });

  it("refusing plaintext SMTP (no STARTTLS) is tagged definitive and nothing sensitive was sent", async () => {
    const transcript = [];
    const server = net.createServer((socket) => {
      socket.write("220 mock.example.test ESMTP\r\n");
      socket.on("data", (chunk) => {
        for (const line of chunk.toString().split("\r\n").filter(Boolean)) {
          transcript.push(line);
          if (line.startsWith("EHLO")) socket.write("250-mock.example.test\r\n250 AUTH LOGIN\r\n");
        }
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      Object.assign(process.env, {
        SMTP_HOST: "127.0.0.1", SMTP_PORT: String(server.address().port), SMTP_SECURE: "false",
        SMTP_USER: "u", SMTP_PASS: "not-a-real-password", SMTP_FROM: "pilot@example.test"
      });
      await assert.rejects(sendEmail({ to: "pilot-a@example.test", subject: "Q", body: "b" }), (err) => {
        assert.match(err.message, /did not offer STARTTLS/);
        assert.equal(err.outcomeUncertain, false);
        assert.equal(err.smtpStage, "before_data");
        return true;
      });
      assert.ok(!transcript.includes("AUTH LOGIN"));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("connection refused is tagged definitive", async () => {
    const probe = net.createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    Object.assign(process.env, {
      SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), SMTP_SECURE: "false",
      SMTP_USER: "u", SMTP_PASS: "not-a-real-password", SMTP_FROM: "pilot@example.test"
    });
    await assert.rejects(sendEmail({ to: "pilot-a@example.test", subject: "Q", body: "b" }), (err) => {
      assert.equal(err.outcomeUncertain, false);
      return true;
    });
  });

  it("a server that drops the connection before replying is tagged definitive (nothing was sent)", async () => {
    const server = net.createServer((socket) => socket.destroy());
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      Object.assign(process.env, {
        SMTP_HOST: "127.0.0.1", SMTP_PORT: String(server.address().port), SMTP_SECURE: "false",
        SMTP_USER: "u", SMTP_PASS: "not-a-real-password", SMTP_FROM: "pilot@example.test"
      });
      await assert.rejects(sendEmail({ to: "pilot-a@example.test", subject: "Q", body: "b" }), (err) => {
        assert.equal(err.outcomeUncertain, false);
        return true;
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("pre-network refusals keep their HTTP status and carry no uncertainty tag", async () => {
    delete process.env.SMTP_HOST; delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
    await assert.rejects(sendEmail({ to: "pilot-a@example.test", subject: "Q", body: "b" }), (err) => {
      assert.equal(err.status, 503);
      assert.equal(err.outcomeUncertain, undefined);
      return true;
    });
    await assert.rejects(sendEmail({ to: "outsider@example.test", subject: "Q", body: "b" }), { status: 403, code: "RECIPIENT_NOT_ALLOWED" });
  });
});
