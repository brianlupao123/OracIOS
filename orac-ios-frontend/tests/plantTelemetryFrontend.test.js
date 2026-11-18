import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Enable plant IoT telemetry & offline sync flags for this test suite
process.env.VITE_ORAC_IOT_SYNC_SUBSYSTEM = "enabled";

const { ROLES, canAccessRoute, visibleNavigation, visibleNavigationGroups } = await import("../src/accessPolicy.js");
const { sidebarGroups } = await import("../src/navModel.js");

// Polyfill import.meta.env for testing client.js in Node.js
const clientSource = readFileSync(new URL("../src/api/client.js", import.meta.url), "utf8")
  .replaceAll("import.meta.env", "globalThis.__ORAC_TEST_ENV__");
globalThis.__ORAC_TEST_ENV__ = { PROD: false, VITE_API_BASE_URL: "http://api.test" };
const { telemetry, sync } = await import(`data:text/javascript;base64,${Buffer.from(clientSource).toString("base64")}`);

test("plant telemetry route is accessible to operational, technical, sales, and client roles", () => {
  const allowed = [ROLES.ADMIN, ROLES.MANAGEMENT, ROLES.OPERATIONS, ROLES.SUPERVISOR, ROLES.TECHNICIAN, ROLES.SALES, ROLES.CLIENT_VIEWER];
  const forbidden = [ROLES.FINANCE];

  for (const role of allowed) {
    assert.ok(canAccessRoute(role, "/telemetry"), `${role} should have access to /telemetry`);
  }
  for (const role of forbidden) {
    assert.ok(!canAccessRoute(role, "/telemetry"), `${role} should NOT have access to /telemetry`);
  }
});

test("plant telemetry navigation item is visible only to authorized roles in flat and grouped nav", () => {
  for (const role of Object.values(ROLES)) {
    const isAllowed = [ROLES.ADMIN, ROLES.MANAGEMENT, ROLES.OPERATIONS, ROLES.SUPERVISOR, ROLES.TECHNICIAN, ROLES.SALES, ROLES.CLIENT_VIEWER].includes(role);
    const inFlat = visibleNavigation(role).some((i) => i.path === "/telemetry");
    assert.equal(inFlat, isAllowed, `${role} flat navigation for /telemetry mismatch`);

    const inGrouped = visibleNavigationGroups(role)
      .flatMap((g) => g.items)
      .some((i) => i.path === "/telemetry");
    assert.equal(inGrouped, isAllowed, `${role} grouped navigation for /telemetry mismatch`);
  }
});

test("sidebar groups organize plant telemetry under field-work category", () => {
  const adminItems = sidebarGroups(ROLES.ADMIN).flatMap((g) => g.items);
  assert.ok(adminItems.some((i) => i.path === "/telemetry"), "Admin sidebar should include /telemetry");

  const techItems = sidebarGroups(ROLES.TECHNICIAN).flatMap((g) => g.items);
  assert.ok(techItems.some((i) => i.path === "/telemetry"), "Technician sidebar should include /telemetry");

  const financeItems = sidebarGroups(ROLES.FINANCE).flatMap((g) => g.items);
  assert.ok(!financeItems.some((i) => i.path === "/telemetry"), "Finance sidebar should NOT include /telemetry");
});

test("api client exports all required telemetry and sync methods", () => {
  assert.equal(typeof telemetry.ingest, "function");
  assert.equal(typeof telemetry.getEquipmentTelemetry, "function");
  assert.equal(typeof telemetry.listAlerts, "function");
  assert.equal(typeof telemetry.resolveAlert, "function");
  assert.equal(typeof telemetry.getSummary, "function");

  assert.equal(typeof sync.batch, "function");
  assert.equal(typeof sync.getJournal, "function");
  assert.equal(typeof sync.resolveConflict, "function");
});

test("PlantTelemetryPage source code adheres to ORAC tripwires and UX rules", () => {
  const src = readFileSync(new URL("../src/pages/PlantTelemetryPage.jsx", import.meta.url), "utf8");

  // Zero banned direct sale terms
  const banned = /direct[-_ ]?sale|cash[-_ ]?sale|walk[-_ ]?in[-_ ]sale|counter[-_ ]sale/i;
  assert.doesNotMatch(src, banned, "PlantTelemetryPage must not contain banned direct-sale terms");

  // No banned uppercase / tracking classes
  assert.doesNotMatch(src, /\buppercase\b/, "PlantTelemetryPage must not contain uppercase class");
  assert.doesNotMatch(src, /\btracking-(?:tight|wide|wider|widest)\b/, "PlantTelemetryPage must not contain tracking-* class");

  // Core domain concepts present
  assert.match(src, /Vibration RMS/);
  assert.match(src, /Predictive Maintenance Policy/);
  assert.match(src, /Offline Mobile Sync Journal/);
  assert.match(src, /role="tabpanel"/);
});
