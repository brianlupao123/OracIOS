/**
 * Tests for Structured Logging Service.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  StructuredLogger, requestLogger, redactObject,
  LOG_LEVELS, LEVEL_NAMES
} from "../src/services/structuredLoggingService.js";

// ═══════════════════ Constants ═══════════════════

describe("structuredLoggingService — constants", () => {
  it("defines 6 log levels in severity order", () => {
    assert.equal(LEVEL_NAMES.length, 6);
    assert.ok(LOG_LEVELS.error < LOG_LEVELS.warn);
    assert.ok(LOG_LEVELS.warn < LOG_LEVELS.info);
    assert.ok(LOG_LEVELS.info < LOG_LEVELS.http);
    assert.ok(LOG_LEVELS.http < LOG_LEVELS.debug);
    assert.ok(LOG_LEVELS.debug < LOG_LEVELS.trace);
  });
});

// ═══════════════════ redactObject ═══════════════════

describe("structuredLoggingService — redactObject", () => {
  it("redacts password and token fields", () => {
    const result = redactObject({
      username: "brian",
      password: "secret123",
      token: "abc.jwt.xyz"
    });
    assert.equal(result.username, "brian");
    assert.equal(result.password, "[REDACTED]");
    assert.equal(result.token, "[REDACTED]");
  });

  it("redacts nested sensitive fields", () => {
    const result = redactObject({
      user: { name: "John", bank_account_number: "12345678" }
    });
    assert.equal(result.user.name, "John");
    assert.equal(result.user.bank_account_number, "[REDACTED]");
  });

  it("handles arrays", () => {
    const result = redactObject([
      { password: "secret", name: "A" },
      { password: "other", name: "B" }
    ]);
    assert.equal(result[0].password, "[REDACTED]");
    assert.equal(result[0].name, "A");
  });

  it("handles null and primitives safely", () => {
    assert.equal(redactObject(null), null);
    assert.equal(redactObject("string"), "string");
    assert.equal(redactObject(42), 42);
  });
});

// ═══════════════════ StructuredLogger ═══════════════════

describe("structuredLoggingService — StructuredLogger", () => {
  it("creates structured JSON entries with timestamp, level, message", () => {
    const captured = [];
    const log = new StructuredLogger({
      level: "debug", transport: (e) => captured.push(e)
    });

    log.info("Server started", { port: 3000 });

    assert.equal(captured.length, 1);
    assert.equal(captured[0].level, "info");
    assert.equal(captured[0].message, "Server started");
    assert.equal(captured[0].port, 3000);
    assert.ok(captured[0].timestamp);
    assert.equal(captured[0].service, "orac-backend");
  });

  it("filters by log level", () => {
    const captured = [];
    const log = new StructuredLogger({
      level: "warn", transport: (e) => captured.push(e)
    });

    log.error("Error");   // should appear (error < warn)
    log.warn("Warning");  // should appear
    log.info("Info");     // should NOT appear (info > warn)
    log.debug("Debug");   // should NOT appear

    assert.equal(captured.length, 2);
    assert.equal(captured[0].level, "error");
    assert.equal(captured[1].level, "warn");
  });

  it("supports all 6 log methods", () => {
    const log = new StructuredLogger({ level: "trace", transport: () => {} });

    log.error("e"); log.warn("w"); log.info("i");
    log.http("h"); log.debug("d"); log.trace("t");

    assert.equal(log.getEntries().length, 6);
  });

  it("redacts sensitive fields by default", () => {
    const captured = [];
    const log = new StructuredLogger({
      level: "info", transport: (e) => captured.push(e)
    });

    log.info("Login attempt", { email: "brian@orac.co.zw", password: "secret" });

    assert.equal(captured[0].email, "brian@orac.co.zw");
    assert.equal(captured[0].password, "[REDACTED]");
  });

  it("can disable redaction", () => {
    const captured = [];
    const log = new StructuredLogger({
      level: "info", transport: (e) => captured.push(e), redact: false
    });

    log.info("Test", { password: "visible" });
    assert.equal(captured[0].password, "visible");
  });

  it("creates child loggers with bound context", () => {
    const captured = [];
    const log = new StructuredLogger({
      level: "info", transport: (e) => captured.push(e)
    });

    const child = log.child({ requestId: "req-123", userId: "u-1" });
    child.info("Processing request");

    assert.equal(captured[0].requestId, "req-123");
    assert.equal(captured[0].userId, "u-1");
    assert.equal(captured[0].message, "Processing request");
  });

  it("getEntries and clearEntries work", () => {
    const log = new StructuredLogger({ level: "info", transport: () => {} });
    log.info("A"); log.info("B");
    assert.equal(log.getEntries().length, 2);
    log.clearEntries();
    assert.equal(log.getEntries().length, 0);
  });
});

// ═══════════════════ requestLogger middleware ═══════════════════

describe("structuredLoggingService — requestLogger middleware", () => {
  it("logs request with method, path, status, and duration", (t, done) => {
    const captured = [];
    const log = new StructuredLogger({
      level: "http", transport: (e) => captured.push(e)
    });

    const middleware = requestLogger(log);

    // Mock req/res
    const req = {
      method: "GET",
      url: "/api/dispatches",
      originalUrl: "/api/dispatches",
      headers: { "x-request-id": "test-req-1" }
    };

    let endCalled = false;
    const res = {
      statusCode: 200,
      end: function () {
        endCalled = true;
        // Check log was written
        assert.equal(captured.length, 1);
        assert.equal(captured[0].method, "GET");
        assert.equal(captured[0].path, "/api/dispatches");
        assert.equal(captured[0].statusCode, 200);
        assert.ok(captured[0].durationMs >= 0);
        assert.equal(captured[0].requestId, "test-req-1");
        done();
      }
    };

    middleware(req, res, () => {
      // Check requestId was attached
      assert.equal(req.requestId, "test-req-1");
      assert.ok(req.log);
      // Simulate response
      res.end();
    });
  });

  it("logs error level for 500+ status codes", (t, done) => {
    const captured = [];
    const log = new StructuredLogger({
      level: "http", transport: (e) => captured.push(e)
    });

    const middleware = requestLogger(log);
    const req = { method: "POST", url: "/api/fail", headers: {} };
    const res = {
      statusCode: 500,
      end: function () {
        assert.equal(captured[0].level, "error");
        done();
      }
    };

    middleware(req, res, () => { res.end(); });
  });

  it("logs warn level for 400+ status codes", (t, done) => {
    const captured = [];
    const log = new StructuredLogger({
      level: "http", transport: (e) => captured.push(e)
    });

    const middleware = requestLogger(log);
    const req = { method: "POST", url: "/api/bad", headers: {} };
    const res = {
      statusCode: 403,
      end: function () {
        assert.equal(captured[0].level, "warn");
        done();
      }
    };

    middleware(req, res, () => { res.end(); });
  });
});
