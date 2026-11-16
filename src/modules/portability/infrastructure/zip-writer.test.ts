import { describe, expect, it } from "vitest";
import { readZip } from "../../../../tests/support/zip";
import { crc32, zipStored } from "./zip-writer";

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("zipStored", () => {
  it("writes stored entries a reader reads back with their names, CRCs and bytes", () => {
    const movements = new TextEncoder().encode("﻿fecha,descripción\r\n2026-10-05,Café\r\n");
    const accounts = new TextEncoder().encode("a,b\r\n");
    const zip = zipStored(
      [
        { name: "movements.csv", data: movements },
        { name: "accounts.csv", data: accounts },
        { name: "empty.csv", data: new Uint8Array() },
      ],
      new Date("2026-11-16T10:20:30Z"),
    );

    const entries = readZip(zip);

    expect(entries.map((e) => e.name)).toEqual(["movements.csv", "accounts.csv", "empty.csv"]);
    expect(entries[0]!.data).toEqual(movements);
    expect(entries[1]!.data).toEqual(accounts);
    expect(entries[2]!.data.byteLength).toBe(0);
  });

  it("marks names as UTF-8 and stamps the given time", () => {
    const zip = zipStored([{ name: "año.csv", data: new Uint8Array([1]) }], new Date("2026-11-16T10:20:30Z"));
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800);
    // DOS time: hours << 11 | minutes << 5 | seconds / 2; date: (year − 1980) << 9 | month << 5 | day.
    expect(view.getUint16(10, true)).toBe((10 << 11) | (20 << 5) | 15);
    expect(view.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (11 << 5) | 16);
    expect(readZip(zip)[0]!.name).toBe("año.csv");
  });
});
