import { expect } from "vitest";

export interface ReadZipEntry {
  readonly name: string;
  readonly crc: number;
  readonly data: Uint8Array;
}

/** CRC-32 (ISO 3309), computed here on its own so a reader never trusts the writer's. */
const crcOf = (data: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/**
 * Reads a stored (uncompressed) ZIP archive the way an unzip tool would: from the end record through the central
 * directory to each local header, asserting that both headers agree and that each entry's bytes match its CRC-32.
 */
export const readZip = (bytes: Uint8Array): ReadZipEntry[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.byteLength - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  expect(directoryOffset + directorySize).toBe(eocd);
  const decoder = new TextDecoder();
  const entries: ReadZipEntry[] = [];
  let at = directoryOffset;
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    expect(view.getUint16(at + 10, true)).toBe(0);
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    expect(compressed).toBe(size);
    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    expect(view.getUint32(localOffset + 14, true)).toBe(crc);
    expect(view.getUint32(localOffset + 18, true)).toBe(size);
    expect(view.getUint32(localOffset + 22, true)).toBe(size);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const extraLength = view.getUint16(localOffset + 28, true);
    expect(decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength))).toBe(name);
    const start = localOffset + 30 + localNameLength + extraLength;
    const data = bytes.subarray(start, start + size);
    expect(crcOf(data)).toBe(crc);
    entries.push({ name, crc, data });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return entries;
};
