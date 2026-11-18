import test from "node:test";
import assert from "node:assert/strict";
import { toLead, describeNeed } from "../src/modules/public/booking/leadMapper.js";

const base = { name: "Tendai Moyo", phone: "0777000000", email: "t@mine.co.zw", siteLocation: "Ngezi concentrator" };

test("quote -> standard lead with the items in service_need", () => {
  const l = toLead({ ...base, type: "quote", company: "Mine Co", items: ["Hot & Cold Vulcanizing", "Sandblasting"], message: "By Friday" }, { reference: "AB12CD34" });
  assert.equal(l.company_name, "Mine Co");
  assert.equal(l.contact_name, "Tendai Moyo");
  assert.equal(l.mine_site, "Ngezi concentrator");
  assert.equal(l.urgency, "standard");
  assert.match(l.service_need, /Hot & Cold Vulcanizing; Sandblasting/);
  assert.equal(l.source, "website");
  assert.equal(l.website_reference, "AB12CD34");
});

test("emergency -> urgent, flagged in the text, works with a phone and no email", () => {
  const l = toLead({ type: "emergency", name: "Shift boss", phone: "0777", siteLocation: "Plant 2", message: "Belt snapped" });
  assert.equal(l.urgency, "urgent");
  assert.match(l.service_need, /^EMERGENCY call-out\. Belt snapped/);
  assert.equal(l.email, "");
});

test("survey with a booked slot records the slot and booking reference", () => {
  const l = toLead({ ...base, type: "survey", surveyType: "Conveyor belt audit", slotDate: "2026-10-09", slotTime: "10:00" }, { reference: "REF00001" });
  assert.match(l.service_need, /Site survey: Conveyor belt audit\. Requested slot: 2026-10-09 10:00/);
  assert.equal(l.booking_reference, "REF00001");
  assert.equal(toLead({ ...base, type: "survey", surveyType: "Audit" }).booking_reference, "");
});

test("a missing company never leaves the required field empty", () => {
  assert.match(toLead({ ...base, type: "contact", message: "hi" }).company_name, /company not given/);
  assert.match(toLead({ ...base, type: "chat", company: "   ", message: "hi" }).company_name, /company not given/);
});

test("hostile or oversized input is trimmed and never throws", () => {
  const l = toLead({ ...base, type: "contact", message: "x".repeat(50000), name: "  A  " });
  assert.ok(l.service_need.length <= 1000);
  assert.equal(l.contact_name, "A");
  assert.doesNotThrow(() => describeNeed({ type: "quote" }));
  assert.doesNotThrow(() => toLead({ type: "nonsense" }));
});

test("a website visitor is a lead, never a client", () => {
  const l = toLead({ ...base, type: "quote", items: ["x"] });
  assert.ok(!("client_id" in l) && !("role" in l));
});
