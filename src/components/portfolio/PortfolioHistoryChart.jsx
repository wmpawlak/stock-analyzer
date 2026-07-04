import { useSelector } from 'react-redux';
import {
    ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, ReferenceLine
} from 'recharts';

const MOCK_DATA = [
    { Data: '2023-01-01', Wartość: '48 000 zł', 'Wpłacone łącz.': '50 000 zł', Różnica: '-2 000 zł' },
    { Data: '2023-04-01', Wartość: '62 500 zł', 'Wpłacone łącz.': '60 000 zł', Różnica: '2 500 zł' },
    { Data: '2023-08-01', Wartość: '85 000 zł', 'Wpłacone łącz.': '80 000 zł', Różnica: '5 000 zł' },
    { Data: '2024-01-01', Wartość: '105 200 zł', 'Wpłacone łącz.': '95 000 zł', Różnica: '10 200 zł' },
    { Data: '2024-05-01', Wartość: '131 581 zł', 'Wpłacone łącz.': '110 000 zł', Różnica: '21 581 zł' },
    { Data: '2024-08-01', Wartość: '143 765 zł', 'Wpłacone łącz.': '115 000 zł', Różnica: '28 765 zł' }
];

const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-2xl min-w-[200px]">
                <p className="font-bold text-slate-200 border-b border-slate-800 pb-2 mb-3 text-sm">{label}</p>
                <div className="space-y-2">
                    {payload.filter(p => p.dataKey !== 'roznica').map((entry, index) => (
                        <div key={index} className="flex justify-between gap-6 text-xs">
                            <span style={{ color: entry.color }} className="font-medium">
                                {entry.name}:
                            </span>
                            <span className="font-mono font-semibold text-slate-300">
                                    {new Intl.NumberFormat('pl-PL', {
                                    style: 'currency', currency: 'PLN', maximumFractionDigits: 0
                                    }).format(entry.value)}
                                </span>
                            </div>
                        ))}
                    {payload.filter(p => p.dataKey === 'roznica').map((entry, index) => {
                            const isPositive = entry.value >= 0;
                            return (
                            <div key={`delta-${index}`} className="border-t border-slate-800 pt-2 mt-2">
                                <div className="flex justify-between gap-6 text-xs">
                                    <span className="font-medium text-slate-400">Zysk / Strata:</span>
                                    <span className={`font-mono font-bold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {isPositive ? '+' : ''}
                                            {new Intl.NumberFormat('pl-PL', {
                                            style: 'currency', currency: 'PLN', maximumFractionDigits: 0
                                            }).format(entry.value)}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                </div>
            </div>
        );
    }
    return null;
};

const PortfolioHistoryChart = () => {
    const reduxHistory = useSelector((state) => state.portfolio.portfolioHistory);
    const isMockData = !reduxHistory || reduxHistory.length === 0;
    const rawData = isMockData ? MOCK_DATA : reduxHistory;

    const parseCurrency = (str) => {
        if (!str) return 0;
        return parseFloat(str.replace(/\s/g, '').replace('zł', '').replace(',', '.'));
    };

    const data = rawData.map((item, index) => ({
        id: index,
        date: item['Data'],
        wartosc: parseCurrency(item['Wartość']),
        wplacone: parseCurrency(item['Wpłacone łącz.']),
        roznica: parseCurrency(item['Różnica'])
    })).sort((a, b) => new Date(a.date) - new Date(b.date));

    // --- DYNAMICZNE OBLICZANIE PUNKTU ZERO ---
    const globalMax = Math.max(0, ...data.map(i => Math.max(i.wartosc, i.wplacone, i.roznica)));
    const globalMin = Math.min(0, ...data.map(i => Math.min(i.wartosc, i.wplacone, i.roznica)));
    let gradientOffset = 0;
    if (globalMax <= 0) {
        gradientOffset = 0;
    } else if (globalMin >= 0) {
        gradientOffset = 1;
    } else {
        gradientOffset = globalMax / (globalMax - globalMin);
    }

    return (
        <div className="w-full h-96 relative">
            <style>{`
                .recharts-wrapper, .recharts-wrapper *, .recharts-surface, .recharts-surface * {
                    outline: none !important;
                    box-shadow: none !important;
                }
 `}</style>
            {isMockData && (
                <div className="absolute top-2 right-2 z-10 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-bold px-3 py-1 rounded-lg">
                    DANE PRZYKŁADOWE
                </div>
            )}
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} margin={{ top: 15, right: 10, bottom: 5, left: 10 }}>
                    <defs>
                        <linearGradient id="colorWartosc" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                            <stop offset="100%" stopColor="#10b981" stopOpacity={0.0} />
                        </linearGradient>
                        <linearGradient id="colorWplacone" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#ef4444" stopOpacity={0.15} />
                            <stop offset="100%" stopColor="#ef4444" stopOpacity={0.0} />
                        </linearGradient>
                        {/* Wypełnienie obszaru dla Delty z twardym odcięciem na poziomie zero */}
                        <linearGradient id="colorDeltaFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset={0} stopColor="#10b981" stopOpacity={0.3} />
                            <stop offset={gradientOffset} stopColor="#10b981" stopOpacity={0.02} />
                            <stop offset={gradientOffset} stopColor="#ef4444" stopOpacity={0.02} />
                            <stop offset={1} stopColor="#ef4444" stopOpacity={0.3} />
                        </linearGradient>
                        {/* Obrys linii dla Delty z twardym odcięciem na poziomie zero */}
                        <linearGradient id="colorDeltaStroke" x1="0" y1="0" x2="0" y2="1">
                            <stop offset={gradientOffset} stopColor="#10b981" stopOpacity={1} />
                            <stop offset={gradientOffset} stopColor="#ef4444" stopOpacity={1} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
                    <XAxis
                        dataKey="date"
                        tick={{ fill: '#64748b', fontSize: 10 }}
                        tickMargin={10}
                        axisLine={false}
                        tickLine={false}
                    />
                    <YAxis
                        tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                        tick={{ fill: '#64748b', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        width={35}
                        type="number"
                        domain={[
                            dataMin => Math.min(0, Math.floor(dataMin / 10000) * 10000),
                            dataMax => Math.ceil(dataMax / 10000) * 10000
                        ]}
                        allowDataOverflow={true}
                    />
                    {/* Gruba linia poziomu zero */}
                    <ReferenceLine y={0} stroke="#334155" strokeWidth={1} />
                    <Tooltip
                        content={<CustomTooltip />}
                        cursor={{ stroke: '#334155', strokeWidth: 1, strokeDasharray: '4 4' }}
                    />
                    {/* Uporządkowanie warstw: 1. Wartość (dno), 2.  Wpłacone, 3. Delta (wierzch) */}
                    <Area
                        type="monotone"
                        dataKey="wartosc"
                        name="Wartość Portfela"
                        stroke="#10b981"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorWartosc)"
                        activeDot={{ r: 4, fill: '#10b981', stroke: '#0f172a', strokeWidth: 2 }}
                    />
                    <Area
                        type="monotone"
                        dataKey="wplacone"
                        name="Wpłacone"
                        stroke="#ef4444"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        fillOpacity={1}
                        fill="url(#colorWplacone)"
                        activeDot={{ r: 4, fill: '#ef4444', stroke: '#0f172a', strokeWidth: 2 }}
                    />
                    <Area
                        type="monotone"
                        dataKey="roznica"
                        name="Zysk / Strata"
                        stroke="url(#colorDeltaStroke)"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#colorDeltaFill)"
                        activeDot={(props) => {
                            const { cx, cy, payload } = props;
                            const isPositive = payload.roznica >= 0;
                            return (
                                <circle
                                    cx={cx} cy={cy} r={5}
                                    fill={isPositive ? '#10b981' : '#ef4444'}
                                    stroke="#0f172a" strokeWidth={2}
                                />
                            );
                        }}
                    />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
};

export default PortfolioHistoryChart;

