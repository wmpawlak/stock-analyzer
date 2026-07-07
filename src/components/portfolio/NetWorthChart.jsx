import { useMemo } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import useLiveData from '../../hooks/useLiveData.js';
import { getNetWorthHistoryFromLiveData } from '../../utils/liveData.js';
import ChartTooltip from './ChartTooltip.jsx';
import {
  CHART_AXIS,
  CHART_COLORS,
  formatCompactAxisValue,
  formatDateTick,
  getAdaptiveDateTicks,
  getRoundedAxisTicks,
  toIndexedChartData,
} from './chartConfig.js';

const GROWTH_AXIS_STEP = 10_000;

const getLinearTrend = (points) => {
  if (points.length === 0) return [];
  if (points.length === 1) return [points[0].value];

  const count = points.length;
  const sumX = points.reduce((sum, _, index) => sum + index, 0);
  const sumY = points.reduce((sum, point) => sum + point.value, 0);
  const sumXY = points.reduce((sum, point, index) => sum + (index * point.value), 0);
  const sumXX = points.reduce((sum, _, index) => sum + (index * index), 0);
  const denominator = (count * sumXX) - (sumX * sumX);

  if (denominator === 0) return points.map((point) => point.value);

  const slope = ((count * sumXY) - (sumX * sumY)) / denominator;
  const intercept = (sumY - (slope * sumX)) / count;

  return points.map((_, index) => intercept + (slope * index));
};

const getGrowthColor = (growth, maxAbsoluteGrowth) => {
  if (!Number.isFinite(growth) || growth === 0 || maxAbsoluteGrowth <= 0) {
    return CHART_COLORS.neutral;
  }

  const intensity = Math.min(Math.abs(growth) / maxAbsoluteGrowth, 1);

  if (growth > 0) {
    const saturation = 48 + (intensity * 34);
    const lightness = 62 - (intensity * 22);
    return `hsl(145 ${saturation}% ${lightness}%)`;
  }

  const saturation = 58 + (intensity * 32);
  const lightness = 64 - (intensity * 20);
  return `hsl(348 ${saturation}% ${lightness}%)`;
};

const getChartData = (data) => {
  const parsedData = toIndexedChartData(data);

  const trend = getLinearTrend(parsedData);
  const maxAbsoluteGrowth = parsedData.reduce((max, point) => (
    Math.max(max, Math.abs(point.growth || 0))
  ), 0);

  return parsedData.map((point, index) => ({
    ...point,
    growthColor: getGrowthColor(point.growth, maxAbsoluteGrowth),
    trend: trend[index],
  }));
};

const getAvailableRangeNames = (liveData) => {
  if (!liveData || typeof liveData !== 'object') return '';
  return Object.keys(liveData).join(', ');
};

const formatNames = (names) => names.filter(Boolean).join(', ');

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;

  const { date } = payload[0].payload;
  const valueEntry = payload.find((entry) => entry.dataKey === 'value');
  const growthEntry = payload.find((entry) => entry.dataKey === 'growth');
  const trendEntry = payload.find((entry) => entry.dataKey === 'trend');

  return (
    <ChartTooltip
      active={active}
      payload={payload}
      title={date}
      rows={[valueEntry, growthEntry, trendEntry].filter(Boolean).map((entry) => ({
        key: entry.dataKey,
        name: entry.name,
        color: entry.dataKey === 'growth' ? entry.payload.growthColor : entry.color,
        value: entry.value,
      }))}
    />
  );
};

const NetWorthChart = () => {
  const liveData = useLiveData();
  const { data, found, columns } = useMemo(() => getNetWorthHistoryFromLiveData(liveData), [liveData]);
  const chartData = useMemo(() => getChartData(data), [data]);
  const dateTicks = useMemo(() => getAdaptiveDateTicks(chartData), [chartData]);
  const valueAxis = useMemo(() => getRoundedAxisTicks(
    chartData.flatMap((point) => [point.value, point.trend]),
  ), [chartData]);
  const growthAxis = useMemo(() => getRoundedAxisTicks(
    chartData.map((point) => point.growth),
    { step: GROWTH_AXIS_STEP },
  ), [chartData]);
  const availableRangeNames = useMemo(() => getAvailableRangeNames(liveData), [liveData]);
  const availableColumns = useMemo(() => formatNames(columns ?? []), [columns]);

  if (!found) {
    return (
      <div className="flex h-80 w-full items-center justify-center text-slate-500">
        <div className="text-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 13.5l6-6 4 4L21 3.5M21 3.5h-6m6 0v6M3 20.5h18" />
          </svg>
          <p className="mt-2 text-sm">{'Brak zakresu "Warto\u015b\u0107 netto" w danych live.'}</p>
          {availableRangeNames && (
            <p className="mx-auto mt-2 max-w-xl text-xs text-slate-600">
              {`Dost\u0119pne zakresy: ${availableRangeNames}`}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (data.length === 0 || chartData.length === 0) {
    return (
      <div className="flex h-80 w-full items-center justify-center text-slate-500">
        <div className="text-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 7v10M12 7v10M16 7v10M5 5h14M5 19h14" />
          </svg>
          <p className="mt-2 text-sm">{'Zakres "Warto\u015b\u0107 netto" istnieje, ale nie uda\u0142o si\u0119 zbudowa\u0107 punkt\u00f3w wykresu.'}</p>
          {availableColumns && (
            <p className="mx-auto mt-2 max-w-xl text-xs text-slate-600">
              {`Wykryte kolumny: ${availableColumns}`}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${CHART_AXIS.heightClass} w-full`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={CHART_AXIS.margin}>
          <defs>
            <linearGradient id="netWorthValueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.netWorth} stopOpacity={0.42} />
              <stop offset="100%" stopColor={CHART_COLORS.netWorth} stopOpacity={0.08} />
            </linearGradient>
          </defs>
          <CartesianGrid {...CHART_AXIS.grid} />
          <XAxis
            dataKey="xIndex"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={dateTicks}
            tickFormatter={(value) => formatDateTick(value, chartData)}
            tick={CHART_AXIS.tick}
            tickMargin={CHART_AXIS.tickMargin}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="value"
            tickFormatter={formatCompactAxisValue}
            tick={CHART_AXIS.tick}
            axisLine={false}
            tickLine={false}
            width={CHART_AXIS.yAxisWidth}
            type="number"
            domain={[valueAxis.min, valueAxis.max]}
            ticks={valueAxis.ticks}
          />
          <YAxis
            yAxisId="growth"
            orientation="right"
            tickFormatter={formatCompactAxisValue}
            tick={CHART_AXIS.tick}
            axisLine={false}
            tickLine={false}
            width={CHART_AXIS.yAxisWidth}
            type="number"
            domain={[growthAxis.min, growthAxis.max]}
            ticks={growthAxis.ticks}
          />
          <Tooltip content={<CustomTooltip />} cursor={CHART_AXIS.cursor} />
          <Legend
            wrapperStyle={CHART_AXIS.legendWrapper}
            iconType="circle"
            formatter={(value) => <span className="text-slate-300">{value}</span>}
          />
          <Area
            yAxisId="value"
            type="monotone"
            dataKey="value"
            name={'Warto\u015b\u0107 netto'}
            stroke={CHART_COLORS.netWorth}
            strokeWidth={2.4}
            fill="url(#netWorthValueFill)"
            activeDot={{ r: 4, fill: CHART_COLORS.netWorth, stroke: '#0f172a', strokeWidth: 2 }}
          />
          <Bar
            yAxisId="growth"
            dataKey="growth"
            name="Wzrost"
            fill={CHART_COLORS.profit}
            radius={[4, 4, 0, 0]}
            barSize={18}
            opacity={0.88}
          >
            {chartData.map((point) => (
              <Cell key={`net-worth-growth-${point.xIndex}`} fill={point.growthColor} />
            ))}
          </Bar>
          <Line
            yAxisId="value"
            type="monotone"
            dataKey="trend"
            name="Trend"
            stroke={CHART_COLORS.trend}
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            activeDot={false}
          />
          {valueAxis.min < 0 && <ReferenceLine yAxisId="value" y={0} {...CHART_AXIS.zeroLine} />}
          {growthAxis.min < 0 && <ReferenceLine yAxisId="growth" y={0} {...CHART_AXIS.zeroLine} />}
          {dateTicks.map((tick) => (
            <ReferenceLine
              key={`net-worth-vertical-grid-${tick}`}
              x={tick}
              {...CHART_AXIS.referenceLine}
              ifOverflow="extendDomain"
            />
          ))}
          {valueAxis.ticks.filter((tick) => tick !== 0).map((tick) => (
            <ReferenceLine
              key={`net-worth-horizontal-grid-${tick}`}
              yAxisId="value"
              y={tick}
              {...CHART_AXIS.referenceLine}
              ifOverflow="extendDomain"
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default NetWorthChart;
