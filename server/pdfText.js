import zlib from 'node:zlib';

const STREAM_PATTERN = /<<(?:.|\n|\r)*?>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
const LITERAL_TEXT_PATTERN = /\((?:\\.|[^\\)])*\)\s*(?:Tj|'|")/g;
const ARRAY_TEXT_PATTERN = /\[((?:.|\n|\r)*?)\]\s*TJ/g;
const HEX_TEXT_PATTERN = /<([0-9a-fA-F\s]+)>\s*(?:Tj|'|")/g;
const TEXT_BLOCK_PATTERN = /BT\b([\s\S]*?)\bET/g;
const TEXT_MATRIX_PATTERN = /[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?\s+[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?\s+[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?\s+[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+Tm/g;
const ROW_Y_TOLERANCE = 0.35;

const decodeLiteral = (value) => value
  .replace(/\\([nrtbf()\\])/g, (_match, character) => ({
    n: '\n',
    r: '\r',
    t: '\t',
    b: '\b',
    f: '\f',
    '(': '(',
    ')': ')',
    '\\': '\\',
  }[character] || character))
  .replace(/\\([0-7]{1,3})/g, (_match, octal) => String.fromCharCode(Number.parseInt(octal, 8)));

const utf16BeHexToString = (hex) => {
  const clean = hex.replace(/\s+/g, '');
  let result = '';
  for (let index = 0; index + 3 < clean.length; index += 4) {
    result += String.fromCharCode(Number.parseInt(clean.slice(index, index + 4), 16));
  }
  return result;
};

const parseToUnicodeCMap = (text) => {
  const mapping = new Map();
  for (const section of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const entry of section[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      mapping.set(Number.parseInt(entry[1], 16), utf16BeHexToString(entry[2]));
    }
  }
  for (const section of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const entry of section[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]+)\])/g)) {
      const start = Number.parseInt(entry[1], 16);
      const end = Number.parseInt(entry[2], 16);
      if (entry[3]) {
        const destination = Number.parseInt(entry[3], 16);
        for (let code = start; code <= end; code += 1) {
          mapping.set(code, String.fromCharCode(destination + code - start));
        }
      } else {
        const destinations = [...entry[4].matchAll(/<([0-9a-fA-F]+)>/g)];
        destinations.forEach((destinationEntry, offset) => {
          if (start + offset <= end) mapping.set(start + offset, utf16BeHexToString(destinationEntry[1]));
        });
      }
    }
  }
  return mapping;
};

const decodedObjectStream = (body) => {
  const stream = /stream\r?\n([\s\S]*?)\r?\nendstream/.exec(body);
  if (!stream) return '';
  let content = Buffer.from(stream[1], 'latin1');
  if (/FlateDecode/.test(body.slice(0, body.indexOf('stream')))) {
    try {
      content = zlib.inflateSync(content);
    } catch {
      return '';
    }
  }
  return content.toString('latin1');
};

const buildFontDecoders = (raw) => {
  const objects = new Map(
    [...raw.matchAll(/(?:^|[\r\n])(\d+)\s+\d+\s+obj\b([\s\S]*?)endobj/g)]
      .map((match) => [match[1], match[2]]),
  );
  const decoderByObject = new Map();
  objects.forEach((body, objectId) => {
    const toUnicode = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(body);
    if (!toUnicode) return;
    const cmapBody = objects.get(toUnicode[1]);
    const mapping = parseToUnicodeCMap(cmapBody ? decodedObjectStream(cmapBody) : '');
    if (!mapping.size) return;
    decoderByObject.set(objectId, (buffer) => {
      let result = '';
      for (let index = 0; index + 1 < buffer.length; index += 2) {
        const code = buffer.readUInt16BE(index);
        result += mapping.get(code) || '';
      }
      return result;
    });
  });

  const decoders = new Map();
  for (const match of raw.matchAll(/\/(F\d+)\s+(\d+)\s+\d+\s+R/g)) {
    const decoder = decoderByObject.get(match[2]);
    if (decoder) decoders.set(match[1], decoder);
  }
  return decoders;
};

const decodeHex = (value) => {
  const clean = value.replace(/\s+/g, '');
  if (!clean || clean.length % 2 !== 0) return '';
  return Buffer.from(clean, 'hex').toString('utf8').replace(/\0/g, '');
};

const decodeTextArray = (value, fontDecoder) => {
  const chunks = [];
  const itemPattern = /\((?:\\.|[^\\)])*\)|<([0-9a-fA-F\s]+)>/g;
  for (const match of value.matchAll(itemPattern)) {
    const literal = match[0].startsWith('(');
    const decoded = literal ? decodeLiteral(match[0].slice(1, -1)) : null;
    chunks.push(fontDecoder
      ? fontDecoder(literal ? Buffer.from(decoded, 'latin1') : Buffer.from(match[1].replace(/\s+/g, ''), 'hex'))
      : literal ? decoded : decodeHex(match[1]));
  }
  return chunks.join('');
};

const cleanText = (value, maxChars) => value
  .join('\n')
  .replace(/\0/g, ' ')
  .replace(/[^\t\n\r -~ąćęłńóśźżĄĆĘŁŃÓŚŹŻ€%.,:;()[\]/+-]/g, ' ')
  .replace(/[^\S\n]+/g, ' ')
  .replace(/ *\n+ */g, '\n')
  .replace(/\s+([.,:;%])/g, '$1')
  .replace(/([(/])\s+/g, '$1')
  .replace(/\s+([)])/g, '$1')
  .replace(/\bR\s+O\s+E\b/g, 'ROE')
  .replace(/\bR\s+O\s+A\b/g, 'ROA')
  .replace(/\bC\s*\/\s*I\b/g, 'C/I')
  .replace(/\bL\s*\/\s*D\b/g, 'L/D')
  .replace(/\bN\s*P\s*L\b/g, 'NPL')
  .replace(/\bT\s*C\s*R\b/g, 'TCR')
  .replace(/\bTi\s*er\s*1\b/gi, 'Tier 1')
  .trim()
  .slice(0, maxChars);

const extractTextOperators = (stream, fontDecoder) => {
  const texts = [];
  for (const match of stream.matchAll(LITERAL_TEXT_PATTERN)) {
    const literal = match[0].replace(/\s*(?:Tj|'|")$/, '').slice(1, -1);
    const decoded = decodeLiteral(literal);
    texts.push({
      index: match.index,
      text: fontDecoder ? fontDecoder(Buffer.from(decoded, 'latin1')) : decoded,
    });
  }
  for (const match of stream.matchAll(HEX_TEXT_PATTERN)) {
    texts.push({
      index: match.index,
      text: fontDecoder
        ? fontDecoder(Buffer.from(match[1].replace(/\s+/g, ''), 'hex'))
        : decodeHex(match[1]),
    });
  }
  for (const match of stream.matchAll(ARRAY_TEXT_PATTERN)) {
    texts.push({ index: match.index, text: decodeTextArray(match[1], fontDecoder) });
  }
  return texts
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.text);
};

const lastTextMatrix = (block) => {
  const matrices = [...block.matchAll(TEXT_MATRIX_PATTERN)];
  if (!matrices.length) return null;
  const matrix = matrices.at(-1);
  const x = Number(matrix[1]);
  const y = Number(matrix[2]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
};

const fontDecoderForBlock = (block, fontDecoders) => {
  const fonts = [...block.matchAll(/\/(F\d+)\s+[-+]?\d*\.?\d+\s+Tf/g)];
  return fonts.length ? fontDecoders.get(fonts.at(-1)[1]) : null;
};

const extractPositionedRows = (stream, fontDecoders) => {
  const cells = [];
  for (const match of stream.matchAll(TEXT_BLOCK_PATTERN)) {
    const fontDecoder = fontDecoderForBlock(match[1], fontDecoders);
    const text = extractTextOperators(match[1], fontDecoder).join('').trim();
    if (!text) continue;
    const position = lastTextMatrix(match[1]);
    if (position) cells.push({ ...position, text, index: match.index });
  }
  if (cells.length < 2) return [];

  const rows = [];
  cells.forEach((cell) => {
    let row = rows.find((candidate) => Math.abs(candidate.y - cell.y) <= ROW_Y_TOLERANCE);
    if (!row) {
      row = { y: cell.y, index: cell.index, cells: [] };
      rows.push(row);
    }
    row.index = Math.min(row.index, cell.index);
    row.cells.push(cell);
  });

  return rows
    .sort((left, right) => left.index - right.index)
    .map((row) => row.cells
      .sort((left, right) => left.x - right.x || left.index - right.index)
      .map((cell) => cell.text)
      .join(' '));
};

const extractStreamText = (stream, fontDecoders) => {
  const positionedRows = extractPositionedRows(stream, fontDecoders);
  return positionedRows.length ? positionedRows : extractTextOperators(stream);
};

export const extractPdfText = (buffer, { maxChars = 180_000 } = {}) => {
  if (!Buffer.isBuffer(buffer) || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) return '';
  const raw = buffer.toString('latin1');
  const fontDecoders = buildFontDecoders(raw);
  const texts = [];
  for (const match of raw.matchAll(STREAM_PATTERN)) {
    const dictionary = match[0].slice(0, match[0].indexOf('stream'));
    let content = Buffer.from(match[1], 'latin1');
    if (/FlateDecode/.test(dictionary)) {
      try {
        content = zlib.inflateSync(content);
      } catch {
        continue;
      }
    }
    texts.push(...extractStreamText(content.toString('latin1'), fontDecoders));
    if (texts.join(' ').length >= maxChars) break;
  }
  return cleanText(texts, maxChars);
};
