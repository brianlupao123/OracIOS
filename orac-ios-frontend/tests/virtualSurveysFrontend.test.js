import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Enable virtual surveys flag for this test suite
process.env.VITE_ORAC_VIRTUAL_SURVEYS_SUBSYSTEM = "enabled";

const { ROLES, canAccessRoute, visibleNavigation, visibleNavigationGroups } = await import("../src/accessPolicy.js");
const { sidebarGroups } = await import("../src/navModel.js");

// Polyfill import.meta.env for testing client.js in Node.js
const clientSource = readFileSync(new URL("../src/api/client.js", import.meta.url), "utf8")
  .replaceAll("import.meta.env", "globalThis.__ORAC_TEST_ENV__");
globalThis.__ORAC_TEST_ENV__ = { PROD: false, VITE_API_BASE_URL: "http://api.test" };
const { surveys } = await import(`data:text/javascript;base64,${Buffer.from(clientSource).toString("base64")}`);

test("virtual surveys route is accessible to commercial, operational, and client viewer roles", () => {
  const allowed = [ROLES.ADMIN, ROLES.MANAGEMENT, ROLES.OPERATIONS, ROLES.SUPERVISOR, ROLES.SALES, ROLES.CLIENT_VIEWER];
  const forbidden = [ROLES.TECHNICIAN, ROLES.FINANCE];

  for (const role of allowed) {
    assert.ok(canAccessRoute(role, "/surveys"), `${role} should have access to /surveys`);
  }

  for (const role of forbidden) {
    assert.ok(!canAccessRoute(role, "/surveys"), `${role} should NOT have access to /surveys`);
  }
});

test("virtual surveys navigation item is visible only to authorized roles in flat and grouped nav", () => {
  for (const role of Object.values(ROLES)) {
    const isAllowed = [ROLES.ADMIN, ROLES.MANAGEMENT, ROLES.OPERATIONS, ROLES.SUPERVISOR, ROLES.SALES, ROLES.CLIENT_VIEWER].includes(role);
    const inFlat = visibleNavigation(role).some((i) => i.path === "/surveys");
    assert.equal(inFlat, isAllowed, `${role} flat navigation for /surveys mismatch`);

    const inGrouped = visibleNavigationGroups(role)
      .flatMap((g) => g.items)
      .some((i) => i.path === "/surveys");
    assert.equal(inGrouped, isAllowed, `${role} grouped navigation for /surveys mismatch`);
  }
});

test("sidebar groups include virtual surveys under commercial category for authorized roles", () => {
  const adminItems = sidebarGroups(ROLES.ADMIN).flatMap((g) => g.items);
  assert.ok(adminItems.some((i) => i.path === "/surveys"), "Admin sidebar should include /surveys");

  const salesItems = sidebarGroups(ROLES.SALES).flatMap((g) => g.items);
  assert.ok(salesItems.some((i) => i.path === "/surveys"), "Sales sidebar should include /surveys");

  const techItems = sidebarGroups(ROLES.TECHNICIAN).flatMap((g) => g.items);
  assert.ok(!techItems.some((i) => i.path === "/surveys"), "Technician sidebar should NOT include /surveys");
});

test("api client exports all required virtual surveys methods", () => {
  assert.equal(typeof surveys.bookSurvey, "function");
  assert.equal(typeof surveys.listSurveys, "function");
  assert.equal(typeof surveys.getMeetingAccess, "function");
  assert.equal(typeof surveys.completeSurvey, "function");
  assert.equal(typeof surveys.extractAiScope, "function");
  assert.equal(typeof surveys.getSummary, "function");
});

test("VirtualSurveysPage source code adheres to ORAC tripwires, USD billing, and UX rules", () => {
  const src = readFileSync(new URL("../src/pages/VirtualSurveysPage.jsx", import.meta.url), "utf8");

  // Zero banned direct sale terms
  const banned = /direct[-_ ]?sale|cash[-_ ]?sale|walk[-_ ]?in[-_ ]sale|counter[-_ ]sale/i;
  assert.doesNotMatch(src, banned, "VirtualSurveysPage must not contain banned direct-sale terms");

  // No banned uppercase / tracking classes (per chatFOperationsConsole.test.js:31)
  assert.doesNotMatch(src, /\buppercase\b/, "VirtualSurveysPage must not contain uppercase class");
  assert.doesNotMatch(src, /\btracking-(?:tight|wide|wider|widest)\b/, "VirtualSurveysPage must not contain tracking-* class");

  // WebRTC and Dash AI present
  assert.match(src, /Daily\.co WebRTC/);
  assert.match(src, /Dash AI/);

  // Currency adheres strictly to USD (Sensitive Control S-08)
  assert.match(src, /USD \$/);

  // Tabpanels accessible
  assert.match(src, /role="tabpanel"/);
});
