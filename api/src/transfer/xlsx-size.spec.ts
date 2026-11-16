import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { deflateRawSync } from 'node:zlib';
import { MB } from '../common/uploads';
import { MAX_XLSX_PARTS, MAX_XLSX_UNCOMPRESSED_BYTES, checkXlsxSize, zipParts } from './xlsx-size';

const UNREADABLE = new BadRequestException('No se pudo leer el archivo Excel');

/** One part of a zip written by `zip` below. */
interface Part {
  name?: string;
  data: Buffer;
  /** 0: stored as it is; 8 (the default): deflated. */
  method?: number;
  /** The size the zip says the part has once inflated, when it is not the real one. */
  declared?: number;
  /** Sizes and offset in the zip64 extra field, with 0xFFFFFFFF in their 32-bit fields. */
  zip64?: boolean;
}

/**
 * A zip written by hand, byte by byte, so that it can say what a real one would not: sizes that
 * are not the real ones, more entries than its end record counts, zip64 fields, bytes in front.
 */
function zip(parts: Part[], options: { zip64End?: boolean; countInEnd?: number; prefix?: Buffer } = {}): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  parts.forEach((part, index) => {
    const name = Buffer.from(part.name ?? `xl/part${index}.xml`);
    const method = part.method ?? 8;
    const data = method === 8 ? deflateRawSync(part.data) : part.data;
    const declared = part.declared ?? part.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(part.zip64 ? 0xffffffff : data.length, 18);
    local.writeUInt32LE(part.zip64 ? 0xffffffff : declared, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const extra = Buffer.alloc(part.zip64 ? 28 : 0);
    if (part.zip64) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(declared), 4);
      extra.writeBigUInt64LE(BigInt(data.length), 12);
      extra.writeBigUInt64LE(BigInt(offset), 20);
    }
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(method, 10);
    header.writeUInt32LE(part.zip64 ? 0xffffffff : data.length, 20);
    header.writeUInt32LE(part.zip64 ? 0xffffffff : declared, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(extra.length, 30);
    header.writeUInt32LE(part.zip64 ? 0xffffffff : offset, 42);
    central.push(header, name, extra);
    offset += local.length + name.length + data.length;
  });

  const directory = Buffer.concat(central);
  const records: Buffer[] = [];
  const count = options.countInEnd ?? parts.length;
  if (options.zip64End) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeBigUInt64LE(BigInt(count), 24);
    record.writeBigUInt64LE(BigInt(count), 32);
    record.writeBigUInt64LE(BigInt(directory.length), 40);
    record.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(offset + directory.length), 8);
    locator.writeUInt32LE(1, 16);
    records.push(record, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(options.zip64End ? 0xffff : count, 8);
  end.writeUInt16LE(options.zip64End ? 0xffff : count, 10);
  end.writeUInt32LE(options.zip64End ? 0xffffffff : directory.length, 12);
  end.writeUInt32LE(options.zip64End ? 0xffffffff : offset, 16);
  return Buffer.concat([options.prefix ?? Buffer.alloc(0), ...locals, directory, ...records, end]);
}

/** An .xlsx as ExcelJS writes it, with one sheet of the rows given. */
async function xlsx(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Casos').addRows(rows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * The sizes of the parts with data, in order, as JSZip (which ExcelJS uses to open the file) reads
 * them, or as `zipParts` does. Folders weigh nothing, and JSZip adds some that are not in the zip.
 */
async function jszipSizes(buffer: Buffer): Promise<number[]> {
  const files = Object.values((await JSZip.loadAsync(buffer)).files) as unknown as { dir: boolean; _data: { uncompressedSize: number } }[];
  return files.filter((file) => !file.dir && file._data.uncompressedSize > 0).map((file) => file._data.uncompressedSize);
}
const sizes = (buffer: Buffer): number[] => zipParts(buffer).flatMap((part) => (part.uncompressedSize > 0 ? [part.uncompressedSize] : []));

describe('the uncompressed size of an .xlsx', () => {
  it('reads the parts of a real .xlsx as JSZip does, and lets it through', async () => {
    const file = await xlsx([
      ['Fecha', 'Empresa', 'Descripción'],
      [new Date(), 'ACME', 'No imprime'],
    ]);

    expect(sizes(file)).toEqual(await jszipSizes(file));
    await expect(checkXlsxSize(file)).resolves.toBeUndefined();
  });

  it('allows 50 MB, a measured bound of the memory reading a sheet takes', () => {
    expect(MAX_XLSX_UNCOMPRESSED_BYTES).toBe(50 * MB);
  });

  it('refuses a file whose parts add up to more than the limit, saying both sizes, without inflating anything', async () => {
    // A few bytes of data that say they are 60 MB: refused on what they say.
    const file = zip([{ data: Buffer.from('<x/>'), declared: 30 * MB }, { data: Buffer.from('<y/>'), declared: 30 * MB + 1 }]);

    await expect(checkXlsxSize(file)).rejects.toThrow(
      new BadRequestException('El archivo Excel ocupa 61 MB sin comprimir y se pueden importar hasta 50 MB a la vez. Divídelo en varios archivos.'),
    );
  });

  it('refuses a real sheet that takes more than the limit given once uncompressed', async () => {
    // Each text its own: a spreadsheet keeps a repeated one once.
    const file = await xlsx(Array.from({ length: 2000 }, (_, index) => [`Caso ${index}`, `${index} ${'x'.repeat(1000)}`]));

    await expect(checkXlsxSize(file, 1 * MB)).rejects.toThrow(/^El archivo Excel ocupa [23] MB sin comprimir y se pueden importar hasta 1 MB a la vez/);
    await expect(checkXlsxSize(file, 3 * MB)).resolves.toBeUndefined();
  });

  // JSZip believes the declared size and only notices the lie once it has inflated the whole part:
  // here 64 MB from 64 KB, and a file of 20 MB could be made to inflate to gigabytes.
  it('refuses a part that inflates to more than it says, before JSZip would inflate it whole', async () => {
    const file = zip([{ data: Buffer.alloc(64 * MB), declared: 1024 }]);
    expect(file.length).toBeLessThan(MB);

    await expect(checkXlsxSize(file)).rejects.toThrow(UNREADABLE);
  });

  it('refuses a part that inflates to less than it says, a stored part of the wrong size, and one compressed in another way', async () => {
    await expect(checkXlsxSize(zip([{ data: Buffer.from('<x/>'), declared: 100 }]))).rejects.toThrow(UNREADABLE);
    await expect(checkXlsxSize(zip([{ data: Buffer.from('<x/>'), method: 0, declared: 100 }]))).rejects.toThrow(UNREADABLE);
    // 12 is bzip2, which JSZip cannot read either.
    await expect(checkXlsxSize(zip([{ data: Buffer.from('<x/>'), method: 12 }]))).rejects.toThrow(UNREADABLE);
    await expect(checkXlsxSize(zip([{ data: Buffer.from('<x/>'), method: 0 }, { data: Buffer.from('<y/>') }]))).resolves.toBeUndefined();
  });

  it('refuses what is no zip, a zip cut short, and deflated data that is not', async () => {
    await expect(checkXlsxSize(Buffer.from('Fecha,Empresa,Descripción\n7/27/2023,ACME,No imprime\n'))).rejects.toThrow(UNREADABLE);
    const file = await xlsx([['Fecha', 'Empresa', 'Descripción']]);
    await expect(checkXlsxSize(file.subarray(0, file.length / 2))).rejects.toThrow(UNREADABLE);
    await expect(checkXlsxSize(Buffer.concat([file.subarray(0, file.length - 30), file.subarray(file.length - 22)]))).rejects.toThrow(UNREADABLE);
    const broken = zip([{ data: Buffer.from('<x/>'), method: 0 }]);
    broken.writeUInt16LE(8, 8);
    broken.writeUInt16LE(8, broken.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10);
    await expect(checkXlsxSize(broken)).rejects.toThrow(UNREADABLE);
  });

  // JSZip reads every entry of the central directory, however many the end record counts.
  it('counts the parts after the number the end record gives', async () => {
    const file = zip([{ data: Buffer.from('<x/>') }, { data: Buffer.from('<y/>'), declared: 60 * MB - 4 }], { countInEnd: 1 });

    expect(zipParts(file)).toHaveLength(2);
    await expect(checkXlsxSize(file)).rejects.toThrow(/^El archivo Excel ocupa 60 MB sin comprimir/);
  });

  it('reads the sizes of zip64, in the extra field of a part and in the zip64 end record', async () => {
    const big = zip([{ data: Buffer.from('<x/>'), declared: 60 * MB, zip64: true }], { zip64End: true });
    const small = zip([{ data: Buffer.from('<x/>'), zip64: true }, { data: Buffer.from('<y/>') }], { zip64End: true });

    await expect(checkXlsxSize(big)).rejects.toThrow(/^El archivo Excel ocupa 60 MB sin comprimir/);
    expect(sizes(small)).toEqual(await jszipSizes(small));
    await expect(checkXlsxSize(small)).resolves.toBeUndefined();
  });

  it('skips bytes written before the zip, as JSZip does', async () => {
    const file = Buffer.concat([Buffer.from('MZ'.repeat(50)), await xlsx([['Fecha', 'Empresa', 'Descripción']])]);

    expect(sizes(file)).toEqual(await jszipSizes(file));
    await expect(checkXlsxSize(file)).resolves.toBeUndefined();
  });

  it(`refuses a zip of more than ${MAX_XLSX_PARTS} parts, which cost memory even when empty`, async () => {
    const empty = (count: number): Part[] => Array.from({ length: count }, () => ({ data: Buffer.alloc(0), method: 0 }));

    await expect(checkXlsxSize(zip(empty(MAX_XLSX_PARTS)))).resolves.toBeUndefined();
    await expect(checkXlsxSize(zip(empty(MAX_XLSX_PARTS + 1)))).rejects.toThrow(UNREADABLE);
  });
});
