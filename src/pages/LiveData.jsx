import React, { useState, useEffect } from 'react';

const fetchSheetData = async (url, sheetName, range) => {
    if (!url) {
        throw new Error('Proszę podać link udostępniania arkusza Google.');
    }
    
    // Extract SPREADSHEET_ID from URL
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) {
        throw new Error('Nie udało się rozpoznać ID arkusza. Upewnij się, że link wygląda tak: https://docs.google.com/spreadsheets/d/TWOJE_ID/edit');
    }
    const spreadsheetId = match[1];
    
    const fetchUrl = new URL(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`);
    fetchUrl.searchParams.set('tqx', 'out:csv');
    
    if (sheetName) {
        fetchUrl.searchParams.set('sheet', sheetName);
    }
    if (range) {
        fetchUrl.searchParams.set('range', range);
    }
    
    const response = await fetch(fetchUrl.toString());
    if (!response.ok) {
        throw new Error('Błąd pobierania danych. Upewnij się, że arkusz jest udostępniony (Każda osoba mająca link -> Przeglądający).');
    }
    
    const csvText = await response.text();
    
    if (csvText.trim().startsWith('<!DOCTYPE html>') || csvText.trim().startsWith('<html')) {
        throw new Error('Pobrane dane to strona HTML. Upewnij się, że arkusz jest udostępniony poprawnie (Każda osoba mająca link -> Przeglądający).');
    }

    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    if (lines.length === 0) {
        throw new Error('Pobrany plik CSV jest pusty.');
    }

        const parseLine = (line) => {
        const result = [];
        let cell = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') {
                inQuotes = !inQuotes;
            } else if (c === ',' && !inQuotes) {
                result.push(cell);
                cell = '';
            } else {
                cell += c;
            }
        }
        result.push(cell);
        return result.map(v => v.replace(/^"|"$/g, '').trim());
    };

    const rawHeaders = parseLine(lines[0]);
    
    // Zabezpieczenie przed pustymi i duplikującymi się nagłówkami
    const uniqueHeaders = [];
    const headerCounts = {};
    
    rawHeaders.forEach((header, index) => {
        let cleanHeader = header.trim();
        
        // Jeżeli komórka nagłówka jest pusta (często w arkuszach)
        if (!cleanHeader) {
            cleanHeader = `Kolumna_${index + 1}`; 
        }
        
        // Zabezpieczenie przed takimi samymi nazwami kolumn
        if (headerCounts[cleanHeader]) {
            headerCounts[cleanHeader]++;
            uniqueHeaders.push(`${cleanHeader}_${headerCounts[cleanHeader]}`);
        } else {
            headerCounts[cleanHeader] = 1;
            uniqueHeaders.push(cleanHeader);
        }
    });

    const data = [];

    for (let i = 1; i < lines.length; i++) {
        const values = parseLine(lines[i]);
        
        // Pomijamy całkowicie puste wiersze
        if (values.every(v => v === '')) continue;
        
        const row = {};
        uniqueHeaders.forEach((header, index) => {
            row[header] = values[index] !== undefined ? values[index] : '';
        });
        // Pozbywamy się z obiektu pustych właściwości żeby w JSONIE panował porządek
        // Jeżeli chcesz zachować puste kolumny w JSONie, skasuj tę linijkę
        Object.keys(row).forEach(key => row[key] === '' && delete row[key]);

        // Jeśli po wyczyszczeniu pustych pól obiekt nadal ma jakieś dane, dodajemy go
        if (Object.keys(row).length > 0) {
            data.push(row);
        }
    }

    return data;
};

const LiveData = () => {
    // Basic config fields
    const [configName, setConfigName] = useState('');
    const [url, setUrl] = useState('');
    const [sheetName, setSheetName] = useState('');
    const [range, setRange] = useState('');
    
    // Status & Output
    const [jsonData, setJsonData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Saved Configs loaded from LocalStorage
    const [savedConfigs, setSavedConfigs] = useState(() => {
        try {
            const saved = localStorage.getItem('liveDataConfigs');
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    });

    // Save configs to LocalStorage when changed
    useEffect(() => {
        localStorage.setItem('liveDataConfigs', JSON.stringify(savedConfigs));
    }, [savedConfigs]);

    const handleSaveConfig = () => {
        if (!configName.trim() || !url.trim()) return;
        const newConfig = {
            id: Date.now().toString(),
            name: configName.trim(),
            url: url.trim(),
            sheetName: sheetName.trim(),
            range: range.trim()
        };
        setSavedConfigs(prev => [...prev, newConfig]);
        setConfigName('');
        setSheetName('');
        setRange('');
    };

    const handleRemoveConfig = (id) => {
        setSavedConfigs(prev => prev.filter(c => c.id !== id));
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
                    results[config.name] = { error: err.message };
                }
            }
            setJsonData(results);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const downloadJson = () => {
        if (!jsonData) return;
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(jsonData, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `dane_live_${new Date().toISOString().split('T')[0]}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
    };

    return (
        <div className="p-8 max-w-4xl mx-auto animate-fadeIn">
            <div className="mb-8 flex flex-col md:flex-row justify-between items-start">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">Dane Live (GSheets)</h1>
                    <p className="text-slate-400 text-sm mt-1">Pobieraj i konwertuj dane z w wielu arkuszy Google do formatu JSON.</p>
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
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
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
                <div className="mb-6 p-4 rounded-xl border flex items-center gap-3 text-sm font-medium transition-all bg-rose-500/10 border-rose-500/20 text-rose-300">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {error}
                </div>
            )}

            <div className="space-y-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Zapisywanie konfiguracji */}
                    <div className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden flex flex-col">
                        <div className="px-6 py-5 border-b border-slate-800/80 bg-slate-900/50">
                            <h3 className="text-lg font-bold text-white">Dodaj nowy zakres</h3>
                        </div>
                        <div className="p-6 space-y-5 flex-1">
                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-1.5">Nazwa własna dla zapisanej konfiguracji</label>
                                <input
                                    type="text" placeholder="np. Portfel Główny - dywidendy"
                                    value={configName} onChange={(e) => setConfigName(e.target.value)}
                                    className="w-full p-2.5 bg-slate-950/70 border border-slate-700/50 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-1.5">Link udostępniania (Udostępnij -&gt; Każda osoba mająca link)</label>
                                <input
                                    type="text" placeholder="np. https://docs.google.com/spreadsheets/d/e/.../edit?usp=sharing"
                                    value={url} onChange={(e) => setUrl(e.target.value)}
                                    className="w-full p-2.5 bg-slate-950/70 border border-slate-700/50 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Opcjonalnie: Zakładka</label>
                                    <input
                                        type="text" placeholder="np. Styczeń"
                                        value={sheetName} onChange={(e) => setSheetName(e.target.value)}
                                        className="w-full p-2.5 bg-slate-950/70 border border-slate-700/50 rounded-lg text-sm font-mono text-slate-200 focus:outline-none focus:border-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Opcjonalnie: Zakres</label>
                                    <input
                                        type="text" placeholder="np. A1:D20"
                                        value={range} onChange={(e) => setRange(e.target.value)}
                                        className="w-full p-2.5 bg-slate-950/70 border border-slate-700/50 rounded-lg text-sm font-mono text-slate-200 focus:outline-none focus:border-blue-500"
                                    />
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-3 justify-end pt-5 border-t border-slate-800/80 mt-4">
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
                            </div>
                        </div>
                    </div>

                    {/* Zapisane Konfiguracje */}
                    <div className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden flex flex-col">
                        <div className="px-6 py-5 border-b border-slate-800/80 bg-slate-900/50 flex justify-between items-center">
                            <h3 className="text-lg font-bold text-white">Zapisane zakresy</h3>
                            <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded font-mono">{savedConfigs.length} configów</span>
                        </div>
                        <div className="p-0 overflow-y-auto flex-1 min-h-[300px] max-h-[420px]">
                            {savedConfigs.length === 0 ? (
                                <div className="p-6 text-center text-sm text-slate-500 h-full flex flex-col items-center justify-center min-h-[250px]">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-slate-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                                    </svg>
                                    Brak zapisanych zakresów.<br/>Zapisz swój pierwszy konfig w panelu obok.
                                </div>
                            ) : (
                                <ul className="divide-y divide-slate-800/50">
                                    {savedConfigs.map(config => (
                                        <li key={config.id} className="p-4 hover:bg-slate-800/30 transition-colors flex justify-between items-center group">
                                            <div className="truncate pr-4 flex-1">
                                                <p className="text-sm font-semibold text-slate-200">{config.name}</p>
                                                <p className="text-[10px] text-slate-500 truncate mt-1 flex gap-2">
                                                    {config.sheetName && <span className="bg-slate-800 px-1.5 py-0.5 rounded text-blue-400"># {config.sheetName}</span>}
                                                    {config.range && <span className="bg-slate-800 px-1.5 py-0.5 rounded text-emerald-400">rg: {config.range}</span>}
                                                    <span className="truncate py-0.5">{config.url}</span>
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => handleRemoveConfig(config.id)}
                                                className="text-xs text-rose-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 p-2 bg-rose-500/10 rounded-lg transition-all flex-shrink-0"
                                                title="Usuń"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </div>

                {jsonData && (
                    <div className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden animate-fadeIn">
                        <div className="px-6 py-5 border-b border-slate-800/80 bg-slate-900/50 flex flex-col md:flex-row justify-between items-start md:items-center w-full gap-4">
                            <h3 className="text-lg font-bold text-white">Przetworzone Dane (JSON)</h3>
                            <button
                                onClick={downloadJson}
                                className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-slate-700 font-medium text-sm text-slate-300 bg-slate-800/50 rounded-lg hover:bg-slate-800 transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                Pobierz wygenerowany JSON
                            </button>
                        </div>
                        <div className="p-0 border-b border-slate-800/80 bg-slate-950 max-h-[600px] overflow-y-auto">
                            <pre className="p-4 text-xs font-mono text-emerald-400">
                                {JSON.stringify(jsonData, null, 2)}
                            </pre>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LiveData;