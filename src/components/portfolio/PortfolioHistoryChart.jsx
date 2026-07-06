import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency, parseNumericValue } from '../../utils/number.js';

const COLORS = {
  value: '#10b981',
  paid: '#ef4444',
  profit: '#3b82f6',
  loss: '#ef4444',
};

const MOCK_DATA = [
  { Data: '2023-01-01', Wartość: '48 000 zł', 'Wpłacone łącz.': '50 000 zł', Różnica: '-2 000 zł' },
  { Data: '2023-04-01', Wartość: '62 500 zł', 'Wpłacone łącz.': '60 000 zł', Różnica: '2 500 zł' },
  { Data: '2023-08-01', Wartość: '85 000 zł', 'Wpłacone łącz.': '80 000 zł', Różnica: '5 000 zł' },
  { Data: '2024-01-01', Wartość: '105 200 zł', 'Wpłacone łącz.': '95 000 zł', Różnica: '10 200 zł' },
  { Data: '2024-05-01', Wartość: '131 581 zł', 'Wpłacone łącz.': '110 000 zł', Różnica: '21 581 zł' },
  { Data: '2024-08-01', Wartość: '143 765 zł', 'Wpłacone łącz.': '115 000 zł', Różnica: '28 765 zł' },
];

const VALUE_KEYS = ['Wartość', 'WartoĹ›Ä‡'];
const PAID_KEYS = ['Wpłacone łącz.', 'WpĹ‚acone Ĺ‚Ä…cz.'];
const DIFF_KEYS = ['Różnica', 'RĂłĹĽnica'];

const getFirstValue = (row, keys) => {
  const key = keys.find((candidate) => row[candidate] !== undefined);
  return key ? row[key] : undefined;
};

const formatAxisValue = (value) => {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return value;
};

const getDomain = (data) => {
  const values = data.flatMap((point) => [point.wartosc, point.wplacone, point.roznica]);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);

  return {
    min: Math.floor(minValue / 50_000) * 50_000,
    max: Math.ceil(maxValue / 50_000) * 50_000,
  };
};

const getHorizontalGridValues = ({ min, max }) => {
  const values = [];
  for (let value = min; value <= max; value += 50_000) {
    values.push(value);
  }
  return values;
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;

  const rows = payload.filter((entry) => Number.isFinite(entry.value));
  const delta = rows.find((entry) => entry.dataKey === 'roznica');

  return (
    <div className="min-w-[240px] rounded-xl border border-slate-700 bg-slate-950/95 px-4 py-3 shadow-2xl backdrop-blur-sm">
      <p className="mb-3 border-b border-slate-800 pb-2 text-sm font-bold text-slate-100">{label}</p>
      <div className="space-y-2">
        {rows.filter((entry) => entry.dataKey !== 'roznica').map((entry) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-5 text-xs">
            <span className="flex min-w-0 items-center gap-2 text-slate-300">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="truncate">{entry.name}</span>
            </span>
            <span className="shrink-0 font-mono font-semibold text-slate-100">
              {formatCurrency(entry.value, 0)}
            </span>
          </div>
        ))}
      </div>
      {delta && (
        <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-2 text-xs">
          <span className="font-medium text-slate-400">Zysk / Strata</span>
          <span className={`font-mono font-bold ${delta.value >= 0 ? 'text-blue-300' : 'text-rose-300'}`}>
            {delta.value >= 0 ? '+' : ''}
            {formatCurrency(delta.value, 0)}
          </span>
        </div>
      )}
    </div>
  );
};

const PortfolioHistoryChart = () => {
  const reduxHistory = useSelector((state) => state.portfolio.portfolioHistory);
  const isMockData = !reduxHistory || reduxHistory.length === 0;
  const rawData = isMockData ? MOCK_DATA : reduxHistory;

  const data = useMemo(() => rawData.map((item, index) => ({
    id: index,
    date: item.Data,
    wartosc: parseNumericValue(getFirstValue(item, VALUE_KEYS)),
    wplacone: parseNumericValue(getFirstValue(item, PAID_KEYS)),
    roznica: parseNumericValue(getFirstValue(item, DIFF_KEYS)),
  })).map((point) => ({
    ...point,
    wartosc: Number.isFinite(point.wartosc) ? point.wartosc : 0,
    wplacone: Number.isFinite(point.wplacone) ? point.wplacone : 0,
    roznica: Number.isFinite(point.roznica) ? point.roznica : 0,
  })).sort((a, b) => new Date(a.date) - new Date(b.date)), [rawData]);

  const domain = useMemo(() => getDomain(data), [data]);
  const horizontalGridValues = useMemo(() => getHorizontalGridValues(domain), [domain]);
  const gradientOffset = (() => {
    if (domain.max <= 0) return 0;
    if (domain.min >= 0) return 1;
    return domain.max / (domain.max - domain.min);
  })();

  return (
    <div className="h-[460px] w-full relative">
      {isMockData && (
        <div className="absolute top-2 right-2 z-10 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-bold px-3 py-1 rounded-lg">
          DANE PRZYKŁADOWE
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 15, right: 24, bottom: 8, left: 0 }}>
          <defs>
            <linearGradient id="portfolioHistoryValueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.value} stopOpacity={0.46} />
              <stop offset="100%" stopColor={COLORS.value} stopOpacity={0.1} />
            </linearGradient>
            <linearGradient id="portfolioHistoryPaidFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.paid} stopOpacity={0.38} />
              <stop offset="100%" stopColor={COLORS.paid} stopOpacity={0.08} />
            </linearGradient>
            <linearGradient id="portfolioHistoryDeltaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset={0} stopColor={COLORS.profit} stopOpacity={0.46} />
              <stop offset={gradientOffset} stopColor={COLORS.profit} stopOpacity={0.1} />
              <stop offset={gradientOffset} stopColor={COLORS.loss} stopOpacity={0.1} />
              <stop offset={1} stopColor={COLORS.loss} stopOpacity={0.46} />
            </linearGradient>
            <linearGradient id="portfolioHistoryDeltaStroke" x1="0" y1="0" x2="0" y2="1">
              <stop offset={gradientOffset} stopColor={COLORS.profit} stopOpacity={1} />
              <stop offset={gradientOffset} stopColor={COLORS.loss} stopOpacity={1} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical stroke="#1e293b" opacity={0.35} />
          <XAxis
            dataKey="date"
            tick={{ fill: '#64748b', fontSize: 10 }}
            tickMargin={10}
            axisLine={false}
            tickLine={false}
            interval={0}
          />
          <YAxis
            tickFormatter={formatAxisValue}
            tick={{ fill: '#64748b', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={44}
            type="number"
            domain={[domain.min, domain.max]}
            ticks={horizontalGridValues}
            allowDataOverflow
          />
          <ReferenceLine y={0} stroke="#cbd5e1" strokeWidth={1.2} strokeOpacity={0.24} />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#334155', strokeWidth: 1, strokeDasharray: '4 4' }} />
          <Legend
            wrapperStyle={{ paddingTop: 16, fontSize: 12 }}
            iconType="circle"
            formatter={(value) => <span className="text-slate-300">{value}</span>}
          />
          <Area
            type="monotone"
            dataKey="wartosc"
            name="Wartość Portfela"
            stroke={COLORS.value}
            strokeWidth={2}
            fill="url(#portfolioHistoryValueFill)"
            activeDot={{ r: 4, fill: COLORS.value, stroke: '#0f172a', strokeWidth: 2 }}
          />
          <Area
            type="monotone"
            dataKey="wplacone"
            name="Wpłacone"
            stroke={COLORS.paid}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            fill="url(#portfolioHistoryPaidFill)"
            activeDot={{ r: 4, fill: COLORS.paid, stroke: '#0f172a', strokeWidth: 2 }}
          />
          <Area
            type="monotone"
            dataKey="roznica"
            name="Zysk / Strata"
            stroke="url(#portfolioHistoryDeltaStroke)"
            strokeWidth={2.5}
            fill="url(#portfolioHistoryDeltaFill)"
            activeDot={(props) => {
              const { cx, cy, payload } = props;
              const isPositive = payload.roznica >= 0;
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={5}
                  fill={isPositive ? COLORS.profit : COLORS.loss}
                  stroke="#0f172a"
                  strokeWidth={2}
                />
              );
            }}
          />
          {data.map((point) => (
            <ReferenceLine
              key={`portfolio-history-vertical-grid-${point.date}`}
              x={point.date}
              stroke="#cbd5e1"
              strokeDasharray="2 4"
              strokeOpacity={0.18}
              ifOverflow="extendDomain"
            />
          ))}
          {horizontalGridValues.map((value) => (
            <ReferenceLine
              key={`portfolio-history-horizontal-grid-${value}`}
              y={value}
              stroke="#cbd5e1"
              strokeDasharray="2 4"
              strokeOpacity={0.18}
              ifOverflow="extendDomain"
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PortfolioHistoryChart;
