import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';

export class AppError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 500 * 1024 * 1024;
export const MAX_JSON_BYTES = 2 * 1024 * 1024;

export const newId = (prefix) => `${prefix}_${randomUUID()}`;
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const nowIso = (clock = () => new Date()) => clock().toISOString();
export const monthKey = (date = new Date()) => date.toISOString().slice(0, 7);

export const parseJson = (value, fallback) => {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export const asFiniteNumber = (value, fallback = null) => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export const asBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
};

export const stringOrEmpty = (value) => (typeof value === 'string' ? value.trim() : '');

export const safeFilename = (value, fallback = 'document') => {
  const candidate = stringOrEmpty(value)
    .replace(/[\\/:*?"<>|]/g, '_')
    .split('')
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('')
    .replace(/\.+$/g, '')
    .slice(0, 180);
  return candidate || fallback;
};

export const extensionOf = (filename = '') => {
  const extension = path.extname(filename).toLowerCase().replace(/^\./, '');
  return extension || 'bin';
};

export const isZip = (filename = '', mimeType = '') => (
  extensionOf(filename) === 'zip' || String(mimeType).toLowerCase().includes('zip')
);

const MIME_BY_EXTENSION = {
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  htm: 'text/html',
  html: 'text/html',
  json: 'application/json',
  pdf: 'application/pdf',
  rtf: 'application/rtf',
  txt: 'text/plain',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
};

export const guessMimeType = (filename, fallback = 'application/octet-stream') => (
  MIME_BY_EXTENSION[extensionOf(filename)] || fallback
);

export const ANALYZABLE_EXTENSIONS = new Set([
  'pdf', 'txt', 'rtf', 'doc', 'docx', 'html', 'htm', 'csv',
]);

export const isAnalyzableFilename = (filename) => ANALYZABLE_EXTENSIONS.has(extensionOf(filename));

export const decodeHeaderValue = (value = '') => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const readRequestBody = (request, maxBytes = MAX_UPLOAD_BYTES) => new Promise((resolve, reject) => {
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    request.resume();
    reject(new AppError('PAYLOAD_TOO_LARGE', `Maksymalny rozmiar pliku to ${Math.floor(maxBytes / 1024 / 1024)} MB.`, 413));
    return;
  }

  const chunks = [];
  let size = 0;
  let settled = false;
  const fail = (error) => {
    if (settled) return;
    settled = true;
    reject(error);
  };

  request.on('data', (chunk) => {
    if (settled) return;
    size += chunk.length;
    if (size > maxBytes) {
      request.resume();
      fail(new AppError('PAYLOAD_TOO_LARGE', `Maksymalny rozmiar pliku to ${Math.floor(maxBytes / 1024 / 1024)} MB.`, 413));
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => {
    if (!settled) {
      settled = true;
      resolve(Buffer.concat(chunks));
    }
  });
  request.on('aborted', () => fail(new AppError('REQUEST_ABORTED', 'Przerwano przesyłanie danych.', 400)));
  request.on('error', fail);
});

export const readJsonBody = async (request, maxBytes = MAX_JSON_BYTES) => {
  const raw = await readRequestBody(request, maxBytes);
  if (raw.length === 0) return {};
  try {
    const value = JSON.parse(raw.toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      throw new Error('not an object');
    }
    return value;
  } catch {
    throw new AppError('INVALID_JSON', 'Treść żądania musi być poprawnym obiektem JSON.', 400);
  }
};

export const sendJson = (response, status, payload) => {
  if (response.writableEnded) return;
  const text = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(text);
};

export const sendData = (response, data, status = 200) => sendJson(response, status, { data });

export const sendError = (response, error) => {
  const appError = error instanceof AppError
    ? error
    : new AppError('INTERNAL_ERROR', 'Wystąpił nieoczekiwany błąd lokalnego helpera.', 500);
  if (appError.status >= 500) {
    console.error('[analysis-helper]', appError.code, appError.message);
  }
  sendJson(response, appError.status, {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
    },
  });
};

export const decodePathPart = (value) => {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\u0000')) {
      throw new Error('unsafe');
    }
    return decoded;
  } catch {
    throw new AppError('INVALID_PATH', 'Nieprawidłowy identyfikator w ścieżce.', 400);
  }
};

const isPrivateIpv4 = (address) => {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19));
};

const isPrivateAddress = (address) => {
  const normalized = address.toLowerCase().split('%')[0];
  const ipType = net.isIP(normalized);
  if (ipType === 4) return isPrivateIpv4(normalized);
  if (ipType !== 6) return true;
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fe80:')
    || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  const mapped = normalized.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIpv4(mapped[1]) : false;
};

export const validateExternalUrl = async (input) => {
  let url;
  try {
    url = new URL(stringOrEmpty(input));
  } catch {
    throw new AppError('INVALID_URL', 'Podaj poprawny adres http albo https.', 400);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new AppError('INVALID_URL', 'Dozwolone są wyłącznie publiczne adresy http/https bez danych logowania.', 400);
  }
  if (url.port && !['80', '443'].includes(url.port)) {
    throw new AppError('INVALID_URL', 'Pobieranie jest dozwolone wyłącznie z portów 80 i 443.', 400);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new AppError('UNSAFE_URL', 'Adres lokalny nie może być pobierany przez helper.', 400);
  }
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new AppError('UNSAFE_URL', 'Adres prywatny nie może być pobierany przez helper.', 400);
    return url;
  }
  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new AppError('URL_NOT_RESOLVABLE', 'Nie można rozwiązać adresu źródła.', 400);
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new AppError('UNSAFE_URL', 'Adres źródła wskazuje na sieć prywatną lub lokalną.', 400);
  }
  return url;
};

export const fetchExternalDocument = async ({ url: initialUrl, fetchImpl = fetch, maxBytes = MAX_DOWNLOAD_BYTES }) => {
  let url = await validateExternalUrl(initialUrl);
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Accept: 'application/pdf,application/zip,text/html,text/plain,application/octet-stream;q=0.8,*/*;q=0.3',
          'User-Agent': 'StockAnalyzerLocalHelper/1.0',
        },
      });
    } catch (error) {
      throw new AppError('DOWNLOAD_FAILED', `Nie udało się pobrać dokumentu: ${error.message}`, 502);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirect === 5) throw new AppError('TOO_MANY_REDIRECTS', 'Zbyt wiele przekierowań podczas pobierania dokumentu.', 502);
      url = await validateExternalUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new AppError('DOWNLOAD_FAILED', `Źródło zwróciło HTTP ${response.status}.`, 502);
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new AppError('PAYLOAD_TOO_LARGE', `Dokument przekracza limit ${Math.floor(maxBytes / 1024 / 1024)} MB.`, 413);
    }
    if (!response.body) throw new AppError('DOWNLOAD_FAILED', 'Źródło nie zwróciło treści dokumentu.', 502);
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AppError('PAYLOAD_TOO_LARGE', `Dokument przekracza limit ${Math.floor(maxBytes / 1024 / 1024)} MB.`, 413);
      }
      chunks.push(Buffer.from(value));
    }
    return {
      buffer: Buffer.concat(chunks),
      finalUrl: url.toString(),
      mimeType: response.headers.get('content-type')?.split(';')[0].trim() || 'application/octet-stream',
      filename: filenameFromResponse(response, url),
    };
  }
  throw new AppError('DOWNLOAD_FAILED', 'Nie udało się pobrać dokumentu.', 502);
};

const filenameFromResponse = (response, url) => {
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const simple = disposition.match(/filename\s*=\s*"?([^";]+)"?/i)?.[1];
  const fromHeader = encoded ? decodeHeaderValue(encoded) : simple;
  const fromUrl = path.basename(decodeURIComponent(url.pathname)) || 'document';
  return safeFilename(fromHeader || fromUrl);
};

export const contentDispositionAttachment = (filename) => {
  const clean = safeFilename(filename);
  const encoded = encodeURIComponent(clean).replace(/['()]/g, escape).replace(/\*/g, '%2A');
  return `attachment; filename="${clean.replace(/"/g, '')}"; filename*=UTF-8''${encoded}`;
};

export const ensureInside = (root, candidate) => {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new AppError('UNSAFE_PATH', 'Ścieżka pliku wychodzi poza katalog danych.', 400);
  }
  return resolvedCandidate;
};
