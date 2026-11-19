import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  protectPdf,
  isLegacyPdfEncryptionAllowed
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

describe("S-13 / Production Security: 40-bit RC4 PDF Encryption Rejection", () => {
  it("legacy 40-bit RC4 PDF encryption is disabled by policy", () => {
    assert.equal(isLegacyPdfEncryptionAllowed(), false, "40-bit RC4 must never be allowed in production");
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

  it("protectPdf with a user password throws explicit 40-bit RC4 rejection error", () => {
    const model = minimalModel();
    const pdf = generateControlledPdf(model);
    assert.throws(
      () => protectPdf(pdf, { userPassword: "secret123" }),
      /40-bit RC4 PDF encryption is rejected: insecure algorithm disabled for production security/
    );
  });

  it("protectPdf with an owner password throws explicit 40-bit RC4 rejection error", () => {
    const model = minimalModel();
    const pdf = generateControlledPdf(model);
    assert.throws(
      () => protectPdf(pdf, { ownerPassword: "ownerSecret123" }),
      /40-bit RC4 PDF encryption is rejected: insecure algorithm disabled for production security/
    );
  });

  it("generateControlledPdf with password option rejects insecure 40-bit RC4", () => {
    const model = minimalModel();
    assert.throws(
      () => generateControlledPdf(model, { userPassword: "bankdetails" }),
      /40-bit RC4 PDF encryption is rejected/
    );
  });

  it("generateControlledPdf without options produces a valid, clean, unencrypted PDF", () => {
    const model = minimalModel();
    const pdf = generateControlledPdf(model);
    assert.ok(Buffer.isBuffer(pdf));
    const str = pdf.toString("binary");
    assert.ok(str.startsWith("%PDF-1.4"), "Must start with %PDF-1.4 header");
    assert.ok(!str.includes("/Encrypt"), "Unprotected PDF must NOT contain /Encrypt");
    assert.ok(!str.includes("/Filter /Standard"), "Must NOT use Standard RC4 security handler");
  });
});
