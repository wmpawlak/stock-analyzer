import { normalizeText, parseNumericValue } from './number.js';

export const ASSET_COLUMN_ALIASES = [
  'Akcje i inne instrumenty',
  'Akcje',
  'Instrument',
  'Instrument finansowy',
  'Walor',
  'Ticker',
  'Symbol',
];

export const PROFIT_PERCENT_ALIASES = ['Zysk/Strata %', 'Zysk %', 'Wynik %', 'Profit %', 'P/L %'];

export const VALUE_ALIASES = [
  'Cena sprzedazy brutto',
  'Cena sprzedaży brutto',
  'Wartosc aktualna',
  'Wartość aktualna',
  'Wartosc',
  'Wartość',
  'Wartosc PLN',
  'Wartość PLN',
  'Value',
  'Market value',
  'Kwota',
  'Saldo',
];

export const METRIC_DEFINITIONS = {
  peRatio: 'Cena akcji podzielona przez zysk na akcje. Pomaga ocenic, ile rynek placi za jednostke zysku.',
  eps: 'Zysk netto przypadajacy na jedna akcje.',
  dividendYield: 'Roczna dywidenda jako procent ceny akcji.',
  beta: 'Wrazliwosc ceny akcji na ruch szerokiego rynku. Beta powyzej 1 oznacza zwykle wyzsza zmiennosc.',
  priceToBook: 'Cena rynkowa wzgledem wartosci ksiegowej na akcje.',
  priceToSales: 'Cena rynkowa wzgledem przychodow na akcje.',
  roe: 'Zwrot z kapitalu wlasnego. Pokazuje, jak efektywnie firma wykorzystuje kapital akcjonariuszy.',
  payoutRatio: 'Czesc zysku wyplacana akcjonariuszom w formie dywidendy.',
};

const SYMBOL_API_ALIASES = ['Symbol API', 'Alpha Vantage Symbol', 'AV Symbol', 'Symbol', 'Ticker API'];
const QUANTITY_ALIASES = ['Ilosc', 'Ilość', 'Liczba', 'Sztuki', 'Quantity', 'Ilosc jednostek', 'Ilość jednostek'];
const BUY_PRICE_ALIASES = ['Kurs kupna', 'Cena kupna', 'Cena zakupu', 'Buy price'];
const TOTAL_COST_ALIASES = ['Koszt calkowity', 'Koszt całkowity', 'Koszt', 'Total cost'];
const CURRENT_PRICE_ALIASES = ['Aktualny kurs', 'Kurs aktualny', 'Cena aktualna', 'Current price'];
const PROFIT_ALIASES = ['Zysk/Strata', 'Zysk', 'Wynik', 'Profit', 'P/L'];
const DIVIDEND_ALIASES = ['Dywidenda netto', 'Dywidenda', 'Dividend'];
const NET_PROFIT_ALIASES = ['Zysk netto', 'Net profit'];
const PURCHASE_DATE_ALIASES = ['Data zakupu', 'Purchase date'];

export const hasPercentMarker = (value) => String(value ?? '').includes('%');

export const matchesAlias = (header, alias) => (
  normalizeText(header) === normalizeText(alias)
  && hasPercentMarker(header) === hasPercentMarker(alias)
);

export const matchesAliases = (header, aliases) => (
  aliases.some((alias) => matchesAlias(header, alias))
);

export const findColumn = (headers, aliases) => (
  headers.find((header) => matchesAliases(header, aliases))
);

export const getHeaders = (rows) => {
  const headers = [];
  rows.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    Object.keys(row).forEach((key) => {
      if (!headers.includes(key)) headers.push(key);
    });
  });
  return headers;
};

export const getValueByAliases = (row, aliases) => {
  if (!row || typeof row !== 'object') return undefined;
  const header = findColumn(Object.keys(row), aliases);
  return header ? row[header] : undefined;
};

export const parseAssetCell = (value) => {
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

export const resolveInstrument = (row) => {
  const assetValue = getValueByAliases(row, ASSET_COLUMN_ALIASES);
  const asset = parseAssetCell(assetValue);
  const explicitSymbol = String(getValueByAliases(row, SYMBOL_API_ALIASES) ?? '').trim();
  const parsedExplicitSymbol = parseAssetCell(explicitSymbol);
  const symbol = parsedExplicitSymbol.quote || explicitSymbol || asset.quote;

  return {
    label: asset.label || parsedExplicitSymbol.label || symbol || 'Instrument',
    quote: asset.quote || parsedExplicitSymbol.quote || symbol,
    symbol,
    url: asset.url || (symbol ? `https://www.google.com/finance/beta/quote/${symbol}` : ''),
  };
};

const finiteOrNull = (value) => (Number.isFinite(value) ? value : null);

const readNumericMetric = (row, aliases) => finiteOrNull(parseNumericValue(getValueByAliases(row, aliases)));

const parsePurchaseDate = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  }

  const polishMatch = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (polishMatch) {
    return new Date(Number(polishMatch[3]), Number(polishMatch[2]) - 1, Number(polishMatch[1]));
  }

  const parsedDate = new Date(text);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

export const getPositionMetrics = (row, portfolioRows = []) => {
  const quantity = readNumericMetric(row, QUANTITY_ALIASES);
  const buyPrice = readNumericMetric(row, BUY_PRICE_ALIASES);
  const totalCost = readNumericMetric(row, TOTAL_COST_ALIASES);
  const currentPrice = readNumericMetric(row, CURRENT_PRICE_ALIASES);
  const marketValue = readNumericMetric(row, VALUE_ALIASES);
  const profitLoss = readNumericMetric(row, PROFIT_ALIASES);
  const dividendNet = readNumericMetric(row, DIVIDEND_ALIASES);
  const netProfit = readNumericMetric(row, NET_PROFIT_ALIASES);
  const profitPercent = readNumericMetric(row, PROFIT_PERCENT_ALIASES);
  const totalResult = [profitLoss, dividendNet].every((value) => value === null)
    ? netProfit
    : (profitLoss ?? 0) + (dividendNet ?? 0);
  const breakEvenPrice = quantity && quantity > 0 && totalCost !== null
    ? (totalCost - (dividendNet ?? 0)) / quantity
    : null;
  const portfolioValue = portfolioRows.reduce((sum, portfolioRow) => {
    const value = readNumericMetric(portfolioRow, VALUE_ALIASES);
    return value === null ? sum : sum + value;
  }, 0);
  const portfolioShare = marketValue !== null && portfolioValue > 0
    ? (marketValue / portfolioValue) * 100
    : null;
  const purchaseDateRaw = getValueByAliases(row, PURCHASE_DATE_ALIASES);
  const purchaseDate = parsePurchaseDate(purchaseDateRaw);
  const positionAgeDays = purchaseDate
    ? Math.max(0, Math.floor((Date.now() - purchaseDate.getTime()) / 86_400_000))
    : null;

  return {
    quantity,
    buyPrice,
    totalCost,
    currentPrice,
    marketValue,
    profitLoss,
    profitPercent,
    dividendNet,
    netProfit,
    totalResult,
    portfolioShare,
    breakEvenPrice,
    positionAgeDays,
    purchaseDate: purchaseDateRaw ? String(purchaseDateRaw) : '',
  };
};

const cleanApiValue = (value) => {
  const text = String(value ?? '').trim();
  if (!text || text === 'None' || text === 'null' || text === '-') return '';
  return text;
};

export const mapAlphaVantageOverview = (overview = {}) => ({
  symbol: cleanApiValue(overview.Symbol),
  name: cleanApiValue(overview.Name),
  description: cleanApiValue(overview.Description),
  sector: cleanApiValue(overview.Sector),
  industry: cleanApiValue(overview.Industry),
  marketCapitalization: cleanApiValue(overview.MarketCapitalization),
  peRatio: cleanApiValue(overview.PERatio),
  eps: cleanApiValue(overview.EPS),
  dividendYield: cleanApiValue(overview.DividendYield),
  beta: cleanApiValue(overview.Beta),
  fiftyTwoWeekHigh: cleanApiValue(overview['52WeekHigh']),
  fiftyTwoWeekLow: cleanApiValue(overview['52WeekLow']),
  priceToBook: cleanApiValue(overview.PriceToBookRatio),
  priceToSales: cleanApiValue(overview.PriceToSalesRatioTTM),
  profitMargin: cleanApiValue(overview.ProfitMargin),
  roe: cleanApiValue(overview.ReturnOnEquityTTM),
  payoutRatio: cleanApiValue(overview.PayoutRatio),
});
