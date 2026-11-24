// Minimal QR Code encoder for printing attendance badges: byte mode, error-correction level M, versions 1-10
// (up to 213 bytes). Pure function, no dependencies, no I/O.
//
// Why this exists: services/qrCodeService.js renderQrSvg() draws a pattern derived from a hash, not a QR symbol,
// so a phone camera cannot read it (see the attendance notes). The badge token is ~70 bytes, so a small, fully
// specified encoder is enough. It is verified in tests against an independent decoder (OpenCV) and an independent
// reference encoder (segno) in the sandbox; the in-repo test suite checks the structural invariants that do not
// need either tool (format/version BCH, Reed-Solomon, block interleaving, function patterns, determinism).
const EC_LEVEL_M_BITS = 0; // format-information bits for level M

// version -> [EC codewords per block, [[block count, data codewords per block], ...]]   (level M)
const BLOCKS_M = {
  1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]], 5: [24, [[2, 43]]],
  6: [16, [[4, 27]]], 7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]], 9: [22, [[3, 36], [2, 37]]], 10: [26, [[4, 43], [1, 44]]]
};
const ALIGNMENT = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
export const QR_MAX_VERSION = 10;

// ---- Reed-Solomon over GF(256), primitive polynomial 0x11D ----
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();
const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

export function reedSolomonGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly; // leading coefficient 1 first
}

export function reedSolomonRemainder(data, degree) {
  const gen = reedSolomonGenerator(degree);
  const rem = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift(); rem.push(0);
    for (let i = 0; i < degree; i += 1) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

const bit = (value, index) => ((value >>> index) & 1) === 1;

function dataCapacity(version) {
  return BLOCKS_M[version][1].reduce((sum, [count, size]) => sum + count * size, 0);
}

function chooseVersion(byteLength) {
  for (let v = 1; v <= QR_MAX_VERSION; v += 1) {
    const countBits = v < 10 ? 8 : 16;
    if (4 + countBits + 8 * byteLength <= 8 * dataCapacity(v)) return v;
  }
  throw new RangeError(`Text is too long for this QR encoder (maximum ${dataCapacity(QR_MAX_VERSION) - 3} bytes).`);
}

function buildDataCodewords(bytes, version) {
  const bits = [];
  const push = (value, count) => { for (let i = count - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacityBits = 8 * dataCapacity(version);
  push(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; out.length < dataCapacity(version); pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

// Split into blocks, add EC to each, then interleave (data first, then EC), per the QR specification.
function interleave(data, version) {
  const [ecPerBlock, groups] = BLOCKS_M[version];
  const blocks = []; let offset = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i += 1) { blocks.push(data.slice(offset, offset + size)); offset += size; }
  }
  const ecBlocks = blocks.map((block) => reedSolomonRemainder(block, ecPerBlock));
  const out = [];
  const longest = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < longest; i += 1) for (const block of blocks) if (i < block.length) out.push(block[i]);
  for (let i = 0; i < ecPerBlock; i += 1) for (const ec of ecBlocks) out.push(ec[i]);
  return out;
}

export function formatBits(mask) {
  const data = (EC_LEVEL_M_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

export function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

class Grid {
  constructor(version) {
    this.version = version;
    this.size = 17 + 4 * version;
    this.dark = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.fixed = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.drawFunctionPatterns();
  }

  setFunction(x, y, isDark) { this.dark[y][x] = isDark; this.fixed[y][x] = true; }

  drawFunctionPatterns() {
    const n = this.size;
    for (let i = 0; i < n; i += 1) { this.setFunction(6, i, i % 2 === 0); this.setFunction(i, 6, i % 2 === 0); } // timing
    for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) { // finders + separators
      for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx; const y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        this.setFunction(x, y, dist !== 2 && dist !== 4);
      }
    }
    const pos = ALIGNMENT[this.version];
    for (let i = 0; i < pos.length; i += 1) for (let j = 0; j < pos.length; j += 1) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
        this.setFunction(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
    this.drawFormat(0); // reserve the area; rewritten once the mask is chosen
    this.drawVersion();
  }

  drawFormat(mask) {
    const bits = formatBits(mask); const n = this.size;
    for (let i = 0; i <= 5; i += 1) this.setFunction(8, i, bit(bits, i));
    this.setFunction(8, 7, bit(bits, 6)); this.setFunction(8, 8, bit(bits, 7)); this.setFunction(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i += 1) this.setFunction(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i += 1) this.setFunction(n - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i += 1) this.setFunction(8, n - 15 + i, bit(bits, i));
    this.setFunction(8, n - 8, true); // the always-dark module
  }

  drawVersion() {
    if (this.version < 7) return;
    const bits = versionBits(this.version); const n = this.size;
    for (let i = 0; i < 18; i += 1) {
      const a = n - 11 + (i % 3); const b = Math.floor(i / 3);
      this.setFunction(a, b, bit(bits, i)); this.setFunction(b, a, bit(bits, i));
    }
  }

  placeCodewords(codewords) {
    const n = this.size; let index = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          const y = ((right + 1) & 2) === 0 ? n - 1 - vert : vert;
          if (!this.fixed[y][x] && index < codewords.length * 8) {
            this.dark[y][x] = bit(codewords[index >>> 3], 7 - (index & 7)); index += 1;
          }
        }
      }
    }
  }

  applyMask(mask) {
    for (let y = 0; y < this.size; y += 1) for (let x = 0; x < this.size; x += 1) {
      let invert;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      }
      if (!this.fixed[y][x] && invert) this.dark[y][x] = !this.dark[y][x];
    }
  }

  penalty() {
    const n = this.size; let score = 0; const m = this.dark;
    const lines = [];
    for (let i = 0; i < n; i += 1) { lines.push(m[i]); lines.push(m.map((row) => row[i])); }
    for (const line of lines) { // rule 1 (runs) and rule 3 (finder-like)
      let run = 1;
      for (let i = 1; i < n; i += 1) {
        if (line[i] === line[i - 1]) { run += 1; if (run === 5) score += 3; else if (run > 5) score += 1; } else run = 1;
      }
      const text = line.map((d) => (d ? "1" : "0")).join("");
      for (const pattern of ["00001011101", "10111010000"]) {
        let at = text.indexOf(pattern);
        while (at !== -1) { score += 40; at = text.indexOf(pattern, at + 1); }
      }
    }
    for (let y = 0; y < n - 1; y += 1) for (let x = 0; x < n - 1; x += 1) { // rule 2 (2x2 blocks)
      const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
    const darkCount = m.reduce((sum, row) => sum + row.filter(Boolean).length, 0); // rule 4 (balance)
    score += Math.max(0, Math.ceil(Math.abs(darkCount * 20 - n * n * 10) / (n * n)) - 1) * 10;
    return score;
  }
}

// text -> { version, size, mask, modules }  (modules[y][x] === true is a dark module, no quiet zone)
export function encodeQr(text, { mask: forcedMask } = {}) {
  if (typeof text !== "string" || text.length === 0) throw new TypeError("QR text must be a non-empty string.");
  const bytes = [...Buffer.from(text, "utf8")];
  const version = chooseVersion(bytes.length);
  const codewords = interleave(buildDataCodewords(bytes, version), version);
  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    if (forcedMask !== undefined && mask !== forcedMask) continue;
    const grid = new Grid(version);
    grid.placeCodewords(codewords);
    grid.applyMask(mask);
    grid.drawFormat(mask);
    const penalty = grid.penalty();
    if (!best || penalty < best.penalty) best = { grid, mask, penalty };
  }
  return { version, size: best.grid.size, mask: best.mask, modules: best.grid.dark.map((row) => [...row]) };
}

// Black-on-white SVG with the mandatory 4-module quiet zone. Fixed colours on purpose: scanners need contrast,
// so it is not themed for dark mode.
export function qrToSvg(text, { scale = 6, quiet = 4, label = "Badge QR code" } = {}) {
  const { size, modules } = encodeQr(text);
  const total = size + quiet * 2;
  let path = "";
  for (let y = 0; y < size; y += 1) {
    let x = 0;
    while (x < size) {
      if (!modules[y][x]) { x += 1; continue; }
      let end = x; while (end < size && modules[y][end]) end += 1;
      path += `M${x + quiet} ${y + quiet}h${end - x}v1h-${end - x}z`;
      x = end;
    }
  }
  const safeLabel = String(label).replace(/[<>&"']/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total * scale}" height="${total * scale}" shape-rendering="crispEdges" role="img" aria-label="${safeLabel}"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
