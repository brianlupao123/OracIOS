// Public anonymous feedback (QR): intake, idempotency, NPS exclusion, QR wiring, limiter table.
// Synthetic data only: no network, no mail, no real URL.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPublicFeedback, validatePublicFeedback } from "../src/modules/public/controllers/publicFeedbackController.js";
import { idempotencyKeyMiddleware } from "../src/idempotency.js";
import { calculateNps, compileQbrExecutiveMetrics } from "../src/services/qbrReportService.js";
import { getPublicFeedbackQr, getFeedbackSummary } from "../src/controllers/feedbackController.js";
import { resolvePublicFeedbackUrl, renderPublicFeedbackQr } from "../src/services/qrCodeService.js";
import { createPublicEndpointLimits, PUBLIC_WRITE_ROUTES } from "../src/middleware/rateLimit.js";

const KEY = "3f2b8c1e-9d4a-4e6b-8a1c-5d7e9f0a1b2c";
const URL_OK = "https://feedback.example.invalid/feedback";
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r/g, "");

function mock({ user, body = {}, db = {}, key = KEY, nowMs = 1_700_000_000_000 } = {}) {
  const audit = [];
  const headers = {};
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; },
    set(k, v) { headers[k] = v; return this; }
  };
  const req = {
    user, body, query: {}, nowMs, idempotencyKey: key,
    db: {
      users: [{ id: "u-admin", role: "Admin" }, { id: "u-tech", role: "Technician" }, { id: "u-cv", role: "Client Viewer", client_id: "c-1" }],
      client_job_feedbacks: [], audit_logs: [], ...db
    },
    store: { id: (p) => `${p}-${Math.random().toString(36).slice(2, 9)}`, audit: (...a) => audit.push(a) }
  };
  return { req, res, audit, headers };
}
const good = { rating_stars: 5, comments: "Crew was prompt." };

test("guest submit: 201, minimal acknowledgement, anonymous record in the existing register", () => {
  const { req, res, audit } = mock({ body: { ...good, guest_name: "Test Guest", contact_email: "g@example.invalid", contact_phone: "+263000000", client_id: "c-1", nps_score: 10, site_location: "Synthetic" } });
  createPublicFeedback(req, res);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(Object.keys(res.body), ["success", "data"]);
  assert.deepEqual(Object.keys(res.body.data), ["reference"]);
  const [rec] = req.db.client_job_feedbacks;
  assert.equal(req.db.client_job_feedbacks.length, 1);
  assert.equal(rec.source, "PUBLIC_QR");
  assert.equal(rec.client_id, null, "a client_id in the body must not be honoured");
  assert.equal(rec.submitted_by_name, "Anonymous guest");
  assert.equal("nps_score" in rec, false);
  assert.ok(!JSON.stringify(rec).match(/Test Guest|g@example|\+263|Synthetic/), "no identifying property is persisted");
  const wire = JSON.stringify(res.body);
  for (const s of [rec.id, "Crew was prompt"]) assert.ok(!wire.includes(s));
  assert.equal(audit[0][1], null);
  assert.ok(!JSON.stringify(audit[0].slice(1)).includes("Crew was prompt"), "audit omits the comment");
  assert.ok(!["SUPERVISOR_TRIAGE_REQUIRED", "FEEDBACK_SUBMITTED"].includes(audit[0][4]), "legacy audit actions are not reused");
});

test("low rating enters the existing triage queue; 4-5 stars does not", () => {
  const low = mock({ body: { ...good, rating_stars: 3 } });
  createPublicFeedback(low.req, low.res);
  assert.equal(low.req.db.client_job_feedbacks[0].triage_required, true);
  assert.equal(low.req.db.client_job_feedbacks[0].triage_status, "PENDING_REVIEW");
  assert.equal(low.audit[0][4], "PUBLIC_FEEDBACK_TRIAGE_REQUIRED");
  const ok = mock({ body: { ...good, rating_stars: 4 } });
  createPublicFeedback(ok.req, ok.res);
  assert.equal(ok.req.db.client_job_feedbacks[0].triage_required, false);
});

test("retry with the same key saves one record; changed body is 409; key expires after 24h", () => {
  const first = mock({ body: good });
  createPublicFeedback(first.req, first.res);
  const retry = mock({ body: { ...good, ignored: "x" }, db: first.req.db });
  createPublicFeedback(retry.req, retry.res);
  assert.equal(first.req.db.client_job_feedbacks.length, 1);
  assert.deepEqual(retry.res.body, first.res.body);
  assert.equal(retry.headers["Idempotency-Replayed"], "true");
  const clash = mock({ body: { ...good, comments: "different" }, db: first.req.db });
  createPublicFeedback(clash.req, clash.res);
  assert.equal(clash.res.statusCode, 409);
  assert.equal(first.req.db.client_job_feedbacks.length, 1);
  const later = mock({ body: good, db: first.req.db, nowMs: 1_700_000_000_000 + 24 * 3600 * 1000 });
  createPublicFeedback(later.req, later.res);
  assert.equal(first.req.db.client_job_feedbacks.length, 2);
});

test("invalid input is refused and nothing is saved", () => {
  const bad = [{}, { ...good, rating_stars: 0 }, { ...good, rating_stars: 6 }, { ...good, rating_stars: 3.5 }, { ...good, rating_stars: "5" },
    { ...good, comments: "x".repeat(1001) }, { ...good, comments: 42 }, { ...good, comments: ["a"] }, { ...good, website: "http://spam.example.invalid" }];
  for (const body of bad) {
    const { req, res } = mock({ body });
    createPublicFeedback(req, res);
    assert.equal(res.statusCode, 400, JSON.stringify(body).slice(0, 60));
    assert.equal(req.db.client_job_feedbacks.length, 0);
  }
  for (const body of [null, [], "text"]) {
    const { req, res } = mock({ body });
    createPublicFeedback(req, res);
    assert.equal(res.statusCode, 400);
  }
  const noKey = mock({ body: good, key: null });
  createPublicFeedback(noKey.req, noKey.res);
  assert.equal(noKey.res.statusCode, 400);
  assert.equal(noKey.res.body.code, "IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(noKey.req.db.client_job_feedbacks.length, 0);
  assert.equal(validatePublicFeedback({ ...good, comments: "a\u0000b\r\nc" }).value.comments, "ab\nc");
  assert.equal(validatePublicFeedback({ rating_stars: 2 }).value.comments, "");
  assert.equal(validatePublicFeedback({ ...good, comments: "y".repeat(1000) }).errors.length, 0);
});

test("idempotency middleware refuses a malformed key on the public route", () => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  let passed = false;
  idempotencyKeyMiddleware({ headers: { "idempotency-key": "not-a-uuid" }, rawHeaders: ["Idempotency-Key", "not-a-uuid"] }, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 400);
});

test("NPS excludes anonymous public feedback everywhere it is computed", () => {
  const client = [
    { id: "a", client_id: "c-1", rating_stars: 5, nps_score: 10, service_quality_score: 5, safety_compliance_score: 5, timeliness_score: 5 },
    { id: "b", client_id: "c-1", rating_stars: 2, nps_score: 3, service_quality_score: 2, safety_compliance_score: 2, timeliness_score: 2 }
  ];
  const guests = [{ id: "g1", source: "PUBLIC_QR", client_id: null, rating_stars: 1, triage_required: true, triage_status: "PENDING_REVIEW" },
    { id: "g2", source: "PUBLIC_QR", client_id: null, rating_stars: 5 }];
  assert.deepEqual(calculateNps([...client, ...guests]), calculateNps(client));
  assert.equal(calculateNps(guests).total_reviews, 0);
  assert.equal(calculateNps(guests).nps_score, 0);
  const deck = compileQbrExecutiveMetrics({ client_job_feedbacks: [...client, ...guests] });
  assert.deepEqual(deck.satisfaction, calculateNps(client));
  const { req, res } = mock({ user: { id: "u-admin" }, db: { client_job_feedbacks: [...client, ...guests] } });
  getFeedbackSummary(req, res);
  assert.deepEqual(res.body.data, calculateNps(client));
});

test("QR: the configured URL has no fallback and unsafe values are refused", () => {
  assert.equal(resolvePublicFeedbackUrl({ ORAC_PUBLIC_FEEDBACK_URL: URL_OK }), URL_OK);
  for (const v of [undefined, "", "   ", "http://x.example.invalid/f", "javascript:alert(1)", "https://u:p@x.example.invalid/f", "not a url", "https://x.example.invalid/" + "a".repeat(200)]) {
    assert.equal(resolvePublicFeedbackUrl({ ORAC_PUBLIC_FEEDBACK_URL: v }), null, String(v));
  }
  assert.equal(resolvePublicFeedbackUrl({}), null);
});

test("QR: the generator receives exactly the configured URL; bad generator output is refused", async () => {
  const seen = [];
  const out = await renderPublicFeedbackQr(URL_OK, { generator: async (t) => { seen.push(t); return '<svg xmlns="http://www.w3.org/2000/svg"></svg>'; } });
  assert.deepEqual(seen, [URL_OK]);
  assert.match(out.data_url, /^data:image\/svg\+xml;utf8,/);
  await assert.rejects(renderPublicFeedbackQr(URL_OK, { generator: async () => "<html></html>" }), (e) => e.statusCode === 502);
  await assert.rejects(renderPublicFeedbackQr(URL_OK, { generator: async () => null }), (e) => e.statusCode === 502);
});

test("QR endpoint: staff only; 503 when the URL is unset; real library used when installed", async (t) => {
  const prev = process.env.ORAC_PUBLIC_FEEDBACK_URL;
  t.after(() => { if (prev === undefined) delete process.env.ORAC_PUBLIC_FEEDBACK_URL; else process.env.ORAC_PUBLIC_FEEDBACK_URL = prev; });
  const call = async (user) => { const m = mock({ user }); await getPublicFeedbackQr(m.req, m.res); return m.res; };
  delete process.env.ORAC_PUBLIC_FEEDBACK_URL;
  assert.equal((await call({ id: "u-admin" })).statusCode, 503, "no fallback URL");
  process.env.ORAC_PUBLIC_FEEDBACK_URL = URL_OK;
  assert.equal((await call(undefined)).statusCode, 401);
  assert.equal((await call({ id: "u-tech" })).statusCode, 403);
  assert.equal((await call({ id: "u-cv" })).statusCode, 403, "Client Viewer cannot fetch the QR");
  const installed = await import("qrcode").then(() => true, () => false);
  const res = await call({ id: "u-admin" });
  if (!installed) {
    assert.equal(res.statusCode, 503);
    assert.match(res.body.message, /not installed/);
    t.diagnostic("qrcode not installed: real-library branch NOT RUN");
  } else {
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.url, URL_OK);
    assert.equal(res.body.data.text_link, URL_OK);
    assert.match(res.body.data.svg, /<svg[\s>]/);
  }
});

test("mount order: public write is limited before persistence and sits before the auth wall; reads are staff-only", () => {
  assert.ok(PUBLIC_WRITE_ROUTES.includes("POST /public/feedback"));
  const router = read("../src/router.js");
  const authAt = router.indexOf("router.use(authMiddleware)");
  assert.ok(router.indexOf("router.use(publicRoutes)") > -1 && router.indexOf("router.use(publicRoutes)") < authAt);
  assert.ok(router.indexOf("router.use(feedbackRoutes)") > authAt, "staff feedback routes are behind the auth wall");
  assert.ok(!router.slice(0, authAt).includes("/public/feedback"), "router.js pre-auth allowlist is unchanged");
  const pub = read("../src/modules/public/routes.js");
  assert.match(pub, /^router\.post\("\/public\/feedback", idempotencyKeyMiddleware, createPublicFeedback\);$/m);
  assert.ok(!/router\.(get|put|patch|delete)\("\/public\/feedback/.test(pub), "no public read or mutate on feedback");
  assert.match(read("../src/modules/feedback/routes.js"), /get\("\/feedback\/public-qr", getPublicFeedbackQr\)/);
  // same comparison as rateLimit.test.js: the limiter table equals the public write routes
  const found = [...router.slice(0, authAt).matchAll(/^router\.(post|put|patch|delete)\("([^"]+)"/gm)].map((m) => `${m[1].toUpperCase()} ${m[2]}`);
  for (const m of pub.matchAll(/^router\.(post|put|patch|delete)\("(\/public\/[^"]+)"/gm)) found.push(`${m[1].toUpperCase()} ${m[2]}`);
  assert.deepEqual(found.sort(), PUBLIC_WRITE_ROUTES.concat("POST /auth/login").sort());
});

test("POST /public/feedback is throttled per IP with Retry-After, before any store access", () => {
  let t = 1_000_000;
  const mw = createPublicEndpointLimits({ env: { RATE_LIMIT_PUBLIC_WRITE_MAX: "2", RATE_LIMIT_WINDOW_MS: "60000" }, now: () => t });
  const call = (ip) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    let passed = false;
    mw({ method: "POST", path: "/public/feedback", ip, headers: {}, body: {} }, res, () => { passed = true; });
    return { passed, res };
  };
  assert.equal(call("7.7.7.7").passed, true);
  assert.equal(call("7.7.7.7").passed, true);
  const blocked = call("7.7.7.7");
  assert.equal(blocked.passed, false);
  assert.equal(blocked.res.statusCode, 429);
  assert.ok(Number(blocked.res.headers["retry-after"]) >= 1);
  assert.equal(call("6.6.6.6").passed, true);
  t += 60_001;
  assert.equal(call("7.7.7.7").passed, true);
});
