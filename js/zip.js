// Minimal ZIP writer (stored, no compression: PDFs are already compressed) and reader.
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export async function writeZip(entries) {   // [{name, data: Blob|string}]
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  const now = new Date();
  const dt = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const tm = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  for (const e of entries) {
    const data = typeof e.data === 'string' ? new Blob([e.data]) : e.data;
    const bytes = new Uint8Array(await data.arrayBuffer());
    const crc = crc32(bytes), name = enc.encode(e.name), size = bytes.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, tm, true); h.setUint16(12, dt, true); h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, tm, true); c.setUint16(14, dt, true); c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true);
    c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(c.buffer, name);
    off += 30 + name.length + size;
  }
  const cdSize = central.reduce((a, b) => a + b.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

export async function readZip(blob) {   // -> Map(name -> () => Promise<Blob>)
  const tailLen = Math.min(blob.size, 65557);
  const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
  let p = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { p = i; break; }
  if (p < 0) throw new Error('Not a zip file');
  const count = tail.getUint16(p + 10, true), cdSize = tail.getUint32(p + 12, true), cdOff = tail.getUint32(p + 16, true);
  const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dec = new TextDecoder(), out = new Map();
  let q = 0;
  for (let i = 0; i < count; i++) {
    const method = cd.getUint16(q + 10, true), csize = cd.getUint32(q + 20, true);
    const nl = cd.getUint16(q + 28, true), xl = cd.getUint16(q + 30, true), cl = cd.getUint16(q + 32, true), lo = cd.getUint32(q + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + q + 46, nl));
    q += 46 + nl + xl + cl;
    out.set(name, async () => {
      const lh = new DataView(await blob.slice(lo, lo + 30).arrayBuffer());
      const start = lo + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      const raw = blob.slice(start, start + csize);
      if (method === 0) return raw;
      if (method === 8) return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      throw new Error('Unsupported zip compression');
    });
  }
  return out;
}
