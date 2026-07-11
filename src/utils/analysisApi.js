const API_BASE = '/api/analysis';

export class AnalysisApiError extends Error {
  constructor(message, { status = 0, code = 'REQUEST_FAILED' } = {}) {
    super(message);
    this.name = 'AnalysisApiError';
    this.status = status;
    this.code = code;
  }
}

const unwrapData = (payload) => (
  payload && typeof payload === 'object' && Object.hasOwn(payload, 'data')
    ? payload.data
    : payload
);

const asArray = (value, key) => {
  const data = unwrapData(value);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.[key])) return data[key];
  return [];
};

const buildUrl = (path) => `${API_BASE}${path}`;

const apiRequest = async (path, options = {}) => {
  let response;

  try {
    response = await fetch(buildUrl(path), {
      credentials: 'same-origin',
      ...options,
      headers: {
        Accept: 'application/json',
        ...options.headers,
      },
    });
  } catch {
    throw new AnalysisApiError(
      'Lokalny helper analizy nie jest uruchomiony. Zapisane dane portfela nadal są dostępne.',
      { code: 'HELPER_UNAVAILABLE' },
    );
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    throw new AnalysisApiError(
      payload?.error?.message || payload?.message || `Żądanie analizy zakończyło się błędem (${response.status}).`,
      { status: response.status, code: payload?.error?.code || 'API_ERROR' },
    );
  }

  return unwrapData(payload);
};

const jsonRequest = (path, { method = 'POST', body, ...options } = {}) => apiRequest(path, {
  method,
  ...options,
  headers: {
    'Content-Type': 'application/json',
    ...options.headers,
  },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const analysisApi = {
  getHealth: () => apiRequest('/health'),
  getState: () => apiRequest('/state'),
  updateState: (state) => jsonRequest('/state', {
    method: 'PATCH',
    body: { state },
  }),
  deleteStateKey: (key) => apiRequest(`/state/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  migrateState: (localStorageSnapshot) => jsonRequest('/state/migrate', {
    body: { localStorage: localStorageSnapshot },
  }),

  listProfiles: async () => asArray(await apiRequest('/profiles'), 'profiles'),
  createProfile: (profile) => jsonRequest('/profiles', { body: profile }),
  getProfile: (assetId) => apiRequest(`/profiles/${encodeURIComponent(assetId)}`),
  updateProfile: (assetId, changes) => jsonRequest(`/profiles/${encodeURIComponent(assetId)}`, {
    method: 'PATCH',
    body: changes,
  }),
  syncProfiles: (positions) => jsonRequest('/profiles/sync', { body: { positions } }),

  listSources: async (assetId) => asArray(
    await apiRequest(`/profiles/${encodeURIComponent(assetId)}/sources`),
    'sources',
  ),
  addSource: (assetId, source) => jsonRequest(`/profiles/${encodeURIComponent(assetId)}/sources`, { body: source }),
  updateSource: (assetId, sourceId, source) => jsonRequest(
    `/profiles/${encodeURIComponent(assetId)}/sources/${encodeURIComponent(sourceId)}`,
    { method: 'PATCH', body: source },
  ),
  deleteSource: (assetId, sourceId) => apiRequest(
    `/profiles/${encodeURIComponent(assetId)}/sources/${encodeURIComponent(sourceId)}`,
    { method: 'DELETE' },
  ),

  listDocuments: async (assetId) => asArray(
    await apiRequest(`/profiles/${encodeURIComponent(assetId)}/documents`),
    'documents',
  ),
  downloadDocument: (assetId, document) => jsonRequest(
    `/profiles/${encodeURIComponent(assetId)}/documents/download`,
    { body: document },
  ),
  importDocument: (assetId, file, metadata = {}) => apiRequest(
    `/profiles/${encodeURIComponent(assetId)}/documents/import`,
    {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
        'X-Document-Title': encodeURIComponent(metadata.title || file.name),
        'X-Document-Type': encodeURIComponent(metadata.type || ''),
        'X-Reporting-Period': encodeURIComponent(metadata.period || ''),
      },
      body: file,
    },
  ),
  deleteDocument: (documentId) => apiRequest(`/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' }),
  getDocumentDownloadUrl: (documentId) => buildUrl(`/documents/${encodeURIComponent(documentId)}/download`),

  listCandidates: async (assetId) => asArray(
    await apiRequest(`/profiles/${encodeURIComponent(assetId)}/candidates`),
    'candidates',
  ),
  discoverCandidates: (assetId, options = {}) => jsonRequest(
    `/profiles/${encodeURIComponent(assetId)}/candidates/discover`,
    { body: options },
  ),
  approveCandidate: (assetId, candidateId, options = {}) => jsonRequest(
    `/profiles/${encodeURIComponent(assetId)}/candidates/${encodeURIComponent(candidateId)}/approve`,
    { body: options },
  ),

  listAnalyses: async (assetId) => asArray(
    await apiRequest(`/profiles/${encodeURIComponent(assetId)}/analyses`),
    'analyses',
  ),
  runAnalysis: (assetId, options) => jsonRequest(`/profiles/${encodeURIComponent(assetId)}/analyses`, {
    body: options,
  }),
  approveAnalysis: (analysisId) => jsonRequest(`/analyses/${encodeURIComponent(analysisId)}/approve`, { body: {} }),

  getBudget: () => apiRequest('/budget'),
  updateBudget: (monthlyLimitUsd) => jsonRequest('/budget', {
    method: 'PATCH',
    body: { monthlyLimitUsd },
  }),

  exportBackup: (browserState) => jsonRequest('/backup/export', { body: { browserState } }),
  importBackup: (file) => apiRequest('/backup/import', {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/zip',
      'X-File-Name': encodeURIComponent(file.name),
    },
    body: file,
  }),
};

export const isHelperUnavailable = (error) => (
  error instanceof AnalysisApiError && error.code === 'HELPER_UNAVAILABLE'
);
