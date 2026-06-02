// Tiny store-only ZIP writer.
// Works in MV3 service workers — uses only ArrayBuffer/DataView/TextEncoder/Blob.
// Files are stored uncompressed (method 0). Good for media that's already compressed
// (webm, png) and gives us a single download instead of N.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input === 'string') return new TextEncoder().encode(input);
  throw new Error('unsupported data type for zip entry');
}

/**
 * Build a ZIP archive (store-only) as a Blob.
 * @param {{ name: string, data: Uint8Array | ArrayBuffer | string }[]} files
 * @returns {Blob}
 */
export function makeZip(files) {
  const encoder = new TextEncoder();
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = encoder.encode(f.name);
    const data = toBytes(f.data);
    const crc = crc32(data);

    // Local file header (30 bytes + filename)
    const lh = new Uint8Array(30 + nameBytes.length);
    const lhv = new DataView(lh.buffer);
    lhv.setUint32(0, 0x04034b50, true); // local file header signature
    lhv.setUint16(4, 20, true);          // version needed
    lhv.setUint16(6, 0, true);           // general purpose bit flag
    lhv.setUint16(8, 0, true);           // compression method = store
    lhv.setUint16(10, 0, true);          // mod time (skip)
    lhv.setUint16(12, 0, true);          // mod date (skip)
    lhv.setUint32(14, crc, true);
    lhv.setUint32(18, data.length, true); // compressed size
    lhv.setUint32(22, data.length, true); // uncompressed size
    lhv.setUint16(26, nameBytes.length, true);
    lhv.setUint16(28, 0, true);           // extra field length
    lh.set(nameBytes, 30);

    localChunks.push(lh, data);

    // Central directory entry (46 bytes + filename)
    const ch = new Uint8Array(46 + nameBytes.length);
    const chv = new DataView(ch.buffer);
    chv.setUint32(0, 0x02014b50, true);   // central dir signature
    chv.setUint16(4, 20, true);            // version made by
    chv.setUint16(6, 20, true);            // version needed
    chv.setUint16(8, 0, true);
    chv.setUint16(10, 0, true);            // method
    chv.setUint16(12, 0, true);
    chv.setUint16(14, 0, true);
    chv.setUint32(16, crc, true);
    chv.setUint32(20, data.length, true);
    chv.setUint32(24, data.length, true);
    chv.setUint16(28, nameBytes.length, true);
    chv.setUint16(30, 0, true);
    chv.setUint16(32, 0, true);            // comment length
    chv.setUint16(34, 0, true);            // disk number
    chv.setUint16(36, 0, true);            // internal attrs
    chv.setUint32(38, 0, true);            // external attrs
    chv.setUint32(42, offset, true);       // local header offset
    ch.set(nameBytes, 46);

    centralChunks.push(ch);
    offset += lh.length + data.length;
  }

  const centralSize = centralChunks.reduce((a, p) => a + p.length, 0);

  // End of central directory record (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...localChunks, ...centralChunks, eocd], { type: 'application/zip' });
}

/** Convert a Blob to a data URL inside a service worker (no FileReader available). */
export async function blobToDataUrl(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // btoa needs a binary string; build in chunks to avoid call-stack limits
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}
