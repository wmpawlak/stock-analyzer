import { formatCurrency } from '../../utils/number.js';

export const CHART_COLORS = {
  portfolioValue: '#3b82f6',
  netWorth: '#3b82f6',
  paid: '#f59e0b',
  profit: '#22c55e',
  loss: '#f43f5e',
  trend: '#e2e8f0',
  neutral: '#64748b',
  categoryPalette: [
    '#38bdf8',
    '#22c55e',
    '#f59e0b',
    '#f43f5e',
    '#a78bfa',
    '#14b8a6',
    '#f97316',
    '#eab308',
    '#60a5fa',
    '#34d399',
    '#fb7185',
    '#c084fc',
  ],
};

export const CHART_AXIS = {
  heightClass: 'h-[460px]',
  margin: { top: 15, right: 24, bottom: 8, left: 0 },
  pieMargin: { top: 30, right: 120, bottom: 30, left: 120 },
  tick: { fill: '#64748b', fontSize: 10 },
  tickMargin: 10,
  yAxisWidth: 44,
  grid: { strokeDasharray: '3 3', vertical: true, stroke: '#1e293b', opacity: 0.35 },
  cursor: { stroke: '#334155', strokeWidth: 1, strokeDasharray: '4 4' },
  legendWrapper: { paddingTop: 16, fontSize: 12 },
  referenceLine: { stroke: '#cbd5e1', strokeDasharray: '2 4', strokeOpacity: 0.18 },
  zeroLine: { stroke: '#cbd5e1', strokeWidth: 1.2, strokeOpacity: 0.22 },
};

export const PERCENT_AXIS_TICKS = [0, 20, 40, 60, 80, 100];

const DEFAULT_MAX_DATE_TICKS = 6;

export const parseChartDate = (dateValue) => {
  if (dateValue instanceof Date) return dateValue;
  if (typeof dateValue === 'number') return new Date(dateValue);

  const rawDate = String(dateValue ?? '').trim();
  const dayMonthYearMatch = rawDate.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  const monthYearMatch = rawDate.match(/^(\d{1,2})\.(\d{4})$/);

  if (dayMonthYearMatch) {
    const [, day, month, year] = dayMonthYearMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  if (monthYearMatch) {
    const [, month, year] = monthYearMatch;
    return new Date(Number(year), Number(month) - 1, 1);
  }

  return new Date(rawDate);
};

export const getChartDateValue = (dateValue) => parseChartDate(dateValue).getTime();

export const toIndexedChartData = (data, mapPoint = (point) => point) => data
  .map((point, index) => {
    const mappedPoint = mapPoint(point, index);
    const dateValue = getChartDateValue(mappedPoint.date);

    return {
      ...mappedPoint,
      dateValue,
    };
  })
  .filter((point) => point.date && Number.isFinite(point.dateValue))
  .sort((a, b) => a.dateValue - b.dateValue)
  .map((point, index) => ({
    ...point,
    xIndex: index,
  }));

export const getAdaptiveDateTicks = (data, maxTicks = DEFAULT_MAX_DATE_TICKS) => {
  const count = data.length;
  if (count === 0 || maxTicks <= 0) return [];
  if (count <= maxTicks) return data.map((point) => point.xIndex);

  const lastIndex = count - 1;
  const tickIndexes = new Set();

  for (let tickIndex = 0; tickIndex < maxTicks; tickIndex += 1) {
    tickIndexes.add(Math.round((tickIndex * lastIndex) / (maxTicks - 1)));
  }

  return [...tickIndexes]
    .sort((a, b) => a - b)
    .map((index) => data[index]?.xIndex)
    .filter((value) => Number.isFinite(value));
};

export const formatDateTick = (tickValue, data) => data.find((point) => point.xIndex === tickValue)?.date ?? '';

export const formatCompactAxisValue = (value) => {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return value;
};

export const formatPercentValue = (value) => `${value.toFixed(value >= 10 ? 0 : 1)}%`;

export const formatCurrencyValue = (value) => formatCurrency(value, 0);

const roundDomain = (value, step, direction) => {
  if (!Number.isFinite(value)) return 0;
  if (direction === 'down') return Math.floor(value / step) * step;
  return Math.ceil(value / step) * step;
};

export const getRoundedAxisTicks = (values, {
  step = 50_000,
  includeZero = true,
  minValue = includeZero ? 0 : undefined,
  maxValue = includeZero ? 0 : undefined,
} = {}) => {
  const finiteValues = values.filter(Number.isFinite);
  const rawMin = Math.min(...finiteValues, minValue ?? Infinity);
  const rawMax = Math.max(...finiteValues, maxValue ?? -Infinity);
  const roundedMin = roundDomain(rawMin === Infinity ? 0 : rawMin, step, 'down');
  const roundedMax = Math.max(step, roundDomain(rawMax === -Infinity ? step : rawMax, step, 'up'));
  const ticks = [];

  for (let value = roundedMin; value <= roundedMax; value += step) {
    ticks.push(value);
  }

  return {
    min: roundedMin,
    max: roundedMax,
    ticks,
  };
};
