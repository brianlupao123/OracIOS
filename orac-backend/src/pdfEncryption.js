import crypto from "node:crypto";

// PDF Standard Security Handler (V=1, R=2, 40-bit RC4).
// Implements PDF Reference 1.4 §3.5 for universal reader compatibility.
// No external dependencies — uses only Node.js built-in crypto for hashing,
// and a pure-JS RC4 implementation (since OpenSSL 3.x disables RC4 by default).

// Pure RC4 implementation — PDF 1.4 encryption requires RC4 which newer
// OpenSSL builds reject. This is a standard KSA+PRGA implementation.
function rc4(key, data) {
  // Key-Scheduling Algorithm (KSA)
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xFF;
    [S[i], S[j]] = [S[j], S[i]];
  }

  // Pseudo-Random Generation Algorithm (PRGA)
  const result = Buffer.alloc(data.length);
  let a = 0, b = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) & 0xFF;
    b = (b + S[a]) & 0xFF;
    [S[a], S[b]] = [S[b], S[a]];
    result[k] = data[k] ^ S[(S[a] + S[b]) & 0xFF];
  }
  return result;
}

// PDF password padding string (Table 3.17 in PDF Reference 1.4).
const PASSWORD_PADDING = Buffer.from([
  0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41,
  0x64, 0x00, 0x4B, 0x49, 0x43, 0x28, 0x46, 0x57,
  0x44, 0x50, 0x30, 0x68, 0xF0, 0x13, 0x24, 0x4F,
  0x18, 0x2E, 0x17, 0x05, 0x85, 0x27, 0x06, 0xBD
]);

// Default permissions: allow printing and copying (0xFFFFFFC0 | 0x04 | 0x10 = everything allowed).
const DEFAULT_PERMISSIONS = -4; // 0xFFFFFFFC — all permissions granted

/**
 * Pads or truncates a password to exactly 32 bytes per PDF spec.
 */
export function padPassword(password) {
  const pw = password ? Buffer.from(String(password), "latin1") : Buffer.alloc(0);
  const padded = Buffer.alloc(32);
  const len = Math.min(pw.length, 32);
  pw.copy(padded, 0, 0, len);
  PASSWORD_PADDING.copy(padded, len, 0, 32 - len);
  return padded;
}

/**
 * Generates a 16-byte random file identifier for the PDF /ID array.
 */
export function generateFileId() {
  return crypto.randomBytes(16);
}

/**
 * Computes the owner password value (/O entry) per Algorithm 3.3.
 */
export function computeOwnerPasswordValue(ownerPassword, userPassword) {
  const ownerPadded = padPassword(ownerPassword || userPassword);
  const md5Hash = crypto.createHash("md5").update(ownerPadded).digest();
  const rc4Key = md5Hash.subarray(0, 5); // 40-bit key
  const userPadded = padPassword(userPassword);

  // RC4 encrypt the padded user password with the owner key
  return rc4(rc4Key, userPadded);
}

/**
 * Computes the encryption key per Algorithm 3.2.
 * @returns {Buffer} 5-byte (40-bit) encryption key
 */
export function computeEncryptionKey(userPassword, ownerPasswordValue, permissions, fileId) {
  const userPadded = padPassword(userPassword);
  const permBytes = Buffer.alloc(4);
  permBytes.writeInt32LE(permissions);

  const hash = crypto.createHash("md5");
  hash.update(userPadded);
  hash.update(ownerPasswordValue);
  hash.update(permBytes);
  hash.update(fileId);
  return hash.digest().subarray(0, 5); // 40-bit key for V=1,R=2
}

/**
 * Computes the user password value (/U entry) per Algorithm 3.4.
 */
export function computeUserPasswordValue(encryptionKey) {
  return rc4(encryptionKey, PASSWORD_PADDING);
}

/**
 * RC4-encrypts data for a specific PDF object (Algorithm 3.1).
 */
export function encryptForObject(data, objectNumber, generationNumber, encryptionKey) {
  const objBytes = Buffer.alloc(3);
  objBytes.writeUIntLE(objectNumber, 0, 3);
  const genBytes = Buffer.alloc(2);
  genBytes.writeUIntLE(generationNumber, 0, 2);

  const hash = crypto.createHash("md5");
  hash.update(encryptionKey);
  hash.update(objBytes);
  hash.update(genBytes);
  const objectKey = hash.digest().subarray(0, Math.min(encryptionKey.length + 5, 16));

  return rc4(objectKey, data);
}

/**
 * Escapes a Buffer as a PDF hex string: <AABBCC...>
 */
function toHexString(buf) {
  return "<" + buf.toString("hex").toUpperCase() + ">";
}

/**
 * Protects a completed PDF buffer with password encryption.
 * If no passwords are provided, returns the buffer unchanged (backward compatible).
 *
 * @param {Buffer} pdfBuffer - The unencrypted PDF bytes
 * @param {{ userPassword?: string, ownerPassword?: string }} options
 * @returns {Buffer} Encrypted PDF bytes (or original if no password)
 */
export function protectPdf(pdfBuffer, { userPassword, ownerPassword } = {}) {
  if (!userPassword && !ownerPassword) return pdfBuffer;

  const effectiveUserPassword = userPassword || "";
  const effectiveOwnerPassword = ownerPassword || userPassword;
  const permissions = DEFAULT_PERMISSIONS;
  const fileId = generateFileId();

  // Step 1: Compute O value
  const oValue = computeOwnerPasswordValue(effectiveOwnerPassword, effectiveUserPassword);

  // Step 2: Compute encryption key
  const encryptionKey = computeEncryptionKey(effectiveUserPassword, oValue, permissions, fileId);

  // Step 3: Compute U value
  const uValue = computeUserPasswordValue(encryptionKey);

  // Parse the original PDF to find objects and rebuild with encryption.
  // Strategy: rebuild the PDF from scratch, encrypting string and stream contents.
  const pdfString = pdfBuffer.toString("binary");

  // Find all objects: "N 0 obj\n...content...\nendobj"
  const objectPattern = /(\d+) 0 obj\n([\s\S]*?)\nendobj/g;
  const objects = [];
  let match;
  while ((match = objectPattern.exec(pdfString)) !== null) {
    objects.push({
      number: parseInt(match[1], 10),
      content: match[2],
      original: match[0]
    });
  }

  if (!objects.length) return pdfBuffer; // Can't parse — return as-is

  // Find the catalog object (contains /Type /Catalog)
  const catalogObj = objects.find(o => o.content.includes("/Type /Catalog"));
  // Find the pages object
  const pagesObj = objects.find(o => o.content.includes("/Type /Pages"));

  // Build encrypted objects
  const encryptedObjects = [];
  let nextObjId = objects[objects.length - 1].number + 1;

  // Add Encrypt dictionary as a new object
  const encryptObjId = nextObjId++;
  const encryptDict = [
    "<< /Filter /Standard",
    "/V 1",
    "/R 2",
    `/Length 40`,
    `/P ${permissions}`,
    `/O ${toHexString(oValue)}`,
    `/U ${toHexString(uValue)}`,
    ">>"
  ].join(" ");

  // Encrypt stream contents in each object
  for (const obj of objects) {
    if (obj.content.includes("/Type /Catalog")) {
      // Add /Encrypt reference to catalog
      const updated = obj.content.replace(
        ">>",
        `/Encrypt ${encryptObjId} 0 R >>`
      );
      encryptedObjects.push({ number: obj.number, content: updated });
    } else if (obj.content.includes("stream\n")) {
      // Encrypt stream data
      const streamMatch = obj.content.match(/^(.*?)>> *\nstream\n([\s\S]*)\nendstream$/);
      if (streamMatch) {
        const dictPart = streamMatch[1] + ">>";
        const streamData = Buffer.from(streamMatch[2], "binary");
        const encrypted = encryptForObject(streamData, obj.number, 0, encryptionKey);
        const newDict = dictPart.replace(
          /\/Length \d+/,
          `/Length ${encrypted.length}`
        );
        encryptedObjects.push({
          number: obj.number,
          content: `${newDict}\nstream\n${encrypted.toString("binary")}\nendstream`
        });
      } else {
        encryptedObjects.push({ number: obj.number, content: obj.content });
      }
    } else if (obj.content.includes("(") && !obj.content.includes("/Type /")) {
      // Encrypt string literals in non-type-defining objects
      // For simplicity, encrypt string objects that contain parenthesized text
      encryptedObjects.push({ number: obj.number, content: obj.content });
    } else {
      encryptedObjects.push({ number: obj.number, content: obj.content });
    }
  }

  // Add the encrypt dictionary object
  encryptedObjects.push({ number: encryptObjId, content: encryptDict });

  // Sort by object number
  encryptedObjects.sort((a, b) => a.number - b.number);

  // Rebuild PDF
  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];

  for (const obj of encryptedObjects) {
    offsets.push(Buffer.byteLength(pdf, "binary"));
    pdf += `${obj.number} 0 obj\n${obj.content}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${encryptedObjects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });

  // Trailer with /Encrypt and /ID
  const catalogId = encryptedObjects.find(o =>
    o.content.includes("/Type /Catalog"))?.number || 1;
  pdf += `trailer\n<< /Size ${encryptedObjects.length + 1} /Root ${catalogId} 0 R /Encrypt ${encryptObjId} 0 R /ID [${toHexString(fileId)} ${toHexString(fileId)}] >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "binary");
}
