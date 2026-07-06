import { normalizeText, parseNumericValue } from './number.js';

export const FETCHED_LIVE_DATA_KEY = 'fetchedLiveData';
export const LIVE_DATA_CHANGED_EVENT = 'stock-analyzer:live-data-changed';
export const LIVE_ASSETS_KEY = 'Podsumowanie aktywów';
export const LIVE_ASSET_CATEGORY_HISTORY_KEY = 'Historia kategorii aktywów';

const findColumn = (keys, aliases) => {
  const normalizedAliases = aliases.map(normalizeText);
  return keys.find((key) => normalizedAliases.includes(normalizeText(key)));
};

export const getLiveAssetsFromLiveData = (liveData) => {
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
};

export const getAssetCategoryHistoryFromLiveData = (liveData) => {
  if (!liveData || typeof liveData !== 'object') return { data: [], categories: [] };

  const historyKey = Object.keys(liveData).find(
    (key) => normalizeText(key) === normalizeText(LIVE_ASSET_CATEGORY_HISTORY_KEY),
  );
  const rows = historyKey ? liveData[historyKey] : null;
  if (!Array.isArray(rows)) return { data: [], categories: [] };

  const dateKey = rows.reduce((foundKey, row) => {
    if (foundKey || !row || typeof row !== 'object') return foundKey;
    return Object.keys(row).find((key) => normalizeText(key) === 'data') || null;
  }, null);

  if (!dateKey) return { data: [], categories: [] };

  const categories = rows.reduce((headers, row) => {
    if (!row || typeof row !== 'object') return headers;

    Object.keys(row).forEach((key) => {
      if (key !== dateKey && !headers.includes(key)) headers.push(key);
    });

    return headers;
  }, []);

  const data = rows.map((row) => {
    const point = { date: String(row?.[dateKey] ?? '').trim() };

    categories.forEach((category) => {
      const value = parseNumericValue(row?.[category]);
      point[category] = Number.isFinite(value) ? value : 0;
    });

    return point;
  }).filter((point) => point.date);

  return {
    data: data.sort((a, b) => new Date(a.date) - new Date(b.date)),
    categories,
  };
};

export const readStoredLiveData = () => {
  try {
    const savedLiveData = localStorage.getItem(FETCHED_LIVE_DATA_KEY);
    return savedLiveData ? JSON.parse(savedLiveData) : null;
  } catch {
    return null;
  }
};

export const notifyLiveDataChanged = () => {
  window.dispatchEvent(new Event(LIVE_DATA_CHANGED_EVENT));
};
