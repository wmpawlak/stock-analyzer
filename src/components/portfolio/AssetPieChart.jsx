import { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import useDisplayedAssets from '../../hooks/useDisplayedAssets.js';
import { formatCurrency } from '../../utils/number.js';
import ChartTooltip from './ChartTooltip.jsx';
import { CHART_AXIS, CHART_COLORS, formatPercentValue } from './chartConfig.js';

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;

  const data = payload[0].payload;
  const percent = data.percent * 100;

  return (
    <ChartTooltip
      active={active}
      payload={payload}
      title={data.label}
      rows={[{
        key: data.id,
        name: 'Wartość',
        color: payload[0].color,
        value: data.value,
      }]}
      total={{
        label: 'Udział',
        value: percent,
        formatter: formatPercentValue,
      }}
    />
  );
};

const renderCustomizedLabel = ({ cx, cy, midAngle, outerRadius, percent, fill, label, value }) => {
  if (percent < 0.045) return null;

  const radian = Math.PI / 180;
  const sin = Math.sin(-radian * midAngle);
  const cos = Math.cos(-radian * midAngle);
  const sx = cx + outerRadius * cos;
  const sy = cy + outerRadius * sin;
  const mx = cx + (outerRadius + 18) * cos;
  const my = cy + (outerRadius + 18) * sin;
  const ex = mx + (cos >= 0 ? 1 : -1) * 24;
  const ey = my;
  const textAnchor = cos >= 0 ? 'start' : 'end';

  return (
    <g>
      <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke={fill} fill="none" strokeWidth={1.5} opacity={0.9} />
      <circle cx={ex} cy={ey} r={3.5} fill={fill} stroke="#020617" strokeWidth={1.5} />
      <text
        x={ex + (cos >= 0 ? 1 : -1) * 10}
        y={ey}
        textAnchor={textAnchor}
        fill="#f8fafc"
        dy={-6}
        fontSize={12}
        fontWeight="600"
      >
        {label}
      </text>
      <text
        x={ex + (cos >= 0 ? 1 : -1) * 10}
        y={ey}
        textAnchor={textAnchor}
        fill="#94a3b8"
        dy={10}
        fontSize={11}
      >
        {`${formatPercentValue(percent * 100)} · ${formatCurrency(value, 0)}`}
      </text>
    </g>
  );
};

const AssetPieChart = () => {
  const { assets: displayedAssets } = useDisplayedAssets();
  const assets = displayedAssets
    .filter((asset) => asset.value > 0)
    .sort((a, b) => b.value - a.value);

  const totalValue = useMemo(
    () => assets.reduce((sum, asset) => sum + asset.value, 0),
    [assets],
  );

  if (assets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500">
        <div className="text-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="mt-2 text-sm">Brak danych do wyświetlenia na wykresie.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid w-full grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.5fr)_320px] xl:items-center">
      <div className={`${CHART_AXIS.heightClass} w-full`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={CHART_AXIS.pieMargin}>
            <Pie
              data={assets}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={renderCustomizedLabel}
              outerRadius="78%"
              innerRadius="52%"
              dataKey="value"
              nameKey="label"
              paddingAngle={2}
              cornerRadius={6}
              isAnimationActive
              stroke="#020617"
              strokeWidth={3}
              style={{ outline: 'none', cursor: 'pointer' }}
            >
              {assets.map((entry, index) => (
                <Cell
                  key={entry.id}
                  fill={CHART_COLORS.categoryPalette[index % CHART_COLORS.categoryPalette.length]}
                  style={{ outline: 'none' }}
                />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-4 shadow-inner shadow-black/20">
        <div className="mb-4 border-b border-slate-800/70 pb-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Legenda i udział</p>
          <p className="mt-2 text-sm text-slate-400">Łączna wartość portfela</p>
          <p className="text-xl font-semibold text-slate-100">{formatCurrency(totalValue, 0)}</p>
        </div>

        <div className="space-y-3">
          {assets.map((asset, index) => {
            const share = totalValue > 0 ? (asset.value / totalValue) * 100 : 0;
            const color = CHART_COLORS.categoryPalette[index % CHART_COLORS.categoryPalette.length];

            return (
              <div key={asset.id} className="rounded-xl border border-slate-800/60 bg-slate-900/70 px-3 py-3">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className="mt-1 h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-200">{asset.label}</p>
                      <p className="text-xs font-mono text-slate-500">{formatCurrency(asset.value, 0)}</p>
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-slate-100">{formatPercentValue(share)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${share}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default AssetPieChart;
