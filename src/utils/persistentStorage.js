const API_BASE = '/api/analysis';

export const PERSISTENT_STATE_CHANGED_EVENT = 'stock-analyzer:persistent-state-changed';
export const PERSISTENT_STATUS_EVENT = 'stock-analyzer:persistent-status';

const STRING_KEYS = new Set([
  'portfolioInputText',
  'portfolioHistoryText',
]);

const JSON_KEYS = new Set([
  'portfolioAssets',
  'stockPortfolios',
  'portfolioHistory',
  'fetchedLiveData',
  'dummyLiveData',
  'liveDataConfigs',
  'portfolioCommissions',
  'investmentAlphaVantageCache',
  'investmentCompactColumns',
  'investmentTotalColumns',
  'spreadsheetId',
  'rangeTable',
  'rangeCharts',
]);

export const PERSISTENT_STATE_KEYS = [...STRING_KEYS, ...JSON_KEYS];

let helperOnline = false;
let lastError = '';

const dispatchStatus = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PERSISTENT_STATUS_EVENT, {
    detail: {
      online: helperOnline,
      cacheOnly: !helperOnline,
      error: lastError,
    },
  }));
};

const markOnline = () => {
  helperOnline = true;
  lastError = '';
  dispatchStatus();
};

const markOffline = (error) => {
  helperOnline = false;
  lastError = error?.message || 'Lokalny helper jest niedostepny. Nowe zmiany sa tylko w cache przegladarki.';
  dispatchStatus();
};

const notifyChanged = (key) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PERSISTENT_STATE_CHANGED_EVENT, { detail: { key } }));
};

const isAllowedKey = (key) => STRING_KEYS.has(key) || JSON_KEYS.has(key);

const readLocal = (key) => {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeLocalValue = (key, value) => {
  if (typeof localStorage === 'undefined') return;
  if (!isAllowedKey(key)) return;
  if (value === undefined || value === null) {
    localStorage.removeItem(key);
    return;
  }
  if (STRING_KEYS.has(key)) {
    localStorage.setItem(key, String(value));
    return;
  }
  localStorage.setItem(key, JSON.stringify(value));
};

const stateRequest = async (path = '/state', options = {}) => {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      Accept: 'application/json',
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Helper zwrocil HTTP ${response.status}.`);
  }
  return payload?.data ?? payload;
};

const snapshotLocalStorage = () => {
  const snapshot = {};
  if (typeof localStorage === 'undefined') return snapshot;
  PERSISTENT_STATE_KEYS.forEach((key) => {
    const value = readLocal(key);
    if (value !== null) snapshot[key] = value;
  });
  return snapshot;
};

const hasSnapshotData = (snapshot) => Object.keys(snapshot).length > 0;

const writeStateToCache = (state = {}) => {
  Object.entries(state).forEach(([key, value]) => writeLocalValue(key, value));
};

export const isPersistentHelperOnline = () => helperOnline;

export const readPersistentJson = (key, fallback = null) => {
  const value = readLocal(key);
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export const readPersistentString = (key, fallback = '') => {
  const value = readLocal(key);
  return value === null || value === undefined ? fallback : value;
};

export const writePersistentJson = (key, value) => {
  writeLocalValue(key, value);
  notifyChanged(key);
  if (!isAllowedKey(key)) return Promise.resolve({ saved: false });
  return stateRequest('/state', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: { [key]: value } }),
  }).then((result) => {
    markOnline();
    return result;
  }).catch((error) => {
    markOffline(error);
    return { saved: false, error };
  });
};

export const writePersistentString = (key, value) => writePersistentJson(key, String(value ?? ''));

export const removePersistentKey = (key) => {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  notifyChanged(key);
  if (!isAllowedKey(key)) return Promise.resolve({ deleted: false });
  return stateRequest(`/state/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  }).then((result) => {
    markOnline();
    return result;
  }).catch((error) => {
    markOffline(error);
    return { deleted: false, error };
  });
};

export const hydratePersistentState = async () => {
  try {
    const result = await stateRequest('/state');
    writeStateToCache(result.state || {});
    markOnline();
    notifyChanged('*');
    return result;
  } catch (error) {
    markOffline(error);
    return { state: {}, empty: true, offline: true, error };
  }
};

export const migrateLocalStorageOnce = async () => {
  const snapshot = snapshotLocalStorage();
  try {
    const current = await stateRequest('/state');
    if (!current.empty) {
      writeStateToCache(current.state || {});
      markOnline();
      notifyChanged('*');
      return { migrated: false, state: current.state || {} };
    }
    if (!hasSnapshotData(snapshot)) {
      markOnline();
      return { migrated: false, state: {} };
    }
    const migrated = await stateRequest('/state/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ localStorage: snapshot }),
    });
    writeStateToCache(migrated.state || {});
    markOnline();
    notifyChanged('*');
    return { migrated: true, ...migrated };
  } catch (error) {
    markOffline(error);
    return { migrated: false, offline: true, error };
  }
};
