import { useSelector } from 'react-redux';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from
    'recharts';
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444',
    '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#64748b', '#84cc16',
    '#14b8a6'];
const renderCustomizedLabel = (props) => {
    const { cx, cy, midAngle, outerRadius, value, label, percent,
        fill } = props;
    const RADIAN = Math.PI / 180;
    const insideRadius = outerRadius * 0.60;
    const xInside = cx + insideRadius * Math.cos(-midAngle *
        RADIAN);
    const yInside = cy + insideRadius * Math.sin(-midAngle *
        RADIAN);
    const sin = Math.sin(-RADIAN * midAngle);
    const cos = Math.cos(-RADIAN * midAngle);
    const sx = cx + outerRadius * cos;
    const sy = cy + outerRadius * sin;
    const mx = cx + (outerRadius + 30) * cos;
    const my = cy + (outerRadius + 30) * sin;
    const ex = mx + (cos >= 0 ? 1 : -1) * 35;
    const ey = my;
    const textAnchor = cos >= 0 ? 'start' : 'end';
    const formattedValue = new Intl.NumberFormat('pl-PL', {
        style: 'currency',
        currency: 'PLN',
        maximumFractionDigits: 0
    }).format(value);
    return (
        <g>
            <text
                x={xInside}
                y={yInside}
                fill="white"
                textAnchor="middle"
                dominantBaseline="central"
                className="text-xs font-bold drop-shadow-md"
            >
                {`${(percent * 100).toFixed(0)}%`}
            </text>
            <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`}
                stroke={fill} fill="none" strokeWidth={1.5} />
            <circle cx={ex} cy={ey} r={3} fill={fill} stroke="none" />
            <text x={ex + (cos >= 0 ? 1 : -1) * 12} y={ey - 6}
                textAnchor={textAnchor} fill="#374151" className="text-sm fontsemibold">
                {label}
            </text>
            <text x={ex + (cos >= 0 ? 1 : -1) * 12} y={ey + 14}
                textAnchor={textAnchor} fill="#6b7280" className="text-xs">
                {formattedValue}
            </text>
        </g>
    );
};
const AssetPieChart = () => {
    const assets = useSelector((state) => state.portfolio.assets)
        .filter(a => a.value > 0)
        .sort((a, b) => b.value - a.value);
    if (assets.length === 0) {
        return <div className="flex items-center justify-center h-64
text-gray-400">Brak danych do wyświetlenia na wykresie.</div>;
    }
    return (
        <div className="w-full h-150 relative">
            {/* Wstrzykujemy lokalny blok stylów, który wyłącza outline dla wszystkiego wewnątrz tego kontenera */}
            <style>{`
 .recharts-wrapper,
 .recharts-wrapper *,
 .recharts-surface,
 .recharts-surface *,
 .recharts-legend-wrapper,
 .recharts-tooltip-wrapper {
 outline: none !important;
 box-shadow: none !important;
 }
 `}</style>
            <ResponsiveContainer width="100%" height="100%">
                <PieChart
                    margin={{ top: 40, right: 120, bottom: 40, left: 120 }}
                    style={{ outline: 'none' }}
                >
                    <Pie
                        data={assets}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={renderCustomizedLabel}
                        outerRadius={180}
                        fill="#8884d8"
                        dataKey="value"
                        nameKey="label"
                        paddingAngle={2}
                        minAngle={15}
                        isAnimationActive={true}
                        style={{ outline: 'none', cursor: 'pointer' }}
                    >
                        {assets.map((entry, index) => (
                            <Cell
                                key={`cell-${index}`}
                                fill={COLORS[index % COLORS.length]}
                                style={{ outline: 'none', boxShadow: 'none' }}
                            />
                        ))}
                    </Pie>
                    <Tooltip
                        formatter={(value) => new Intl.NumberFormat('pl-PL',
                            { style: 'currency', currency: 'PLN' }).format(value)}
                        contentStyle={{ outline: 'none', border: '1px solid', color: '#e5e7eb', borderRadius: '0.5rem' }}
                    />
                </PieChart>
            </ResponsiveContainer>
        </div>
    );
};
export default AssetPieChart;
        