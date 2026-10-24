import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { decodePngToGray, dHash, hamming, selectDistinctFrames } from "./frame-hash";

// --- minimal PNG encoder for synthetic fixtures (filter type configurable) ---
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}
function chunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, "ascii");
  const body = Buffer.concat([t, data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
}
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
function filterRow(type: number, raw: Uint8Array, prior: Uint8Array, bpp: number): Uint8Array {
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const a = i >= bpp ? raw[i - bpp] : 0;
    const b = prior[i];
    const c = i >= bpp ? prior[i - bpp] : 0;
    let pred = 0;
    if (type === 1) pred = a;
    else if (type === 2) pred = b;
    else if (type === 3) pred = (a + b) >> 1;
    else if (type === 4) pred = paeth(a, b, c);
    out[i] = (raw[i] - pred) & 0xff;
  }
  return out;
}
/** raw: row-major pixel bytes, length = w*h*channels. channels 3=RGB, 4=RGBA. */
function encodePng(width: number, height: number, raw: Uint8Array, channels: number, filterType = 0): Buffer {
  const stride = width * channels;
  const scan: number[] = [];
  let prior = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = raw.slice(y * stride, (y + 1) * stride);
    const filtered = filterRow(filterType, row, prior, channels);
    scan.push(filterType, ...filtered);
    prior = row;
  }
  const idat = zlib.deflateSync(Buffer.from(scan));
  const ihdr = Buffer.concat([u32(width), u32(height), Buffer.from([8, channels === 4 ? 6 : 2, 0, 0, 0])]);
  return Buffer.concat([SIG, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
/** Encode a grayscale grid (R=G=B=v) so expected gray == v, formula-independent. */
function encodeGray(grid: number[][], channels: 3 | 4 = 4, filterType = 0): Buffer {
  const h = grid.length, w = grid[0].length;
  const raw = new Uint8Array(w * h * channels);
  let o = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = grid[y][x];
      raw[o++] = v; raw[o++] = v; raw[o++] = v;
      if (channels === 4) raw[o++] = 255;
    }
  return encodePng(w, h, raw, channels, filterType);
}

describe("decodePngToGray", () => {
  it("decodes a real Pillow-encoded grayscale PNG (real adaptive filters)", () => {
    // 16x12 grayscale gradient produced by Pillow (see spec). Validates the
    // un-filtering against a genuine encoder, not just a round-trip.
    const b64 =
      "iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAYAAABr5z2BAAAAIklEQVR4nGNkYGD4z87OzkAuZuHl5SVb86gB7KMGsA8WAwBCYhGeZ0x7wQAAAABJRU5ErkJggg==";
    const grayCsv =
      "0,7,14,21,28,35,42,49,56,63,70,77,84,91,98,105,13,20,27,34,41,48,55,62,69,76,83,90,97,104,111,118,26,33,40,47,54,61,68,75,82,89,96,103,110,117,124,131,39,46,53,60,67,74,81,88,95,102,109,116,123,130,137,144,52,59,66,73,80,87,94,101,108,115,122,129,136,143,150,157,65,72,79,86,93,100,107,114,121,128,135,142,149,156,163,170,78,85,92,99,106,113,120,127,134,141,148,155,162,169,176,183,91,98,105,112,119,126,133,140,147,154,161,168,175,182,189,196,104,111,118,125,132,139,146,153,160,167,174,181,188,195,202,209,117,124,131,138,145,152,159,166,173,180,187,194,201,208,215,222,130,137,144,151,158,165,172,179,186,193,200,207,214,221,228,235,143,150,157,164,171,178,185,192,199,206,213,220,227,234,241,248";
    const expected = grayCsv.split(",").map(Number);
    const got = decodePngToGray(Buffer.from(b64, "base64"));
    expect(got).not.toBeNull();
    expect(got!.width).toBe(16);
    expect(got!.height).toBe(12);
    expect(Array.from(got!.gray)).toEqual(expected);
  });

  it("applies the luma formula to RGB pixels (red -> 76, gray stays)", () => {
    // 2x2: white, black / red, mid-gray
    const raw = new Uint8Array([255, 255, 255, 0, 0, 0, 255, 0, 0, 128, 128, 128]);
    const got = decodePngToGray(encodePng(2, 2, raw, 3, 0));
    expect(got).not.toBeNull();
    expect(Array.from(got!.gray)).toEqual([255, 0, 76, 128]);
  });

  it("ignores the alpha channel on RGBA (colour type 6)", () => {
    const raw = new Uint8Array([255, 255, 255, 10, 0, 0, 0, 250, 255, 0, 0, 0, 128, 128, 128, 99]);
    const got = decodePngToGray(encodePng(2, 2, raw, 4, 0));
    expect(got).not.toBeNull();
    expect(Array.from(got!.gray)).toEqual([255, 0, 76, 128]);
  });

  it("un-filters every PNG filter type (1=Sub,2=Up,3=Average,4=Paeth) correctly", () => {
    const grid = [
      [10, 40, 90, 160, 250],
      [20, 55, 120, 30, 200],
      [240, 15, 70, 130, 5],
      [60, 110, 175, 220, 45],
    ];
    const flat = grid.flat();
    for (const ft of [1, 2, 3, 4]) {
      const got = decodePngToGray(encodeGray(grid, 4, ft));
      expect(got, `filter ${ft}`).not.toBeNull();
      expect(Array.from(got!.gray), `filter ${ft}`).toEqual(flat);
    }
  });

  it("returns null on non-PNG / unsupported / truncated input", () => {
    expect(decodePngToGray(Buffer.from("not a png at all"))).toBeNull();
    expect(decodePngToGray(Buffer.alloc(4))).toBeNull();
    // valid header but truncated before IDAT data
    const ihdr = Buffer.concat([u32(2), u32(2), Buffer.from([8, 6, 0, 0, 0])]);
    expect(decodePngToGray(Buffer.concat([SIG, chunk("IHDR", ihdr)]))).toBeNull();
  });
});

describe("dHash + hamming", () => {
  it("hamming counts differing bits", () => {
    expect(hamming(BigInt(0b1011), BigInt(0b0010))).toBe(2);
    expect(hamming(BigInt(0), BigInt(0))).toBe(0);
    expect(hamming(BigInt("0xffffffffffffffff"), BigInt(0))).toBe(64);
  });

  it("identical images hash identically (distance 0)", () => {
    const grid = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => (x * 9 + y * 5) % 256));
    const g = decodePngToGray(encodeGray(grid))!;
    expect(hamming(dHash(g.gray, g.width, g.height), dHash(g.gray, g.width, g.height))).toBe(0);
  });

  it("opposite gradients are maximally far apart", () => {
    const up = Array.from({ length: 16 }, () => Array.from({ length: 16 }, (_, x) => x * 16));
    const down = Array.from({ length: 16 }, () => Array.from({ length: 16 }, (_, x) => 255 - x * 16));
    const a = decodePngToGray(encodeGray(up))!;
    const b = decodePngToGray(encodeGray(down))!;
    expect(hamming(dHash(a.gray, a.width, a.height), dHash(b.gray, b.width, b.height))).toBe(64);
  });

  it("a small change is closer than a completely different image", () => {
    // A rich (non-monotonic) pattern so horizontal comparisons vary.
    const base = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => (x * 37 + y * 17) % 256));
    const nudged = base.map((r) => r.slice());
    for (let y = 7; y < 9; y++) for (let x = 7; x < 9; x++) nudged[y][x] = (nudged[y][x] + 40) % 256;
    // Photographic negative flips horizontal comparisons -> maximally different.
    const different = base.map((r) => r.map((v) => 255 - v));
    const hh = (grid: number[][]) => {
      const g = decodePngToGray(encodeGray(grid))!;
      return dHash(g.gray, g.width, g.height);
    };
    const dNudge = hamming(hh(base), hh(nudged));
    const dDiff = hamming(hh(base), hh(different));
    expect(dDiff).toBeGreaterThan(20); // genuinely different
    expect(dNudge).toBeLessThan(dDiff);
  });
});

describe("selectDistinctFrames", () => {
  const inc = Array.from({ length: 16 }, () => Array.from({ length: 16 }, (_, x) => x * 16));
  const dec = Array.from({ length: 16 }, () => Array.from({ length: 16 }, (_, x) => 255 - x * 16));
  const half = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => (y < 8 ? x * 16 : 255 - x * 16)));
  const frame = (name: string, grid: number[][]) => ({ name, bytes: encodeGray(grid) });

  it("collapses a run of identical frames to one", () => {
    const f = frame("a", inc);
    const out = selectDistinctFrames([f, { ...f }, { ...f }, { ...f }, { ...f }]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("a");
  });

  it("keeps the frames where the screen actually changed, in order", () => {
    const frames = [frame("0", inc), frame("1", inc), frame("2", dec), frame("3", dec), frame("4", half)];
    const out = selectDistinctFrames(frames);
    expect(out.map((f) => f.name)).toEqual(["0", "2", "4"]);
  });

  it("caps the result and samples evenly, keeping first and last", () => {
    const frames = [inc, dec, inc, dec, inc].map((g, i) => frame(String(i), g));
    const out = selectDistinctFrames(frames, { maxFrames: 3 });
    expect(out).toHaveLength(3);
    expect(out[0].name).toBe("0");
    expect(out[out.length - 1].name).toBe("4");
  });

  it("keeps the frames it is told to however alike they look, and gives them the slots", () => {
    const frames = [inc, inc, inc, dec, inc, inc].map((g, i) => frame(String(i), g));
    expect(selectDistinctFrames(frames, { keep: (f) => f.name === "2" }).map((f) => f.name)).toEqual(["0", "2", "3", "4"]);
    // three slots: the kept one survives the cut, the rest are sampled
    const many = [inc, dec, inc, dec, inc, dec].map((g, i) => frame(String(i), g));
    expect(selectDistinctFrames(many, { maxFrames: 3, keep: (f) => f.name === "2" }).map((f) => f.name)).toEqual(["0", "2", "5"]);
  });

  it("falls back to exact-byte de-dup for undecodable frames", () => {
    const g1 = { name: "g1", bytes: Buffer.from("garbage-one") };
    const g2 = { name: "g2", bytes: Buffer.from("garbage-two") };
    const out = selectDistinctFrames([g1, { ...g1 }, g2, { ...g2 }]);
    expect(out.map((f) => f.name)).toEqual(["g1", "g2"]);
  });

  it("preserves the original frame objects (timestamps, extra fields)", () => {
    const frames = [
      { name: "0", timestampMs: 0, bytes: encodeGray(inc) },
      { name: "1", timestampMs: 2000, bytes: encodeGray(dec) },
    ];
    const out = selectDistinctFrames(frames);
    expect(out).toEqual(frames);
  });
});
