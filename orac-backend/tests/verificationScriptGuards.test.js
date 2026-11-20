import test from "node:test";
import assert from "node:assert/strict";
import { requireEmptyStoreBootstrap, requireLocalEmailProbe } from "../src/verificationScriptGuards.js";

test("empty-store bootstrap refuses the old implicit fixture command", () => {
  assert.throws(() => requireEmptyStoreBootstrap([], {}), /Empty-store bootstrap only/);
  assert.throws(() => requireEmptyStoreBootstrap(["--apply"], { ORAC_ALLOW_EMPTY_STORE_BOOTSTRAP: "true" }), /explicit source JSON path/);
  assert.throws(() => requireEmptyStoreBootstrap(["data/db.json", "--apply"], {}), /ORAC_ALLOW_EMPTY_STORE_BOOTSTRAP/);
  assert.throws(() => requireEmptyStoreBootstrap(["data/db.json"], { ORAC_ALLOW_EMPTY_STORE_BOOTSTRAP: "true" }), /--apply/);
  assert.equal(requireEmptyStoreBootstrap(["reviewed-import.json", "--apply"], { ORAC_ALLOW_EMPTY_STORE_BOOTSTRAP: "true" }), "reviewed-import.json");
});

test("live local-fixture SMTP cannot start without explicit recipient and mode", () => {
  const namedFixture = ["--fixture-json", "fixture.json", "--quote-id", "FX-Q-001"];
  assert.throws(() => requireLocalEmailProbe([], {}, true), /--fixture-json/);
  assert.deepEqual(requireLocalEmailProbe(namedFixture, {}, true), { fixturePath: "fixture.json", quoteId: "FX-Q-001" });
  assert.throws(() => requireLocalEmailProbe(namedFixture, { TEST_RECIPIENT: "test@example.invalid" }, false), /--live-fixture/);
  assert.throws(() => requireLocalEmailProbe([...namedFixture, "--live-fixture"], {}, false), /TEST_RECIPIENT/);
  assert.doesNotThrow(() => requireLocalEmailProbe([...namedFixture, "--live-fixture"], { TEST_RECIPIENT: "test@example.invalid" }, false));
});
