import test from "node:test";
import assert from "node:assert/strict";
import { validate } from "../src/modules/public/booking/validateEnquiry.js";

const good = { type: "quote", name: "Tendai", phone: "0777", items: ["Hot & Cold Vulcanizing"] };

test("validation accepts good input and trims", () => {
  const { errors, record } = validate({ ...good, name: "  Tendai  " });
  assert.deepEqual(errors, []);
  assert.equal(record.name, "Tendai");
});

test("validation rules per type", () => {
  assert.match(validate({}).errors.join(), /Unknown request type/);
  assert.match(validate({ type: "quote", name: "A", phone: "1" }).errors.join(), /Add at least one item/);
  assert.match(validate({ type: "emergency", name: "A", phone: "1" }).errors.join(), /site location/);
  assert.match(validate({ type: "emergency", name: "A", email: "a@b.co", siteLocation: "X" }).errors.join(), /phone number is required/);
  assert.match(validate({ type: "survey", name: "A", phone: "1", siteLocation: "X" }).errors.join(), /type of survey/);
  assert.match(validate({ type: "survey", name: "A", phone: "1", siteLocation: "X", surveyType: "Audit", preferredDate: "soon" }).errors.join(), /date/);
  assert.match(validate({ type: "chat", name: "A", phone: "1" }).errors.join(), /describe/);
  assert.match(validate({ type: "contact", name: "A", email: "bad", message: "x" }).errors.join(), /invalid/);
});

test("overlong input is truncated, non-strings ignored", () => {
  const { record } = validate({ ...good, message: "x".repeat(9000), company: 42 });
  assert.equal(record.message.length, 4000);
  assert.equal(record.company, "");
});
