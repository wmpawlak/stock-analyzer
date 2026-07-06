import { useMemo } from 'react';
import { useSelector } from 'react-redux';

const LIVE_ASSETS_KEY = 'Podsumowanie aktywów';

const formatCurrency = (value) => new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'PLN'
}).format(value);

const normalizeText = (value) => String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();

const parseNumericValue = (value) => {
    if (typeof value === 'number') return value;
    if (value === null || value === undefined) return NaN;

    const compactValue = String(value).trim().replace(/\s/g, '');
    if (!compactValue) return NaN;

    const numericText = compactValue.replace(/[^\d,.-]/g, '');
    const lastComma = numericText.lastIndexOf(',');
    const lastDot = numericText.lastIndexOf('.');

    const numericValue = (() => {
        if (lastComma > -1 && lastDot > -1) {
            return lastComma > lastDot
            ? numericText.replace(/\./g, '').replace(',', '.')
            : numericText.replace(/,/g, '');
        }

        if (lastComma > -1) {
            return numericText.replace(',', '.');
        }

        return numericText.replace(/\.(?=\d{3}(?:\D|$))/g, '');
    })();

    return parseFloat(numericValue);
};

const findColumn = (keys, aliases) => {
    const normalizedAliases = aliases.map(normalizeText);
    return keys.find((key) => normalizedAliases.includes(normalizeText(key)));
};

const getLiveAssets = () => {
    try {
        const savedLiveData = localStorage.getItem('fetchedLiveData');
        if (!savedLiveData) return [];

        const liveData = JSON.parse(savedLiveData);
        if (!liveData || typeof liveData !== 'object') return [];

        const summaryKey = Object.keys(liveData).find(
            (key) => normalizeText(key) === normalizeText(LIVE_ASSETS_KEY),
        );
        const rows = summaryKey ? liveData[summaryKey] : null;
        if (!Array.isArray(rows)) return [];

        return rows.map((row, index) => {
            if (!row || typeof row !== 'object') return null;

            const keys = Object.keys(row);
            const valueKey = findColumn(keys, ['Wartość', 'Wartość PLN', 'Value', 'Kwota', 'Saldo']);
            const labelKey = findColumn(keys, ['Kategoria', 'Nazwa', 'Aktywo', 'Aktywa', 'Label', 'Category'])
                || keys.find((key) => key !== valueKey && String(row[key] || '').trim());
            const fallbackValueKey = valueKey
                || keys.find((key) => key !== labelKey && Number.isFinite(parseNumericValue(row[key])));

            const label = String(row[labelKey] || '').trim();
            const value = parseNumericValue(row[fallbackValueKey]);

            if (!label || !Number.isFinite(value)) return null;

            return {
                id: `live-${index}-${label}`,
                label,
                value,
            };
        }).filter(Boolean);
    } catch {
        return [];
    }
};

const PortfolioTable = () => {
    const assets = useSelector((state) => state.portfolio.assets);
    const liveAssets = useMemo(() => getLiveAssets(), []);
    const displayedAssets = liveAssets.length > 0 ? liveAssets : assets;
    const isUsingLiveAssets = liveAssets.length > 0;

    // Obliczamy całkowitą wartość, żeby wyliczyć alokację procentową
    const totalValue = displayedAssets.reduce((sum, asset) => sum + asset.value, 0);
    if (displayedAssets.length === 0) {
        return (
            <div className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-xl p-8 mb-8 text-center text-slate-400">
                <div className="mx-auto w-12 h-12 bg-slate-800/50 rounded-xl flex items-center justify-center mb-3">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>
                <p className="text-sm font-medium text-slate-300">Brak zdefiniowanych aktywów</p>
                <p className="text-xs text-slate-500 mt-1">Przejdź do zakładki "Dane wejściowe", aby dodać swoje pierwsze aktywo.</p>
            </div>
    );
    }

    return (
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden mb-8 transition-all hover:border-slate-800">
            <div className="px-6 py-5 border-b border-slate-800/80 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center bg-slate-900/50">
                <div>
                    <h2 className="text-lg font-bold text-white">Podsumowanie Aktywów</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                        {isUsingLiveAssets ? 'Dane pobrane z zakładki Dane Live' : 'Zestawienie Twojej alokacji kapitału'}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {isUsingLiveAssets && (
                        <span className="text-xs font-semibold bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-lg border border-emerald-500/20">
                            Źródło: Dane Live
                        </span>
                    )}
                    <span className="font-mono font-bold text-sm text-blue-400 bg-blue-500/10 border border-blue-500/20 px-4 py-2 rounded-xl shadow-inner">
                        Suma: {formatCurrency(totalValue)}
                    </span>
                </div>
            </div>
            <div className="overflow-x-auto">                   
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-950/40 text-slate-400 text-xs uppercase tracking-wider">
                            <th className="px-6 py-4 font-semibold border-b border-slate-800/50">Kategoria</th>
                            <th className="px-6 py-4 font-semibold border-b border-slate-800/50 text-right">Wartość</th>
                            <th className="px-6 py-4 font-semibold border-b border-slate-800/50 text-right">Alokacja</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                        {/* Sortujemy od największej do najmniejszej i odfiltrowujemy zera dla czytelności */}
                        {[...displayedAssets]
                            .filter(a => a.value > 0)
                            .sort((a, b) => b.value - a.value)
                            .map((row) => (
                                <tr key={row.id} className="hover:bg-slate-800/20 transition-colors">
                                    <td className="px-6 py-4 text-slate-200 font-medium text-sm">{row.label}</td>
                                    <td className="px-6 py-4 text-slate-300 font-mono text-sm text-right">
                                        {formatCurrency(row.value)}
                                    </td>
                                    <td className="px-6 py-4 text-blue-400 font-mono text-sm text-right font-medium">
                                        {((row.value / totalValue) * 100).toFixed(2)}%
                                    </td>
                                </tr>
                            ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default PortfolioTable;
