import { useEffect, useState } from 'react';
import DataTable from '../components/DataTable';
import JsonPreviewModal from '../components/JsonPreviewModal';
import { csvToObjects } from '../utils/csv';
import {
  FETCHED_LIVE_DATA_KEY,
  notifyLiveDataChanged,
} from '../utils/liveData';

const fetchSheetData = async (url, sheetName, range) => {
  if (!url) {
    throw new Error('Podaj link udostępniania arkusza Google.');
  }

  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) {
    throw new Error('Nie udało się rozpoznać ID arkusza. Link powinien zawierać /spreadsheets/d/TWOJE_ID/.');
  }

  const spreadsheetId = match[1];
  const fetchUrl = new URL(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`);
  fetchUrl.searchParams.set('tqx', 'out:csv');

  if (sheetName) fetchUrl.searchParams.set('sheet', sheetName);
  if (range) fetchUrl.searchParams.set('range', range);

  const response = await fetch(fetchUrl.toString());
  if (!response.ok) {
    throw new Error('Błąd pobierania danych. Upewnij się, że arkusz jest udostępniony jako "Każda osoba mająca link -> Przeglądający".');
  }

  const csvText = await response.text();
  const trimmedCsv = csvText.trim();

  if (trimmedCsv.startsWith('<!DOCTYPE html>') || trimmedCsv.startsWith('<html')) {
    throw new Error('Pobrane dane wyglądają jak strona HTML. Sprawdź ustawienia udostępniania arkusza.');
  }

  const data = csvToObjects(csvText);
  if (data.length === 0) {
    throw new Error('Pobrany plik CSV jest pusty.');
  }

  return data;
};

const LiveData = () => {
  const [configName, setConfigName] = useState('');
  const [url, setUrl] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [range, setRange] = useState('');
  const [jsonData, setJsonData] = useState(() => {
    try {
      const saved = localStorage.getItem(FETCHED_LIVE_DATA_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [savedConfigs, setSavedConfigs] = useState(() => {
    try {
      const saved = localStorage.getItem('liveDataConfigs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState(null);

  useEffect(() => {
    if (jsonData) {
      localStorage.setItem(FETCHED_LIVE_DATA_KEY, JSON.stringify(jsonData));
    } else {
      localStorage.removeItem(FETCHED_LIVE_DATA_KEY);
    }

    notifyLiveDataChanged();
  }, [jsonData]);

  useEffect(() => {
    localStorage.setItem('liveDataConfigs', JSON.stringify(savedConfigs));
  }, [savedConfigs]);

  const handleEditClick = (config) => {
    setEditingConfig({ ...config });
  };

  const handleEditConfigChange = (event) => {
    const { name, value } = event.target;
    setEditingConfig((current) => ({ ...current, [name]: value }));
  };

  const handleUpdateConfig = () => {
    if (!editingConfig?.name?.trim() || !editingConfig?.url?.trim()) return;

    const updatedConfig = {
      ...editingConfig,
      name: editingConfig.name.trim(),
      url: editingConfig.url.trim(),
      sheetName: editingConfig.sheetName?.trim() || '',
      range: editingConfig.range?.trim() || '',
    };

    setSavedConfigs((current) => current.map((config) => (
      config.id === updatedConfig.id ? updatedConfig : config
    )));
    setEditingConfig(null);
  };

  const handleSaveConfig = () => {
    if (!configName.trim() || !url.trim()) return;

    setSavedConfigs((current) => [...current, {
      id: Date.now().toString(),
      name: configName.trim(),
      url: url.trim(),
      sheetName: sheetName.trim(),
      range: range.trim(),
    }]);
    setConfigName('');
    setSheetName('');
    setRange('');
  };

  const handleRemoveConfig = (id) => {
    setSavedConfigs((current) => current.filter((config) => config.id !== id));
    if (editingConfig?.id === id) setEditingConfig(null);
  };

  const handleFetchSingle = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchSheetData(url, sheetName, range);
      setJsonData({ 'Ostatnie pobranie ręczne': data });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFetchAll = async () => {
    if (savedConfigs.length === 0) return;

    try {
      setLoading(true);
      setError(null);

      const results = {};
      for (const config of savedConfigs) {
        try {
          results[config.name] = await fetchSheetData(config.url, config.sheetName, config.range);
        } catch (err) {
          results[config.name] = [{ error: err.message }];
        }
      }
      setJsonData(results);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formValues = editingConfig ?? {
    name: configName,
    url,
    sheetName,
    range,
  };

  return (
    <div className="p-8 max-w-4xl mx-auto animate-fadeIn">
      <div className="mb-8 flex flex-col md:flex-row justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">Dane Live (GSheets)</h1>
          <p className="text-slate-400 text-sm mt-1">Pobieraj i konwertuj dane z wielu arkuszy Google do formatu JSON.</p>
        </div>

        <button
          onClick={handleFetchAll}
          disabled={loading || savedConfigs.length === 0}
          className={`mt-4 md:mt-0 px-5 py-2.5 font-medium text-sm rounded-xl transition-colors flex items-center gap-2 shadow-lg shrink-0 ${
            loading || savedConfigs.length === 0
              ? 'bg-slate-800 text-slate-500 cursor-not-allowed shadow-none'
              : 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white hover:from-emerald-500 hover:to-emerald-400 shadow-emerald-500/20'
          }`}
        >
          {loading ? (
            <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          )}
          Pobierz wszystkie
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl border flex items-center gap-3 text-sm font-medium bg-rose-500/10 border-rose-500/20 text-rose-300">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      <div className="space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden flex flex-col">
            <div className="px-6 py-5 border-b border-slate-800/80 bg-slate-900/50">
              <h3 className="text-lg font-bold text-white">
                {editingConfig ? 'Edytuj zakres' : 'Dodaj nowy zakres'}
              </h3>
            </div>
            <div className="p-6 space-y-5 flex-1">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Nazwa własna dla zapisanej konfiguracji</label>
                <input
                  type="text"
                  placeholder="np. Portfel Główny - dywidendy"
                  name="name"
                  value={formValues.name ?? ''}
                  onChange={editingConfig ? handleEditConfigChange : (event) => setConfigName(event.target.value)}
                  className="w-full p-2.5 bg-slate-950/70 border border-slate-700/50 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Link udostępniania</label>
                <input
                  type="text"
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                  name="url"
                  value={formValues.url ?? ''}
                  onChange={editingConfig ? handleEditConfigChange : (event) => setUrl(event.target.value)}
                  className="w-full p-2.5 bg-slate-950/70 border border-slate-700/50 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Opcjonalnie: zakładka</label>
                  <input
                    type="text"
                    placeholder="np. Styczeń"
                    name="sheetName"
                    value={formValues.sheetName ?? ''}
                    onChange={editingConfig ? handleEditConfigChange : (event) => setSheetName(event.target.value)}
                    className="w-full p-2.5 bg-slate-950/70 border border-slate-700/50 rounded-lg text-sm font-mono text-slate-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Opcjonalnie: zakres</label>
                  <input
                    type="text"
                    placeholder="np. A1:D20"
                    name="range"
                    value={formValues.range ?? ''}
                    onChange={editingConfig ? handleEditConfigChange : (event) => setRange(event.target.value)}
                    className="w-full p-2.5 bg-slate-950/70 border border-slate-700/50 rounded-lg text-sm font-mono text-slate-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-3 justify-end pt-5 border-t border-slate-800/80 mt-4">
                {editingConfig ? (
                  <>
                    <button
                      onClick={() => setEditingConfig(null)}
                      className="px-4 py-2 font-medium text-xs rounded-lg transition-colors bg-slate-800 text-slate-300 hover:bg-slate-700"
                    >
                      Cofnij
                    </button>
                    <button
                      onClick={handleUpdateConfig}
                      disabled={!editingConfig.name || !editingConfig.url}
                      className="px-4 py-2 font-medium text-xs rounded-lg transition-colors bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                      Zapisz zmiany
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={handleFetchSingle}
                      disabled={loading || !url}
                      className="px-4 py-2 font-medium text-xs rounded-lg transition-colors bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                    >
                      Pobierz tylko ten
                    </button>
                    <button
                      onClick={handleSaveConfig}
                      disabled={!configName || !url}
                      className="px-4 py-2 font-medium text-xs rounded-lg transition-colors bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/20 disabled:opacity-50"
                    >
                      Zapisz do pamięci
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden flex flex-col">
            <div className="px-6 py-5 border-b border-slate-800/80 bg-slate-900/50 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Zapisane zakresy</h3>
              <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded font-mono">{savedConfigs.length}</span>
            </div>
            <div className="p-0 overflow-y-auto flex-1 min-h-[300px] max-h-[420px]">
              {savedConfigs.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500 h-full flex flex-col items-center justify-center min-h-[250px]">
                  Brak zapisanych zakresów.
                </div>
              ) : (
                <ul className="divide-y divide-slate-800/50">
                  {savedConfigs.map((config) => (
                    <li key={config.id} className="p-4 hover:bg-slate-800/30 transition-colors flex justify-between items-center group">
                      <div className="truncate pr-4 flex-1">
                        <p className="text-sm font-semibold text-slate-200">{config.name}</p>
                        <p className="text-[10px] text-slate-500 truncate mt-1 flex gap-2">
                          {config.sheetName && <span className="bg-slate-800 px-1.5 py-0.5 rounded text-blue-400"># {config.sheetName}</span>}
                          {config.range && <span className="bg-slate-800 px-1.5 py-0.5 rounded text-emerald-400">rg: {config.range}</span>}
                          <span className="truncate py-0.5">{config.url}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleEditClick(config)}
                          className="text-xs text-blue-500 hover:text-blue-400 opacity-0 group-hover:opacity-100 p-2 bg-blue-500/10 rounded-lg transition-all flex-shrink-0"
                          title="Edytuj"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L15.232 5.232z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleRemoveConfig(config.id)}
                          className="text-xs text-rose-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 p-2 bg-rose-500/10 rounded-lg transition-all flex-shrink-0"
                          title="Usuń"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {jsonData && (
          <div className="flex justify-center mt-8 space-x-4">
            <button
              onClick={() => setIsJsonModalOpen(true)}
              className="px-5 py-2.5 font-medium text-sm rounded-xl transition-colors flex items-center gap-2 shadow-lg bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-500 hover:to-blue-400 shadow-blue-500/20"
            >
              Pokaż wygenerowany JSON
            </button>
            <button
              onClick={() => setJsonData(null)}
              className="px-5 py-2.5 font-medium text-sm rounded-xl transition-colors flex items-center gap-2 shadow-lg bg-gradient-to-r from-red-600 to-red-500 text-white hover:from-red-500 hover:to-red-400 shadow-red-500/20"
            >
              Wyczyść dane
            </button>
          </div>
        )}

        <div className="space-y-8 mt-8">
          {jsonData && Object.entries(jsonData).map(([title, data]) => (
            <DataTable key={title} title={title} data={data} />
          ))}
        </div>

        {isJsonModalOpen && (
          <JsonPreviewModal
            jsonData={jsonData}
            onClose={() => setIsJsonModalOpen(false)}
          />
        )}
      </div>
    </div>
  );
};

export default LiveData;
