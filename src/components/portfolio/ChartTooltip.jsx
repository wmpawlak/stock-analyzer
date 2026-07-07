import { formatCurrencyValue } from './chartConfig.js';

const ChartTooltip = ({ active, payload, title, rows, total, valueFormatter }) => {
  if (!active || !payload?.length) return null;

  const formatter = valueFormatter ?? formatCurrencyValue;

  return (
    <div className="min-w-[240px] rounded-xl border border-slate-700 bg-slate-950/95 px-4 py-3 shadow-2xl backdrop-blur-sm">
      {title && (
        <p className="mb-3 border-b border-slate-800 pb-2 text-sm font-bold text-slate-100">{title}</p>
      )}
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-5 text-xs">
            <span className="flex min-w-0 items-center gap-2 text-slate-300">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
              <span className="truncate">{row.name}</span>
            </span>
            <span className={`shrink-0 font-mono font-semibold ${row.valueClassName ?? 'text-slate-100'}`}>
              {row.prefix}
              {formatter(row.value)}
            </span>
          </div>
        ))}
      </div>
      {total && (
        <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-2 text-xs">
          <span className="font-medium text-slate-400">{total.label}</span>
          <span className={`font-mono font-bold ${total.valueClassName ?? 'text-blue-300'}`}>
            {total.prefix}
            {total.formatter ? total.formatter(total.value) : formatter(total.value)}
          </span>
        </div>
      )}
    </div>
  );
};

export default ChartTooltip;
