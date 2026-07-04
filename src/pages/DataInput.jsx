import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    setAssets, addStockPortfolio, removeStockPortfolio,
    setPortfolioHistory
} from '../features/portfolioSlice';

const HARDCODED_HEADERS = [
    "Akcje i inne instrumenty", "Kurs kupna", "Ilość", "Cena kupna brutto",
    "Prowizja kupna", "Koszt całkowity", "Aktualny kurs", "Ilość jednostek",
    "Prowizja sprzedaży", "Cena sprzedaży brutto", "Zysk/Strata",
    "Dywidenda netto", "Zysk netto", "Zysk/Strata %", "Dywidenda T / N",
    "Strategia", "Check", "Data zakupu"
];

const HISTORY_HEADERS = ["Data", "Wartość", "Wpłacone łącz.", "Różnica", "Delta %"];

const DataInput = () => {
    const [activeTab, setActiveTab] = useState('ogolne');
    const [inputText, setInputText] = useState(() => localStorage.getItem('portfolioInputText') || '');
    const [parsedAssets, setParsedAssets] = useState([]);
    const [portfolioName, setPortfolioName] = useState('');
    const [portfolioCsv, setPortfolioCsv] = useState('');
    const [historyText, setHistoryText] = useState(() => localStorage.getItem('portfolioHistoryText') || '');
    const [parsedHistory, setParsedHistory] = useState([]);

    const dispatch = useDispatch();
    const stockPortfolios = useSelector(state => state.portfolio.stockPortfolios);

    useEffect(() => {
        if (inputText) parseAssets(inputText);
        if (historyText) parseHistory(historyText);
    }, [inputText, historyText]);

    const getGoogleFinanceLink = (query) => {
        if (!query) return '#';
        const ticker = query.trim().split(' ')[0];
        return `https://www.google.com/finance/quote/${ticker}`;
    };

    const handleTextChange = (e) => {
        const text = e.target.value;
        setInputText(text);
        localStorage.setItem('portfolioInputText', text);
        parseAssets(text);
    };

    const parseAssets = (text) => {
        const regex = /(.*?)([\d\s]+,\d{2})\s*zł/g;
        let results = [];
        let match;
        while ((match = regex.exec(text)) !== null) {
            const label = match[1].trim();
            const rawValue = match[2].trim();
            const numericValue = parseFloat(rawValue.replace(/\s/g, '').replace(',', '.'));
            if (label && !isNaN(numericValue)) {
                results.push({ id: `${label}-${results.length}`, label, value: numericValue, formattedValue: `${rawValue} zł` });
            }
        }
        setParsedAssets(results);
        if (results.length > 0) dispatch(setAssets(results.map(({ id, label, value }) => ({ id, label, value }))));
    };
    
    const handleHistoryChange = (e) => {
        const text = e.target.value;
        setHistoryText(text);
        localStorage.setItem('portfolioHistoryText', text);
        parseHistory(text);
    };
    
    const parseHistory = (text) => {
        const lines = text.split('\n').filter(line => line.trim().length > 0);
        if (lines.length === 0) {
            setParsedHistory([]);
            dispatch(setPortfolioHistory([]));
            return;
        }
        const separator = lines[0].includes('\t') ? '\t' : (lines[0].includes(';') ? ';' : /\s{2,}/);
        const startIndex = lines[0].toLowerCase().includes("data") ? 1 : 0;
        const results = lines.slice(startIndex).map((line, i) => {
            const values = line.split(separator);
            let rowObj = { id: `history-${i}` };
            HISTORY_HEADERS.forEach((header, idx) => {
                rowObj[header] = values[idx] ? values[idx].trim() : '';
            });
            return rowObj;
        }).filter(row => row['Data']);
        setParsedHistory(results);
        dispatch(setPortfolioHistory(results));
    };

    const handleAddStockPortfolio = () => {
        if (!portfolioName.trim() || !portfolioCsv.trim()) return;

        const lines = portfolioCsv.split('\n').filter(line => line.trim().length > 0);
        if (lines.length === 0) return alert("Pole z danymi jest puste.");

        const separator = lines[0].includes('\t') ? '\t' : (lines[0].includes(';') ? ';' : /\s{2,}/);
        const startIndex = lines[0].includes("Akcje i inne instrumenty") ? 1 : 0;

        const parsedData = lines.slice(startIndex).map((line, i) => {
            const values = line.split(separator);
            if (values.length < 2) return null;
            
            let rowObj = {};
            HARDCODED_HEADERS.forEach((header, idx) => {
                rowObj[header] = values[idx] ? values[idx].trim() : '';
            });
            
            const cenaSprzedazy = parseFloat(rowObj['Cena sprzedaży brutto']?.replace(/\s/g, '').replace(',', '.') || 0);
            if (cenaSprzedazy > 0) {
                const ticker = rowObj['Akcje i inne instrumenty'] || '';
                const prowizja = ticker.toUpperCase().includes('WSE')
                    ? Math.max(5, cenaSprzedazy * 0.0039)
                    : Math.max(14, cenaSprzedazy * 0.0029);
                rowObj['Prowizja sprzedaży'] = prowizja.toFixed(2).replace('.', ',');
            }

            if (rowObj['Akcje i inne instrumenty']) {
                rowObj.id = `${rowObj['Akcje i inne instrumenty']}-${i}`;
                return rowObj;
            }
            return null;
        }).filter(Boolean);

        if (parsedData.length > 0) {
            dispatch(addStockPortfolio({
                id: Date.now().toString(),
                name: portfolioName.trim(),
                rawCsv: portfolioCsv,
                assets: parsedData,
                headers: HARDCODED_HEADERS
            }));
            setPortfolioName('');
            setPortfolioCsv('');
        } else {
            alert("Nie udało się rozpoznać danych.");
        }
    };

    const totalAssetsValue = parsedAssets.reduce((sum, asset) => sum + asset.value, 0);

    return (
        <div className="p-8 max-w-7xl mx-auto animate-fadeIn">
            <div className="mb-8">
                <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">Dane wejściowe</h1>
                <p className="text-slate-400 text-sm mt-1">Zarządzaj i importuj dane do analizy portfela.</p>
            </div>
            <div className="flex border-b border-slate-800 mb-8">
                <button
                    onClick={() => setActiveTab('ogolne')}
                    className={`py-3 px-5 text-sm font-medium transition-colors duration-200 ${activeTab === 'ogolne' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    Ogólne i Historia
                </button>
                <button
                    onClick={() => setActiveTab('portfele')}
                    className={`py-3 px-5 text-sm font-medium transition-colors duration-200 ${activeTab === 'portfele' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    Portfele Akcji
                </button>
            </div>

            {activeTab === 'ogolne' && (
                <div className="space-y-8 animate-fadeIn">
                    <div className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-xl p-6">
                        <h3 className="text-lg font-bold text-white mb-1">Ogólne saldo aktywów</h3>
                        <p className="text-slate-400 text-sm mb-6">Wklej zestawienie ogólnych aktywów, aby zasilić wykres kołowy.</p>
                        <textarea
                            className="w-full h-32 p-4 bg-slate-950/70 border border-slate-700/50 rounded-lg font-mono text-sm text-slate-300 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 resize-y"
                            placeholder="Wklej tutaj np.: USD (gotówka) 17 600,60 zł..."
                            value={inputText}
                            onChange={handleTextChange}
                        ></textarea>
                        
                        {parsedAssets.length > 0 && (
                             <div className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden mt-6">
                                <div className="px-6 py-5 border-b border-slate-800/80 flex justify-between items-center bg-slate-900/50">
                                    <h2 className="text-lg font-bold text-white">Podgląd Aktywów</h2>
                                    <span className="font-mono font-bold text-sm text-blue-400 bg-blue-500/10 border border-blue-500/20 px-4 py-2 rounded-xl shadow-inner">
                                        Suma: {new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(totalAssetsValue)}
                                    </span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-slate-950/40 text-slate-400 text-xs uppercase tracking-wider">
                                                <th className="px-6 py-4 font-semibold border-b border-slate-800/50">Kategoria</th>
                                                <th className="px-6 py-4 font-semibold border-b border-slate-800/50 text-right">Wartość</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800/40">
                                            {parsedAssets.map((asset) => (
                                                <tr key={asset.id} className="hover:bg-slate-800/20 transition-colors">
                                                    <td className="px-6 py-4 text-slate-200 font-medium text-sm">{asset.label}</td>
                                                    <td className="px-6 py-4 text-slate-300 font-mono text-sm text-right">{asset.formattedValue}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-xl p-6">
                        <h3 className="text-lg font-bold text-white mb-1">Historia wyceny portfela</h3>
                        <p className="text-slate-400 text-sm mb-6">Wklej dane historyczne. Separator (tabulator/średnik) wykrywany automatycznie.</p>
                        <textarea
                            className="w-full h-32 p-4 bg-slate-950/70 border border-slate-700/50 rounded-lg font-mono text-sm text-slate-300 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 resize-y"
                            placeholder="2020-01-01   2 875,00 zł   2 900,00 zł   -25,00 zł   -0,88%..."
                            value={historyText}
                            onChange={handleHistoryChange}
                        ></textarea>
                        
                        {parsedHistory.length > 0 && (
                            <div className="overflow-x-auto mt-6 border border-slate-800/80 rounded-xl">
                                <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
                                    <thead className="bg-slate-950/40">
                                        <tr>
                                            {HISTORY_HEADERS.map((header, idx) => (
                                                <th key={idx} className="px-4 py-3 border-b border-slate-800/50 font-semibold text-slate-400 uppercase tracking-wider">{header}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/40">
                                        {parsedHistory.map((row) => (
                                            <tr key={row.id} className="hover:bg-slate-800/20">
                                                {HISTORY_HEADERS.map((header, idx) => {
                                                    const val = row[header];
                                                    let colorClass = "text-slate-400 font-mono";
                                                    if ((header === "Różnica" || header === "Delta %") && val) {
                                                        if (val.startsWith('-')) colorClass = "text-rose-400 font-mono font-medium";
                                                        else if (val !== "0 zł" && val !== "0,00%") colorClass = "text-emerald-400 font-mono font-medium";
                                                    }
                                                    return (
                                                        <td key={idx} className={`px-4 py-3 ${header === 'Data' ? 'text-slate-200 font-medium' : colorClass}`}>
                                                            {val}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'portfele' && (
                <div className="animate-fadeIn">
                    <div className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-xl p-6">
                        <h3 className="text-lg font-bold text-white mb-1">Portfele inwestycyjne (Akcje / ETF)</h3>
                        <p className="text-slate-400 text-sm mb-6">Nazwij swój portfel i wklej <strong>tylko wiersze z danymi</strong>.</p>
                        <div className="flex flex-col gap-4 mb-6 max-w-4xl">
                            <input
                                type="text"
                                className="w-full p-3 bg-slate-950/70 border border-slate-700/50 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
                                placeholder="Nazwa portfela (np. IKE - CD Projekt)"
                                value={portfolioName}
                                onChange={(e) => setPortfolioName(e.target.value)}
                            />
                            <textarea
                                className="w-full h-40 p-4 bg-slate-950/70 border border-slate-700/50 rounded-lg font-mono text-sm text-slate-300 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 resize-y whitespace-pre"
                                placeholder="Wklej tutaj same wiersze z wartościami..."
                                value={portfolioCsv}
                                onChange={(e) => setPortfolioCsv(e.target.value)}
                            ></textarea>
                            <button
                                onClick={handleAddStockPortfolio}
                                className="self-start px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
                            >
                                Zapisz / Aktualizuj portfel
                            </button>
                        </div>

                        {stockPortfolios.length > 0 && (
                            <div className="space-y-8 mt-8 border-t border-slate-800 pt-8">
                                {stockPortfolios.map((portfolio) => (
                                    <div key={portfolio.id} className="border border-slate-800/80 rounded-2xl overflow-hidden shadow-xl">
                                        <div className="bg-slate-900/50 px-6 py-4 border-b border-slate-800/80 flex justify-between items-center">
                                            <h4 className="font-bold text-white text-lg">{portfolio.name}</h4>
                                            <button
                                                onClick={() => dispatch(removeStockPortfolio(portfolio.id))}
                                                className="text-sm text-rose-400 hover:text-rose-300 font-medium px-3 py-1 bg-rose-500/10 rounded-lg hover:bg-rose-500/20 transition-colors"
                                            >
                                                Usuń portfel
                                            </button>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
                                                <thead className="bg-slate-950/40">
                                                    <tr>
                                                        {portfolio.headers.map((header, idx) => (
                                                            <th key={idx} className="px-4 py-3 border-b border-slate-800/50 font-semibold text-slate-400 uppercase tracking-wider">
                                                                {header}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-800/40">
                                                    {portfolio.assets.map((row) => (
                                                        <tr key={row.id} className="hover:bg-slate-800/20 transition-colors">
                                                            {portfolio.headers.map((header, idx) => {
                                                                const val = row[header];
                                                                let colorClass = "text-slate-400";
                                                                if (header.includes('Zysk/Strata') && val && val !== "0,00" && val !== "0,00%") {
                                                                    colorClass = val.startsWith('-') ? "text-rose-400 font-medium" : "text-emerald-400 font-medium";
                                                                }
                                                                return (
                                                                    <td key={idx} className={`px-4 py-3 ${colorClass}`}>
                                                                        {header === "Akcje i inne instrumenty" && val ? (
                                                                            <a
                                                                                href={getGoogleFinanceLink(val)}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                                className="inline-flex items-center gap-1.5 text-blue-400 font-medium hover:text-blue-300 hover:underline transition-colors group"
                                                                                title={`Sprawdź notowania dla: ${val}`}
                                                                            >
                                                                                {val}
                                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-slate-500 group-hover:text-blue-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                                                </svg>
                                                                            </a>
                                                                        ) : ( val )}
                                                                    </td>
                                                                );
                                                            })}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default DataInput;