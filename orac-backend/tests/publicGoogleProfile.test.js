import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import express from "express";

test("public Google profile returns contact fields only and rejects invalid credentials and origins", async (t) => {
  const origin = "https://public.example.test";
  const audience = "public-client.apps.googleusercontent.com";
  const staffAudience = "staff-client.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_ID = staffAudience;
  process.env.PUBLIC_GOOGLE_CLIENT_ID = audience;
  process.env.PUBLIC_GOOGLE_ALLOWED_ORIGINS = origin;
  const { createPublicEndpointLimits } = await import("../src/middleware/rateLimit.js");
  const { default: publicRoutes } = await import("../src/modules/public/routes.js");
  const { verifyGoogleIdToken } = await import("../src/services/googleOAuthService.js");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: "https://accounts.google.com", aud: audience, exp: now + 300,
    sub: "google-test-subject", name: "Public Visitor", email: "visitor@example.test",
    email_verified: true, picture: "https://example.test/avatar"
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  function token(overrides = {}, validSignature = true) {
    const content = `${encode({ alg: "RS256", kid: "test-key" })}.${encode({ ...claims, ...overrides })}`;
    const signature = validSignature ? sign("sha256", Buffer.from(content), privateKey).toString("base64url") : "bad-signature";
    return `${content}.${signature}`;
  }

  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "https://www.googleapis.com/oauth2/v3/certs");
    return Response.json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "test-key", use: "sig" }] });
  });
  const app = express();
  app.use(express.json());
  app.use("/api", createPublicEndpointLimits({ env: { RATE_LIMIT_PUBLIC_WRITE_MAX: "20" } }), publicRoutes);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = (credential, requestOrigin = origin) =>
    originalFetch(`http://127.0.0.1:${server.address().port}/api/public/google-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: requestOrigin },
      body: JSON.stringify({ credential })
    });

  const verified = await request(token());
  assert.equal(verified.status, 200);
  assert.equal(verified.headers.get("cache-control"), "no-store");
  assert.equal(verified.headers.has("set-cookie"), false);
  assert.deepEqual(await verified.json(), { success: true, data: { name: claims.name, email: claims.email } });
  assert.equal((await request(token(), "https://other.example.test")).status, 403);
  assert.equal((await request("malformed")).status, 400);
  for (const credential of [
    token({ aud: staffAudience }), token({ exp: undefined }), token({ exp: now - 1 }),
    token({ email_verified: "false" }), token({ iss: "https://other.example.test" }), token({}, false)
  ]) {
    assert.equal((await request(credential)).status, 401);
  }
  await assert.rejects(verifyGoogleIdToken(token()), { status: 401 });
  process.env.PUBLIC_GOOGLE_CLIENT_ID = staffAudience;
  assert.equal((await request(token({ aud: staffAudience }))).status, 503);
  await assert.rejects(verifyGoogleIdToken(token({ aud: staffAudience })), { status: 503 });
});
