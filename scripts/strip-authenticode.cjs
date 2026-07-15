"use strict";

const { readFileSync, writeFileSync } = require("node:fs");

const path = process.argv[2];
if (!path) throw new Error("Usage: node strip-authenticode.cjs <pe-file>");

const file = readFileSync(path);
if (file.toString("ascii", 0, 2) !== "MZ") throw new Error("Not a PE executable");
const peOffset = file.readUInt32LE(0x3c);
if (file.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") {
  throw new Error("PE signature not found");
}

const optionalHeader = peOffset + 24;
const magic = file.readUInt16LE(optionalHeader);
const dataDirectory = optionalHeader + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : 0);
if (dataDirectory === optionalHeader) throw new Error(`Unsupported PE magic 0x${magic.toString(16)}`);
const securityDirectory = dataDirectory + 4 * 8;
const certificateOffset = file.readUInt32LE(securityDirectory);
const certificateSize = file.readUInt32LE(securityDirectory + 4);

if (certificateOffset === 0 || certificateSize === 0) process.exit(0);
file.writeUInt32LE(0, securityDirectory);
file.writeUInt32LE(0, securityDirectory + 4);

const certificateEnd = certificateOffset + certificateSize;
if (certificateEnd === file.length) {
  writeFileSync(path, file.subarray(0, certificateOffset));
} else {
  file.fill(0, certificateOffset, Math.min(certificateEnd, file.length));
  writeFileSync(path, file);
}
