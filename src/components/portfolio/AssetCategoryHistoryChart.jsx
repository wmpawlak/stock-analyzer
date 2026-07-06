import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import useLiveData from '../../hooks/useLiveData.js';
import { getAssetCategoryHistoryFromLiveData } from '../../utils/liveData.js';
import { formatCurrency } from '../../utils/number.js';

const COLORS = [
  '#06b6d4',
  '#84cc16',
  '#f97316',
  '#ec4899',
  '#8b5cf6',
  '#10b981',
  '#facc15',
  '#ef4444',
  '#0ea5e9',
  '#d946ef',
  '#65a30d',
  '#fb923c',
];

const Y_AXIS_ROUNDING_STEP = 50_000;
const X_AXIS_TICK_STEP = 3;

const formatAxisValue = (value) => {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return value;
};

const parseChartDate = (dateValue) => {
  if (dateValue instanceof Date) return dateValue;
  if (typeof dateValue === 'number') return new Date(dateValue);

  const rawDate = String(dateValue ?? '').trim();
  const polishDateMatch = rawDate.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);

  if (polishDateMatch) {
    const [, day, month, year] = polishDateMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  return new Date(rawDate);
};

const getChartData = (data) => data
  .map((point) => {
    const parsedDate = parseChartDate(point.date);

    return {
      ...point,
      dateValue: parsedDate.getTime(),
    };
  })
  .filter((point) => Number.isFinite(point.dateValue))
  .sort((a, b) => a.dateValue - b.dateValue)
  .map((point, index) => ({
    ...point,
    xIndex: index,
  }));

const getEveryThirdDateTicks = (data) => data
  .filter((_, index) => index % X_AXIS_TICK_STEP === 0)
  .map((point) => point.xIndex);

const formatDateTick = (tickValue, data) => data[tickValue]?.date ?? '';

const getStackedScale = (data, categories) => {
  const maxValue = data.reduce((max, point) => {
    const total = categories.reduce((sum, category) => sum + (point[category] || 0), 0);
    return Math.max(max, total);
  }, 0);

  if (maxValue <= 0) return { maxDomain: Y_AXIS_ROUNDING_STEP, ticks: [] };

  const maxDomain = Math.ceil(maxValue / Y_AXIS_ROUNDING_STEP) * Y_AXIS_ROUNDING_STEP;
  const tickCount = Math.max(1, Math.ceil(maxDomain / Y_AXIS_ROUNDING_STEP));

  return {
    maxDomain,
    ticks: Array.from({ length: tickCount }, (_, index) => Y_AXIS_ROUNDING_STEP * (index + 1)),
  };
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;

  const visiblePayload = payload
    .filter((entry) => Number.isFinite(entry.value) && entry.value !== 0)
    .reverse();
  const total = visiblePayload.reduce((sum, entry) => sum + entry.value, 0);
  const displayDate = payload[0]?.payload?.date || label;

  return (
    <div className="min-w-[240px] rounded-xl border border-slate-700 bg-slate-950/95 px-4 py-3 shadow-2xl backdrop-blur-sm">
      <p className="mb-3 border-b border-slate-800 pb-2 text-sm font-bold text-slate-100">{displayDate}</p>
      <div className="space-y-2">
        {visiblePayload.map((entry) => (
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
      <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-2 text-xs">
        <span className="font-medium text-slate-400">Suma</span>
        <span className="font-mono font-bold text-blue-300">{formatCurrency(total, 0)}</span>
      </div>
    </div>
  );
};

const AssetCategoryHistoryChart = () => {
  const liveData = useLiveData();
  const { data, categories } = useMemo(
    () => getAssetCategoryHistoryFromLiveData(liveData),
    [liveData],
  );
  const chartData = useMemo(() => getChartData(data), [data]);
  const { maxDomain, ticks: horizontalGridValues } = useMemo(
    () => getStackedScale(chartData, categories),
    [chartData, categories],
  );
  const dateTicks = useMemo(() => getEveryThirdDateTicks(chartData), [chartData]);

  if (chartData.length === 0 || categories.length === 0) {
    return (
      <div className="flex h-80 w-full items-center justify-center text-slate-500">
        <div className="text-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 13.5l6-6 4 4L21 3.5M21 3.5h-6m6 0v6M3 20.5h18" />
          </svg>
          <p className="mt-2 text-sm">Brak zakresu "Historia kategorii aktywów" w danych live.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[460px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 15, right: 24, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical stroke="#1e293b" opacity={0.35} />
          <XAxis
            dataKey="xIndex"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={dateTicks}
            tickFormatter={(value) => formatDateTick(value, chartData)}
            tick={{ fill: '#64748b', fontSize: 10 }}
            tickMargin={10}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={formatAxisValue}
            tick={{ fill: '#64748b', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={44}
            domain={[0, maxDomain]}
            ticks={[0, ...horizontalGridValues]}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#334155', strokeWidth: 1, strokeDasharray: '4 4' }} />
          <Legend
            wrapperStyle={{ paddingTop: 16, fontSize: 12 }}
            iconType="circle"
            formatter={(value) => <span className="text-slate-300">{value}</span>}
          />
          {categories.map((category, index) => (
            <Area
              key={category}
              type="monotone"
              dataKey={category}
              name={category}
              stackId="asset-category-history"
              stroke={COLORS[index % COLORS.length]}
              fill={COLORS[index % COLORS.length]}
              fillOpacity={0.28}
              strokeWidth={1.5}
              activeDot={{ r: 3, stroke: '#0f172a', strokeWidth: 1.5 }}
            />
          ))}
          {dateTicks.map((tick) => (
            <ReferenceLine
              key={`vertical-grid-${tick}`}
              x={tick}
              stroke="#cbd5e1"
              strokeDasharray="2 4"
              strokeOpacity={0.18}
              ifOverflow="extendDomain"
            />
          ))}
          {horizontalGridValues.map((value) => (
            <ReferenceLine
              key={`horizontal-grid-${value}`}
              y={value}
              stroke="#cbd5e1"
              strokeDasharray="2 4"
              strokeOpacity={0.18}
              ifOverflow="extendDomain"
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default AssetCategoryHistoryChart;
