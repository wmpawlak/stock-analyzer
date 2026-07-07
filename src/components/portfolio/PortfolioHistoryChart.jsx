import { useMemo } from 'react';
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
import useLiveData from '../../hooks/useLiveData.js';
import { getPortfolioHistoryFromLiveData } from '../../utils/liveData.js';
import { normalizeText, parseNumericValue } from '../../utils/number.js';
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

const DATE_ALIASES = ['date', 'Data'];
const VALUE_ALIASES = ['wartosc', 'Warto\u015b\u0107', 'Wartosc', 'Warto\u015b\u0107 portfela', 'Value'];
const PAID_ALIASES = ['wplacone', 'Wp\u0142acone \u0142\u0105cz.', 'Wplacone lacz.', 'Wp\u0142acone \u0142\u0105cznie', 'Paid'];
const DIFF_ALIASES = ['roznica', 'R\u00f3\u017cnica', 'Roznica', 'Zysk / Strata', 'Difference'];

const getFirstValue = (row, aliases) => {
  if (!row || typeof row !== 'object') return undefined;

  const normalizedAliases = aliases.map(normalizeText);
  const key = Object.keys(row).find((candidate) => normalizedAliases.includes(normalizeText(candidate)));
  return key ? row[key] : undefined;
};

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;

  const rows = payload.filter((entry) => Number.isFinite(entry.value));
  const delta = rows.find((entry) => entry.dataKey === 'roznica');

  return (
    <ChartTooltip
      active={active}
      payload={payload}
      title={payload[0]?.payload?.date}
      rows={rows.filter((entry) => entry.dataKey !== 'roznica').map((entry) => ({
        key: entry.dataKey,
        name: entry.name,
        color: entry.color,
        value: entry.value,
      }))}
      total={delta && {
        label: 'Zysk / Strata',
        value: delta.value,
        prefix: delta.value >= 0 ? '+' : '',
        valueClassName: delta.value >= 0 ? 'text-emerald-300' : 'text-rose-300',
      }}
    />
  );
};

const PortfolioHistoryChart = () => {
  const liveData = useLiveData();
  const rawData = useMemo(() => getPortfolioHistoryFromLiveData(liveData).data, [liveData]);

  const data = useMemo(() => {
    const points = rawData.map((item, index) => ({
      id: index,
      date: getFirstValue(item, DATE_ALIASES),
      wartosc: parseNumericValue(getFirstValue(item, VALUE_ALIASES)),
      wplacone: parseNumericValue(getFirstValue(item, PAID_ALIASES)),
      roznica: parseNumericValue(getFirstValue(item, DIFF_ALIASES)),
    })).map((point) => ({
      ...point,
      wplacone: Number.isFinite(point.wplacone) ? point.wplacone : 0,
      roznica: Number.isFinite(point.roznica) ? point.roznica : 0,
    })).filter((point) => Number.isFinite(point.wartosc));

    return toIndexedChartData(points);
  }, [rawData]);

  const valueAxis = useMemo(() => getRoundedAxisTicks(
    data.flatMap((point) => [point.wartosc, point.wplacone, point.roznica]),
  ), [data]);
  const horizontalGridValues = valueAxis.ticks;
  const dateTicks = useMemo(() => getAdaptiveDateTicks(data), [data]);
  const gradientOffset = (() => {
    if (valueAxis.max <= 0) return 0;
    if (valueAxis.min >= 0) return 1;
    return valueAxis.max / (valueAxis.max - valueAxis.min);
  })();

  if (data.length === 0) {
    return (
      <div className="flex h-80 w-full items-center justify-center text-slate-500">
        <div className="text-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 13.5l6-6 4 4L21 3.5M21 3.5h-6m6 0v6M3 20.5h18" />
          </svg>
          <p className="mt-2 text-sm">{'Brak danych dla zakresu "Historia wyceny portfela".'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${CHART_AXIS.heightClass} w-full`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={CHART_AXIS.margin}>
          <defs>
            <linearGradient id="portfolioHistoryValueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.portfolioValue} stopOpacity={0.46} />
              <stop offset="100%" stopColor={CHART_COLORS.portfolioValue} stopOpacity={0.1} />
            </linearGradient>
            <linearGradient id="portfolioHistoryPaidFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.paid} stopOpacity={0.34} />
              <stop offset="100%" stopColor={CHART_COLORS.paid} stopOpacity={0.08} />
            </linearGradient>
            <linearGradient id="portfolioHistoryDeltaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset={0} stopColor={CHART_COLORS.profit} stopOpacity={0.46} />
              <stop offset={gradientOffset} stopColor={CHART_COLORS.profit} stopOpacity={0.1} />
              <stop offset={gradientOffset} stopColor={CHART_COLORS.loss} stopOpacity={0.1} />
              <stop offset={1} stopColor={CHART_COLORS.loss} stopOpacity={0.46} />
            </linearGradient>
            <linearGradient id="portfolioHistoryDeltaStroke" x1="0" y1="0" x2="0" y2="1">
              <stop offset={gradientOffset} stopColor={CHART_COLORS.profit} stopOpacity={1} />
              <stop offset={gradientOffset} stopColor={CHART_COLORS.loss} stopOpacity={1} />
            </linearGradient>
          </defs>
          <CartesianGrid {...CHART_AXIS.grid} />
          <XAxis
            dataKey="xIndex"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={dateTicks}
            tickFormatter={(value) => formatDateTick(value, data)}
            tick={CHART_AXIS.tick}
            tickMargin={CHART_AXIS.tickMargin}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={formatCompactAxisValue}
            tick={CHART_AXIS.tick}
            axisLine={false}
            tickLine={false}
            width={CHART_AXIS.yAxisWidth}
            type="number"
            domain={[valueAxis.min, valueAxis.max]}
            ticks={horizontalGridValues}
            allowDataOverflow
          />
          <ReferenceLine y={0} {...CHART_AXIS.zeroLine} />
          <Tooltip content={<CustomTooltip />} cursor={CHART_AXIS.cursor} />
          <Legend
            wrapperStyle={CHART_AXIS.legendWrapper}
            iconType="circle"
            formatter={(value) => <span className="text-slate-300">{value}</span>}
          />
          <Area
            type="monotone"
            dataKey="wartosc"
            name={'Warto\u015b\u0107 portfela'}
            stroke={CHART_COLORS.portfolioValue}
            strokeWidth={2}
            fill="url(#portfolioHistoryValueFill)"
            activeDot={{ r: 4, fill: CHART_COLORS.portfolioValue, stroke: '#0f172a', strokeWidth: 2 }}
          />
          <Area
            type="monotone"
            dataKey="wplacone"
            name={'Wp\u0142acone'}
            stroke={CHART_COLORS.paid}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            fill="url(#portfolioHistoryPaidFill)"
            activeDot={{ r: 4, fill: CHART_COLORS.paid, stroke: '#0f172a', strokeWidth: 2 }}
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
                  fill={isPositive ? CHART_COLORS.profit : CHART_COLORS.loss}
                  stroke="#0f172a"
                  strokeWidth={2}
                />
              );
            }}
          />
          {dateTicks.map((date) => (
            <ReferenceLine
              key={`portfolio-history-vertical-grid-${date}`}
              x={date}
              {...CHART_AXIS.referenceLine}
              ifOverflow="extendDomain"
            />
          ))}
          {horizontalGridValues.map((value) => (
            <ReferenceLine
              key={`portfolio-history-horizontal-grid-${value}`}
              y={value}
              {...CHART_AXIS.referenceLine}
              ifOverflow="extendDomain"
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PortfolioHistoryChart;
