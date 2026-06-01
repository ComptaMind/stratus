/**
 * Minimal ZIP writer — no external dependencies.
 *
 * Uses Node.js built-in `zlib.deflateRawSync` for DEFLATE compression
 * and constructs a valid PKZIP (ZIP 2.0) file from scratch.
 *
 * Supports: multiple files, DEFLATE compression (method 8), UTF-8 filenames.
 * Does not support: encryption, ZIP64, directories (add '/' suffix if needed).
 */
import { deflateRawSync } from "node:zlib";

// ── CRC-32 ────────────────────────────────────────────────────────────────────

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── DOS date/time (zero = 1980-01-01 00:00:00) ────────────────────────────────

const DOS_DATE = 0x0021; // 1980-01-01
const DOS_TIME = 0x0000; // 00:00:00

// ── Internal helpers ──────────────────────────────────────────────────────────

interface ZipEntry {
  nameBytes: Buffer;
  compressed: Buffer;
  uncompressedSize: number;
  crc: number;
  localOffset: number;
}

function buildLocalHeader(entry: ZipEntry): Buffer {
  const buf = Buffer.alloc(30 + entry.nameBytes.length);
  buf.writeUInt32LE(0x04034b50, 0);              // local file header signature
  buf.writeUInt16LE(20, 4);                      // version needed: 2.0
  buf.writeUInt16LE(0x0800, 6);                  // flags: UTF-8 filename
  buf.writeUInt16LE(8, 8);                       // compression: DEFLATE
  buf.writeUInt16LE(DOS_TIME, 10);               // mod time
  buf.writeUInt16LE(DOS_DATE, 12);               // mod date
  buf.writeUInt32LE(entry.crc, 14);              // CRC-32
  buf.writeUInt32LE(entry.compressed.length, 18); // compressed size
  buf.writeUInt32LE(entry.uncompressedSize, 22); // uncompressed size
  buf.writeUInt16LE(entry.nameBytes.length, 26); // filename length
  buf.writeUInt16LE(0, 28);                      // extra field length
  entry.nameBytes.copy(buf, 30);
  return buf;
}

function buildCentralEntry(entry: ZipEntry): Buffer {
  const buf = Buffer.alloc(46 + entry.nameBytes.length);
  buf.writeUInt32LE(0x02014b50, 0);              // central dir signature
  buf.writeUInt16LE(0x031e, 4);                  // version made by: Unix 3.0
  buf.writeUInt16LE(20, 6);                      // version needed: 2.0
  buf.writeUInt16LE(0x0800, 8);                  // flags: UTF-8
  buf.writeUInt16LE(8, 10);                      // compression: DEFLATE
  buf.writeUInt16LE(DOS_TIME, 12);               // mod time
  buf.writeUInt16LE(DOS_DATE, 14);               // mod date
  buf.writeUInt32LE(entry.crc, 16);              // CRC-32
  buf.writeUInt32LE(entry.compressed.length, 20); // compressed size
  buf.writeUInt32LE(entry.uncompressedSize, 24); // uncompressed size
  buf.writeUInt16LE(entry.nameBytes.length, 28); // filename length
  buf.writeUInt16LE(0, 30);                      // extra field length
  buf.writeUInt16LE(0, 32);                      // file comment length
  buf.writeUInt16LE(0, 34);                      // disk number start
  buf.writeUInt16LE(0, 36);                      // internal attributes
  buf.writeUInt32LE(0, 38);                      // external attributes
  buf.writeUInt32LE(entry.localOffset, 42);      // local header offset
  entry.nameBytes.copy(buf, 46);
  return buf;
}

function buildEOCD(
  entryCount: number,
  centralDirSize: number,
  centralDirOffset: number,
): Buffer {
  const buf = Buffer.alloc(22);
  buf.writeUInt32LE(0x06054b50, 0);              // end-of-central-directory signature
  buf.writeUInt16LE(0, 4);                       // disk number
  buf.writeUInt16LE(0, 6);                       // central-dir start disk
  buf.writeUInt16LE(entryCount, 8);              // entries on this disk
  buf.writeUInt16LE(entryCount, 10);             // total entries
  buf.writeUInt32LE(centralDirSize, 12);         // central dir size
  buf.writeUInt32LE(centralDirOffset, 16);       // central dir offset
  buf.writeUInt16LE(0, 20);                      // comment length
  return buf;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ZipFile {
  /** Path inside the zip, e.g. "prompts/event-abc.txt" */
  name: string;
  data: Buffer;
}

/**
 * Build a valid ZIP archive from an array of in-memory files.
 *
 * @param files  Array of { name, data } — name may include path separators.
 * @returns      Buffer containing the complete ZIP binary.
 */
export function buildZip(files: ZipFile[]): Buffer {
  const entries: ZipEntry[] = [];
  const localParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, "utf8");
    const compressed = deflateRawSync(file.data, { level: 6 });
    const entry: ZipEntry = {
      nameBytes,
      compressed,
      uncompressedSize: file.data.length,
      crc: crc32(file.data),
      localOffset: offset,
    };

    const localHeader = buildLocalHeader(entry);
    localParts.push(localHeader, compressed);
    offset += localHeader.length + compressed.length;
    entries.push(entry);
  }

  const centralParts = entries.map(buildCentralEntry);
  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = buildEOCD(entries.length, centralDirBuf.length, offset);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}
