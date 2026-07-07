import { mapAlphaVantageOverview } from './investmentDetails.js';

const CACHE_KEY = 'investmentAlphaVantageCache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const OVERVIEW_URL = 'https://www.alphavantage.co/query';

const readCache = () => {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    return cached ? JSON.parse(cached) : {};
  } catch {
    return {};
  }
};

const writeCache = (cache) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Cache is an optimization; failed storage should not block the modal.
  }
};

export const getAlphaVantageApiKey = () => (
  import.meta.env.VITE_ALPHA_VANTAGE_API_KEY || ''
);

export const getCachedAlphaVantageOverview = (symbol) => {
  const normalizedSymbol = String(symbol ?? '').trim().toUpperCase();
  if (!normalizedSymbol) return null;

  const cache = readCache();
  const entry = cache[normalizedSymbol];
  if (!entry || Date.now() - entry.cachedAt > CACHE_TTL_MS) return null;

  return entry.data;
};

export const fetchAlphaVantageOverview = async (symbol, apiKey = getAlphaVantageApiKey()) => {
  const normalizedSymbol = String(symbol ?? '').trim().toUpperCase();
  if (!normalizedSymbol) {
    return { data: null, status: 'missing-symbol', message: 'Brak symbolu instrumentu.' };
  }

  if (!apiKey) {
    return { data: null, status: 'missing-key', message: 'Brak VITE_ALPHA_VANTAGE_API_KEY.' };
  }

  const cachedData = getCachedAlphaVantageOverview(normalizedSymbol);
  if (cachedData) {
    return { data: cachedData, status: 'cached', message: 'Dane z cache.' };
  }

  const params = new URLSearchParams({
    function: 'OVERVIEW',
    symbol: normalizedSymbol,
    apikey: apiKey,
  });

  const response = await fetch(`${OVERVIEW_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Alpha Vantage zwrocil status ${response.status}.`);
  }

  const payload = await response.json();
  if (payload.Note || payload.Information) {
    return {
      data: null,
      status: 'limited',
      message: payload.Note || payload.Information,
    };
  }

  if (payload['Error Message']) {
    return { data: null, status: 'error', message: payload['Error Message'] };
  }

  if (!payload.Symbol && Object.keys(payload).length === 0) {
    return { data: null, status: 'empty', message: 'Alpha Vantage nie zwrocil danych dla symbolu.' };
  }

  const data = mapAlphaVantageOverview(payload);
  const cache = readCache();
  cache[normalizedSymbol] = {
    cachedAt: Date.now(),
    data,
  };
  writeCache(cache);

  return { data, status: 'fresh', message: 'Dane pobrane z Alpha Vantage.' };
};
