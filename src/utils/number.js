const decodeEscapedUnicode = (value) => value.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => (
  String.fromCharCode(parseInt(code, 16))
));

const repairKnownMojibake = (value) => value
  .replace(/\u00c4\u2026/g, 'ą')
  .replace(/\u00c4\u2021/g, 'ć')
  .replace(/\u00c4\u2122/g, 'ę')
  .replace(/\u00c5\u201a/g, 'ł')
  .replace(/\u00c5\u201e/g, 'ń')
  .replace(/\u00c3\u00b3/g, 'ó')
  .replace(/\u00c5\u203a/g, 'ś')
  .replace(/\u00c5\u013a/g, 'ź')
  .replace(/\u00c5\u00bc/g, 'ż')
  .replace(/\u00c4\u201e/g, 'Ą')
  .replace(/\u00c4\u2020/g, 'Ć')
  .replace(/\u00c4\u02dc/g, 'Ę')
  .replace(/\u00c5\u0081/g, 'Ł')
  .replace(/\u00c5\u0192/g, 'Ń')
  .replace(/\u00c3\u201c/g, 'Ó')
  .replace(/\u00c5\u0161/g, 'Ś')
  .replace(/\u00c5\u00b9/g, 'Ź')
  .replace(/\u00c5\u00bb/g, 'Ż')
  .replace(/\u0139\u203a/g, 'ś')
  .replace(/\u0139\u201a/g, 'ł')
  .replace(/\u0139\u201e/g, 'ń')
  .replace(/\u0139\u013a/g, 'ź')
  .replace(/\u0139\u00bc/g, 'ż')
  .replace(/\u0139\u0081/g, 'Ł');

export const normalizeText = (value) => repairKnownMojibake(decodeEscapedUnicode(String(value ?? '')))
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]/g, '')
  .toLowerCase();

export const parseNumericValue = (value) => {
  if (typeof value === 'number') return value;
  if (value === null || value === undefined) return NaN;

  const compactValue = String(value).trim().replace(/\s/g, '');
  if (!compactValue) return NaN;

  const numericText = compactValue.replace(/[^\d,.-]/g, '');
  const lastComma = numericText.lastIndexOf(',');
  const lastDot = numericText.lastIndexOf('.');

  const numericValue = (() => {
    if (lastComma > -1 && lastDot > -1) {
      return lastComma > lastDot
        ? numericText.replace(/\./g, '').replace(',', '.')
        : numericText.replace(/,/g, '');
    }

    if (lastComma > -1) return numericText.replace(',', '.');

    return numericText.replace(/\.(?=\d{3}(?:\D|$))/g, '');
  })();

  return parseFloat(numericValue);
};

export const formatCurrency = (value, maximumFractionDigits = 2) => new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits,
}).format(value);
