import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  padPassword,
  generateFileId,
  computeOwnerPasswordValue,
  computeEncryptionKey,
  computeUserPasswordValue,
  encryptForObject,
  protectPdf
} from "../src/pdfEncryption.js";
import { generateControlledPdf } from "../src/pdfGenerator.js";

// Minimal model that produces a valid PDF
function minimalModel() {
  return {
    documentType: "QUOTE",
    documentTypeLabel: "Quotation",
    documentNumber: "Q-TEST-001",
    status: "Draft",
    company: { name: "ORAC Test Co", legalName: "ORAC (Pvt) Ltd", brandPrimary: "#6EC2E4" },
    generatedAt: "2026-11-17",
    controlledNote: "Test document",
    headerMeta: [
      { label: "Client", value: "Test Client" },
      { label: "Date", value: "2026-11-17" }
    ],
    sections: [
      { type: "paragraph", heading: "Scope", text: "Test scope description." }
    ]
  };
}

describe("S-13: PDF Password Protection", () => {
  it("padPassword pads to exactly 32 bytes", () => {
    const short = padPassword("abc");
    assert.equal(short.length, 32);
    assert.equal(short[0], 0x61); // 'a'
    assert.equal(short[1], 0x62); // 'b'
    assert.equal(short[2], 0x63); // 'c'
    // Rest is padding bytes
    assert.equal(short[3], 0x28); // First padding byte
  });

  it("padPassword with no password uses full padding", () => {
    const empty = padPassword("");
    assert.equal(empty.length, 32);
    assert.equal(empty[0], 0x28);
  });

  it("padPassword truncates to 32 bytes", () => {
    const long = padPassword("a".repeat(50));
    assert.equal(long.length, 32);
  });

  it("generateFileId returns 16 bytes", () => {
    const id = generateFileId();
    assert.equal(id.length, 16);
    assert.ok(Buffer.isBuffer(id));
  });

  it("generateFileId produces unique values", () => {
    const id1 = generateFileId();
    const id2 = generateFileId();
    assert.notDeepStrictEqual(id1, id2);
  });

  it("computeOwnerPasswordValue returns a 32-byte Buffer", () => {
    const oValue = computeOwnerPasswordValue("owner123", "user456");
    assert.equal(oValue.length, 32);
    assert.ok(Buffer.isBuffer(oValue));
  });

  it("computeEncryptionKey returns a 5-byte key (40-bit)", () => {
    const fileId = generateFileId();
    const oValue = computeOwnerPasswordValue("owner", "user");
    const key = computeEncryptionKey("user", oValue, -4, fileId);
    assert.equal(key.length, 5);
    assert.ok(Buffer.isBuffer(key));
  });

  it("computeUserPasswordValue returns a 32-byte Buffer", () => {
    const fileId = generateFileId();
    const oValue = computeOwnerPasswordValue("owner", "user");
    const key = computeEncryptionKey("user", oValue, -4, fileId);
    const uValue = computeUserPasswordValue(key);
    assert.equal(uValue.length, 32);
  });

  it("encryptForObject encrypts data with object-specific key", () => {
    const fileId = generateFileId();
    const oValue = computeOwnerPasswordValue("owner", "user");
    const key = computeEncryptionKey("user", oValue, -4, fileId);
    const plaintext = Buffer.from("Hello World", "utf8");
    const encrypted = encryptForObject(plaintext, 1, 0, key);
    assert.ok(Buffer.isBuffer(encrypted));
    assert.notDeepStrictEqual(encrypted, plaintext);
    assert.equal(encrypted.length, plaintext.length); // RC4 preserves length
  });

  it("different object numbers produce different ciphertext", () => {
    const fileId = generateFileId();
    const oValue = computeOwnerPasswordValue("owner", "user");
    const key = computeEncryptionKey("user", oValue, -4, fileId);
    const data = Buffer.from("Same data", "utf8");
    const enc1 = encryptForObject(data, 1, 0, key);
    const enc2 = encryptForObject(data, 2, 0, key);
    assert.notDeepStrictEqual(enc1, enc2);
  });

  it("protectPdf with no password returns buffer unchanged (backward compatible)", () => {
    const model = minimalModel();
    const pdf = generateControlledPdf(model);
    const result = protectPdf(pdf, {});
    assert.deepStrictEqual(result, pdf);
  });

  it("protectPdf with no options returns buffer unchanged", () => {
    const model = minimalModel();
    const pdf = generateControlledPdf(model);
    const result = protectPdf(pdf);
    assert.deepStrictEqual(result, pdf);
  });

  it("protectPdf with a user password returns a different buffer", () => {
    const model = minimalModel();
    const pdf = generateControlledPdf(model);
    const encrypted = protectPdf(pdf, { userPassword: "secret123" });
    assert.notDeepStrictEqual(encrypted, pdf);
    assert.ok(encrypted.length > 0);
  });

  it("encrypted PDF starts with %PDF-1.4 and contains /Encrypt", () => {
    const model = minimalModel();
    const pdf = generateControlledPdf(model);
    const encrypted = protectPdf(pdf, { userPassword: "test" });
    const str = encrypted.toString("binary");
    assert.ok(str.startsWith("%PDF-1.4"), "Must start with PDF header");
    assert.ok(str.includes("/Encrypt"), "Must contain /Encrypt reference");
    assert.ok(str.includes("/Filter /Standard"), "Must use Standard security handler");
    assert.ok(str.includes("/V 1"), "Must use encryption version 1");
    assert.ok(str.includes("/R 2"), "Must use revision 2");
  });

  it("encrypted PDF contains /ID array", () => {
    const model = minimalModel();
    const pdf = generateControlledPdf(model);
    const encrypted = protectPdf(pdf, { userPassword: "test" });
    const str = encrypted.toString("binary");
    assert.ok(str.includes("/ID [<"), "Must contain /ID array with hex strings");
  });

  it("two different passwords produce different encrypted outputs", () => {
    const model = minimalModel();
    const pdf = generateControlledPdf(model);
    const enc1 = protectPdf(pdf, { userPassword: "password1" });
    const enc2 = protectPdf(pdf, { userPassword: "password2" });
    // Both are valid PDFs but different due to different keys + random file IDs
    assert.notDeepStrictEqual(enc1, enc2);
  });

  it("generateControlledPdf with password option produces encrypted PDF", () => {
    const model = minimalModel();
    const encrypted = generateControlledPdf(model, { userPassword: "bankdetails" });
    const str = encrypted.toString("binary");
    assert.ok(str.startsWith("%PDF-1.4"));
    assert.ok(str.includes("/Encrypt"));
    assert.ok(str.includes("/Filter /Standard"));
  });

  it("generateControlledPdf without options is backward compatible", () => {
    const model = minimalModel();
    const pdf1 = generateControlledPdf(model);
    const pdf2 = generateControlledPdf(model, {});
    // Both should be identical (no encryption applied)
    assert.deepStrictEqual(pdf1, pdf2);
    const str = pdf1.toString("binary");
    assert.ok(!str.includes("/Encrypt"), "Unprotected PDF must NOT contain /Encrypt");
  });
});
