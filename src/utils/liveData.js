import { normalizeText, parseNumericValue } from './number.js';

export const FETCHED_LIVE_DATA_KEY = 'fetchedLiveData';
export const LIVE_DATA_CHANGED_EVENT = 'stock-analyzer:live-data-changed';
export const LIVE_ASSETS_KEY = 'Podsumowanie aktywów';

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
