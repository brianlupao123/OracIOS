import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "../src/middleware/publicRateLimit.js";

function run(limiter, ip) {
  let result = "next";
  const res = { headers: {}, set(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { result = { code: this.code, body: b }; } };
  limiter({ ip }, res, () => {});
  return result;
}

test("allows up to the limit, then answers 429 with Retry-After", () => {
  let t = 1000;
  const l = createRateLimiter({ max: 3, windowMs: 60000, now: () => t });
  assert.deepEqual([run(l, "a"), run(l, "a"), run(l, "a")], ["next", "next", "next"]);
  const blocked = run(l, "a");
  assert.equal(blocked.code, 429);
  assert.equal(blocked.body.success, false);
});

test("each visitor has their own allowance", () => {
  const l = createRateLimiter({ max: 1, windowMs: 60000 });
  assert.equal(run(l, "a"), "next");
  assert.equal(run(l, "b"), "next");
  assert.equal(run(l, "a").code, 429);
});

test("the allowance comes back after the window", () => {
  let t = 0;
  const l = createRateLimiter({ max: 1, windowMs: 1000, now: () => t });
  assert.equal(run(l, "a"), "next");
  assert.equal(run(l, "a").code, 429);
  t = 1001;
  assert.equal(run(l, "a"), "next");
});
