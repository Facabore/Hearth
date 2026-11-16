/** One file of an archive: its name inside the archive and its bytes. */
export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (ISO 3309, the one ZIP uses) of `data`. */
export const crc32 = (data: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

/** MS-DOS time and date, which ZIP headers carry; written from the instant's UTC fields. */
const dosStamp = (at: Date): { time: number; date: number } => ({
  time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
  date: ((Math.max(at.getUTCFullYear(), 1980) - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
});

/** General-purpose flag bit 11: the names are UTF-8. */
const UTF8_NAMES = 0x0800;
const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
/** Version 2.0, the lowest that knows stored entries with these fields. */
const VERSION = 20;
/** ZIP's 32-bit fields: larger archives need ZIP64, which this writer does not write. */
const MAX_SIZE = 0xffffffff;
const MAX_ENTRIES = 0xffff;

/**
 * Design §3.6: a ZIP archive of `entries`, stored without compression (method 0), with each entry's CRC-32 and sizes
 * in its local header and in the central directory, so no data descriptor is needed. No dependency: the export's
 * three CSV files are small next to ZIP's 4 GiB limit, which this refuses to pass rather than write a broken file.
 */
export const zipStored = (entries: readonly ZipEntry[], modifiedAt: Date): Uint8Array => {
  if (entries.length > MAX_ENTRIES) throw new RangeError("Too many ZIP entries");
  const encoder = new TextEncoder();
  const { time, date } = dosStamp(modifiedAt);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const size = entry.data.byteLength;
    if (size > MAX_SIZE || offset > MAX_SIZE) throw new RangeError("ZIP entry too large");
    const crc = crc32(entry.data);

    const local = new Uint8Array(30 + name.byteLength + size);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_HEADER, true);
    lv.setUint16(4, VERSION, true);
    lv.setUint16(6, UTF8_NAMES, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.byteLength, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(entry.data, 30 + name.byteLength);

    const central = new Uint8Array(46 + name.byteLength);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL_HEADER, true);
    cv.setUint16(4, VERSION, true);
    cv.setUint16(6, VERSION, true);
    cv.setUint16(8, UTF8_NAMES, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.byteLength, true);
    // Extra field, comment, disk number, internal and external attributes stay 0.
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.byteLength;
  }
  const directorySize = centrals.reduce((sum, c) => sum + c.byteLength, 0);
  if (offset + directorySize > MAX_SIZE) throw new RangeError("ZIP archive too large");
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, END_OF_DIRECTORY, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directorySize, true);
  ev.setUint32(16, offset, true);

  const archive = new Uint8Array(offset + directorySize + end.byteLength);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    archive.set(part, at);
    at += part.byteLength;
  }
  return archive;
};
