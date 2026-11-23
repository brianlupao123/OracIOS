// orac-backend/tests/configurationTripwires.test.js
//
// ORAC P7 - configuration tripwires. Baseline 99c8a339a5200e769a53f861898834dd7e299b44.
//
// Pins configuration-safety behaviour that the supplied source actually implements:
//   1. email: controlled-recipient allowlist fails closed; dry-run is the default; live SMTP needs
//      complete credentials; SMTP_FROM must be a single bare address; refusals never carry secrets;
//   2. payment details: no valid 32-byte standard-base64 key means nothing is stored or read;
//   3. CORS: createCors() as implemented, for production origins and for arbitrary origins.
//
// Deliberately NOT covered (the supplied source cannot prove it; see OWNER_DECISIONS.md):
//   - config.js / validateRuntimeConfig(), auth.js, router.js, configuredStore.js: config.js reads the
//     backend .env file when it is imported, and this file must not read .env.
//   - TOTP / V5 default-dark behaviour: totpPolicy.js and v5InvoiceWriterPolicy.js were not supplied.
//   - server.js wiring (CORS_ORIGINS parsing, isProduction, when validateRuntimeConfig runs).
//
// Rules this file follows:
//   - Only synthetic values. Nothing is read from .env, a real SMTP server or a real database.
//   - Environment variables are snapshotted, cleared and restored around every test that touches
//     process.env, so an ambient developer or CI environment cannot change a result.
//   - net.connect / net.createConnection / tls.connect are replaced with a tripwire for every email
//     test, and any attempted connection fails the run. No test here reaches the network on purpose.
//   - Assertions about secrets compare booleans and never print the value being protected, so a
//     failing run cannot leak a synthetic (or, by accident, a real) secret into logs.

import assert from "node:assert/strict";
import net from "node:net";
import tls from "node:tls";
import { isDeepStrictEqual } from "node:util";
import { afterEach, beforeEach, describe, it } from "node:test";
import { CORS_ALLOWED_HEADERS, CORS_EXPOSED_HEADERS, createCors } from "../src/middleware/cors.js";
import { decryptPaymentDetails, encryptPaymentDetails, paymentEncryptionConfigured } from "../src/paymentDetails.js";
import {
  buildMimeMessage,
  getAllowedRecipients,
  getTransportConfig,
  isRecipientPermitted,
  sendEmail
} from "../src/services/communicationTransportService.js";

// ---------- synthetic fixtures ----------

const ALLOWED = "recipient-one@orac.test";
const OUTSIDER = "outsider@elsewhere.test";

// Obviously fake credentials. None of these is, or resembles, a real secret.
const SYNTH = Object.freeze({
  host: "relay.synthetic.invalid",
  user: "synthetic-smtp-user-3c91d7",
  pass: "SYNTH-SMTP-PASS-8e24b6f1",
  sender: "tripwire-sender@orac.test"
});
const SECRET_VALUES = [SYNTH.user, SYNTH.pass];
const FULL_SMTP = Object.freeze({
  SMTP_HOST: SYNTH.host,
  SMTP_USER: SYNTH.user,
  SMTP_PASS: SYNTH.pass,
  SMTP_FROM: SYNTH.sender
});

// Deterministic synthetic payment keys: 32 bytes of a repeated byte, standard base64 (43 chars + "=").
const KEY = Buffer.alloc(32, 0x5a).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 0xa5).toString("base64");
const DETAILS = Object.freeze({
  payment_method: "bank",
  bank_name: "Synthetic Test Bank",
  bank_account: "SYNTH-ACCT-0001",
  bank_branch: "SYNTH-BRANCH-03",
  ecocash_number: "SYNTH-ECO-0002"
});
// payment_method's value ("bank") is left out on purpose: it is a substring of field names in the envelope.
const PLAINTEXT_NEEDLES = [DETAILS.bank_name, DETAILS.bank_account, DETAILS.bank_branch, DETAILS.ecocash_number];

const ENV_KEYS = [
  "CONTROLLED_RECIPIENT_ALLOWLIST",
  "COMMUNICATIONS_DRY_RUN",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "EMAIL_FROM",
  "ORAC_PAYMENT_ENCRYPTION_KEY"
];

// ---------- helpers ----------

/** Snapshot, clear and restore every variable this file can touch, around each test in the enclosing describe. */
function useIsolatedEnv() {
  let saved = null;
  beforeEach(() => {
    saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
  });
  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved = null;
  });
}

/** Set (or, with undefined, delete) variables, refusing any name that is not under isolation. */
function setEnv(vars) {
  for (const [key, value] of Object.entries(vars)) {
    assert.ok(ENV_KEYS.includes(key), `setEnv: ${key} is not under isolation`);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** Replace the socket constructors the transport uses; any call is recorded and fails the test. */
function useNetworkTripwire() {
  let state = null;
  beforeEach(() => {
    const calls = [];
    const originals = { connect: net.connect, createConnection: net.createConnection, tlsConnect: tls.connect };
    const trip = (name) => () => {
      calls.push(name);
      throw new Error("NETWORK_TRIPWIRE: configuration tests must never open a connection");
    };
    net.connect = trip("net.connect");
    net.createConnection = trip("net.createConnection");
    tls.connect = trip("tls.connect");
    state = { calls, originals };
  });
  afterEach(() => {
    const { calls, originals } = state;
    net.connect = originals.connect;
    net.createConnection = originals.createConnection;
    tls.connect = originals.tlsConnect;
    state = null;
    assert.deepEqual(calls, [], "a test attempted to open a network connection");
  });
}

async function attempt(run) {
  try {
    return { value: await run(), error: null };
  } catch (error) {
    return { value: undefined, error };
  }
}

function attemptSync(run) {
  try {
    return { value: run(), error: null };
  } catch (error) {
    return { value: undefined, error };
  }
}

/** Everything a value could show a reader: String(), JSON, and for errors message, stack, status, code, cause. */
function serialize(value) {
  const parts = [];
  try { parts.push(String(value)); } catch { /* exotic value: JSON below still runs */ }
  try {
    parts.push(JSON.stringify(value, (_key, v) => {
      if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack, status: v.status, code: v.code, cause: v.cause };
      if (typeof v === "bigint") return v.toString();
      return v;
    }) ?? "");
  } catch { /* circular: String() above still covers the message */ }
  if (value instanceof Error) parts.push(value.stack ?? "");
  return parts.join("\n");
}

const leaks = (value, needles) => {
  const haystack = serialize(value);
  return needles.some((needle) => haystack.includes(needle));
};

/** Fails with `label` only; never prints the value or the needles. */
function assertNoLeak(label, value, needles) {
  assert.equal(leaks(value, needles), false, `${label}: output contains a protected synthetic value`);
}

function assertRefusal(outcome, expected, needles = []) {
  assert.notEqual(outcome.error, null, "expected the call to be refused, but it succeeded");
  assert.equal(outcome.error.status, expected.status, "refusal status");
  if (expected.code !== undefined) assert.equal(outcome.error.code, expected.code, "refusal code");
  assertNoLeak("refusal", outcome.error, needles);
}

const liveEnv = (extra = {}) => ({
  CONTROLLED_RECIPIENT_ALLOWLIST: ALLOWED,
  COMMUNICATIONS_DRY_RUN: "false",
  ...FULL_SMTP,
  ...extra
});
const mail = (to = ALLOWED) => ({ to, subject: "Tripwire subject", body: "Tripwire body" });

// ---------- email: controlled recipient allowlist ----------

describe("email allowlist fails closed", () => {
  useIsolatedEnv();
  useNetworkTripwire();

  it("an unset, empty, blank or separator-only allowlist permits nobody", () => {
    for (const value of [undefined, "", "   ", ",", " , ,, ", "\t\n"]) {
      setEnv({ CONTROLLED_RECIPIENT_ALLOWLIST: value });
      const label = `allowlist ${JSON.stringify(value)}`;
      assert.deepEqual(getAllowedRecipients(), [], label);
      assert.deepEqual(getTransportConfig().allowedRecipients, [], `${label} (transport config)`);
      assert.equal(isRecipientPermitted(ALLOWED), false, label);
    }
  });

  it("wildcards never widen the allowlist", () => {
    setEnv({ CONTROLLED_RECIPIENT_ALLOWLIST: "*" });
    assert.deepEqual(getAllowedRecipients(), []);
    assert.equal(isRecipientPermitted(OUTSIDER), false);

    setEnv({ CONTROLLED_RECIPIENT_ALLOWLIST: `${ALLOWED},*` });
    assert.deepEqual(getAllowedRecipients(), [ALLOWED], "a bare * beside real entries is ignored, not honoured");
    assert.equal(isRecipientPermitted(OUTSIDER), false);

    for (const pattern of ["*@orac.test", "@orac.test", "orac.test"]) {
      setEnv({ CONTROLLED_RECIPIENT_ALLOWLIST: pattern });
      assert.equal(isRecipientPermitted("someone-else@orac.test"), false, `domain pattern ${pattern} must not match members`);
    }
  });

  it("matching is exact after trim and lowercase: lists, display names, injected headers and non-strings are refused", () => {
    setEnv({ CONTROLLED_RECIPIENT_ALLOWLIST: ALLOWED });
    assert.equal(isRecipientPermitted(`  ${ALLOWED.toUpperCase()}  `), true, "control: trim and case are the only normalisation");
    const refused = [
      `${ALLOWED}, other@orac.test`,
      `${ALLOWED};other@orac.test`,
      `<${ALLOWED}>`,
      `Name <${ALLOWED}>`,
      `${ALLOWED}\r\nBcc: other@orac.test`,
      [ALLOWED],
      { address: ALLOWED },
      42,
      "",
      null,
      undefined
    ];
    for (const candidate of refused) {
      assert.equal(isRecipientPermitted(candidate), false, `refused candidate: ${typeof candidate}`);
    }
  });

  it("the allowlist is enforced before dry-run, so an empty allowlist refuses even in the default dry-run mode", async () => {
    for (const dryRun of [undefined, "true"]) {
      setEnv({ CONTROLLED_RECIPIENT_ALLOWLIST: undefined, COMMUNICATIONS_DRY_RUN: dryRun });
      assertRefusal(await attempt(() => sendEmail(mail())), { status: 403, code: "RECIPIENT_NOT_ALLOWED" });
    }
  });

  it("the allowlist is evaluated before SMTP configuration, so an outsider gets 403 and not 503, and no credentials leak", async () => {
    setEnv(liveEnv());
    assertRefusal(await attempt(() => sendEmail(mail(OUTSIDER))), { status: 403, code: "RECIPIENT_NOT_ALLOWED" }, SECRET_VALUES);

    setEnv({ SMTP_HOST: undefined, SMTP_USER: undefined, SMTP_PASS: undefined });
    assertRefusal(await attempt(() => sendEmail(mail(OUTSIDER))), { status: 403, code: "RECIPIENT_NOT_ALLOWED" });
  });
});

// ---------- email: dry-run default and live-mode gating ----------

describe("email dry-run is the default and live sending needs complete configuration", () => {
  useIsolatedEnv();
  useNetworkTripwire();

  it("only the exact string 'false' disables dry-run", () => {
    const stillDryRun = [undefined, "", "true", "TRUE", "True", "False", "FALSE", "0", "no", "off", " false", "false ", "false\n"];
    for (const value of stillDryRun) {
      setEnv({ COMMUNICATIONS_DRY_RUN: value });
      assert.equal(getTransportConfig().dryRun, true, `COMMUNICATIONS_DRY_RUN=${JSON.stringify(value)} must remain dry-run`);
    }
    setEnv({ COMMUNICATIONS_DRY_RUN: "false" });
    assert.equal(getTransportConfig().dryRun, false, "control: the exact string 'false' is the only live switch");
  });

  it("dry-run needs no SMTP configuration, returns a descriptor, and complete credentials alone do not enable live sending", async () => {
    const scenarios = [
      ["no credentials, flag unset", {}],
      ["no credentials, flag true", { COMMUNICATIONS_DRY_RUN: "true" }],
      ["complete credentials, flag unset", { ...FULL_SMTP }],
      ["complete credentials, flag true", { ...FULL_SMTP, COMMUNICATIONS_DRY_RUN: "true" }]
    ];
    for (const [label, vars] of scenarios) {
      setEnv({ CONTROLLED_RECIPIENT_ALLOWLIST: ALLOWED, COMMUNICATIONS_DRY_RUN: undefined, SMTP_HOST: undefined, SMTP_USER: undefined, SMTP_PASS: undefined, SMTP_FROM: undefined, ...vars });
      const outcome = await attempt(() => sendEmail(mail()));
      assert.equal(outcome.error, null, `${label}: dry-run must not be refused`);
      assert.equal(outcome.value.success, true, label);
      assert.equal(outcome.value.mode, "dry-run", label);
      assert.ok(String(outcome.value.messageId).startsWith("dry_"), `${label}: dry-run message id`);
      assertNoLeak(label, outcome.value, SECRET_VALUES);
    }
  });

  it("live mode is refused with 503 SMTP_UNCONFIGURED unless host, user and pass are all present, and nothing leaks", async () => {
    const names = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
    // mask bit i set = names[i] is present. Mask 7 (all present) is the control below.
    for (let mask = 0; mask < 7; mask += 1) {
      setEnv({ CONTROLLED_RECIPIENT_ALLOWLIST: ALLOWED, COMMUNICATIONS_DRY_RUN: "false", SMTP_FROM: SYNTH.sender });
      for (const [index, name] of names.entries()) setEnv({ [name]: mask & (1 << index) ? FULL_SMTP[name] : undefined });
      const label = `present: ${names.filter((_, i) => mask & (1 << i)).join("+") || "none"}`;
      assert.equal(getTransportConfig().isConfigured, false, `${label}: isConfigured`);
      assertRefusal(await attempt(() => sendEmail(mail())), { status: 503, code: "SMTP_UNCONFIGURED" }, SECRET_VALUES);
    }

    for (const name of names) {
      setEnv(liveEnv({ [name]: "" }));
      assert.equal(getTransportConfig().isConfigured, false, `empty ${name} counts as missing`);
      assertRefusal(await attempt(() => sendEmail(mail())), { status: 503, code: "SMTP_UNCONFIGURED" }, SECRET_VALUES);
    }

    setEnv({ CONTROLLED_RECIPIENT_ALLOWLIST: ALLOWED, COMMUNICATIONS_DRY_RUN: undefined, ...FULL_SMTP });
    const control = getTransportConfig();
    assert.equal(control.isConfigured, true, "control: all three credentials present");
    assert.equal(control.dryRun, true, "control: complete credentials alone keep dry-run on");
  });
});

// ---------- email: sender and redaction ----------

describe("email sender is a single bare address, and failures never carry credentials", () => {
  useIsolatedEnv();
  useNetworkTripwire();

  it("buildMimeMessage accepts one bare address and refuses lists, display names and CR, LF or NUL in the sender", () => {
    const base = { to: ALLOWED, toName: "Tripwire", subject: "Tripwire subject", body: "Tripwire body" };
    const accepted = attemptSync(() => buildMimeMessage({ ...base, from: SYNTH.sender }));
    assert.equal(accepted.error, null, "control: a bare address is accepted");
    assert.ok(accepted.value.payload.includes(`From: <${SYNTH.sender}>`), "control: header built from the bare address");

    const refused = [
      `Display Name <${SYNTH.sender}>`,
      `<${SYNTH.sender}>`,
      `${SYNTH.sender}, second@orac.test`,
      ` ${SYNTH.sender}`,
      `${SYNTH.sender}\r`,
      `${SYNTH.sender}\n`,
      `${SYNTH.sender}\0`,
      `${SYNTH.sender}\r\nBcc: other@orac.test`,
      "sender",
      "sender@host",
      ""
    ];
    for (const from of refused) {
      const outcome = attemptSync(() => buildMimeMessage({ ...base, from }));
      assert.notEqual(outcome.error, null, `sender ${JSON.stringify(from)} must be refused`);
      assert.equal(outcome.error.status, 400, `sender ${JSON.stringify(from)} status`);
    }
  });

  it("live sending refuses a non-bare SMTP_FROM with 400 before any connection, without echoing credentials", async () => {
    const badSenders = [
      `Display Name <${SYNTH.sender}>`,
      `${SYNTH.sender}, second@orac.test`,
      `${SYNTH.sender}\r\nBcc: other@orac.test`,
      `${SYNTH.sender}\nRCPT TO:<other@orac.test>`,
      "not-an-address"
    ];
    for (const sender of badSenders) {
      setEnv(liveEnv({ SMTP_FROM: sender }));
      assertRefusal(await attempt(() => sendEmail(mail())), { status: 400 }, SECRET_VALUES);
    }
  });

  it("the sender falls back SMTP_FROM, then EMAIL_FROM, then SMTP_USER; a non-address fallback fails live sending without echoing the credential", async () => {
    setEnv({ SMTP_USER: SYNTH.user });
    assert.ok(getTransportConfig().from === SYNTH.user, "with only SMTP_USER set, the sender falls back to it");
    setEnv({ EMAIL_FROM: "email-from@orac.test" });
    assert.equal(getTransportConfig().from, "email-from@orac.test");
    setEnv({ SMTP_FROM: SYNTH.sender });
    assert.equal(getTransportConfig().from, SYNTH.sender);

    // SMTP_USER is not an address here, and neither SMTP_FROM nor EMAIL_FROM is set.
    setEnv(liveEnv({ SMTP_FROM: undefined, EMAIL_FROM: undefined }));
    assertRefusal(await attempt(() => sendEmail(mail())), { status: 400 }, SECRET_VALUES);
  });

  // README items 3 and 7 say returned configuration never reveals SMTP secrets, but the baseline source does
  // not support that: getTransportConfig() returns `pass` (and `user`) verbatim. This is a body-less marker, so
  // it runs nothing and claims no guarantee; it only keeps the gap visible in every run. Once
  // getTransportConfig() redacts (a production change, OWNER_DECISIONS.md D1), replace it with a real guard.
  it("getTransportConfig() does not return the SMTP password", () => {
    setEnv(liveEnv());
    assertNoLeak("getTransportConfig()", getTransportConfig(), [SYNTH.pass]);
    assert.equal(getTransportConfig().pass, undefined);
    assert.equal(getTransportConfig().hasPassword, true);
  });
});

// ---------- payment details: encryption key fails closed ----------

describe("payment details fail closed without a valid encryption key", () => {
  const envWith = (value) => (value === undefined ? {} : { ORAC_PAYMENT_ENCRYPTION_KEY: value });
  const validEnvelope = encryptPaymentDetails(DETAILS, envWith(KEY));
  const INVALID_KEYS = [
    ["unset", undefined],
    ["empty", ""],
    ["whitespace only", "   "],
    ["31 bytes", Buffer.alloc(31, 0x5a).toString("base64")],
    ["33 bytes", Buffer.alloc(33, 0x5a).toString("base64")],
    ["64 bytes", Buffer.alloc(64, 0x5a).toString("base64")],
    ["32 bytes as hex", Buffer.alloc(32, 0x5a).toString("hex")],
    ["a passphrase", "synthetic-passphrase-not-a-key-000"],
    ["a valid key with a trailing newline", `${KEY}\n`],
    ["a valid key with a leading space", ` ${KEY}`],
    ["a valid key wrapped in quotes", `"${KEY}"`]
  ];

  it("no valid key means 503 on store and on read, with nothing leaked", () => {
    for (const [label, value] of INVALID_KEYS) {
      const env = envWith(value);
      assert.equal(paymentEncryptionConfigured(env), false, `${label}: configured`);
      assertRefusal(attemptSync(() => encryptPaymentDetails(DETAILS, env)), { status: 503 }, [...PLAINTEXT_NEEDLES, KEY]);
      assertRefusal(attemptSync(() => decryptPaymentDetails(validEnvelope, env)), { status: 503 }, [...PLAINTEXT_NEEDLES, KEY]);
    }
  });

  it("an absent envelope reads as empty without a key, because there is nothing to protect", () => {
    for (const envelope of [undefined, null, {}, { data: "" }]) {
      const outcome = attemptSync(() => decryptPaymentDetails(envelope, {}));
      assert.equal(outcome.error, null, "no key and no envelope must not be an error");
      assert.ok(isDeepStrictEqual(outcome.value, {}), "reads as an empty object");
    }
  });

  it("a valid key round-trips only the known fields, and the envelope holds no plaintext or key", () => {
    const env = envWith(KEY);
    assert.equal(paymentEncryptionConfigured(env), true, "control: valid key is accepted");

    const envelope = encryptPaymentDetails({ ...DETAILS, not_a_payment_field: "SYNTH-IGNORED-FIELD" }, env);
    assert.equal(envelope.v, 1);
    assert.ok(isDeepStrictEqual([...envelope.fields].sort(), Object.keys(DETAILS).sort()), "only the declared payment fields are kept");
    assert.equal(envelope.data.split(".").length, 3, "iv.tag.ciphertext");
    assertNoLeak("envelope", envelope, [...PLAINTEXT_NEEDLES, "SYNTH-IGNORED-FIELD", KEY]);
    assert.ok(isDeepStrictEqual(decryptPaymentDetails(envelope, env), { ...DETAILS }), "round trip");

    const sparse = encryptPaymentDetails({ payment_method: "ecocash", ecocash_number: DETAILS.ecocash_number, bank_name: "", bank_account: null }, env);
    assert.ok(isDeepStrictEqual([...sparse.fields].sort(), ["ecocash_number", "payment_method"]), "empty and null fields are dropped");

    const again = encryptPaymentDetails(DETAILS, env);
    assert.notEqual(again.data, validEnvelope.data, "a fresh IV is used for every encryption");
  });

  it("a wrong key, a tampered envelope or a malformed envelope cannot be read, and the failure leaks nothing", () => {
    const needles = [...PLAINTEXT_NEEDLES, KEY, OTHER_KEY];

    const wrongKey = attemptSync(() => decryptPaymentDetails(validEnvelope, envWith(OTHER_KEY)));
    assert.notEqual(wrongKey.error, null, "wrong key must not decrypt");
    assertNoLeak("wrong key", wrongKey.error, needles);

    const [iv, tag, ct] = validEnvelope.data.split(".");
    const flipFirstByte = (segment) => {
      const bytes = Buffer.from(segment, "base64url");
      bytes[0] ^= 0x01;
      return bytes.toString("base64url");
    };
    for (const [label, data] of [
      ["ciphertext", [iv, tag, flipFirstByte(ct)].join(".")],
      ["auth tag", [iv, flipFirstByte(tag), ct].join(".")]
    ]) {
      const tampered = attemptSync(() => decryptPaymentDetails({ v: 1, data }, envWith(KEY)));
      assert.notEqual(tampered.error, null, `tampered ${label} must not decrypt`);
      assertNoLeak(`tampered ${label}`, tampered.error, needles);
    }

    for (const data of ["onlyone", "a.b.c"]) {
      const malformed = attemptSync(() => decryptPaymentDetails({ v: 1, data }, envWith(KEY)));
      assertRefusal(malformed, { status: 500 }, [...needles, data]);
    }
  });

  describe("default environment is process.env", () => {
    useIsolatedEnv();

    it("the key is read from process.env on every call, and removing it fails closed again", () => {
      assert.equal(paymentEncryptionConfigured(), false, "isolated environment starts without a key");
      assertRefusal(attemptSync(() => encryptPaymentDetails(DETAILS)), { status: 503 }, [...PLAINTEXT_NEEDLES, KEY]);

      setEnv({ ORAC_PAYMENT_ENCRYPTION_KEY: KEY });
      assert.equal(paymentEncryptionConfigured(), true);
      const envelope = encryptPaymentDetails(DETAILS);
      assert.ok(isDeepStrictEqual(decryptPaymentDetails(envelope), { ...DETAILS }), "default-environment round trip");

      setEnv({ ORAC_PAYMENT_ENCRYPTION_KEY: undefined });
      assert.equal(paymentEncryptionConfigured(), false);
      assertRefusal(attemptSync(() => decryptPaymentDetails(envelope)), { status: 503 }, [...PLAINTEXT_NEEDLES, KEY]);
    });
  });
});

// ---------- CORS ----------

describe("createCors as implemented", () => {
  const LISTED = ["https://app.orac.test", "https://admin.orac.test"];

  function run(cors, { origin, method = "GET" } = {}) {
    const headers = {};
    let status = null;
    let nextCalls = 0;
    const req = { method, headers: origin === undefined ? {} : { origin } };
    const res = {
      setHeader(name, value) { headers[name.toLowerCase()] = value; },
      sendStatus(code) { status = code; return res; }
    };
    cors(req, res, () => { nextCalls += 1; });
    return { headers, status, nextCalls };
  }
  const corsHeaderNames = (headers) => Object.keys(headers).filter((name) => name.startsWith("access-control-"));

  it("production reflects a listed origin with credentials and the declared methods, headers and exposed headers", () => {
    const cors = createCors({ allowedOrigins: LISTED, isProduction: true });
    for (const origin of LISTED) {
      const { headers, status, nextCalls } = run(cors, { origin });
      assert.equal(headers["access-control-allow-origin"], origin);
      assert.equal(headers["access-control-allow-credentials"], "true");
      assert.equal(headers["access-control-allow-methods"], "GET,POST,PATCH,PUT,DELETE,OPTIONS");
      assert.equal(headers["access-control-allow-headers"], CORS_ALLOWED_HEADERS);
      assert.equal(headers["access-control-expose-headers"], CORS_EXPOSED_HEADERS);
      assert.equal(status, null, "a normal request is not answered by the CORS layer");
      assert.equal(nextCalls, 1, "a normal request continues down the chain");
    }
    for (const required of ["Content-Type", "Authorization", "Idempotency-Key"]) {
      assert.ok(CORS_ALLOWED_HEADERS.split(",").includes(required), `${required} must stay an allowed request header`);
    }
    assert.ok(CORS_EXPOSED_HEADERS.split(",").includes("Idempotency-Replayed"), "Idempotency-Replayed must stay exposed");
  });

  it("production sends no CORS headers for an unlisted or lookalike origin, but still passes the request on", () => {
    const cors = createCors({ allowedOrigins: LISTED, isProduction: true });
    const refused = [
      ["an unrelated origin", "https://evil.test"],
      ["a suffix lookalike", "https://app.orac.test.evil.test"],
      ["a prefix lookalike", "https://evil-app.orac.test"],
      ["a different scheme", "http://app.orac.test"],
      ["a different port", "https://app.orac.test:8443"],
      ["the string null", "null"],
      ["the string *", "*"]
    ];
    for (const [label, origin] of refused) {
      const { headers, status, nextCalls } = run(cors, { origin });
      assert.deepEqual(corsHeaderNames(headers), [], `${label}: no CORS headers`);
      assert.equal(status, null, label);
      assert.equal(nextCalls, 1, `${label}: the server does not block, the browser does`);
    }
  });

  it("production never treats a * entry or an empty list as an open door", () => {
    for (const cors of [
      createCors({ allowedOrigins: ["*"], isProduction: true }),
      createCors({ allowedOrigins: [], isProduction: true }),
      createCors({ isProduction: true })
    ]) {
      const { headers } = run(cors, { origin: "https://evil.test" });
      assert.deepEqual(corsHeaderNames(headers), []);
    }
  });

  it("production answers preflight with 204 and stops the chain, granting headers only to a listed origin", () => {
    const cors = createCors({ allowedOrigins: LISTED, isProduction: true });

    const listed = run(cors, { origin: LISTED[0], method: "OPTIONS" });
    assert.equal(listed.status, 204);
    assert.equal(listed.nextCalls, 0);
    assert.equal(listed.headers["access-control-allow-origin"], LISTED[0]);

    const unlisted = run(cors, { origin: "https://evil.test", method: "OPTIONS" });
    assert.equal(unlisted.status, 204);
    assert.equal(unlisted.nextCalls, 0);
    assert.deepEqual(corsHeaderNames(unlisted.headers), []);
  });

  it("a request without a usable Origin header gets no CORS headers in production", () => {
    const cors = createCors({ allowedOrigins: LISTED, isProduction: true });
    for (const origin of [undefined, ""]) {
      const { headers, nextCalls } = run(cors, { origin });
      assert.deepEqual(corsHeaderNames(headers), [], `origin ${JSON.stringify(origin)}`);
      assert.equal(nextCalls, 1);
    }
  });

  it("configured origins are compared as exact strings, so a mistyped entry fails closed", () => {
    const withSlash = createCors({ allowedOrigins: ["https://app.orac.test/"], isProduction: true });
    assert.deepEqual(corsHeaderNames(run(withSlash, { origin: "https://app.orac.test" }).headers), [], "trailing slash in the entry never matches");

    const withPort = createCors({ allowedOrigins: ["https://app.orac.test:8443"], isProduction: true });
    assert.deepEqual(corsHeaderNames(run(withPort, { origin: "https://app.orac.test" }).headers), [], "port is part of the match");
  });

  it("outside production any origin is reflected with credentials (as implemented: a development convenience, not a production guarantee)", () => {
    const cors = createCors({ allowedOrigins: [], isProduction: false });
    for (const origin of ["https://anything.test", "http://localhost:5173"]) {
      const { headers } = run(cors, { origin });
      assert.equal(headers["access-control-allow-origin"], origin);
      assert.equal(headers["access-control-allow-credentials"], "true");
    }
  });

  it("omitting isProduction behaves as non-production: the default is open, so the caller must pass it explicitly", () => {
    for (const cors of [createCors(), createCors({ allowedOrigins: LISTED })]) {
      const { headers } = run(cors, { origin: "https://anything.test" });
      assert.equal(headers["access-control-allow-origin"], "https://anything.test");
      assert.equal(headers["access-control-allow-credentials"], "true");
    }
  });
});
