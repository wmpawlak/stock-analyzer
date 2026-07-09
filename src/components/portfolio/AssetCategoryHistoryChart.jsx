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
import ChartTooltip from './ChartTooltip.jsx';
import {
  CHART_AXIS,
  CHART_COLORS,
  PERCENT_AXIS_TICKS,
  formatCompactAxisValue,
  formatCurrencyValue,
  formatDateTick,
  formatPercentValue,
  getAdaptiveDateTicks,
  getRoundedAxisTicks,
  toIndexedChartData,
} from './chartConfig.js';

const getChartData = (data) => toIndexedChartData(data);

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

const getStackedScale = (data, categories) => getRoundedAxisTicks(
  data.map((point) => categories.reduce((sum, category) => sum + (point[category] || 0), 0)),
);

const getPercentStackedScale = (data, categories) => {
  const maxVisibleStack = Math.max(
    ...data.map((point) => categories.reduce((sum, category) => sum + (point[category] || 0), 0)),
    0,
  );
  const maxDomain = Math.min(100, Math.max(10, Math.ceil(maxVisibleStack / 10) * 10));
  const step = maxDomain <= 20 ? 5 : 20;
  const ticks = [];

  for (let value = 0; value <= maxDomain; value += step) {
    ticks.push(value);
  }

  return { maxDomain, ticks };
};

const getCategoryColor = (category, categories) => (
  CHART_COLORS.categoryPalette[categories.indexOf(category) % CHART_COLORS.categoryPalette.length]
);

const EyeIcon = ({ isVisible }) => (
  <svg
    aria-hidden="true"
    className="h-3.5 w-3.5"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth="1.8"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.25 12s3.5-6.25 9.75-6.25S21.75 12 21.75 12 18.25 18.25 12 18.25 2.25 12 2.25 12Z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9.75 12a2.25 2.25 0 1 0 4.5 0 2.25 2.25 0 0 0-4.5 0Z"
    />
    {!isVisible && (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 19.5 19.5 4.5"
      />
    )}
  </svg>
);

const CustomTooltip = ({ active, payload, label, isPercentMode, hasHiddenCategories }) => {
  if (!active || !payload?.length) return null;

  const visiblePayload = payload
    .filter((entry) => Number.isFinite(entry.value) && entry.value !== 0)
    .reverse();
  const total = visiblePayload.reduce((sum, entry) => sum + entry.value, 0);
  const displayDate = payload[0]?.payload?.date || label;

  return (
    <ChartTooltip
      active={active}
      payload={payload}
      title={displayDate}
      rows={visiblePayload.map((entry) => ({
        key: entry.dataKey,
        name: entry.name,
        color: entry.color,
        value: entry.value,
      }))}
      total={{
        label: hasHiddenCategories ? 'Suma widoczna' : 'Suma',
        value: total,
        formatter: isPercentMode ? formatPercentValue : formatCurrencyValue,
      }}
      valueFormatter={isPercentMode ? formatPercentValue : formatCurrencyValue}
    />
  );
};

const CustomLegend = ({
  items,
  selectedCategory,
  hiddenCategories,
  visibleCount,
  onSelect,
  onToggleVisibility,
  onShowAll,
}) => (
  <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-4 text-xs">
    {items.map((item) => {
      const isSelected = selectedCategory === item.value;
      const isHidden = hiddenCategories.has(item.value);
      const isLastVisible = visibleCount === 1 && !isHidden;

      return (
        <div key={item.value} className="inline-flex items-center gap-1.5">
          <span
            className="h-3.5 w-3.5 rounded-full"
            style={{ backgroundColor: item.color, opacity: isHidden ? 0.35 : 1 }}
          />
          <button
            type="button"
            onClick={() => onSelect(item.value)}
            disabled={isHidden}
            className={`transition-colors ${
              isHidden
                ? 'cursor-not-allowed text-slate-600 line-through'
                : isSelected
                  ? 'font-semibold text-slate-100'
                  : 'text-slate-300 hover:text-slate-100'
            }`}
          >
            {item.value}
          </button>
          <button
            type="button"
            onClick={() => onToggleVisibility(item.value)}
            disabled={isLastVisible}
            title={isHidden ? `Pokaż ${item.value}` : `Ukryj ${item.value}`}
            aria-label={isHidden ? `Pokaż ${item.value}` : `Ukryj ${item.value}`}
            className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
              isLastVisible
                ? 'cursor-not-allowed text-slate-700'
                : isHidden
                  ? 'text-slate-500 hover:bg-slate-800 hover:text-slate-200'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
            }`}
          >
            <EyeIcon isVisible={!isHidden} />
          </button>
        </div>
      );
    })}
    {hiddenCategories.size > 0 && (
      <button
        type="button"
        onClick={onShowAll}
        className="ml-1 rounded-md border border-slate-700 px-2 py-1 text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
      >
        Pokaż wszystkie
      </button>
    )}
  </div>
);

const AssetCategoryHistoryChart = () => {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [hiddenCategories, setHiddenCategories] = useState(() => new Set());
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
  const legendItems = useMemo(() => sortedCategories.map((category) => ({
    color: getCategoryColor(category, categories),
    value: category,
  })), [sortedCategories, categories]);
  const percentData = useMemo(
    () => getPercentData(chartData, sortedCategories),
    [chartData, sortedCategories],
  );
  const visibleCategories = useMemo(
    () => sortedCategories.filter((category) => !hiddenCategories.has(category)),
    [sortedCategories, hiddenCategories],
  );
  const visibleData = isPercentMode ? percentData : chartData;
  const hasHiddenCategories = hiddenCategories.size > 0;
  const { maxDomain, ticks: axisTicks } = useMemo(
    () => {
      if (isPercentMode && visibleCategories.length === sortedCategories.length) {
        return { maxDomain: 100, ticks: PERCENT_AXIS_TICKS };
      }

      if (isPercentMode) return getPercentStackedScale(visibleData, visibleCategories);

      const axis = getStackedScale(visibleData, visibleCategories);
      return { maxDomain: axis.max, ticks: axis.ticks };
    },
    [isPercentMode, visibleData, sortedCategories, visibleCategories],
  );
  const horizontalGridValues = axisTicks.filter((tick) => tick !== 0);
  const dateTicks = useMemo(() => getAdaptiveDateTicks(chartData), [chartData]);
  const handleLegendClick = (category) => {
    if (!category || hiddenCategories.has(category)) return;

    setSelectedCategory((currentCategory) => (
      currentCategory === category ? null : category
    ));
  };
  const handleToggleVisibility = (category) => {
    if (!category) return;

    setHiddenCategories((currentCategories) => {
      const nextCategories = new Set(currentCategories);

      if (nextCategories.has(category)) {
        nextCategories.delete(category);
      } else if (sortedCategories.length - nextCategories.size > 1) {
        nextCategories.add(category);
      }

      return nextCategories;
    });
    setSelectedCategory((currentCategory) => (
      currentCategory === category ? null : currentCategory
    ));
  };
  const handleShowAll = () => {
    setHiddenCategories(new Set());
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
    <div className={`relative ${CHART_AXIS.heightClass} w-full pt-10`}>
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
        <AreaChart data={visibleData} margin={CHART_AXIS.margin}>
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
            tickFormatter={isPercentMode ? formatPercentValue : formatCompactAxisValue}
            tick={CHART_AXIS.tick}
            axisLine={false}
            tickLine={false}
            width={CHART_AXIS.yAxisWidth}
            domain={[0, maxDomain]}
            ticks={axisTicks}
          />
          <Tooltip
            content={(
              <CustomTooltip
                isPercentMode={isPercentMode}
                hasHiddenCategories={hasHiddenCategories}
              />
            )}
            cursor={CHART_AXIS.cursor}
          />
          <Legend
            wrapperStyle={CHART_AXIS.legendWrapper}
            content={(
              <CustomLegend
                items={legendItems}
                selectedCategory={selectedCategory}
                hiddenCategories={hiddenCategories}
                visibleCount={visibleCategories.length}
                onSelect={handleLegendClick}
                onToggleVisibility={handleToggleVisibility}
                onShowAll={handleShowAll}
              />
            )}
          />
          {visibleCategories.map((category) => {
            const categoryColor = getCategoryColor(category, categories);

            return (
              <Area
                key={category}
                type="monotone"
                dataKey={category}
                name={category}
                stackId="asset-category-history"
                stroke={categoryColor}
                fill={categoryColor}
                fillOpacity={selectedCategory ? (selectedCategory === category ? 0.82 : 0.14) : 0.28}
                strokeOpacity={selectedCategory ? (selectedCategory === category ? 1 : 0.38) : 1}
                strokeWidth={selectedCategory === category ? 2.6 : 1.5}
                activeDot={{ r: 3, stroke: '#0f172a', strokeWidth: 1.5 }}
              />
            );
          })}
          {dateTicks.map((tick) => (
            <ReferenceLine
              key={`vertical-grid-${tick}`}
              x={tick}
              {...CHART_AXIS.referenceLine}
              ifOverflow="extendDomain"
            />
          ))}
          {horizontalGridValues.map((value) => (
            <ReferenceLine
              key={`horizontal-grid-${value}`}
              y={value}
              {...CHART_AXIS.referenceLine}
              ifOverflow="extendDomain"
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default AssetCategoryHistoryChart;
