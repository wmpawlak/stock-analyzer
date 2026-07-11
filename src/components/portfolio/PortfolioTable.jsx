import useDisplayedAssets from '../../hooks/useDisplayedAssets';
import { formatCurrency } from '../../utils/number';

const PortfolioTable = () => {
  const {
    assets: displayedAssets,
    isUsingDummyAssets,
    isUsingLiveAssets,
    sourceLabel,
  } = useDisplayedAssets();
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
        <p className="text-xs text-slate-500 mt-1">Dodaj dane w zakladce Dane Live albo zapisz fallback w Ustawieniach jako Dane dummy.</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden mb-8 transition-all hover:border-slate-800">
      <div className="px-6 py-5 border-b border-slate-800/80 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center bg-slate-900/50">
        <div>
          <h2 className="text-lg font-bold text-white">Podsumowanie Aktywów</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {sourceLabel ? `Dane pobrane z: ${sourceLabel}` : 'Zestawienie Twojej alokacji kapitalu'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {(isUsingLiveAssets || isUsingDummyAssets) && (
            <span className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${
              isUsingLiveAssets
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
            }`}
            >
              Zrodlo: {sourceLabel}
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
              <th className="px-6 py-4 font-semibold border-b border-slate-800/50 text-right">Wartosc</th>
              <th className="px-6 py-4 font-semibold border-b border-slate-800/50 text-right">Alokacja</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/40">
            {[...displayedAssets]
              .filter((asset) => asset.value > 0)
              .sort((a, b) => b.value - a.value)
              .map((row) => (
                <tr key={row.id} className="hover:bg-slate-800/20 transition-colors">
                  <td className="px-6 py-4 text-slate-200 font-medium text-sm">{row.label}</td>
                  <td className="px-6 py-4 text-slate-300 font-mono text-sm text-right">
                    {formatCurrency(row.value)}
                  </td>
                  <td className="px-6 py-4 text-blue-400 font-mono text-sm text-right font-medium">
                    {totalValue > 0 ? ((row.value / totalValue) * 100).toFixed(2) : '0.00'}%
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
