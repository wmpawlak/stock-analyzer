import zlib from 'node:zlib';

const STREAM_PATTERN = /<<(?:.|\n|\r)*?>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
const LITERAL_TEXT_PATTERN = /\((?:\\.|[^\\)])*\)\s*(?:Tj|'|")/g;
const ARRAY_TEXT_PATTERN = /\[((?:.|\n|\r)*?)\]\s*TJ/g;
const ARRAY_LITERAL_PATTERN = /\((?:\\.|[^\\)])*\)/g;
const HEX_TEXT_PATTERN = /<([0-9a-fA-F\s]+)>\s*(?:Tj|'|")/g;
const ARRAY_HEX_PATTERN = /<([0-9a-fA-F\s]+)>/g;

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

const decodeHex = (value) => {
  const clean = value.replace(/\s+/g, '');
  if (!clean || clean.length % 2 !== 0) return '';
  return Buffer.from(clean, 'hex').toString('utf8').replace(/\0/g, '');
};

const cleanText = (value, maxChars) => value
  .join(' ')
  .replace(/\0/g, ' ')
  .replace(/[^\t\n\r -~ąćęłńóśźżĄĆĘŁŃÓŚŹŻ€%.,:;()[\]/+-]/g, ' ')
  .replace(/\s+/g, ' ')
  .replace(/(?<=\d)\s+(?=\d)/g, '')
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

const extractStreamText = (stream) => {
  const texts = [];
  for (const match of stream.matchAll(LITERAL_TEXT_PATTERN)) {
    const literal = match[0].replace(/\s*(?:Tj|'|")$/, '').slice(1, -1);
    texts.push(decodeLiteral(literal));
  }
  for (const match of stream.matchAll(HEX_TEXT_PATTERN)) {
    texts.push(decodeHex(match[1]));
  }
  for (const match of stream.matchAll(ARRAY_TEXT_PATTERN)) {
    for (const literal of match[1].matchAll(ARRAY_LITERAL_PATTERN)) {
      texts.push(decodeLiteral(literal[0].slice(1, -1)));
    }
    for (const hex of match[1].matchAll(ARRAY_HEX_PATTERN)) {
      texts.push(decodeHex(hex[1]));
    }
  }
  return texts;
};

export const extractPdfText = (buffer, { maxChars = 180_000 } = {}) => {
  if (!Buffer.isBuffer(buffer) || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) return '';
  const raw = buffer.toString('latin1');
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
    texts.push(...extractStreamText(content.toString('latin1')));
    if (texts.join(' ').length >= maxChars) break;
  }
  return cleanText(texts, maxChars);
};
