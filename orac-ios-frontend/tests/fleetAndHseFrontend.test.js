import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Enable fleet & HSE flags for this test suite
process.env.VITE_ORAC_FLEET_HSE_SUBSYSTEM = "enabled";

const { ROLES, canAccessRoute, visibleNavigation, visibleNavigationGroups } = await import("../src/accessPolicy.js");
const { sidebarGroups } = await import("../src/navModel.js");

// Polyfill import.meta.env for testing client.js in Node.js
const clientSource = readFileSync(new URL("../src/api/client.js", import.meta.url), "utf8")
  .replaceAll("import.meta.env", "globalThis.__ORAC_TEST_ENV__");
globalThis.__ORAC_TEST_ENV__ = { PROD: false, VITE_API_BASE_URL: "http://api.test" };
const { fleet, hse } = await import(`data:text/javascript;base64,${Buffer.from(clientSource).toString("base64")}`);

test("fleet route is strictly restricted to authorized operational, logistics & finance roles", () => {
  const allowed = [ROLES.ADMIN, ROLES.MANAGEMENT, ROLES.OPERATIONS, ROLES.SUPERVISOR, ROLES.FINANCE];
  const forbidden = [ROLES.TECHNICIAN, ROLES.CLIENT_VIEWER, ROLES.SALES];

  for (const role of allowed) {
    assert.ok(canAccessRoute(role, "/fleet"), `${role} should have access to /fleet`);
  }

  for (const role of forbidden) {
    assert.ok(!canAccessRoute(role, "/fleet"), `${role} should NOT have access to /fleet`);
  }
});

test("hse route is strictly accessible to operational teams including field technicians", () => {
  const allowed = [ROLES.ADMIN, ROLES.MANAGEMENT, ROLES.OPERATIONS, ROLES.SUPERVISOR, ROLES.TECHNICIAN];
  const forbidden = [ROLES.CLIENT_VIEWER, ROLES.SALES, ROLES.FINANCE];

  for (const role of allowed) {
    assert.ok(canAccessRoute(role, "/hse"), `${role} should have access to /hse`);
  }

  for (const role of forbidden) {
    assert.ok(!canAccessRoute(role, "/hse"), `${role} should NOT have access to /hse`);
  }
});

test("fleet and hse navigation items are visible only to authorized roles in flat and grouped nav", () => {
  for (const role of Object.values(ROLES)) {
    const isFleetAllowed = [ROLES.ADMIN, ROLES.MANAGEMENT, ROLES.OPERATIONS, ROLES.SUPERVISOR, ROLES.FINANCE].includes(role);
    const isHseAllowed = [ROLES.ADMIN, ROLES.MANAGEMENT, ROLES.OPERATIONS, ROLES.SUPERVISOR, ROLES.TECHNICIAN].includes(role);

    const flatNav = visibleNavigation(role);
    assert.equal(flatNav.some((i) => i.path === "/fleet"), isFleetAllowed, `${role} flat nav /fleet mismatch`);
    assert.equal(flatNav.some((i) => i.path === "/hse"), isHseAllowed, `${role} flat nav /hse mismatch`);

    const groupedItems = visibleNavigationGroups(role).flatMap((g) => g.items);
    assert.equal(groupedItems.some((i) => i.path === "/fleet"), isFleetAllowed, `${role} grouped nav /fleet mismatch`);
    assert.equal(groupedItems.some((i) => i.path === "/hse"), isHseAllowed, `${role} grouped nav /hse mismatch`);
  }
});

test("api client exports all required fleet and hse methods", () => {
  // Fleet API
  assert.equal(typeof fleet.listVehicles, "function");
  assert.equal(typeof fleet.createVehicle, "function");
  assert.equal(typeof fleet.dispatchVehicle, "function");
  assert.equal(typeof fleet.returnVehicle, "function");
  assert.equal(typeof fleet.logFuel, "function");
  assert.equal(typeof fleet.getSummary, "function");

  // HSE API
  assert.equal(typeof hse.recordPreDispatchPpe, "function");
  assert.equal(typeof hse.listPpeChecklists, "function");
  assert.equal(typeof hse.createToolboxTalk, "function");
  assert.equal(typeof hse.listToolboxTalks, "function");
  assert.equal(typeof hse.reportIncident, "function");
  assert.equal(typeof hse.listIncidents, "function");
  assert.equal(typeof hse.getSummary, "function");
});

test("FleetManagementPage and HseCompliancePage source code adhere to ORAC tripwires and UX rules", () => {
  const fleetSrc = readFileSync(new URL("../src/pages/FleetManagementPage.jsx", import.meta.url), "utf8");
  const hseSrc = readFileSync(new URL("../src/pages/HseCompliancePage.jsx", import.meta.url), "utf8");

  // Zero banned direct sale terms
  const banned = /direct[-_ ]?sale|cash[-_ ]?sale|walk[-_ ]?in[-_ ]sale|counter[-_ ]sale/i;
  assert.doesNotMatch(fleetSrc, banned, "FleetManagementPage must not contain banned direct-sale terms");
  assert.doesNotMatch(hseSrc, banned, "HseCompliancePage must not contain banned direct-sale terms");

  // No banned uppercase / tracking classes (per chatFOperationsConsole.test.js:31)
  assert.doesNotMatch(fleetSrc, /\buppercase\b/, "FleetManagementPage must not contain uppercase class");
  assert.doesNotMatch(hseSrc, /\buppercase\b/, "HseCompliancePage must not contain uppercase class");
  assert.doesNotMatch(fleetSrc, /\btracking-(?:tight|wide|wider|widest)\b/, "FleetManagementPage must not contain tracking-* class");
  assert.doesNotMatch(hseSrc, /\btracking-(?:tight|wide|wider|widest)\b/, "HseCompliancePage must not contain tracking-* class");

  // S-12 and S-11 controls present
  assert.match(fleetSrc, /VID Roadworthiness/);
  assert.match(hseSrc, /Pre-Dispatch PPE Gate \(S-11\)/);
  assert.match(hseSrc, /Mandatory 8-Point Physical PPE Checklist/);

  // Tabpanels accessible
  assert.match(fleetSrc, /role="tabpanel"/);
  assert.match(hseSrc, /role="tabpanel"/);
});
