import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import InvestmentDetailsModal from '../components/investments/InvestmentDetailsModal.jsx';
import useLiveData from '../hooks/useLiveData.js';
import { notifyLiveDataChanged } from '../utils/liveData.js';
import {
    readPersistentJson,
    writePersistentJson,
} from '../utils/persistentStorage.js';

const PORTFOLIO_NAMES = ['Portfel Makler', 'Portfel IKZE'];
const MAX_COMPACT_COLUMNS = 10;
const SELECTED_COLUMNS_STORAGE_KEY = 'investmentCompactColumns';
const TOTAL_COLUMNS_STORAGE_KEY = 'investmentTotalColumns';

const ASSET_COLUMN_ALIASES = [
    'Akcje i inne instrumenty',
    'Akcje',
    'Instrument',
    'Instrument finansowy',
    'Walor',
    'Ticker',
    'Symbol',
];

const COMPACT_COLUMN_ALIASES = [
    ASSET_COLUMN_ALIASES,
    ['Ilość', 'Ilosc', 'Liczba', 'Sztuki', 'Quantity'],
    ['Kurs kupna', 'Cena kupna', 'Cena zakupu', 'Buy price'],
    ['Koszt całkowity', 'Koszt calkowity', 'Koszt', 'Total cost'],
    ['Aktualny kurs', 'Kurs aktualny', 'Cena aktualna', 'Current price'],
    ['Cena sprzedaży brutto', 'Cena sprzedazy brutto', 'Wartość aktualna', 'Wartosc aktualna', 'Market value'],
    ['Dywidenda netto', 'Dywidenda', 'Dividend'],
    ['Zysk netto', 'Net profit'],
    ['Data zakupu', 'Purchase date'],
];

const EXCLUDED_COMPACT_COLUMN_ALIASES = [
    ['Cena kupna brutto', 'Wartość zakupu', 'Wartosc zakupu', 'Purchase value'],
    ['Zysk/Strata', 'Zysk', 'Wynik', 'Profit', 'P/L'],
    ['Strategia', 'Strategy'],
];

const PROFIT_PERCENT_ALIASES = ['Zysk/Strata %', 'Zysk %', 'Wynik %', 'Profit %', 'P/L %'];

const VALUE_ALIASES = [
    'Cena sprzedaży brutto',
    'Cena sprzedazy brutto',
    'Wartość aktualna',
    'Wartosc aktualna',
    'Wartosc',
    'Wartość',
    'Wartość PLN',
    'Wartosc PLN',
    'Value',
    'Kwota',
    'Saldo',
];

const normalizeText = (value) => String(value ?? '')
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

        if (lastComma > -1) return numericText.replace(',', '.');

        return numericText.replace(/\.(?=\d{3}(?:\D|$))/g, '');
    })();

    return parseFloat(numericValue);
};

const formatCurrency = (value) => new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'PLN',
    maximumFractionDigits: 2,
}).format(value);

const getHeaders = (rows) => {
    const headers = [];
    rows.forEach((row) => {
        if (!row || typeof row !== 'object') return;
        Object.keys(row).forEach((key) => {
            if (!headers.includes(key)) headers.push(key);
        });
    });
    return headers;
};

const hasPercentMarker = (value) => String(value ?? '').includes('%');

const matchesAlias = (header, alias) => (
    normalizeText(header) === normalizeText(alias)
    && hasPercentMarker(header) === hasPercentMarker(alias)
);

const findColumn = (headers, aliases) => {
    return headers.find((header) => aliases.some((alias) => matchesAlias(header, alias)));
};

const matchesAliases = (header, aliases) => (
    aliases.some((alias) => matchesAlias(header, alias))
);

const isAssetColumn = (header) => (
    matchesAliases(header, ASSET_COLUMN_ALIASES)
);

const getCompactHeaders = (rows) => {
    const headers = getHeaders(rows);
    const profitPercentHeader = findColumn(headers, PROFIT_PERCENT_ALIASES);
    const excludedHeaders = headers.filter((header) => (
        EXCLUDED_COMPACT_COLUMN_ALIASES.some((aliases) => matchesAliases(header, aliases))
    ));
    const preferredHeaders = COMPACT_COLUMN_ALIASES
        .map((aliases) => findColumn(headers, aliases))
        .filter(Boolean);

    const nonEmptyHeaders = headers.filter((header) => (
        rows.some((row) => String(row?.[header] ?? '').trim())
    ));
    const uniquePreferredHeaders = [...new Set(preferredHeaders)].filter(
        (header) => !excludedHeaders.includes(header) && header !== profitPercentHeader,
    );
    const fallbackHeaders = nonEmptyHeaders.filter((header) => (
        !uniquePreferredHeaders.includes(header)
        && !excludedHeaders.includes(header)
        && header !== profitPercentHeader
    ));
    const columnLimit = profitPercentHeader ? MAX_COMPACT_COLUMNS - 1 : MAX_COMPACT_COLUMNS;
    const compactHeaders = [...uniquePreferredHeaders, ...fallbackHeaders].slice(0, columnLimit);
    const assetHeader = findColumn(headers, ASSET_COLUMN_ALIASES);
    const orderedHeaders = assetHeader
        ? [assetHeader, ...compactHeaders.filter((header) => header !== assetHeader)]
        : compactHeaders;

    return [
        ...orderedHeaders,
        ...(profitPercentHeader ? [profitPercentHeader] : []),
    ].slice(0, MAX_COMPACT_COLUMNS);
};

const getSelectedHeaders = (rows, selectedHeaders) => {
    const headers = getHeaders(rows);
    const defaultHeaders = getCompactHeaders(rows);
    const configuredHeaders = Array.isArray(selectedHeaders) && selectedHeaders.length > 0
        ? selectedHeaders.filter((header) => headers.includes(header))
        : defaultHeaders;
    const assetHeader = findColumn(headers, ASSET_COLUMN_ALIASES);

    if (!assetHeader || !configuredHeaders.includes(assetHeader)) {
        return configuredHeaders;
    }

    return [
        assetHeader,
        ...configuredHeaders.filter((header) => header !== assetHeader),
    ];
};

const getSelectedTotalHeaders = (rows, selectedTotalHeaders) => {
    const headers = getHeaders(rows);
    return Array.isArray(selectedTotalHeaders)
        ? selectedTotalHeaders.filter((header) => headers.includes(header))
        : [];
};

const getColumnTotal = (rows, header) => {
    const values = rows
        .map((row) => parseNumericValue(row?.[header]))
        .filter(Number.isFinite);

    if (values.length === 0) return null;

    return values.reduce((sum, value) => sum + value, 0);
};

const formatTotalValue = (header, value) => {
    if (value === null) return '';
    const formattedValue = new Intl.NumberFormat('pl-PL', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);

    return hasPercentMarker(header) ? `${formattedValue}%` : formattedValue;
};

const parseAssetCell = (value) => {
    const rawValue = String(value ?? '').trim();
    if (!rawValue) return { label: '', quote: '', url: '' };

    const [quote, ...nameParts] = rawValue.split(/\s+/);
    const label = nameParts.join(' ').trim() || rawValue;

    return {
        label,
        quote,
        url: quote ? `https://www.google.com/finance/beta/quote/${quote}` : '',
    };
};

const DetailsButton = ({ onOpenDetails }) => (
    <button
        type="button"
        onClick={(event) => {
            event.stopPropagation();
            onOpenDetails?.();
        }}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-700/60 bg-slate-950/60 text-slate-500 transition-colors hover:border-blue-500/40 hover:bg-blue-500/10 hover:text-blue-300"
        title="Pokaz szczegoly inwestycji"
        aria-label="Pokaz szczegoly inwestycji"
    >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 18a6 6 0 100-12 6 6 0 000 12z" />
        </svg>
    </button>
);

const TableCell = ({ header, value, onOpenDetails }) => {
    if (matchesAliases(header, PROFIT_PERCENT_ALIASES)) {
        const numericValue = parseNumericValue(value);
        const valueColor = !Number.isFinite(numericValue)
            ? 'text-slate-300'
            : numericValue > 0
                ? 'text-emerald-400'
                : numericValue < 0
                    ? 'text-rose-400'
                    : 'text-slate-300';

        return (
            <span className={`font-mono font-semibold ${valueColor}`}>
                {value ?? ''}
            </span>
        );
    }

    if (!isAssetColumn(header)) {
        return <>{value ?? ''}</>;
    }

    const asset = parseAssetCell(value);
    if (!asset.url) {
        return (
            <span className="inline-flex items-center gap-2">
                {onOpenDetails && <DetailsButton onOpenDetails={onOpenDetails} />}
                <span>{asset.label}</span>
            </span>
        );
    }

    return (
        <span className="inline-flex items-center gap-2">
            {onOpenDetails && <DetailsButton onOpenDetails={onOpenDetails} />}
            <a
                href={asset.url}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-blue-300 hover:text-blue-200 hover:underline underline-offset-4"
                title={asset.quote}
                onClick={(event) => event.stopPropagation()}
            >
                {asset.label}
            </a>
        </span>
    );
};

const getPortfolioRows = (liveData, portfolioName) => {
    if (!liveData || typeof liveData !== 'object') return [];

    const matchingKey = Object.keys(liveData).find(
        (key) => normalizeText(key) === normalizeText(portfolioName),
    );
    const rows = matchingKey ? liveData[matchingKey] : [];

    return Array.isArray(rows) ? rows.filter((row) => row && typeof row === 'object') : [];
};

const getPortfolioSummary = (rows) => {
    const headers = getHeaders(rows);
    const valueHeader = findColumn(headers, VALUE_ALIASES);
    if (!valueHeader) return { count: rows.length, totalValue: null };

    const totalValue = rows.reduce((sum, row) => {
        const value = parseNumericValue(row[valueHeader]);
        return Number.isFinite(value) ? sum + value : sum;
    }, 0);

    return { count: rows.length, totalValue };
};

const FullTableModal = ({
    portfolioName,
    rows,
    selectedHeaders,
    selectedTotalHeaders,
    onToggleColumn,
    onToggleTotalColumn,
    onOpenDetails,
    onClose,
}) => {
    useEffect(() => {
        const handleEscape = (event) => {
            if (event.key === 'Escape') onClose();
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [onClose]);

    const headers = getHeaders(rows);
    const visibleHeaders = getSelectedHeaders(rows, selectedHeaders);
    const totalHeaders = getSelectedTotalHeaders(rows, selectedTotalHeaders);

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fadeIn"
            onClick={onClose}
        >
            <div
                className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-2xl w-full max-w-7xl max-h-[90vh] mx-4 overflow-hidden flex flex-col"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="px-6 py-5 border-b border-slate-800/80 bg-slate-900/50 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <h3 className="text-lg font-bold text-white">{portfolioName}</h3>
                        <p className="mt-1 text-xs text-slate-500">{rows.length} pozycji, {headers.length} kolumn</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors"
                        aria-label="Zamknij pelna tabele"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-6 bg-slate-950/40 flex-1 min-h-0">
                    <div className="h-full max-h-[66vh] overflow-auto rounded-xl border border-slate-800/80 bg-slate-950 shadow-inner">
                        <table className="w-full min-w-max text-sm text-left text-slate-400">
                            <thead className="sticky top-0 z-10 text-xs text-slate-300 uppercase bg-slate-900">
                                <tr>
                                    {headers.map((header) => {
                                        const isSelected = visibleHeaders.includes(header);

                                        return (
                                        <th
                                            key={header}
                                            scope="col"
                                            className={`border-b px-5 py-3 font-semibold transition-colors ${
                                                isSelected
                                                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                                                    : 'border-rose-500/20 bg-rose-500/10 text-rose-300'
                                            }`}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => onToggleColumn(header)}
                                                className="w-full text-left uppercase"
                                                aria-pressed={isSelected}
                                                title={isSelected ? 'Widoczna w widoku uproszczonym' : 'Ukryta w widoku uproszczonym'}
                                            >
                                                {header}
                                            </button>
                                        </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50">
                                {rows.map((row, rowIndex) => (
                                    <tr key={rowIndex} className="hover:bg-slate-800/30 transition-colors">
                                        {headers.map((header) => (
                                            <td key={header} className="px-5 py-3 whitespace-nowrap">
                                                <TableCell
                                                    header={header}
                                                    value={row[header]}
                                                    onOpenDetails={isAssetColumn(header) ? () => onOpenDetails(row) : undefined}
                                                />
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="sticky bottom-0 z-10 bg-slate-900 text-xs uppercase text-slate-300">
                                <tr className="border-t border-slate-700">
                                    {headers.map((header, headerIndex) => {
                                        const isTotalSelected = totalHeaders.includes(header);

                                        return (
                                        <td
                                            key={header}
                                            className={`px-5 py-3 font-semibold transition-colors ${
                                                isTotalSelected
                                                    ? 'bg-emerald-500/10 text-emerald-300'
                                                    : 'bg-slate-900 text-slate-500'
                                            }`}
                                        >
                                            <label className="flex items-center gap-2 whitespace-nowrap">
                                                <input
                                                    type="checkbox"
                                                    checked={isTotalSelected}
                                                    onChange={() => onToggleTotalColumn(header)}
                                                    className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-500 accent-emerald-500"
                                                    aria-label={`Sumuj kolumne ${header}`}
                                                />
                                                {headerIndex === 0 ? 'Sumuj w Total' : 'Sumuj'}
                                            </label>
                                        </td>
                                        );
                                    })}
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
};

const InvestmentTable = ({
    portfolioName,
    rows,
    selectedHeaders,
    selectedTotalHeaders,
    onOpenFullTable,
    onOpenDetails,
}) => {
    const compactHeaders = useMemo(
        () => getSelectedHeaders(rows, selectedHeaders),
        [rows, selectedHeaders],
    );
    const totalHeaders = useMemo(
        () => getSelectedTotalHeaders(rows, selectedTotalHeaders),
        [rows, selectedTotalHeaders],
    );
    const totalValues = useMemo(() => totalHeaders.reduce((totals, header) => ({
        ...totals,
        [header]: getColumnTotal(rows, header),
    }), {}), [rows, totalHeaders]);
    const summary = useMemo(() => getPortfolioSummary(rows), [rows]);
    const hasTotalRow = compactHeaders.some((header) => (
        totalHeaders.includes(header) && totalValues[header] !== null
    ));

    if (rows.length === 0) {
        return (
            <div className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-xl p-8 text-center text-slate-400">
                <div className="mx-auto w-12 h-12 bg-slate-800/50 rounded-xl flex items-center justify-center mb-3">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7h18M3 12h18M3 17h18" />
                    </svg>
                </div>
                <p className="text-sm font-medium text-slate-300">{portfolioName}</p>
                <p className="text-xs text-slate-500 mt-1">Brak danych dla tego zakresu w Dane Live i Dane dummy.</p>
            </div>
        );
    }

    return (
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden transition-all hover:border-slate-700/70">
            <div className="px-6 py-5 border-b border-slate-800/80 bg-slate-900/50 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <h2 className="text-lg font-bold text-white">{portfolioName}</h2>
                    <p className="text-xs text-slate-500 mt-0.5">Widok skrocony na podstawie Dane Live z fallbackiem Dane dummy</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs font-semibold bg-slate-800 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700/50">
                        {summary.count} pozycji
                    </span>
                    {summary.totalValue !== null && (
                        <span className="font-mono font-bold text-sm text-blue-400 bg-blue-500/10 border border-blue-500/20 px-4 py-2 rounded-xl shadow-inner">
                            Suma: {formatCurrency(summary.totalValue)}
                        </span>
                    )}
                    <button
                        onClick={onOpenFullTable}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 font-medium text-xs rounded-lg transition-colors bg-blue-600 text-white hover:bg-blue-500"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m4 0v-4m0 4l-5-5" />
                        </svg>
                        Pelna tabela
                    </button>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-slate-400">
                    <thead className="text-xs text-slate-300 uppercase bg-slate-800/50">
                        <tr>
                            {compactHeaders.map((header) => (
                                <th key={header} scope="col" className="px-6 py-3 font-semibold">
                                    {header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                        {rows.map((row, rowIndex) => (
                            <tr key={rowIndex} className="hover:bg-slate-800/30 transition-colors">
                                {compactHeaders.map((header) => (
                                    <td key={header} className="px-6 py-4 whitespace-nowrap">
                                        <TableCell
                                            header={header}
                                            value={row[header]}
                                            onOpenDetails={isAssetColumn(header) ? () => onOpenDetails(row) : undefined}
                                        />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                    {hasTotalRow && (
                        <tfoot className="border-t border-slate-700 bg-slate-950/60">
                            <tr>
                                {compactHeaders.map((header, headerIndex) => {
                                    const totalValue = totalHeaders.includes(header) ? totalValues[header] : null;

                                    return (
                                    <td key={header} className="px-6 py-4 whitespace-nowrap font-mono text-sm font-semibold text-slate-200">
                                        {headerIndex === 0
                                            ? 'Suma wybranych kolumn'
                                            : formatTotalValue(header, totalValue)}
                                    </td>
                                    );
                                })}
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    );
};

const Investments = () => {
    const liveData = useLiveData();
    const [activeModal, setActiveModal] = useState(null);
    const [activeInvestment, setActiveInvestment] = useState(null);
    const [selectedColumnsByPortfolio, setSelectedColumnsByPortfolio] = useState(() => {
        return readPersistentJson(SELECTED_COLUMNS_STORAGE_KEY, {});
    });
    const [totalColumnsByPortfolio, setTotalColumnsByPortfolio] = useState(() => {
        return readPersistentJson(TOTAL_COLUMNS_STORAGE_KEY, {});
    });

    useEffect(() => {
        void writePersistentJson(SELECTED_COLUMNS_STORAGE_KEY, selectedColumnsByPortfolio);
    }, [selectedColumnsByPortfolio]);

    useEffect(() => {
        void writePersistentJson(TOTAL_COLUMNS_STORAGE_KEY, totalColumnsByPortfolio);
    }, [totalColumnsByPortfolio]);

    const portfolios = useMemo(() => PORTFOLIO_NAMES.map((name) => ({
        name,
        rows: getPortfolioRows(liveData, name),
    })), [liveData]);

    const foundCount = portfolios.filter((portfolio) => portfolio.rows.length > 0).length;

    const toggleCompactColumn = (portfolioName, header) => {
        setSelectedColumnsByPortfolio((currentSelections) => {
            const portfolio = portfolios.find((item) => item.name === portfolioName);
            const currentHeaders = getSelectedHeaders(
                portfolio?.rows ?? [],
                currentSelections[portfolioName],
            );
            const nextHeaders = currentHeaders.includes(header)
                ? currentHeaders.filter((selectedHeader) => selectedHeader !== header)
                : [...currentHeaders, header];

            return {
                ...currentSelections,
                [portfolioName]: nextHeaders,
            };
        });
    };

    const toggleTotalColumn = (portfolioName, header) => {
        setTotalColumnsByPortfolio((currentSelections) => {
            const portfolio = portfolios.find((item) => item.name === portfolioName);
            const currentHeaders = getSelectedTotalHeaders(
                portfolio?.rows ?? [],
                currentSelections[portfolioName],
            );
            const nextHeaders = currentHeaders.includes(header)
                ? currentHeaders.filter((selectedHeader) => selectedHeader !== header)
                : [...currentHeaders, header];

            return {
                ...currentSelections,
                [portfolioName]: nextHeaders,
            };
        });
    };

    return (
        <div className="p-8 max-w-[1600px] mx-auto animate-fadeIn">
            <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                        Inwestycje
                    </h1>
                    <p className="text-slate-400 text-sm mt-1">Pozycje z zakresow Portfel Makler oraz Portfel IKZE pobranych z Dane Live lub Dane dummy.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <span className="text-xs font-semibold bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-lg border border-emerald-500/20">
                        {foundCount}/2 portfele znalezione
                    </span>
                    <button
                        onClick={notifyLiveDataChanged}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 font-medium text-xs rounded-lg transition-colors bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700/50"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v6h6M20 20v-6h-6M5 19A9 9 0 0019 5M19 5h-5m5 0v5" />
                        </svg>
                        Odswiez widok
                    </button>
                </div>
            </div>

            {!liveData && (
                <div className="mb-8 p-4 rounded-xl border flex items-center gap-3 text-sm font-medium bg-amber-500/10 border-amber-500/20 text-amber-300">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Brak zapisanych danych. Najpierw pobierz zakresy w Dane Live albo zapisz fallback w Ustawieniach jako Dane dummy.
                </div>
            )}

            <div className="grid grid-cols-1 gap-8">
                {portfolios.map((portfolio) => (
                    <InvestmentTable
                        key={portfolio.name}
                        portfolioName={portfolio.name}
                        rows={portfolio.rows}
                        selectedHeaders={selectedColumnsByPortfolio[portfolio.name]}
                        selectedTotalHeaders={totalColumnsByPortfolio[portfolio.name]}
                        onOpenFullTable={() => setActiveModal(portfolio)}
                        onOpenDetails={(row) => setActiveInvestment({
                            portfolioName: portfolio.name,
                            row,
                            portfolioRows: portfolio.rows,
                        })}
                    />
                ))}
            </div>

            {activeModal && (
                <FullTableModal
                    portfolioName={activeModal.name}
                    rows={activeModal.rows}
                    selectedHeaders={selectedColumnsByPortfolio[activeModal.name]}
                    selectedTotalHeaders={totalColumnsByPortfolio[activeModal.name]}
                    onToggleColumn={(header) => toggleCompactColumn(activeModal.name, header)}
                    onToggleTotalColumn={(header) => toggleTotalColumn(activeModal.name, header)}
                    onOpenDetails={(row) => setActiveInvestment({
                        portfolioName: activeModal.name,
                        row,
                        portfolioRows: activeModal.rows,
                    })}
                    onClose={() => setActiveModal(null)}
                />
            )}

            {activeInvestment && (
                <InvestmentDetailsModal
                    portfolioName={activeInvestment.portfolioName}
                    row={activeInvestment.row}
                    portfolioRows={activeInvestment.portfolioRows}
                    onClose={() => setActiveInvestment(null)}
                />
            )}
        </div>
    );
};

export default Investments;
