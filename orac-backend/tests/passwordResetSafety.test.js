import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { makePasswordResetRequest, requestPasswordReset, resetPassword } from "../src/controllers/authController.js";
import { RESET_TOKEN_TTL_MS, issueResetToken, verifyResetToken } from "../src/accountTokens.js";
import { issueSetupToken, verifySetupToken } from "../src/setupTokens.js";

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function requestFor(email) {
  const auditEvents = [];
  const db = {
    users: [{ id: "user-1", email: "person@example.test", is_active: true, password_hash: "hash" }]
  };
  const req = {
    body: { email },
    db,
    store: {
      audit(_db, _actor, _entity, _id, action, before, after) {
        auditEvents.push({ action, before, after });
      }
    }
  };
  return { req, db, auditEvents };
}

test("password reset requests are generic and do not create or expose reset tokens without delivery", () => {
  const known = requestFor("person@example.test");
  const knownResponse = response();
  requestPasswordReset(known.req, knownResponse);

  const unknown = requestFor("missing@example.test");
  const unknownResponse = response();
  requestPasswordReset(unknown.req, unknownResponse);

  assert.deepEqual(knownResponse.body, unknownResponse.body);
  assert.equal(known.db.users[0].reset_token, undefined);
  assert.equal(known.db.users[0].reset_token_expires_at, undefined);
  assert.deepEqual(known.auditEvents, [{
    action: "PASSWORD_RESET_REQUESTED",
    before: null,
    after: { delivery: "not_configured" }
  }]);
  assert.equal(JSON.stringify(known.auditEvents).includes("token"), false);
  assert.equal(JSON.stringify(known.auditEvents).includes("reset-password"), false);
});

test("reset completion rejects an unissued token", () => {
  const { req } = requestFor("person@example.test");
  req.body = { email: "person@example.test", token: "unissued", new_password: "long-enough-password" };
  const res = response();
  resetPassword(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /invalid or has expired/);
});

test("live reset schedules one allowlisted link after response, while keeping the public response generic", async (t) => {
  const env = {
    ORAC_PASSWORD_RESET_EMAIL_ENABLED: "true",
    ORAC_PASSWORD_RESET_REISSUE_COOLDOWN_SECONDS: "300",
    FRONTEND_BASE_URL: "https://portal.example.test",
    COMMUNICATIONS_DRY_RUN: "false",
    CONTROLLED_RECIPIENT_ALLOWLIST: "person@example.test",
    SMTP_HOST: "smtp.example.test",
    SMTP_USER: "sender@example.test",
    SMTP_PASS: "test-fixture"
  };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  const sent = [];
  const requestReset = makePasswordResetRequest(async (message) => sent.push(message));
  function submit(context) {
    const res = Object.assign(new EventEmitter(), response());
    context.req.checkpointWrite = async () => { throw new Error("unexpected explicit checkpoint"); };
    requestReset(context.req, res);
    return res;
  }
  const known = requestFor("person@example.test");
  const first = submit(known);
  const duplicate = submit(known);
  const unknown = submit(requestFor("missing@example.test"));
  const blocked = requestFor("blocked@example.test");
  blocked.db.users[0].email = "blocked@example.test";
  const blockedResponse = submit(blocked);
  assert.deepEqual(first.body, unknown.body);
  assert.deepEqual(first.body, blockedResponse.body);
  assert.equal(blocked.db.users[0].reset_token, undefined);
  assert.equal(sent.length, 0);
  assert.match(known.db.users[0].reset_token, /^sha256:/);
  for (const res of [first, duplicate, unknown, blockedResponse]) res.emit("finish");
  await new Promise(setImmediate);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "person@example.test");
  const link = new URL(sent[0].body.match(/https:\/\/[^\s]+/)[0]);
  assert.equal(link.origin, "https://portal.example.test");
  assert.equal(link.pathname, "/reset-password");
  const query = new URLSearchParams(link.hash.slice(1));
  const token = query.get("token");
  assert.ok(token && !JSON.stringify(known.auditEvents).includes(token));
  known.req.body = { email: query.get("email"), token, new_password: "long-enough-password" };
  const completed = response();
  resetPassword(known.req, completed);
  assert.equal(completed.statusCode, 200);
  const used = response();
  resetPassword(known.req, used);
  assert.equal(used.statusCode, 400);

  const pending = requestFor("person@example.test");
  const pendingUser = pending.db.users[0];
  const setup = issueSetupToken(pendingUser);
  const pendingRes = submit(pending);
  pendingRes.emit("finish");
  await new Promise(setImmediate);
  assert.deepEqual(pendingRes.body, first.body);
  assert.equal(sent.length, 1, "do not send self-service reset while an Admin setup link is pending");
  assert.equal(pendingUser.setup_token_expires_at, setup.expiresAt);
  assert.equal(verifySetupToken(pendingUser, setup.token), true);

  const past = requestFor("person@example.test");
  const pastUser = past.db.users[0];
  const expiredSetup = issueSetupToken(pastUser, Date.now() - 2 * RESET_TOKEN_TTL_MS);
  // Simulate a record written before the separate setup expiry existed.
  pastUser.reset_token_expires_at = pastUser.setup_token_expires_at;
  delete pastUser.setup_token_expires_at;
  const afterExpiry = submit(past);
  afterExpiry.emit("finish");
  await new Promise(setImmediate);
  assert.equal(sent.length, 2);
  assert.equal(pastUser.setup_token_expires_at, expiredSetup.expiresAt);
  assert.equal(verifySetupToken(pastUser, expiredSetup.token), false);

  const lost = requestFor("person@example.test");
  const lostUser = lost.db.users[0];
  const lostReset = issueResetToken(lostUser, Date.now() - 6 * 60 * 1000);
  const retry = submit(lost);
  retry.emit("finish");
  await new Promise(setImmediate);
  assert.equal(sent.length, 3, "a new request after cooldown can replace a lost send");
  assert.equal(verifyResetToken(lostUser, lostReset.token), false);
  const replacedLink = new URL(sent[2].body.match(/https:\/\/[^\s]+/)[0]);
  const replacementToken = new URLSearchParams(replacedLink.hash.slice(1)).get("token");
  assert.equal(verifyResetToken(lostUser, replacementToken), true);
});
