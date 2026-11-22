import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Set environment feature flags so all subsystem routes are active for evaluation
process.env.VITE_ORAC_PROCUREMENT_SUBSYSTEM = "enabled";
process.env.VITE_ORAC_FLEET_HSE_SUBSYSTEM = "enabled";
process.env.VITE_ORAC_ARTISAN_VAULT_SUBSYSTEM = "enabled";

import { canAccessRoute, visibleNavigation, ROUTE_ACCESS } from "../src/accessPolicy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const ALL_ROLES = [
  "Admin",
  "Management",
  "Sales",
  "Finance",
  "Operations",
  "Supervisor",
  "Technician",
  "Client Viewer",
  "Procurement & Stores",
  "Fleet & Facilities",
  "HSE & Quality",
  "Human Resources"
];

test("Batch 1: canAccessRoute enforces strict RBAC across all 12 roles", () => {
  // Client Viewer has no internal-requests or financial write access
  assert.equal(canAccessRoute("Client Viewer", "/internal-requests"), false);
  assert.equal(canAccessRoute("Client Viewer", "/finance"), false);
  assert.equal(canAccessRoute("Client Viewer", "/portal"), true);

  // Technician has no access to Quotations, Finance, or Monthly Worksheets
  assert.equal(canAccessRoute("Technician", "/quotations"), false);
  assert.equal(canAccessRoute("Technician", "/finance"), false);
  assert.equal(canAccessRoute("Technician", "/monthly-worksheets"), false);
  assert.equal(canAccessRoute("Technician", "/worksheets"), true);
  assert.equal(canAccessRoute("Technician", "/job-cards"), true);

  // Finance has no access to Quotations or Admin
  assert.equal(canAccessRoute("Finance", "/quotations"), false);
  assert.equal(canAccessRoute("Finance", "/admin"), false);
  assert.equal(canAccessRoute("Finance", "/finance"), true);
  assert.equal(canAccessRoute("Finance", "/invoice-readiness"), true);

  // Procurement & Stores specialist role
  assert.equal(canAccessRoute("Procurement & Stores", "/procurement"), true);
  assert.equal(canAccessRoute("Procurement & Stores", "/inventory"), true);
  assert.equal(canAccessRoute("Procurement & Stores", "/finance"), false);
  assert.equal(canAccessRoute("Procurement & Stores", "/quotations"), false);

  // Fleet & Facilities specialist role
  assert.equal(canAccessRoute("Fleet & Facilities", "/fleet"), true);
  assert.equal(canAccessRoute("Fleet & Facilities", "/job-cards"), true);
  assert.equal(canAccessRoute("Fleet & Facilities", "/finance"), false);

  // HSE & Quality specialist role
  assert.equal(canAccessRoute("HSE & Quality", "/hse"), true);
  assert.equal(canAccessRoute("HSE & Quality", "/job-cards"), true);
  assert.equal(canAccessRoute("HSE & Quality", "/procurement"), false);

  // Human Resources specialist role
  assert.equal(canAccessRoute("Human Resources", "/artisans"), true);
  assert.equal(canAccessRoute("Human Resources", "/admin"), true);
  assert.equal(canAccessRoute("Human Resources", "/quotations"), false);
});

test("Batch 1: QuickActionsBar never exposes forbidden routes (Progressive Disclosure)", () => {
  const quickBarCode = read("src/components/QuickActionsBar.jsx");

  // Verify the progressive disclosure filter is in place
  assert.match(quickBarCode, /canAccessRoute\(role,\s*act\.path\)/);

  // Verify forbidden teaser routes are removed from specific role blocks
  // Finance must not have /quotations
  const financeBlock = quickBarCode.match(/case "Finance":[\s\S]*?case "Operations":/)?.[0] || "";
  assert.doesNotMatch(financeBlock, /path:\s*["']\/quotations["']/);
  assert.match(financeBlock, /path:\s*["']\/invoice-readiness["']/);

  // Technician must not have /monthly-worksheets
  const techBlock = quickBarCode.match(/case "Technician":[\s\S]*?case "Client Viewer":/)?.[0] || "";
  assert.doesNotMatch(techBlock, /path:\s*["']\/monthly-worksheets["']/);
  assert.match(techBlock, /path:\s*["']\/worksheets["']/);

  // Operational specialist roles have dedicated cases
  assert.match(quickBarCode, /case "Procurement & Stores":/);
  assert.match(quickBarCode, /case "Fleet & Facilities":/);
  assert.match(quickBarCode, /case "HSE & Quality":/);
  assert.match(quickBarCode, /case "Human Resources":/);
});

test("Batch 1: DashboardPage supports greetings and telemetry for all 12 roles", () => {
  const dashCode = read("src/pages/DashboardPage.jsx");

  // Verify ROLE_GREETING has entries for all 12 roles
  for (const role of ALL_ROLES) {
    assert.match(dashCode, new RegExp(`["']?${role.replace("&", "\\&")}["']?\\s*:`), `Missing greeting for ${role}`);
  }

  // Verify exactly 6 statusFirst cards (invariant maintained)
  const statusFirstCount = (dashCode.match(/statusFirst/g) || []).length;
  assert.equal(statusFirstCount, 6, "Must strictly maintain exactly 6 status-first cards");
});
