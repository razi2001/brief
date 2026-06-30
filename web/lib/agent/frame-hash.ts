// Perceptual keyframe selection for the filing agent. Screen recordings are
// sampled every 2s, so naive sampling yields many near-identical stills and can
// miss the moment the UI actually changes. We decode each PNG keyframe (using
// only Node's built-in zlib - no image dependency), compute a difference hash,
// and keep the frames where the screen genuinely changed.
//
// Everything here is pure and fail-soft: any decode failure degrades to
// exact-byte de-dup, so frame analysis can never break ticket filing. Unit
// tested directly in frame-hash.test.ts.
import zlib from "node:zlib";
import { createHash } from "node:crypto";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decode a PNG buffer to a grayscale pixel grid. Supports only the format a
 * browser canvas emits: 8-bit, colour type 2 (RGB) or 6 (RGBA), non-interlaced.
 * Returns null on anything else or on any malformed/truncated input - never
 * throws.
 */
export function decodePngToGray(buf: Buffer): { width: number; height: number; gray: Uint8Array } | null {
  try {
    if (!buf || buf.length < 8) return null;
    for (let i = 0; i < 8; i++) if (buf[i] !== PNG_SIG[i]) return null;

    let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
    let sawIHDR = false;
    const idat: Buffer[] = [];
    let off = 8;
    while (off + 8 <= buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.toString("ascii", off + 4, off + 8);
      const dataStart = off + 8;
      const dataEnd = dataStart + len;
      if (dataEnd + 4 > buf.length) return null; // truncated chunk (incl. CRC)
      const data = buf.subarray(dataStart, dataEnd);
      if (type === "IHDR") {
        if (len < 13) return null;
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        bitDepth = data[8];
        colorType = data[9];
        interlace = data[12];
        sawIHDR = true;
      } else if (type === "IDAT") {
        idat.push(Buffer.from(data));
      } else if (type === "IEND") {
        break;
      }
      off = dataEnd + 4; // advance past the chunk's CRC
    }

    if (!sawIHDR || !width || !height || !idat.length) return null;
    if (bitDepth !== 8 || interlace !== 0) return null;
    const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
    if (!channels) return null;

    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    if (raw.length < (stride + 1) * height) return null;

    // Reverse the per-scanline PNG filters into reconstructed pixel bytes.
    const recon = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
      const filterType = raw[y * (stride + 1)];
      const inStart = y * (stride + 1) + 1;
      const outStart = y * stride;
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? recon[outStart + i - channels] : 0;
        const b = y > 0 ? recon[outStart - stride + i] : 0;
        const c = y > 0 && i >= channels ? recon[outStart - stride + i - channels] : 0;
        let pred = 0;
        switch (filterType) {
          case 0: pred = 0; break;
          case 1: pred = a; break;
          case 2: pred = b; break;
          case 3: pred = (a + b) >> 1; break;
          case 4: pred = paeth(a, b, c); break;
          default: return null;
        }
        recon[outStart + i] = (raw[inStart + i] + pred) & 0xff;
      }
    }

    const gray = new Uint8Array(width * height);
    for (let p = 0; p < width * height; p++) {
      const r = recon[p * channels], g = recon[p * channels + 1], bl = recon[p * channels + 2];
      gray[p] = Math.round((r * 299 + g * 587 + bl * 114) / 1000);
    }
    return { width, height, gray };
  } catch {
    return null;
  }
}

/**
 * 64-bit difference hash: downscale to a 9x8 grayscale grid (nearest sampling)
 * and emit one bit per horizontal neighbour comparison. Similar images produce
 * similar hashes; the Hamming distance measures how much the picture changed.
 */
export function dHash(gray: Uint8Array, width: number, height: number): bigint {
  const W = 9, H = 8;
  const small = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / H));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / W));
      small[y * W + x] = gray[sy * width + sx];
    }
  }
  let hash = BigInt(0);
  let idx = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      if (small[y * W + x] > small[y * W + x + 1]) hash |= BigInt(1) << BigInt(idx);
      idx++;
    }
  }
  return hash;
}

/** Number of differing bits between two 64-bit hashes. */
export function hamming(a: bigint, b: bigint): number {
  const ZERO = BigInt(0), ONE = BigInt(1);
  let x = a ^ b;
  let count = 0;
  while (x !== ZERO) {
    x &= x - ONE;
    count++;
  }
  return count;
}

/**
 * Pick the frames where the screen actually changed. Frames are fingerprinted
 * with dHash (perceptual) when decodable, else with an exact-byte md5 hash.
 * A frame is kept when it differs from the last kept frame by more than
 * `threshold` bits; the first frame is always kept. If more than `maxFrames`
 * survive, they're sampled evenly (first and last preserved) to bound vision
 * cost. The original frame objects are returned unchanged, in capture order.
 */
export function selectDistinctFrames<T extends { bytes: Buffer }>(
  frames: T[],
  opts: { threshold?: number; maxFrames?: number } = {},
): T[] {
  const threshold = opts.threshold ?? 10;
  const maxFrames = opts.maxFrames ?? 12;
  if (frames.length <= 1) return frames.slice();

  const fp: Array<bigint | string> = frames.map((f) => {
    const dec = decodePngToGray(f.bytes);
    return dec ? dHash(dec.gray, dec.width, dec.height) : createHash("md5").update(f.bytes).digest("hex");
  });
  const changed = (x: bigint | string, y: bigint | string): boolean =>
    typeof x === "bigint" && typeof y === "bigint" ? hamming(x, y) > threshold : x !== y;

  const kept: number[] = [0];
  for (let i = 1; i < frames.length; i++) {
    if (changed(fp[i], fp[kept[kept.length - 1]])) kept.push(i);
  }

  let chosen = kept;
  if (kept.length > maxFrames) {
    chosen = Array.from({ length: maxFrames }, (_, i) => kept[Math.round((i * (kept.length - 1)) / (maxFrames - 1))]);
  }
  return chosen.map((i) => frames[i]);
}
