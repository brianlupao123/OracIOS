// Anonymous public feedback must not reach Client Viewers (list, summary, QBR deck, triage),
// and no unreviewed code path may start reading the feedback register.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { roles } from "../src/permissions.js";
import {
  listFeedbacks, getFeedbackSummary, getQbrReportDeck, resolveFeedbackTriage, getPublicFeedbackQr, generateQrToken
} from "../src/controllers/feedbackController.js";
import { getRoleDashboardSummary } from "../src/controllers/dashboardController.js";

const GUEST_COMMENT = "GUEST-SECRET-COMMENT";
const seeded = () => [
  { id: "g1", source: "PUBLIC_QR", client_id: null, rating_stars: 1, comments: GUEST_COMMENT, triage_required: true, triage_status: "PENDING_REVIEW" },
  { id: "g2", source: "PUBLIC_QR", client_id: "cA", rating_stars: 2, comments: GUEST_COMMENT }, // even a mis-tagged guest row stays hidden
  { id: "a1", client_id: "cA", rating_stars: 4, nps_score: 9, comments: "client A" },
  { id: "b1", client_id: "cB", rating_stars: 4, nps_score: 9, comments: "client B" }
];
function db() {
  const all = Object.values(roles);
  return {
    users: [
      ...all.map((role, i) => ({ id: `u${i}`, role, is_active: true, ...(role === roles.CLIENT_VIEWER ? { client_id: "cA" } : {}) })),
      { id: "viewerNoClient", role: roles.CLIENT_VIEWER, is_active: true },
      { id: "viewerB", role: roles.CLIENT_VIEWER, is_active: true, client_id: "cB" }
    ],
    client_job_feedbacks: seeded(), audit_logs: [], dispatch_cards: [], pre_dispatch_ppe_checklists: [], vehicles: []
  };
}
const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const asUser = (d, id, extra = {}) => ({ db: d, user: { id }, query: {}, params: {}, body: {}, store: { id: () => "x", audit() {} }, ...extra });
const idOf = (d, role) => d.users.find((u) => u.role === role && u.client_id !== "cB").id;

test("Client Viewer lists only own client rows; guests never, whatever the query string says", () => {
  const d = db();
  const queries = [{}, { source: "PUBLIC_QR" }, { client_id: "cB" }, { client_id: "" }, { triage_only: "true" }, { source: "PUBLIC_QR", triage_only: "true", client_id: "cA" }, { source: ["PUBLIC_QR"] }];
  for (const query of queries) {
    const r = res(); listFeedbacks(asUser(d, idOf(d, roles.CLIENT_VIEWER), { query }), r);
    assert.equal(r.statusCode, 200);
    // a1 is not a triage item, so triage_only legitimately empties the list; guests never appear
    assert.deepEqual(r.body.data.map((f) => f.id), query.triage_only ? [] : ["a1"], JSON.stringify(query));
    assert.ok(!JSON.stringify(r.body).includes(GUEST_COMMENT));
  }
  const viewerB = res(); listFeedbacks(asUser(d, "viewerB"), viewerB);
  assert.deepEqual(viewerB.body.data.map((f) => f.id), ["b1"]);
});

test("Client Viewer without a client_id sees nothing (previously: every record)", () => {
  const d = db();
  for (const query of [{}, { client_id: "cA" }, { source: "PUBLIC_QR" }]) {
    const r = res(); listFeedbacks(asUser(d, "viewerNoClient", { query }), r);
    assert.deepEqual(r.body.data, []);
  }
});

test("Client Viewer dashboard excludes anonymous public feedback even when a bad row carries its client id", () => {
  const d = db();
  d.client_job_feedbacks.find((f) => f.id === "g1").client_id = "cA";
  const r = res();
  getRoleDashboardSummary(asUser(d, idOf(d, roles.CLIENT_VIEWER)), r);
  assert.equal(r.statusCode, 200);
  const satisfaction = r.body.subsystems.client_satisfaction;
  assert.equal(satisfaction.nps.total_reviews, 1);
  assert.equal(satisfaction.active_triage_tickets, 0);
  assert.ok(!JSON.stringify(r.body).includes(GUEST_COMMENT));
});

test("staff can read guest rows only through the authenticated list, with an explicit source filter", () => {
  const d = db();
  const staff = [roles.ADMIN, roles.MANAGEMENT, roles.OPERATIONS, roles.SUPERVISOR, roles.SALES];
  for (const role of staff) {
    const r = res(); listFeedbacks(asUser(d, idOf(d, role), { query: { source: "PUBLIC_QR" } }), r);
    assert.deepEqual(r.body.data.map((f) => f.id), ["g1", "g2"], role);
  }
  for (const role of Object.values(roles).filter((x) => ![...staff, roles.CLIENT_VIEWER].includes(x))) {
    const r = res(); listFeedbacks(asUser(d, idOf(d, role)), r);
    assert.equal(r.statusCode, 403, role);
  }
  const anon = res(); listFeedbacks({ db: d, user: undefined, query: {} }, anon);
  assert.equal(anon.statusCode, 401);
});

test("Client Viewer is refused on summary, QBR deck, triage and the public QR; nested deck data is staff-only", async () => {
  const d = db(); const cv = idOf(d, roles.CLIENT_VIEWER);
  for (const [name, call] of [
    ["summary", (r) => getFeedbackSummary(asUser(d, cv), r)],
    ["qbr deck", (r) => getQbrReportDeck(asUser(d, cv), r)],
    ["triage", (r) => resolveFeedbackTriage(asUser(d, cv, { params: { id: "g1" }, body: { triage_status: "RESOLVED", triage_notes: "note" } }), r)],
    ["public qr", (r) => getPublicFeedbackQr(asUser(d, cv), r)],
    ["token mint", (r) => generateQrToken(asUser(d, cv, { body: { token_type: "EQUIPMENT_TAG", target_id: "t" } }), r)]
  ]) {
    const r = res(); await call(r);
    assert.equal(r.statusCode, 403, name);
    assert.ok(!JSON.stringify(r.body).includes(GUEST_COMMENT), name);
  }
  assert.equal(d.client_job_feedbacks.find((f) => f.id === "g1").triage_status, "PENDING_REVIEW", "refused triage changed nothing");
  const staffDeck = res(); getQbrReportDeck(asUser(d, idOf(d, roles.ADMIN)), staffDeck);
  assert.equal(staffDeck.statusCode, 200);
  assert.ok(staffDeck.body.data.metrics.open_triages.some((f) => f.id === "g1"), "guest triage items are visible to staff in the deck");
  assert.equal(staffDeck.body.data.metrics.satisfaction.total_reviews, 2, "but never counted in satisfaction");
  assert.ok(staffDeck.body.data.metrics.open_triages.every((f) => f.source === "PUBLIC_QR" || f.client_id), "sanity");
});

// Guard for code this packet does not contain (dashboard, sync, documents, notifications,
// generic collection routes, exports...). If any other source file starts reading the feedback
// register, or iterates every collection generically, this fails and forces a review.
test("repo guard: only reviewed files touch the feedback register or enumerate every collection", (t) => {
  const srcDir = fileURLToPath(new URL("../src", import.meta.url));
  const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : []; });
  const REGISTER_OK = new Set(["store.js", "controllers/dashboardController.js", "controllers/feedbackController.js", "services/qbrReportService.js",
    "services/publicFeedbackPolicy.js", "modules/public/controllers/publicFeedbackController.js"].map((p) => p.split("/").join(sep)));
  const ENUMERATE_OK = new Set(["store.js"]);
  const offenders = [];
  const advisory = [];
  for (const file of walk(srcDir)) {
    const rel = relative(srcDir, file);
    const text = readFileSync(file, "utf8");
    if (/client_job_feedbacks|PUBLIC_QR|PUBLIC_FEEDBACK_SOURCE/.test(text) && !REGISTER_OK.has(rel)) offenders.push(`${rel}: references the feedback register`);
    if (/SCHEMA_COLLECTIONS/.test(text) && !ENUMERATE_OK.has(rel)) offenders.push(`${rel}: enumerates every collection`);
    if (/Object\.(keys|entries|values)\(\s*(req\.)?db\s*\)|for\s*\(\s*(const|let|var)\s+\w+\s+in\s+(req\.)?db\s*\)/.test(text)) advisory.push(rel);
  }
  // Advisory only (some may be legitimate admin or backup code): review these for Client Viewer reach.
  if (advisory.length) t.diagnostic(`files iterating the whole db object: ${advisory.join(", ")}`);
  assert.deepEqual(offenders, [], "review each file for Client Viewer exposure of anonymous public feedback, then add it here deliberately");
});
