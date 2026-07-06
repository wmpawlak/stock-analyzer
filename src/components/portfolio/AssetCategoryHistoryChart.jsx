import { useMemo, useState } from 'react';
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
const PERCENT_TICKS = [20, 40, 60, 80, 100];

const formatAxisValue = (value) => {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return value;
};

const formatPercentValue = (value) => `${value.toFixed(value >= 10 ? 0 : 1)}%`;

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

const getSortedCategories = (data, categories) => {
  const lastPoint = data.at(-1);
  if (!lastPoint) return categories;

  return [...categories].sort((firstCategory, secondCategory) => (
    (lastPoint[secondCategory] || 0) - (lastPoint[firstCategory] || 0)
  ));
};

const getPercentData = (data, categories) => data.map((point) => {
  const total = categories.reduce((sum, category) => sum + (point[category] || 0), 0);

  return categories.reduce((percentPoint, category) => ({
    ...percentPoint,
    [category]: total > 0 ? ((point[category] || 0) / total) * 100 : 0,
  }), {
    date: point.date,
    dateValue: point.dateValue,
    xIndex: point.xIndex,
  });
});

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

const CustomTooltip = ({ active, payload, label, isPercentMode }) => {
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
              {isPercentMode ? formatPercentValue(entry.value) : formatCurrency(entry.value, 0)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-2 text-xs">
        <span className="font-medium text-slate-400">Suma</span>
        <span className="font-mono font-bold text-blue-300">
          {isPercentMode ? formatPercentValue(total) : formatCurrency(total, 0)}
        </span>
      </div>
    </div>
  );
};

const AssetCategoryHistoryChart = () => {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [isPercentMode, setIsPercentMode] = useState(false);
  const liveData = useLiveData();
  const { data, categories } = useMemo(
    () => getAssetCategoryHistoryFromLiveData(liveData),
    [liveData],
  );
  const chartData = useMemo(() => getChartData(data), [data]);
  const sortedCategories = useMemo(
    () => getSortedCategories(chartData, categories),
    [chartData, categories],
  );
  const percentData = useMemo(
    () => getPercentData(chartData, sortedCategories),
    [chartData, sortedCategories],
  );
  const visibleData = isPercentMode ? percentData : chartData;
  const { maxDomain, ticks: horizontalGridValues } = useMemo(
    () => {
      if (isPercentMode) return { maxDomain: 100, ticks: PERCENT_TICKS };

      return getStackedScale(visibleData, sortedCategories);
    },
    [isPercentMode, visibleData, sortedCategories],
  );
  const dateTicks = useMemo(() => getEveryThirdDateTicks(chartData), [chartData]);
  const handleLegendClick = (entry) => {
    const category = entry?.value;
    if (!category) return;

    setSelectedCategory((currentCategory) => (
      currentCategory === category ? null : category
    ));
  };

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
    <div className="relative h-[460px] w-full pt-10">
      <div className="absolute right-0 top-0 z-10 inline-flex rounded-lg border border-slate-700 bg-slate-900/90 p-1 text-xs font-semibold shadow-lg">
        <button
          type="button"
          onClick={() => setIsPercentMode(false)}
          className={`rounded-md px-3 py-1.5 transition-colors ${!isPercentMode ? 'bg-blue-500 text-white' : 'text-slate-400 hover:text-slate-100'}`}
        >
          PLN
        </button>
        <button
          type="button"
          onClick={() => setIsPercentMode(true)}
          className={`rounded-md px-3 py-1.5 transition-colors ${isPercentMode ? 'bg-blue-500 text-white' : 'text-slate-400 hover:text-slate-100'}`}
        >
          %
        </button>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={visibleData} margin={{ top: 15, right: 24, bottom: 8, left: 0 }}>
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
            tickFormatter={isPercentMode ? formatPercentValue : formatAxisValue}
            tick={{ fill: '#64748b', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={44}
            domain={[0, maxDomain]}
            ticks={[0, ...horizontalGridValues]}
          />
          <Tooltip content={<CustomTooltip isPercentMode={isPercentMode} />} cursor={{ stroke: '#334155', strokeWidth: 1, strokeDasharray: '4 4' }} />
          <Legend
            wrapperStyle={{ paddingTop: 16, fontSize: 12 }}
            iconType="circle"
            onClick={handleLegendClick}
            formatter={(value) => (
              <span
                className={selectedCategory === value ? 'font-semibold text-slate-100' : 'text-slate-300'}
                style={{ cursor: 'pointer' }}
              >
                {value}
              </span>
            )}
          />
          {sortedCategories.map((category) => (
            <Area
              key={category}
              type="monotone"
              dataKey={category}
              name={category}
              stackId="asset-category-history"
              stroke={COLORS[categories.indexOf(category) % COLORS.length]}
              fill={COLORS[categories.indexOf(category) % COLORS.length]}
              fillOpacity={selectedCategory ? (selectedCategory === category ? 0.82 : 0.14) : 0.28}
              strokeOpacity={selectedCategory ? (selectedCategory === category ? 1 : 0.38) : 1}
              strokeWidth={selectedCategory === category ? 2.6 : 1.5}
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
