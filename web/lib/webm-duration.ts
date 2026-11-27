/**
 * Chrome's MediaRecorder writes WebM as a live stream: the Segment and its
 * Clusters have "unknown" sizes and the Info element carries no Duration. A
 * player then has no idea how long the video is, so the seek bar does not work
 * (Linear's inline player, GitHub, the browser's own) - the video plays but you
 * can't jump around in it.
 *
 * `fixWebmDuration` walks the file once, finds the last block's timestamp, and
 * writes a Duration element into Info. That is the same repair the widely used
 * fix-webm-duration package makes in the browser, done here on the server so
 * it applies to every recording, including ones already stored.
 *
 * It never throws: anything it does not understand comes back unchanged.
 */

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Info: 0x1549a966,
  Duration: 0x4489,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
} as const;

// Elements we step INTO rather than over: their children are what we read.
const CONTAINERS = new Set<number>([ID.Segment, ID.Cluster, ID.BlockGroup]);

/** Reads an element ID (keeps its length-marker bits, as Matroska IDs do). */
function readId(b: Buffer, p: number): { id: number; len: number } | null {
  if (p >= b.length) return null;
  const first = b[p];
  let len = 1;
  while (len <= 4 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 4 || p + len > b.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[p + i];
  return { id, len };
}

/** Reads a data-size vint. `size` is null for the reserved "unknown" value. */
function readSize(b: Buffer, p: number): { size: number | null; len: number } | null {
  if (p >= b.length) return null;
  const first = b[p];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || p + len > b.length) return null;
  let v = first & (0xff >> len);
  let allOnes = v === 0xff >> len;
  for (let i = 1; i < len; i++) {
    v = v * 256 + b[p + i];
    if (b[p + i] !== 0xff) allOnes = false;
  }
  return { size: allOnes ? null : v, len };
}

function readUint(b: Buffer, p: number, len: number): number {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + b[p + i];
  return v;
}

/** An 8-byte data-size vint for `n`. */
function size8(n: number): Buffer {
  const out = Buffer.alloc(8);
  let v = n;
  for (let i = 7; i >= 1; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] = 0x01;
  return out;
}

export function isWebm(b: Buffer): boolean {
  return b.length > 4 && readUint(b, 0, 4) === ID.EBML;
}

/** The duration (timecode-scale units, i.e. ms by default), or null if unknown. */
export function webmLastTimestamp(b: Buffer): number | null {
  return scan(b)?.lastTs ?? null;
}

interface Scan {
  info?: { start: number; headerLen: number; size: number; hasDuration: boolean };
  segment?: { sizeAt: number; sizeLen: number; size: number | null };
  hasSeekHead: boolean;
  lastTs: number | null;
}

function scan(b: Buffer): Scan | null {
  const out: Scan = { hasSeekHead: false, lastTs: null };
  let clusterTs = 0;
  let p = 0;
  while (p < b.length) {
    const id = readId(b, p);
    if (!id) break;
    const sz = readSize(b, p + id.len);
    if (!sz) break;
    const header = id.len + sz.len;
    const body = p + header;

    if (id.id === ID.Segment) out.segment = { sizeAt: p + id.len, sizeLen: sz.len, size: sz.size };
    if (id.id === ID.SeekHead) out.hasSeekHead = true;

    if (CONTAINERS.has(id.id)) {
      p = body; // step into: the children follow
      continue;
    }
    // Every other element must have a known size to be skipped.
    if (sz.size === null) return null;
    if (body + sz.size > b.length) break; // truncated tail: keep what we read

    switch (id.id) {
      case ID.Info: {
        let hasDuration = false;
        let q = body;
        while (q < body + sz.size) {
          const cid = readId(b, q);
          const csz = cid && readSize(b, q + cid.len);
          if (!cid || !csz || csz.size === null) break;
          if (cid.id === ID.Duration) hasDuration = true;
          q += cid.len + csz.len + csz.size;
        }
        out.info = { start: p, headerLen: header, size: sz.size, hasDuration };
        break;
      }
      case ID.Timecode:
        clusterTs = readUint(b, body, sz.size);
        break;
      case ID.SimpleBlock:
      case ID.Block: {
        // track number (vint), then a signed 16-bit timestamp relative to the cluster
        const track = readSize(b, body);
        if (track) {
          const rel = b.readInt16BE(body + track.len);
          const ts = clusterTs + rel;
          if (out.lastTs === null || ts > out.lastTs) out.lastTs = ts;
        }
        break;
      }
    }
    p = body + sz.size;
  }
  return out;
}

/**
 * Returns the WebM with a Duration written into its Info, or the same buffer
 * when it already has one, isn't a WebM, or can't be repaired safely.
 */
export function fixWebmDuration(b: Buffer): Buffer {
  try {
    if (!isWebm(b)) return b;
    const s = scan(b);
    if (!s?.info || s.info.hasDuration || s.lastTs === null || s.lastTs <= 0) return b;
    // A SeekHead holds byte offsets that the insertion would shift. MediaRecorder
    // never writes one; a file that has one came from a real muxer anyway.
    if (s.hasSeekHead) return b;

    const duration = Buffer.alloc(11);
    duration[0] = 0x44;
    duration[1] = 0x89;
    duration[2] = 0x88; // size 8
    duration.writeDoubleBE(s.lastTs, 3);

    const { start, headerLen, size } = s.info;
    const infoId = b.subarray(start, start + 4); // Info's ID is 4 bytes
    const newInfoSize = size + duration.length;
    const newHeader = Buffer.concat([infoId, size8(newInfoSize)]);
    const grew = newHeader.length + newInfoSize - (headerLen + size);

    const out = Buffer.concat([
      b.subarray(0, start),
      newHeader,
      b.subarray(start + headerLen, start + headerLen + size),
      duration,
      b.subarray(start + headerLen + size),
    ]);

    // A Segment with a known size has to grow by what we inserted.
    if (s.segment && s.segment.size !== null && s.segment.sizeAt < start) {
      const next = s.segment.size + grew;
      const len = s.segment.sizeLen;
      if (next >= 2 ** (7 * len) - 1) return b; // doesn't fit its width
      let v = next;
      for (let i = len - 1; i >= 0; i--) {
        out[s.segment.sizeAt + i] = v % 256;
        v = Math.floor(v / 256);
      }
      out[s.segment.sizeAt] |= 0x80 >> (len - 1);
    }
    return out;
  } catch {
    return b;
  }
}
