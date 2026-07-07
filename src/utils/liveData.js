import { normalizeText, parseNumericValue } from './number.js';
import { getChartDateValue } from '../components/portfolio/chartConfig.js';

export const FETCHED_LIVE_DATA_KEY = 'fetchedLiveData';
export const DUMMY_LIVE_DATA_KEY = 'dummyLiveData';
export const LIVE_DATA_CHANGED_EVENT = 'stock-analyzer:live-data-changed';
export const LIVE_ASSETS_KEY = 'Podsumowanie aktyw\u00f3w';
export const LIVE_ASSET_CATEGORY_HISTORY_KEY = 'Historia kategorii aktyw\u00f3w';
export const LIVE_PORTFOLIO_HISTORY_KEY = 'Historia wyceny portfela';
export const LIVE_NET_WORTH_KEY = 'Warto\u015b\u0107 netto';
const PORTFOLIO_HISTORY_DATE_ALIASES = ['Data', 'Miesi\u0105c', 'Miesiac', 'Okres', 'Date', 'Month'];
const PORTFOLIO_HISTORY_VALUE_ALIASES = [
  'Warto\u015b\u0107',
  'Wartosc',
  'Warto\u015b\u0107 portfela',
  'Wartosc portfela',
  'Warto\u015b\u0107 PLN',
  'Wartosc PLN',
  'Value',
];
const PORTFOLIO_HISTORY_PAID_ALIASES = [
  'Wp\u0142acone \u0142\u0105cz.',
  'Wplacone lacz.',
  'Wp\u0142acone \u0142\u0105cznie',
  'Wplacone lacznie',
  'Wp\u0142aty',
  'Wplaty',
  'Paid',
];
const PORTFOLIO_HISTORY_DIFF_ALIASES = [
  'R\u00f3\u017cnica',
  'Roznica',
  'Zysk / Strata',
  'Zysk/Strata',
  'Wynik',
  'Profit',
  'Difference',
];
const NET_WORTH_DATE_ALIASES = ['Data', 'Miesi\u0105c', 'Miesiac', 'Okres', 'Date', 'Month'];
const NET_WORTH_VALUE_ALIASES = [
  'Warto\u015b\u0107 netto',
  'Wartosc netto',
  'Warto\u015b\u0107',
  'Wartosc',
  'Warto\u015b\u0107 PLN',
  'Wartosc PLN',
  'Netto',
  'Net worth',
];
const NET_WORTH_GROWTH_ALIASES = ['Wzrost', 'Przyrost', 'Zmiana', 'Growth'];

const findColumn = (keys, aliases) => {
  const normalizedAliases = aliases.map(normalizeText);
  return keys.find((key) => normalizedAliases.includes(normalizeText(key)));
};

const readStoredJson = (key) => {
  try {
    const savedData = localStorage.getItem(key);
    return savedData ? JSON.parse(savedData) : null;
  } catch {
    return null;
  }
};

const hasUsableRows = (rows) => (
  Array.isArray(rows)
  && rows.some((row) => row && typeof row === 'object' && Object.keys(row).length > 0)
);

export const mergeLiveDataWithFallback = (liveData, dummyData) => {
  const mergedData = {};
  const keyByNormalizedName = new Map();

  if (dummyData && typeof dummyData === 'object') {
    Object.entries(dummyData).forEach(([key, rows]) => {
      if (!hasUsableRows(rows)) return;

      mergedData[key] = rows;
      keyByNormalizedName.set(normalizeText(key), key);
    });
  }

  if (liveData && typeof liveData === 'object') {
    Object.entries(liveData).forEach(([key, rows]) => {
      if (!hasUsableRows(rows)) return;

      const normalizedKey = normalizeText(key);
      const fallbackKey = keyByNormalizedName.get(normalizedKey);
      if (fallbackKey && fallbackKey !== key) {
        delete mergedData[fallbackKey];
      }

      mergedData[key] = rows;
      keyByNormalizedName.set(normalizedKey, key);
    });
  }

  return Object.keys(mergedData).length > 0 ? mergedData : null;
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
    const valueKey = findColumn(keys, ['Warto\u015b\u0107', 'Warto\u015b\u0107 PLN', 'Value', 'Kwota', 'Saldo']);
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
    data: data.sort((a, b) => getChartDateValue(a.date) - getChartDateValue(b.date)),
    categories,
  };
};

export const getPortfolioHistoryFromLiveData = (liveData) => {
  if (!liveData || typeof liveData !== 'object') return { data: [], found: false, columns: [] };

  const historyKey = Object.keys(liveData).find(
    (key) => normalizeText(key) === normalizeText(LIVE_PORTFOLIO_HISTORY_KEY),
  );
  const rows = historyKey ? liveData[historyKey] : null;
  if (!Array.isArray(rows)) return { data: [], found: Boolean(historyKey), columns: [] };

  const columns = rows.reduce((headers, row) => {
    if (headers.length > 0 || !row || typeof row !== 'object') return headers;
    return Object.keys(row);
  }, []);

  const resolvedKeys = rows.reduce((foundKeys, row) => {
    if (!row || typeof row !== 'object') return foundKeys;

    const keys = Object.keys(row);
    const dateKey = foundKeys.dateKey || findColumn(keys, PORTFOLIO_HISTORY_DATE_ALIASES) || keys[0];
    const valueKey = foundKeys.valueKey || findColumn(keys, PORTFOLIO_HISTORY_VALUE_ALIASES);
    const paidKey = foundKeys.paidKey || findColumn(keys, PORTFOLIO_HISTORY_PAID_ALIASES);
    const diffKey = foundKeys.diffKey || findColumn(keys, PORTFOLIO_HISTORY_DIFF_ALIASES);
    const fallbackValueKey = foundKeys.fallbackValueKey || keys.find((key) => (
      key !== dateKey
      && key !== paidKey
      && key !== diffKey
      && Number.isFinite(parseNumericValue(row[key]))
    ));

    return {
      dateKey,
      valueKey,
      paidKey,
      diffKey,
      fallbackValueKey,
    };
  }, {
    dateKey: null,
    valueKey: null,
    paidKey: null,
    diffKey: null,
    fallbackValueKey: null,
  });

  const valueKey = resolvedKeys.valueKey || resolvedKeys.fallbackValueKey;
  if (!resolvedKeys.dateKey || !valueKey) return { data: [], found: true, columns };

  const data = rows.map((row) => {
    const date = String(row?.[resolvedKeys.dateKey] ?? '').trim();
    const wartosc = parseNumericValue(row?.[valueKey]);
    const wplacone = parseNumericValue(row?.[resolvedKeys.paidKey]);
    const roznica = parseNumericValue(row?.[resolvedKeys.diffKey]);

    return {
      date,
      wartosc,
      wplacone: Number.isFinite(wplacone) ? wplacone : 0,
      roznica: Number.isFinite(roznica) ? roznica : 0,
    };
  }).filter((point) => point.date && Number.isFinite(point.wartosc));

  return {
    found: true,
    columns,
    data: data.sort((a, b) => getChartDateValue(a.date) - getChartDateValue(b.date)),
  };
};

export const getNetWorthHistoryFromLiveData = (liveData) => {
  if (!liveData || typeof liveData !== 'object') return { data: [], found: false, columns: [] };

  const historyKey = Object.keys(liveData).find(
    (key) => normalizeText(key) === normalizeText(LIVE_NET_WORTH_KEY),
  );
  const rows = historyKey ? liveData[historyKey] : null;
  if (!Array.isArray(rows)) return { data: [], found: Boolean(historyKey), columns: [] };

  const columns = rows.reduce((headers, row) => {
    if (headers.length > 0 || !row || typeof row !== 'object') return headers;
    return Object.keys(row);
  }, []);

  const resolvedKeys = rows.reduce((foundKeys, row) => {
    if (!row || typeof row !== 'object') return foundKeys;

    const keys = Object.keys(row);
    const dateKey = foundKeys.dateKey || findColumn(keys, NET_WORTH_DATE_ALIASES) || keys[0];
    const growthKey = foundKeys.growthKey || findColumn(keys, NET_WORTH_GROWTH_ALIASES);
    const valueKey = foundKeys.valueKey || findColumn(keys, NET_WORTH_VALUE_ALIASES);
    const fallbackValueKey = foundKeys.fallbackValueKey || keys.find((key) => (
      key !== dateKey
      && key !== growthKey
      && Number.isFinite(parseNumericValue(row[key]))
    ));

    return {
      dateKey,
      growthKey,
      valueKey,
      fallbackValueKey,
    };
  }, {
    dateKey: null,
    growthKey: null,
    valueKey: null,
    fallbackValueKey: null,
  });

  const valueKey = resolvedKeys.valueKey || resolvedKeys.fallbackValueKey;
  if (!resolvedKeys.dateKey || !valueKey) return { data: [], found: true, columns };

  const data = rows.map((row) => {
    const date = String(row?.[resolvedKeys.dateKey] ?? '').trim();
    const value = parseNumericValue(row?.[valueKey]);
    const growth = parseNumericValue(row?.[resolvedKeys.growthKey]);

    return {
      date,
      value: Number.isFinite(value) ? value : 0,
      growth: Number.isFinite(growth) ? growth : 0,
    };
  }).filter((point) => point.date);

  return {
    found: true,
    columns,
    data: data.sort((a, b) => getChartDateValue(a.date) - getChartDateValue(b.date)),
  };
};

export const readStoredLiveData = () => {
  return readStoredJson(FETCHED_LIVE_DATA_KEY);
};

export const readStoredDummyData = () => {
  return readStoredJson(DUMMY_LIVE_DATA_KEY);
};

export const readStoredResolvedLiveData = () => {
  return mergeLiveDataWithFallback(readStoredLiveData(), readStoredDummyData());
};

export const notifyLiveDataChanged = () => {
  window.dispatchEvent(new Event(LIVE_DATA_CHANGED_EVENT));
};
