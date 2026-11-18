import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Enable client feedback and optical QR flags for this test suite
process.env.VITE_ORAC_FEEDBACK_QR_SUBSYSTEM = "enabled";

const { ROLES, canAccessRoute, visibleNavigation, visibleNavigationGroups } = await import("../src/accessPolicy.js");
const { sidebarGroups } = await import("../src/navModel.js");

// Polyfill import.meta.env for testing client.js in Node.js
const clientSource = readFileSync(new URL("../src/api/client.js", import.meta.url), "utf8")
  .replaceAll("import.meta.env", "globalThis.__ORAC_TEST_ENV__");
globalThis.__ORAC_TEST_ENV__ = { PROD: false, VITE_API_BASE_URL: "http://api.test" };
const { feedback, qr } = await import(`data:text/javascript;base64,${Buffer.from(clientSource).toString("base64")}`);

test("client feedback and qr routes are accessible only to authorized roles", () => {
  // /feedback accessible to commercial, operational, and client viewer roles
  const feedbackAllowed = [ROLES.ADMIN, ROLES.MANAGEMENT, ROLES.OPERATIONS, ROLES.SUPERVISOR, ROLES.SALES, ROLES.CLIENT_VIEWER];
  const feedbackForbidden = [ROLES.TECHNICIAN, ROLES.FINANCE];

  for (const role of feedbackAllowed) {
    assert.ok(canAccessRoute(role, "/feedback"), `${role} should have access to /feedback`);
  }
  for (const role of feedbackForbidden) {
    assert.ok(!canAccessRoute(role, "/feedback"), `${role} should NOT have access to /feedback`);
  }

  // /qr-tools accessible to operational roles and technicians
  const qrAllowed = [ROLES.ADMIN, ROLES.MANAGEMENT, ROLES.OPERATIONS, ROLES.SUPERVISOR, ROLES.TECHNICIAN];
  const qrForbidden = [ROLES.SALES, ROLES.FINANCE, ROLES.CLIENT_VIEWER];

  for (const role of qrAllowed) {
    assert.ok(canAccessRoute(role, "/qr-tools"), `${role} should have access to /qr-tools`);
  }
  for (const role of qrForbidden) {
    assert.ok(!canAccessRoute(role, "/qr-tools"), `${role} should NOT have access to /qr-tools`);
  }
});

test("client feedback and qr navigation items are visible only to authorized roles in flat and grouped nav", () => {
  for (const role of Object.values(ROLES)) {
    const isFeedbackAllowed = [ROLES.ADMIN, ROLES.MANAGEMENT, ROLES.OPERATIONS, ROLES.SUPERVISOR, ROLES.SALES, ROLES.CLIENT_VIEWER].includes(role);
    const feedbackInFlat = visibleNavigation(role).some((i) => i.path === "/feedback");
    assert.equal(feedbackInFlat, isFeedbackAllowed, `${role} flat navigation for /feedback mismatch`);

    const feedbackInGrouped = visibleNavigationGroups(role)
      .flatMap((g) => g.items)
      .some((i) => i.path === "/feedback");
    assert.equal(feedbackInGrouped, isFeedbackAllowed, `${role} grouped navigation for /feedback mismatch`);

    const isQrAllowed = [ROLES.ADMIN, ROLES.MANAGEMENT, ROLES.OPERATIONS, ROLES.SUPERVISOR, ROLES.TECHNICIAN].includes(role);
    const qrInFlat = visibleNavigation(role).some((i) => i.path === "/qr-tools");
    assert.equal(qrInFlat, isQrAllowed, `${role} flat navigation for /qr-tools mismatch`);

    const qrInGrouped = visibleNavigationGroups(role)
      .flatMap((g) => g.items)
      .some((i) => i.path === "/qr-tools");
    assert.equal(qrInGrouped, isQrAllowed, `${role} grouped navigation for /qr-tools mismatch`);
  }
});

test("sidebar groups organize feedback under commercial and qr-tools under field-work", () => {
  const adminItems = sidebarGroups(ROLES.ADMIN).flatMap((g) => g.items);
  assert.ok(adminItems.some((i) => i.path === "/feedback"), "Admin sidebar should include /feedback");
  assert.ok(adminItems.some((i) => i.path === "/qr-tools"), "Admin sidebar should include /qr-tools");

  const salesItems = sidebarGroups(ROLES.SALES).flatMap((g) => g.items);
  assert.ok(salesItems.some((i) => i.path === "/feedback"), "Sales sidebar should include /feedback");
  assert.ok(!salesItems.some((i) => i.path === "/qr-tools"), "Sales sidebar should NOT include /qr-tools");

  const techItems = sidebarGroups(ROLES.TECHNICIAN).flatMap((g) => g.items);
  assert.ok(!techItems.some((i) => i.path === "/feedback"), "Technician sidebar should NOT include /feedback");
  assert.ok(techItems.some((i) => i.path === "/qr-tools"), "Technician sidebar should include /qr-tools");
});

test("api client exports all required feedback and qr methods", () => {
  assert.equal(typeof feedback.submitFeedback, "function");
  assert.equal(typeof feedback.listFeedbacks, "function");
  assert.equal(typeof feedback.resolveTriage, "function");
  assert.equal(typeof feedback.getSummary, "function");
  assert.equal(typeof feedback.getQbrDeck, "function");

  assert.equal(typeof qr.generateToken, "function");
});

test("ClientFeedbackPage and QrToolsPage source code adheres to ORAC tripwires and UX rules", () => {
  const fbSrc = readFileSync(new URL("../src/pages/ClientFeedbackPage.jsx", import.meta.url), "utf8");
  const qrSrc = readFileSync(new URL("../src/pages/QrToolsPage.jsx", import.meta.url), "utf8");

  // Zero banned direct sale terms
  const banned = /direct[-_ ]?sale|cash[-_ ]?sale|walk[-_ ]?in[-_ ]sale|counter[-_ ]sale/i;
  assert.doesNotMatch(fbSrc, banned, "ClientFeedbackPage must not contain banned direct-sale terms");
  assert.doesNotMatch(qrSrc, banned, "QrToolsPage must not contain banned direct-sale terms");

  // No banned uppercase / tracking classes
  assert.doesNotMatch(fbSrc, /\buppercase\b/, "ClientFeedbackPage must not contain uppercase class");
  assert.doesNotMatch(fbSrc, /\btracking-(?:tight|wide|wider|widest)\b/, "ClientFeedbackPage must not contain tracking-* class");
  assert.doesNotMatch(qrSrc, /\buppercase\b/, "QrToolsPage must not contain uppercase class");
  assert.doesNotMatch(qrSrc, /\btracking-(?:tight|wide|wider|widest)\b/, "QrToolsPage must not contain tracking-* class");

  // Required core features present
  assert.match(fbSrc, /NET PROMOTER SCORE/);
  assert.match(fbSrc, /Supervisor Triage Queue/);
  assert.match(fbSrc, /role="tabpanel"/);

  assert.match(qrSrc, /HMAC-SHA256 Cryptographically Signed/);
  assert.match(qrSrc, /EQUIPMENT_TAG/);
  assert.match(qrSrc, /WORKSHEET_SIGNOFF/);
  assert.match(qrSrc, /role="tabpanel"/);
});
