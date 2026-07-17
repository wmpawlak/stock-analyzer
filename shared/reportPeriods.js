const QUARTER_RANGES = [
  { quarter: 1, start: [1, 1], end: [3, 31] },
  { quarter: 2, start: [4, 1], end: [6, 30] },
  { quarter: 3, start: [7, 1], end: [9, 30] },
  { quarter: 4, start: [10, 1], end: [12, 31] },
];

const QUARTER_BY_END_DATE = new Map(
  QUARTER_RANGES.map(({ quarter, end: [month, day] }) => [`${month}-${day}`, quarter]),
);

const normalizeText = (value) => String(value ?? '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[łŁ]/g, (character) => (character === 'Ł' ? 'L' : 'l'))
  .toLowerCase();

const extractDates = (value) => {
  const matches = [];
  const pattern = /\b(?:(?<isoYear>(?:19|20)\d{2})[-/.](?<isoMonth>0?[1-9]|1[0-2])[-/.](?<isoDay>0?[1-9]|[12]\d|3[01])|(?<plDay>0?[1-9]|[12]\d|3[01])[-/.](?<plMonth>0?[1-9]|1[0-2])[-/.](?<plYear>(?:19|20)\d{2}))\b/g;

  for (const match of String(value ?? '').matchAll(pattern)) {
    matches.push({
      year: Number(match.groups.isoYear || match.groups.plYear),
      month: Number(match.groups.isoMonth || match.groups.plMonth),
      day: Number(match.groups.isoDay || match.groups.plDay),
      index: match.index,
      endIndex: match.index + match[0].length,
    });
  }
  return matches;
};

const explicitQuarter = (text) => {
  const year = Number((text.match(/(?:19|20)\d{2}/) || [])[0]) || null;
  if (!year) return null;

  const numeric = text.match(/\bq\s*([1-4])\b/)
    || text.match(/\b([1-4])\s*q\b/)
    || text.match(/\b([1-4])\s*(?:kw\.?|kwartal(?:u|y|e)?)\b/);
  const roman = text.match(/(?:^|[^a-z0-9])(i{1,3}|iv)\s*(?:kw\.?|kwartal(?:u|y|e)?)/);
  const quarter = Number(numeric?.[1]) || ({ i: 1, ii: 2, iii: 3, iv: 4 }[roman?.[1]] || null);

  return quarter ? { year, quarter } : null;
};

const isRangeSeparator = (value) => /^(?:\s|[-–—])*(?:do|to)?(?:\s|[-–—])*$/i.test(value);

const quarterFromFullRange = (text, dates) => {
  if (dates.length < 2 || !isRangeSeparator(text.slice(dates[0].endIndex, dates[1].index))) return null;
  const [start, end] = dates;
  if (start.year !== end.year) return null;

  const range = QUARTER_RANGES.find(({ start: expectedStart, end: expectedEnd }) => (
    start.month === expectedStart[0]
    && start.day === expectedStart[1]
    && end.month === expectedEnd[0]
    && end.day === expectedEnd[1]
  ));

  return range ? { year: end.year, quarter: range.quarter } : { rejectedRange: true };
};

const isCumulativeHalfOrNineMonths = (text) => (
  /\b(?:h1|1h|9m)\b/.test(text)
  || /\b(?:polrocz|half[ -]?year|six months|6\s*mies|nine months|9\s*mies)/.test(text)
);

export const inferReportPeriodFromText = (value) => {
  const original = String(value ?? '').trim();
  if (!original) return '';
  const text = normalizeText(original);

  const explicit = explicitQuarter(text);
  if (explicit) return `Q${explicit.quarter} ${explicit.year}`;

  const dates = extractDates(original);
  const range = quarterFromFullRange(original, dates);
  if (range?.quarter) return `Q${range.quarter} ${range.year}`;
  if (range?.rejectedRange || isCumulativeHalfOrNineMonths(text)) return '';

  const quarterEnd = dates.find((date) => QUARTER_BY_END_DATE.has(`${date.month}-${date.day}`));
  if (!quarterEnd) return '';
  return `Q${QUARTER_BY_END_DATE.get(`${quarterEnd.month}-${quarterEnd.day}`)} ${quarterEnd.year}`;
};

export const normalizeReportPeriod = (value, { preserveUnknown = true } = {}) => {
  const original = String(value ?? '').trim();
  if (!original) return '';
  return inferReportPeriodFromText(original) || (preserveUnknown ? original : '');
};

export const getReportPeriodInfo = (value, { fallback = 'Okres niepodany' } = {}) => {
  const original = String(value ?? '').trim() || fallback;
  const normalized = normalizeReportPeriod(original);
  const quarterMatch = normalized.match(/^Q([1-4])\s+((?:19|20)\d{2})$/);
  const year = Number(quarterMatch?.[2] || (normalized.match(/(?:19|20)\d{2}/) || [])[0]) || null;
  const quarter = Number(quarterMatch?.[1]) || null;

  return {
    key: quarter ? `Q:${year}:${quarter}` : normalized,
    label: normalized,
    year,
    quarter,
    isQuarter: Boolean(year && quarter),
  };
};
