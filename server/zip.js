import { inflateRawSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError, ensureInside } from './utils.js';

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_SENTINEL = 0xffffffff;

const MAX_ENTRIES_DEFAULT = 250;
const MAX_EXTRACTED_BYTES_DEFAULT = 250 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES_DEFAULT = 50 * 1024 * 1024;

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  CRC_TABLE[index] = value >>> 0;
}

export const crc32 = (buffer) => {
  let value = 0xffffffff;
  for (const byte of buffer) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 0xff];
  return (value ^ 0xffffffff) >>> 0;
};

const failZip = (code, message, details) => {
  throw new AppError(code, message, 400, details);
};

const requireRange = (buffer, offset, length) => {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > buffer.length) {
    failZip('INVALID_ZIP', 'Archiwum ZIP jest uszkodzone albo niekompletne.');
  }
};

const findEndRecord = (buffer) => {
  const lowerBound = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  failZip('INVALID_ZIP', 'Nie znaleziono katalogu centralnego archiwum ZIP.');
};

const decodeFilename = (buffer, flags) => buffer.toString(flags & 0x0800 ? 'utf8' : 'latin1');

const safeEntryPath = (rawName) => {
  const name = String(rawName || '');
  if (!name || name.includes('\u0000') || name.includes('\\')) {
    failZip('UNSAFE_ZIP_ENTRY', 'Archiwum zawiera niedozwoloną ścieżkę pliku.');
  }
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) {
    failZip('UNSAFE_ZIP_ENTRY', 'Archiwum zawiera ścieżkę bezwzględną.');
  }
  const isDirectory = name.endsWith('/');
  const parts = (isDirectory ? name.slice(0, -1) : name).split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    failZip('UNSAFE_ZIP_ENTRY', 'Archiwum zawiera niebezpieczną ścieżkę.');
  }
  const normalized = path.posix.normalize(name);
  if (normalized.startsWith('../') || normalized === '..' || normalized !== name) {
    failZip('UNSAFE_ZIP_ENTRY', 'Archiwum zawiera niebezpieczną ścieżkę.');
  }
  return { path: name, isDirectory };
};

/**
 * Reads a regular ZIP central directory without extracting any entry. ZIP64,
 * encrypted archives and methods other than stored/deflate are rejected so we
 * can enforce entry count and expanded-size limits before allocating memory.
 */
export const inspectZip = (buffer, {
  maxEntries = MAX_ENTRIES_DEFAULT,
  maxExtractedBytes = MAX_EXTRACTED_BYTES_DEFAULT,
  maxSingleFileBytes = MAX_SINGLE_FILE_BYTES_DEFAULT,
} = {}) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    failZip('INVALID_ZIP', 'Przesłany plik nie jest poprawnym archiwum ZIP.');
  }

  const endOffset = findEndRecord(buffer);
  const diskNumber = buffer.readUInt16LE(endOffset + 4);
  const centralDisk = buffer.readUInt16LE(endOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(endOffset + 8);
  const entriesTotal = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entriesTotal) {
    failZip('UNSUPPORTED_ZIP', 'Archiwa ZIP podzielone na części nie są obsługiwane.');
  }
  if (entriesTotal === 0xffff || centralSize === ZIP64_SENTINEL || centralOffset === ZIP64_SENTINEL) {
    failZip('UNSUPPORTED_ZIP', 'Archiwa ZIP64 nie są obsługiwane.');
  }
  if (entriesTotal > maxEntries) {
    failZip('ZIP_TOO_MANY_ENTRIES', `Archiwum zawiera więcej niż ${maxEntries} plików.`);
  }
  requireRange(buffer, centralOffset, centralSize);

  const entries = [];
  const seenNames = new Set();
  let offset = centralOffset;
  let expandedBytes = 0;

  for (let index = 0; index < entriesTotal; index += 1) {
    requireRange(buffer, offset, 46);
    if (buffer.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) {
      failZip('INVALID_ZIP', 'Nieprawidłowy wpis w katalogu centralnym ZIP.');
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const filenameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const diskStart = buffer.readUInt16LE(offset + 34);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const recordLength = 46 + filenameLength + extraLength + commentLength;

    requireRange(buffer, offset, recordLength);
    if (flags & 0x0001) failZip('UNSUPPORTED_ZIP', 'Archiwa ZIP szyfrowane hasłem nie są obsługiwane.');
    if (![0, 8].includes(compressionMethod)) {
      failZip('UNSUPPORTED_ZIP', 'Archiwum zawiera format kompresji, którego helper nie obsługuje.');
    }
    if (compressedSize === ZIP64_SENTINEL || uncompressedSize === ZIP64_SENTINEL || localHeaderOffset === ZIP64_SENTINEL) {
      failZip('UNSUPPORTED_ZIP', 'Archiwa ZIP64 nie są obsługiwane.');
    }
    if (diskStart !== 0) failZip('UNSUPPORTED_ZIP', 'Archiwa ZIP podzielone na części nie są obsługiwane.');

    // UNIX symlink bits are stored in the high word of the external attributes.
    const unixFileType = (externalAttributes >>> 16) & 0o170000;
    if (unixFileType === 0o120000) failZip('UNSAFE_ZIP_ENTRY', 'Archiwum ZIP nie może zawierać dowiązań symbolicznych.');

    const filename = decodeFilename(buffer.subarray(offset + 46, offset + 46 + filenameLength), flags);
    const { path: entryPath, isDirectory } = safeEntryPath(filename);
    if (seenNames.has(entryPath)) failZip('INVALID_ZIP', 'Archiwum ZIP zawiera zduplikowane ścieżki.');
    seenNames.add(entryPath);

    if (!isDirectory) {
      if (uncompressedSize > maxSingleFileBytes) {
        failZip('ZIP_ENTRY_TOO_LARGE', `Plik „${entryPath}” przekracza limit ${Math.floor(maxSingleFileBytes / 1024 / 1024)} MB.`);
      }
      expandedBytes += uncompressedSize;
      if (expandedBytes > maxExtractedBytes) {
        failZip('ZIP_TOO_LARGE', `Rozpakowane archiwum przekracza limit ${Math.floor(maxExtractedBytes / 1024 / 1024)} MB.`);
      }
    }

    entries.push({
      path: entryPath,
      isDirectory,
      flags,
      compressionMethod,
      crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset += recordLength;
  }

  if (offset !== centralOffset + centralSize) {
    failZip('INVALID_ZIP', 'Katalog centralny ZIP ma nieprawidłowy rozmiar.');
  }
  return entries;
};

const readEntryData = (buffer, entry, maxSingleFileBytes) => {
  const localOffset = entry.localHeaderOffset;
  requireRange(buffer, localOffset, 30);
  if (buffer.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
    failZip('INVALID_ZIP', `Brakuje lokalnego nagłówka pliku „${entry.path}”.`);
  }
  const localFlags = buffer.readUInt16LE(localOffset + 6);
  const localMethod = buffer.readUInt16LE(localOffset + 8);
  const filenameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  if (localFlags & 0x0001 || localMethod !== entry.compressionMethod) {
    failZip('INVALID_ZIP', `Niespójny nagłówek pliku „${entry.path}”.`);
  }
  const dataOffset = localOffset + 30 + filenameLength + extraLength;
  requireRange(buffer, dataOffset, entry.compressedSize);
  const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize);
  let content;
  try {
    content = entry.compressionMethod === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: maxSingleFileBytes });
  } catch {
    failZip('INVALID_ZIP', `Nie można rozpakować pliku „${entry.path}”.`);
  }
  if (content.length !== entry.uncompressedSize || crc32(content) !== entry.crc) {
    failZip('INVALID_ZIP', `Plik „${entry.path}” nie przeszedł kontroli integralności.`);
  }
  return content;
};

export const extractZipSafely = async (buffer, destination, options = {}) => {
  const entries = inspectZip(buffer, options);
  const maxSingleFileBytes = options.maxSingleFileBytes ?? MAX_SINGLE_FILE_BYTES_DEFAULT;
  const root = path.resolve(destination);
  await mkdir(root, { recursive: true });
  const files = [];

  for (const entry of entries) {
    const outputPath = ensureInside(root, path.join(root, ...entry.path.split('/')));
    if (entry.isDirectory) {
      await mkdir(outputPath, { recursive: true });
      continue;
    }
    const content = readEntryData(buffer, entry, maxSingleFileBytes);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, { flag: 'wx' });
    files.push({ path: entry.path, absolutePath: outputPath, sizeBytes: content.length });
  }

  return files;
};

const dosDateTime = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
};

/** Creates a portable, uncompressed ZIP archive without an external package. */
export const createStoredZip = (entries, { modifiedAt = new Date() } = {}) => {
  if (!Array.isArray(entries) || entries.length > 65_535) {
    throw new AppError('INVALID_BACKUP', 'Backup zawiera zbyt wiele plików.', 400);
  }
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { date, time } = dosDateTime(modifiedAt);

  entries.forEach((entry) => {
    const safe = safeEntryPath(String(entry?.path || ''));
    if (safe.isDirectory) throw new AppError('INVALID_BACKUP', 'Backup nie może zawierać pustego katalogu.', 400);
    const content = Buffer.isBuffer(entry?.content) ? entry.content : Buffer.from(entry?.content ?? '');
    if (content.length > ZIP64_SENTINEL || offset > ZIP64_SENTINEL) {
      throw new AppError('BACKUP_TOO_LARGE', 'Backup przekracza obsługiwany rozmiar ZIP.', 413);
    }
    const filename = Buffer.from(safe.path, 'utf8');
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_FILE_HEADER, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(filename.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, filename, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_FILE_HEADER, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, filename);
    offset += local.length + filename.length + content.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
};
