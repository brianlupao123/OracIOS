import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { roles } from "../src/permissions.js";
import communicationsRouter from "../src/modules/communications/routes.js";

test("communication HTTP routes enforce Sales portfolio and office roles", async () => {
  const db = {
    users: [
      { id: "sales-a", role: roles.SALES, is_active: true },
      { id: "sales-b", role: roles.SALES, is_active: true },
      { id: "admin", role: roles.ADMIN, is_active: true },
      { id: "client", role: roles.CLIENT_VIEWER, client_id: "client-a", is_active: true }
    ],
    clients: [{ id: "client-a" }, { id: "client-b" }],
    quotes: [
      { id: "q-a", client_id: "client-a", sales_owner_id: "sales-a" },
      { id: "q-b", client_id: "client-b", sales_owner_id: "sales-b" }
    ],
    communication_evidence: [], communication_queue: [], audit_logs: []
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const user = db.users.find(u => u.id === req.headers["x-test-user"]);
    req.user = user;
    req.db = db;
    req.store = { audit() {} };
    next();
  });
  app.use("/api", communicationsRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/communications`;
  const call = (user, path, body) => fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "x-test-user": user, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  try {
    const record = id => ({ business_record_type: "quote", business_record_id: id,
      recipient_email: "test@example.invalid", subject: "Quote", channel: "personal_email" });
    assert.equal((await call("sales-a", "/timeline/quote/q-b")).status, 403);
    assert.equal((await call("sales-a", "/record-external-send", record("q-b"))).status, 403);
    assert.equal((await call("sales-a", "/preview", { template_name: "quote_sent", entity_type: "quote", entity_id: "q-b" })).status, 403);
    assert.equal((await call("client", "/timeline/quote/q-a")).status, 403);
    assert.equal((await call("sales-a", "/digest")).status, 403);
    assert.equal(db.communication_evidence.length, 0);
    assert.equal((await call("sales-a", "/timeline/quote/q-a")).status, 200);
    assert.equal((await call("sales-a", "/record-external-send", record("q-a"))).status, 201);
    assert.equal((await call("admin", "/timeline/quote/q-b")).status, 200);
    assert.equal((await call("admin", "/digest")).status, 200);
    assert.equal(db.communication_evidence.length, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
