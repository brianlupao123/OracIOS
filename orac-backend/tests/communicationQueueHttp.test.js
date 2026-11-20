import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { roles } from "../src/permissions.js";
import communicationsRouter from "../src/modules/communications/routes.js";

test("communication queue HTTP routes are Admin-only across every role", async () => {
  const db = { communication_queue: [], audit_logs: [] };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: "test-user", role: req.headers["x-test-role"], is_active: true };
    req.db = db;
    req.store = { audit() {} };
    next();
  });
  app.use("/api", communicationsRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/communications/queue`;
  try {
    for (const role of Object.values(roles).filter((value) => value !== roles.ADMIN)) {
      for (const [method, path] of [["GET", ""], ["GET", "/stats"], ["POST", ""], ["POST", "/unknown/dispatch"]]) {
        const response = await fetch(base + path, {
          method, headers: { "x-test-role": role, "content-type": "application/json" },
          ...(method === "POST" ? { body: JSON.stringify({ subject: "test", body: "test", recipient_email: "lupaob1@gmail.com" }) } : {})
        });
        assert.equal(response.status, 403, `${role} ${method} ${path}`);
      }
    }
    const list = await fetch(base, { headers: { "x-test-role": roles.ADMIN } });
    assert.equal(list.status, 200);
    const created = await fetch(base, {
      method: "POST",
      headers: { "x-test-role": roles.ADMIN, "content-type": "application/json" },
      body: JSON.stringify({ subject: "Pilot", body: "Hello", recipient_email: "lupaob1@gmail.com" })
    });
    assert.equal(created.status, 201);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
