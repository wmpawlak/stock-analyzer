import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { clearPortfolioData } from '../features/portfolioSlice';
import { FETCHED_LIVE_DATA_KEY, notifyLiveDataChanged } from '../utils/liveData';

const DEFAULT_COMMISSIONS = {
  gpwRate: '0.39',
  gpwMin: '5',
  foreignRate: '0.29',
  foreignMin: '14',
};

const Settings = () => {
  const dispatch = useDispatch();
  const { assets, portfolioHistory, stockPortfolios } = useSelector((state) => state.portfolio);
  const [statusMessage, setStatusMessage] = useState({ text: '', type: '' });
  const [commissions, setCommissions] = useState(() => {
    try {
      const saved = localStorage.getItem('portfolioCommissions');
      return saved ? JSON.parse(saved) : DEFAULT_COMMISSIONS;
    } catch {
      return DEFAULT_COMMISSIONS;
    }
  });

  useEffect(() => {
    localStorage.setItem('portfolioCommissions', JSON.stringify(commissions));
  }, [commissions]);

  const handleCommissionChange = (event) => {
    const { name, value } = event.target;
    setCommissions((current) => ({ ...current, [name]: value }));
  };

  const showStatus = (text, type = 'success') => {
    setStatusMessage({ text, type });
    window.setTimeout(() => setStatusMessage({ text: '', type: '' }), 4000);
  };

  const handleClearData = () => {
    if (!window.confirm('Czy na pewno chcesz usunąć zaimportowane dane portfela, historię i cache live? Tej operacji nie da się cofnąć.')) {
      return;
    }

    dispatch(clearPortfolioData());
    localStorage.removeItem(FETCHED_LIVE_DATA_KEY);
    localStorage.removeItem('investmentCompactColumns');
    localStorage.removeItem('investmentTotalColumns');
    notifyLiveDataChanged();
    showStatus('Wszystkie dane zostały trwale usunięte z aplikacji.', 'error');
  };

  const handleExportBackup = () => {
    const backupData = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      reduxState: { assets, portfolioHistory, stockPortfolios },
      localStorage: {
        portfolioInputText: localStorage.getItem('portfolioInputText') || '',
        portfolioHistoryText: localStorage.getItem('portfolioHistoryText') || '',
        fetchedLiveData: localStorage.getItem(FETCHED_LIVE_DATA_KEY) || '',
      },
    };
    const dataStr = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(backupData, null, 2))}`;
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `portfolio_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showStatus('Kopia zapasowa JSON została pobrana pomyślnie.');
  };

  const handleSaveSettings = (event) => {
    event.preventDefault();
    showStatus('Ustawienia prowizji zostały zapisane.');
  };

  return (
    <div className="p-8 max-w-4xl mx-auto animate-fadeIn">
      <div className="mb-8">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">Ustawienia aplikacji</h1>
        <p className="text-slate-400 text-sm mt-1">Zarządzaj stawkami prowizyjnymi, kopiami zapasowymi i resetem danych.</p>
      </div>

      {statusMessage.text && (
        <div className={`mb-6 p-4 rounded-xl border flex items-center gap-3 text-sm font-medium ${
          statusMessage.type === 'error'
            ? 'bg-rose-500/10 border-rose-500/20 text-rose-300'
            : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
        }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {statusMessage.text}
        </div>
      )}

      <div className="space-y-8">
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-800/80 bg-slate-900/50">
            <h3 className="text-lg font-bold text-white">Domyślne stawki prowizji maklerskich</h3>
          </div>
          <form onSubmit={handleSaveSettings} className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4 border border-slate-800/50 p-4 rounded-xl bg-slate-800/30">
                <h4 className="font-semibold text-slate-200 text-sm flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                  Giełda krajowa (GPW / WSE)
                </h4>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Stawka procentowa (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    name="gpwRate"
                    value={commissions.gpwRate}
                    onChange={handleCommissionChange}
                    className="w-full p-2.5 bg-slate-950/70 border border-slate-700/50 rounded-lg text-sm font-mono text-slate-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Prowizja minimalna (PLN)</label>
                  <input
                    type="number"
                    name="gpwMin"
                    value={commissions.gpwMin}
                    onChange={handleCommissionChange}
                    className="w-full p-2.5 bg-slate-950/70 border border-slate-700/50 rounded-lg text-sm font-mono text-slate-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-4 border border-slate-800/50 p-4 rounded-xl bg-slate-800/30">
                <h4 className="font-semibold text-slate-200 text-sm flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                  Rynki zagraniczne
                </h4>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Stawka procentowa (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    name="foreignRate"
                    value={commissions.foreignRate}
                    onChange={handleCommissionChange}
                    className="w-full p-2.5 bg-slate-950/70 border border-slate-700/50 rounded-lg text-sm font-mono text-slate-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Prowizja minimalna (PLN)</label>
                  <input
                    type="number"
                    name="foreignMin"
                    value={commissions.foreignMin}
                    onChange={handleCommissionChange}
                    className="w-full p-2.5 bg-slate-950/70 border border-slate-700/50 rounded-lg text-sm font-mono text-slate-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="px-6 py-2 bg-blue-600 text-white font-medium text-sm rounded-lg hover:bg-blue-700 transition-colors"
              >
                Zapisz stawki
              </button>
            </div>
          </form>
        </div>

        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-800/80 bg-slate-900/50">
            <h3 className="text-lg font-bold text-white">Konserwacja i kopia zapasowa</h3>
          </div>
          <div className="p-6 space-y-6 divide-y divide-slate-800/60">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="text-sm font-bold text-slate-200">Eksportuj kopię bezpieczeństwa</h4>
                <p className="text-xs text-slate-500 max-w-xl mt-1">Pobierz plik JSON z saldami, historią, portfelami i cache danych live.</p>
              </div>
              <button
                onClick={handleExportBackup}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-slate-700 font-medium text-sm text-slate-300 bg-slate-800/50 rounded-lg hover:bg-slate-800 transition-colors shrink-0"
              >
                Pobierz JSON
              </button>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-6">
              <div>
                <h4 className="text-sm font-bold text-rose-400">Przywracanie ustawień fabrycznych</h4>
                <p className="text-xs text-slate-500 max-w-xl mt-1">Usuwa dane portfela, historię i pobrane dane live z pamięci przeglądarki.</p>
              </div>
              <button
                onClick={handleClearData}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 font-medium text-sm text-rose-400 bg-rose-500/10 rounded-lg hover:bg-rose-500/20 border border-rose-500/20 transition-colors shrink-0"
              >
                Wyczyść wszystkie dane
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
