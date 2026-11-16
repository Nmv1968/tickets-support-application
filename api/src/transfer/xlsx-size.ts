import { BadRequestException } from '@nestjs/common';
import { createInflateRaw } from 'node:zlib';
import { MB, megabytes } from '../common/uploads';

/**
 * What the parts of an .xlsx may add up to once uncompressed. An .xlsx is a zip, and ExcelJS
 * inflates every part of it into memory and builds the whole workbook before the import can count
 * its rows; a file of 20 MB can hold gigabytes. The heaviest sheet per byte is one of many small
 * cells: 50 MB of them (20,000 rows of a hundred numbers) need a JavaScript heap of some 640 MB,
 * and took the API container to 930 MB, which its memory is sized for (docker-compose.yml). Sheets
 * of text weigh much less per byte: 20,000 cases exported with descriptions and observations of
 * some 400 characters are about 30 MB; with 1,000 characters each, 47 MB.
 */
export const MAX_XLSX_UNCOMPRESSED_BYTES = 50 * MB;

/** Parts an .xlsx may have. One of Excel has a few dozen; each one costs memory even when it is empty. */
export const MAX_XLSX_PARTS = 10_000;

const UNREADABLE = 'No se pudo leer el archivo Excel';

/** One part of a zip as its central directory describes it, with where its data starts. */
export interface ZipPart {
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  dataStart: number;
}

const END_OF_CENTRAL_DIRECTORY = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const ZIP64_END_LOCATOR = Buffer.from([0x50, 0x4b, 0x06, 0x07]);
const ZIP64_END_OF_CENTRAL_DIRECTORY = Buffer.from([0x50, 0x4b, 0x06, 0x06]);
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
/** A 32-bit size or offset of the zip with this value is in the zip64 extra field instead. */
const IN_ZIP64 = 0xffffffff;

function unreadable(): BadRequestException {
  return new BadRequestException(UNREADABLE);
}

function uint64(buffer: Buffer, at: number): number {
  const value = buffer.readBigUInt64LE(at);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw unreadable();
  return Number(value);
}

/**
 * The parts of a zip as JSZip, which ExcelJS uses, finds them, so that none of what it inflates is
 * left out of the count: the last end record of the file; zip64 where its fields are full; every
 * entry of the central directory for as long as there is one, whatever number the end record says;
 * sizes from the central directory and the data after the local header of each part; and data
 * written before the zip itself (a self-extracting archive) skipped.
 */
export function zipParts(buffer: Buffer): ZipPart[] {
  try {
    const end = buffer.lastIndexOf(END_OF_CENTRAL_DIRECTORY);
    if (end < 0) throw unreadable();
    const fullCount = buffer.readUInt16LE(end + 10) === 0xffff;
    let directorySize = buffer.readUInt32LE(end + 12);
    let directoryOffset = buffer.readUInt32LE(end + 16);
    let expectedEnd: number;
    if (fullCount || directorySize === IN_ZIP64 || directoryOffset === IN_ZIP64 || [4, 6, 8].some((at) => buffer.readUInt16LE(end + at) === 0xffff)) {
      const locator = buffer.lastIndexOf(ZIP64_END_LOCATOR);
      if (locator < 0) throw unreadable();
      let zip64End = uint64(buffer, locator + 8);
      if (!buffer.subarray(zip64End, zip64End + 4).equals(ZIP64_END_OF_CENTRAL_DIRECTORY)) zip64End = buffer.lastIndexOf(ZIP64_END_OF_CENTRAL_DIRECTORY);
      if (zip64End < 0) throw unreadable();
      directorySize = uint64(buffer, zip64End + 40);
      directoryOffset = uint64(buffer, zip64End + 48);
      expectedEnd = directoryOffset + directorySize + 20 + 12 + uint64(buffer, zip64End + 4);
    } else {
      expectedEnd = directoryOffset + directorySize;
    }
    // Bytes before the zip move every offset it wrote.
    const shift = end - expectedEnd;
    if (shift < 0) throw unreadable();

    const parts: ZipPart[] = [];
    let at = directoryOffset + shift;
    while (at + 4 <= buffer.length && buffer.readUInt32LE(at) === CENTRAL_FILE_HEADER) {
      if (parts.length === MAX_XLSX_PARTS) throw unreadable();
      const nameLength = buffer.readUInt16LE(at + 28);
      const extraLength = buffer.readUInt16LE(at + 30);
      const commentLength = buffer.readUInt16LE(at + 32);
      let compressedSize = buffer.readUInt32LE(at + 20);
      let uncompressedSize = buffer.readUInt32LE(at + 24);
      let localOffset = buffer.readUInt32LE(at + 42);

      // The zip64 extra field (the last one, if there are several) holds, in this order, the
      // values whose 32-bit field is full.
      let zip64Field = -1;
      for (let extra = at + 46 + nameLength; extra + 4 <= at + 46 + nameLength + extraLength; extra += 4 + buffer.readUInt16LE(extra + 2)) {
        if (buffer.readUInt16LE(extra) === 0x0001) zip64Field = extra + 4;
      }
      if (zip64Field >= 0) {
        let field = zip64Field;
        if (uncompressedSize === IN_ZIP64) [uncompressedSize, field] = [uint64(buffer, field), field + 8];
        if (compressedSize === IN_ZIP64) [compressedSize, field] = [uint64(buffer, field), field + 8];
        if (localOffset === IN_ZIP64) localOffset = uint64(buffer, field);
      }

      const local = localOffset + shift;
      if (buffer.readUInt32LE(local) !== LOCAL_FILE_HEADER) throw unreadable();
      const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      if (dataStart + compressedSize > buffer.length) throw unreadable();
      parts.push({ method: buffer.readUInt16LE(at + 10), compressedSize, uncompressedSize, dataStart });
      at += 46 + nameLength + extraLength + commentLength;
    }
    return parts;
  } catch (error) {
    // A read past the end of the buffer: a zip cut short, or no zip at all.
    if (error instanceof RangeError) throw unreadable();
    throw error;
  }
}

/** The bytes the data of a part inflates to, counted without keeping them; it stops past `max`. */
async function inflatedSize(data: Buffer, max: number): Promise<number> {
  const inflate = createInflateRaw();
  let size = 0;
  try {
    inflate.end(data);
    for await (const chunk of inflate) {
      size += (chunk as Buffer).length;
      if (size > max) break;
    }
  } finally {
    inflate.destroy();
  }
  return size;
}

/**
 * Refuses, with a 400, an .xlsx that would take too much memory to read: one whose parts say they
 * add up to more than `limit` once uncompressed, and one whose parts inflate to more (or less)
 * than they say. JSZip believes the sizes the zip declares and only notices a lie once it has
 * inflated the whole part, which a part of a few KB can make gigabytes. Each part is inflated here
 * first, counting the bytes and keeping none, and only as far as its declared size and one chunk.
 */
export async function checkXlsxSize(buffer: Buffer, limit = MAX_XLSX_UNCOMPRESSED_BYTES): Promise<void> {
  const parts = zipParts(buffer);
  const declared = parts.reduce((sum, part) => sum + part.uncompressedSize, 0);
  if (declared > limit) {
    // Rounded up: a file of 50.2 MB must not read as one of the 50 it may have.
    throw new BadRequestException(
      `El archivo Excel ocupa ${Math.ceil(declared / MB)} MB sin comprimir y se pueden importar hasta ${megabytes(limit)} MB a la vez. Divídelo en varios archivos.`,
    );
  }
  for (const part of parts) {
    const data = buffer.subarray(part.dataStart, part.dataStart + part.compressedSize);
    let size: number;
    if (part.method === 0) size = data.length;
    else if (part.method === 8) size = await inflatedSize(data, part.uncompressedSize).catch(() => -1);
    // JSZip reads no other compression method either.
    else throw unreadable();
    if (size !== part.uncompressedSize) throw unreadable();
  }
}
