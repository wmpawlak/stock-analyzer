export const normalizeText = (value) => String(value ?? '')
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
