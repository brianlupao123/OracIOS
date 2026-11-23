import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Enable procurement flag for this test suite
process.env.VITE_ORAC_PROCUREMENT_SUBSYSTEM = "enabled";

const { ROLES, canAccessRoute, visibleNavigation, visibleNavigationGroups, NAV_ITEMS } = await import("../src/accessPolicy.js");
const { sidebarGroups } = await import("../src/navModel.js");

// Polyfill import.meta.env for testing client.js in Node.js
const clientSource = readFileSync(new URL("../src/api/client.js", import.meta.url), "utf8")
  .replaceAll("import.meta.env", "globalThis.__ORAC_TEST_ENV__");
globalThis.__ORAC_TEST_ENV__ = { PROD: false, VITE_API_BASE_URL: "http://api.test" };
const { procurement } = await import(`data:text/javascript;base64,${Buffer.from(clientSource).toString("base64")}`);

test("procurement route is strictly restricted to authorized commercial & operational roles", () => {
  const allowed = [ROLES.ADMIN, ROLES.MANAGEMENT, ROLES.OPERATIONS, ROLES.FINANCE];
  const forbidden = [ROLES.TECHNICIAN, ROLES.SUPERVISOR, ROLES.CLIENT_VIEWER, ROLES.SALES];

  for (const role of allowed) {
    assert.ok(canAccessRoute(role, "/procurement"), `${role} should have access to /procurement`);
  }

  for (const role of forbidden) {
    assert.ok(!canAccessRoute(role, "/procurement"), `${role} should NOT have access to /procurement`);
  }
});

test("procurement navigation item is visible only to authorized roles in both flat and grouped nav", () => {
  for (const role of Object.values(ROLES)) {
    const isAllowed = [ROLES.ADMIN, ROLES.MANAGEMENT, ROLES.OPERATIONS, ROLES.FINANCE].includes(role);
    const inFlat = visibleNavigation(role).some((item) => item.path === "/procurement");
    assert.equal(inFlat, isAllowed, `${role} flat navigation for /procurement mismatch`);

    const inGrouped = visibleNavigationGroups(role)
      .flatMap((g) => g.items)
      .some((item) => item.path === "/procurement");
    assert.equal(inGrouped, isAllowed, `${role} grouped navigation for /procurement mismatch`);
  }
});

test("sidebar groups include procurement under inventory category for authorized roles", () => {
  const adminItems = sidebarGroups(ROLES.ADMIN).flatMap((g) => g.items);
  assert.ok(adminItems.some((i) => i.path === "/procurement"), "Admin sidebar should include /procurement");

  const techItems = sidebarGroups(ROLES.TECHNICIAN).flatMap((g) => g.items);
  assert.ok(!techItems.some((i) => i.path === "/procurement"), "Technician sidebar should NOT include /procurement");
});

test("api client exports all required procurement methods", () => {
  assert.equal(typeof procurement.listRequests, "function");
  assert.equal(typeof procurement.createRequest, "function");
  assert.equal(typeof procurement.approveRequest, "function");
  assert.equal(typeof procurement.listSupplierPos, "function");
  assert.equal(typeof procurement.createSupplierPo, "function");
  assert.equal(typeof procurement.listGrns, "function");
  assert.equal(typeof procurement.receiveGrn, "function");
  assert.equal(typeof procurement.listStoreIssueVouchers, "function");
  assert.equal(typeof procurement.issueStoreVoucher, "function");
  assert.equal(typeof procurement.threeWayMatch, "function");
  assert.equal(typeof procurement.getSummary, "function");
});

test("ProcurementPage source code adheres to ORAC architecture and tripwires", () => {
  const src = readFileSync(new URL("../src/pages/ProcurementPage.jsx", import.meta.url), "utf8");

  // Zero banned direct sale terms
  const banned = /direct[-_ ]?sale|cash[-_ ]?sale|walk[-_ ]?in[-_ ]sale|counter[-_ ]sale/i;
  assert.doesNotMatch(src, banned, "ProcurementPage must not contain banned direct-sale terms");

  // Multi-tab architecture present
  assert.match(src, /Overview & Metrics/);
  assert.match(src, /Procurement Requests/);
  assert.match(src, /Supplier Purchase Orders/);
  assert.match(src, /Goods Received \(GRN\)/);
  assert.match(src, /Store Issue \(SIV\)/);
  assert.match(src, /3-Way Match Audit/);

  // Currency adheres to USD
  assert.match(src, /USD \$/);
});

test("goods receipt uses the remaining balance and requires actual delivery information", async () => {
  const { buildReceiptPayload, canReceiveSupplierOrder, openReceiptLines } = await import("../src/procurementReceipt.js");
  const order = { id: "po-1", status: "PARTIALLY_RECEIVED", items: [
    { item_code: "A", quantity: 10 }, { item_code: "B", quantity: 2 }
  ] };
  const receipts = [
    { supplier_po_id: order.id, items: [{ item_code: "A", received_quantity: 3 }, { item_code: "B", received_quantity: 2 }] },
    { supplier_po_id: order.id, items: [{ item_code: "A", received_quantity: 1 }] },
    { supplier_po_id: "other", items: [{ item_code: "A", received_quantity: 5 }] }
  ];
  assert.equal(canReceiveSupplierOrder("Procurement & Stores", order), true);
  assert.equal(canReceiveSupplierOrder("Operations", order), true);
  assert.equal(canReceiveSupplierOrder("Technician", order), false);
  assert.equal(canReceiveSupplierOrder("Admin", { ...order, status: "RECEIVED" }), false);
  const items = openReceiptLines(order, receipts);
  assert.deepEqual(items.map(item => [item.item_code, item.remaining, item.received_quantity]), [["A", 6, 0]]);
  const form = { delivery_note_ref: " DN-32 ", items };
  assert.throws(() => buildReceiptPayload(form), /actually delivered/);
  items[0].received_quantity = 7;
  assert.throws(() => buildReceiptPayload(form), /outstanding/);
  items[0].received_quantity = 6;
  const payload = buildReceiptPayload(form);
  assert.equal(payload.delivery_note_ref, "DN-32");
  assert.equal(payload.items[0].received_quantity, 6);
  assert.equal("remaining" in payload.items[0], false);
});
