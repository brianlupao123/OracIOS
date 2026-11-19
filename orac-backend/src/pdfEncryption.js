// PDF Security Policy and Protection Handler
//
// 40-bit RC4 Standard Security Handler (V=1, R=2) has been deprecated and REMOVED
// for production security. 40-bit RC4 is cryptographically broken and OpenSSL 3.x
// disables RC4 by default.
//
// In production ORAC deployments, PDF confidentiality, authenticity, and access
// control are strictly enforced at the infrastructure and application layers:
// 1. Authenticated session tokens (JWT) and strict Role-Based Access Control (RBAC);
// 2. Transport Layer Security (TLS 1.2+ / HTTPS);
// 3. Document data projection allowlists (Client Viewer redactions);
// 4. Cryptographic audit trails for all document access and downloads.
//
// Any attempt to apply legacy 40-bit RC4 encryption is rejected with an explicit error.

/**
 * Protects a PDF buffer. Rejects insecure 40-bit RC4 password encryption if requested.
 * If no password is requested, returns the unmodified PDF buffer.
 *
 * @param {Buffer} pdfBuffer - The raw unencrypted PDF bytes
 * @param {{ userPassword?: string, ownerPassword?: string }} options
 * @returns {Buffer} The PDF buffer
 * @throws {Error} If password encryption is attempted using legacy insecure algorithms
 */
export function protectPdf(pdfBuffer, options = {}) {
  if (options && (options.userPassword || options.ownerPassword)) {
    throw new Error(
      "40-bit RC4 PDF encryption is rejected: insecure algorithm disabled for production security. PDF documents must be protected via authenticated RBAC and TLS transport."
    );
  }
  return pdfBuffer;
}

/**
 * Audit check helper: confirms whether legacy 40-bit RC4 is enabled.
 * Returns false in all production and compliant environments.
 */
export function isLegacyPdfEncryptionAllowed() {
  return false;
}
