import { DatabaseSync } from 'node:sqlite';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  ANALYZABLE_EXTENSIONS,
  AppError,
  MAX_BACKUP_BYTES,
  MAX_UPLOAD_BYTES,
  asBoolean,
  asFiniteNumber,
  ensureInside,
  extensionOf,
  guessMimeType,
  isAnalyzableFilename,
  isZip,
  monthKey,
  newId,
  nowIso,
  parseJson,
  safeFilename,
  sha256,
  stringOrEmpty,
} from './utils.js';
import { findReportMetricSpec, normalizeMetricText } from './analysisMetricCatalog.js';
import { createStoredZip, extractZipSafely, inspectZip } from './zip.js';

const DATA_VERSION = 1;
const DEFAULT_BUDGET_USD = 10;
const APP_STATE_STRING_KEYS = new Set([
  'portfolioInputText',
  'portfolioHistoryText',
]);
const APP_STATE_SCALAR_KEYS = new Set([
  'spreadsheetId',
  'rangeTable',
  'rangeCharts',
]);
const APP_STATE_JSON_KEYS = new Set([
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
]);
const APP_STATE_KEYS = new Set([
  ...APP_STATE_STRING_KEYS,
  ...APP_STATE_SCALAR_KEYS,
  ...APP_STATE_JSON_KEYS,
]);

const PILOT_PROFILES = [
  {
    assetId: 'company:WSE:CDR',
    type: 'company',
    name: 'CD PROJEKT',
    canonicalId: 'WSE:CDR',
    aliases: ['CDR:WSE', 'CDR'],
    isPilot: true,
    sources: [
      {
        id: 'cdr-periodic-reports',
        title: 'CD PROJEKT — raporty okresowe',
        url: 'https://www.cdprojekt.com/pl/typ-raportu/periodical/',
        role: 'official',
      },
    ],
  },
  {
    assetId: 'etf:IE00BKM4GZ66',
    type: 'etf',
    name: 'iShares Core MSCI EM IMI UCITS ETF USD (Acc)',
    canonicalId: 'IE00BKM4GZ66',
    aliases: ['EIMI:LON', 'EIMI', 'IE00BKM4GZ66'],
    isPilot: true,
    sources: [
      {
        id: 'eimi-ishares-product',
        title: 'iShares — strona funduszu',
        url: 'https://www.ishares.com/uk/individual/en/products/264659/ishares-msci-emerging-markets-imi-ucits-etf?siteEntryPassthrough=true',
        role: 'official',
      },
      {
        id: 'eimi-ishares-factsheet',
        title: 'iShares — factsheet EIMI',
        url: 'https://www.ishares.com/ch/institutional/en/literature/fact-sheet/eimi-ishares-core-msci-em-imi-ucits-etf-fund-fact-sheet-en-gb.pdf',
        role: 'official',
      },
      {
        id: 'eimi-ishares-kid',
        title: 'iShares — KID / PRIIPs',
        url: 'https://www.ishares.com/de/professionelle-anleger/de/literature/kiid/eu-priips-ishares-core-msci-em-imi-ucits-etf-usd-acc-ie00bkm4gz66-en.pdf?siteEntryPassthrough=true&switchLocale=y',
        role: 'official',
      },
      {
        id: 'eimi-atlas',
        title: 'Atlas ETF — karta EIMI',
        url: 'https://atlasetf.pl/etf-details/IE00BKM4GZ66',
        role: 'reference',
      },
    ],
  },
];

const safeAssetId = (value) => {
  const id = stringOrEmpty(value);
  if (!id || id.length > 240 || id.includes('\\') || id.includes('/') || id.includes('\0')) {
    throw new AppError('INVALID_ASSET_ID', 'Nieprawidłowy identyfikator aktywa.', 400);
  }
  return id;
};

const safeUrl = (value) => {
  const url = stringOrEmpty(value);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('invalid');
    return parsed.toString();
  } catch {
    throw new AppError('INVALID_URL', 'Źródło musi mieć poprawny adres http albo https.', 400);
  }
};

const normalizeStringArray = (value) => (
  Array.isArray(value)
    ? [...new Set(value.map((item) => stringOrEmpty(item)).filter(Boolean))].slice(0, 50)
    : []
);

const mapProfile = (row) => {
  if (!row) return null;
  return {
    assetId: row.asset_id,
    type: row.type,
    name: row.name,
    canonicalId: row.canonical_id || '',
    aliases: parseJson(row.aliases_json, []),
    watched: Boolean(row.watched),
    isPilot: Boolean(row.is_pilot),
    portfolios: parseJson(row.portfolios_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const mapSource = (row) => ({
  id: row.id,
  assetId: row.asset_id,
  title: row.title,
  url: row.url,
  role: row.role,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapDocument = (row) => ({
  id: row.id,
  documentId: row.id,
  assetId: row.asset_id,
  parentDocumentId: row.parent_document_id || null,
  sourceId: row.source_id || null,
  title: row.title,
  type: row.type,
  period: row.reporting_period || '',
  publishedAt: row.published_at || null,
  sourceUrl: row.source_url || '',
  filename: row.filename,
  mimeType: row.mime_type,
  format: row.format,
  sizeBytes: row.size_bytes,
  sha256: row.sha256,
  status: row.status,
  analyzable: Boolean(row.analyzable),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapCandidate = (row) => ({
  id: row.id,
  candidateId: row.id,
  assetId: row.asset_id,
  sourceId: row.source_id || null,
  title: row.title,
  url: row.url,
  type: row.type,
  period: row.reporting_period || '',
  publishedAt: row.published_at || null,
  rationale: row.rationale || '',
  status: row.status,
  metadata: parseJson(row.metadata_json, {}),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapAnalysis = (row, { includeContent = true } = {}) => ({
  id: row.id,
  analysisId: row.id,
  assetId: row.asset_id,
  status: row.status,
  title: row.title,
  schemaVersion: row.schema_version,
  documentIds: parseJson(row.document_ids_json, []),
  ...(includeContent ? { content: parseJson(row.content_json, {}) } : {}),
  provider: row.provider,
  model: row.model,
  costUsd: Number(row.cost_usd || 0),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  approvedAt: row.approved_at || null,
});

const mapApprovedReportMetric = (row) => ({
  id: row.id,
  assetId: row.asset_id,
  analysisId: row.analysis_id,
  documentId: row.document_id || '',
  metricKey: row.metric_key,
  label: row.label,
  value: parseJson(row.value_json, null),
  valueNumeric: row.value_numeric === null || row.value_numeric === undefined ? null : Number(row.value_numeric),
  unit: row.unit || '',
  period: row.period,
  page: row.page === null || row.page === undefined ? null : Number(row.page),
  section: row.section || '',
  quote: row.quote || '',
  confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
  aggregation: row.aggregation || '',
  source: parseJson(row.source_json, {}),
  approvedAt: row.approved_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const ensurePlainObject = (value, message) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_INPUT', message, 400);
  return value;
};

const normalizeAnalysisTitle = (value) => {
  const title = stringOrEmpty(value).replace(/\s+/g, ' ').slice(0, 180);
  if (!title) throw new AppError('INVALID_ANALYSIS_TITLE', 'Nazwa analizy nie moze byc pusta.', 400);
  return title;
};

const safeStateKey = (value) => {
  const key = stringOrEmpty(value);
  if (!APP_STATE_KEYS.has(key)) {
    throw new AppError('INVALID_STATE_KEY', 'Ten klucz stanu aplikacji nie moze byc zapisany w lokalnym magazynie.', 400);
  }
  return key;
};

const normalizeStateValue = (key, value) => {
  if (APP_STATE_STRING_KEYS.has(key)) return typeof value === 'string' ? value : String(value ?? '');
  if (value === undefined) throw new AppError('INVALID_STATE_VALUE', 'Wartosc stanu aplikacji nie moze byc pusta.', 400);
  return value;
};

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const normalizePage = (value) => {
  const number = asFiniteNumber(value, null);
  if (number === null) return null;
  const page = Math.trunc(number);
  return page > 0 ? page : null;
};

const normalizeConfidence = (value) => {
  const number = asFiniteNumber(value, null);
  if (number === null) return null;
  return Math.min(1, Math.max(0, number));
};

const normalizeReportMetricPeriod = (period) => {
  const text = stringOrEmpty(period);
  if (!text) return '';

  const isoDate = text.match(/\b((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/);
  const plDate = text.match(/\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.]((?:19|20)\d{2})\b/);
  const dateParts = isoDate
    ? { year: Number(isoDate[1]), month: Number(isoDate[2]), day: Number(isoDate[3]) }
    : plDate
      ? { year: Number(plDate[3]), month: Number(plDate[2]), day: Number(plDate[1]) }
      : null;
  const quarterEnd = dateParts && {
    '3-31': 1,
    '6-30': 2,
    '9-30': 3,
    '12-31': 4,
  }[`${dateParts.month}-${dateParts.day}`];
  if (quarterEnd) return `Q${quarterEnd} ${dateParts.year}`;

  const year = Number((text.match(/(?:19|20)\d{2}/) || [])[0]) || null;
  const quarter = Number((text.match(/q([1-4])/i) || text.match(/([1-4])q/i) || text.match(/([1-4])\s*(?:kw|kwartal)/i))?.[1]) || null;
  return year && quarter ? `Q${quarter} ${year}` : text;
};

const metricFactDocumentId = (fact, documentIds) => (
  stringOrEmpty(fact?.documentId)
  || stringOrEmpty(fact?.document_id)
  || stringOrEmpty(fact?.source?.documentId)
  || (documentIds.length === 1 ? documentIds[0] : '')
);

const moneyAmountInPln = (metric) => {
  const value = asFiniteNumber(metric?.valueNumeric, null);
  if (value === null) return null;
  const unit = normalizeMetricText(metric?.unit);
  if (!unit || (!unit.includes('pln') && !unit.includes('zl'))) return null;
  if (unit.includes('akcj') || unit.includes('share')) return null;
  if (unit.includes('mln') || unit.includes('million')) return value * 1_000_000;
  if (unit.includes('tys') || unit.includes('thousand')) return value * 1_000;
  return value;
};

const bestMetricForKey = (rows, metricKey) => rows
  .filter((metric) => metric.metricKey === metricKey && moneyAmountInPln(metric) !== null)
  .sort((left, right) => (Number(right.confidence || 0) - Number(left.confidence || 0)))[0] || null;

const derivedDividendNetProfitRows = (rows, analysis, timestamp) => {
  const dividendRatioSpec = findReportMetricSpec('dividend_net_profit_ratio');
  const periods = [...new Set(rows.map((metric) => metric.period).filter(Boolean))];

  return periods.flatMap((period) => {
    const periodRows = rows.filter((metric) => metric.period === period);
    const dividend = bestMetricForKey(periodRows, 'dividend_amount');
    const netIncome = bestMetricForKey(periodRows, 'net_income');
    if (!dividend || !netIncome) return [];

    const dividendAmount = moneyAmountInPln(dividend);
    const netIncomeAmount = moneyAmountInPln(netIncome);
    if (dividendAmount === null || netIncomeAmount === null || dividendAmount < 0 || netIncomeAmount <= 0) return [];

    const value = Number(((dividendAmount / netIncomeAmount) * 100).toFixed(2));
    const sharedDocumentId = dividend.documentId && dividend.documentId === netIncome.documentId ? dividend.documentId : '';
    const confidenceValues = [dividend.confidence, netIncome.confidence]
      .map((confidence) => asFiniteNumber(confidence, null))
      .filter((confidence) => confidence !== null);
    const confidence = confidenceValues.length ? Math.min(...confidenceValues) : null;
    const source = {
      derived: true,
      documentId: sharedDocumentId,
      page: null,
      section: 'Wyliczenie aplikacji',
      evidence: 'Wyliczone z zatwierdzonych metryk: dywidenda / zysk netto * 100.',
      inputs: [
        { metricKey: dividend.metricKey, label: dividend.label, value: dividend.valueNumeric, unit: dividend.unit, period: dividend.period, documentId: dividend.documentId },
        { metricKey: netIncome.metricKey, label: netIncome.label, value: netIncome.valueNumeric, unit: netIncome.unit, period: netIncome.period, documentId: netIncome.documentId },
      ],
    };

    return [{
      id: newId('metric'),
      assetId: analysis.asset_id,
      analysisId: analysis.id,
      documentId: sharedDocumentId,
      metricKey: 'dividend_net_profit_ratio',
      label: dividendRatioSpec?.label || 'Dividend/net profit',
      valueJson: JSON.stringify(value),
      valueNumeric: value,
      unit: '%',
      period,
      page: null,
      section: 'Wyliczenie aplikacji',
      quote: source.evidence,
      confidence,
      aggregation: 'derived',
      sourceJson: JSON.stringify(source),
      approvedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    }];
  });
};

const approvedMetricRowsFromAnalysis = (analysis, timestamp) => {
  const content = parseJson(analysis.content_json, {});
  const documentIds = parseJson(analysis.document_ids_json, []);
  const facts = Array.isArray(content.metricFacts) ? content.metricFacts : [];

  const directRows = facts.flatMap((fact) => {
    if (!fact || typeof fact !== 'object' || Array.isArray(fact)) return [];
    const spec = findReportMetricSpec(fact.metricKey) || findReportMetricSpec(fact.label);
    const metricKey = stringOrEmpty(fact.metricKey) || spec?.metricKey || '';
    if (metricKey === 'dividend_net_profit_ratio' || spec?.metricKey === 'dividend_net_profit_ratio') return [];
    const period = normalizeReportMetricPeriod(fact.period) || normalizeReportMetricPeriod(content.reportPeriod);
    if (!metricKey || !period || !hasOwn(fact, 'value')) return [];

    const documentId = metricFactDocumentId(fact, documentIds);
    const page = normalizePage(fact.page);
    const valueNumeric = asFiniteNumber(fact.value, null);
    const source = {
      documentId,
      page,
      section: stringOrEmpty(fact.section),
      evidence: stringOrEmpty(fact.quote),
    };

    return [{
      id: newId('metric'),
      assetId: analysis.asset_id,
      analysisId: analysis.id,
      documentId,
      metricKey,
      label: stringOrEmpty(fact.label) || spec?.label || metricKey,
      valueJson: JSON.stringify(fact.value ?? null),
      valueNumeric,
      unit: stringOrEmpty(fact.unit) || spec?.defaultUnit || '',
      period,
      page,
      section: stringOrEmpty(fact.section),
      quote: stringOrEmpty(fact.quote),
      confidence: normalizeConfidence(fact.confidence),
      aggregation: spec?.aggregation || stringOrEmpty(fact.aggregation),
      sourceJson: JSON.stringify(source),
      approvedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    }];
  });

  return [
    ...directRows,
    ...derivedDividendNetProfitRows(directRows, analysis, timestamp),
  ];
};

const parseLegacyStateValue = (key, value) => {
  if (value === null || value === undefined) return { ok: false };
  if (APP_STATE_STRING_KEYS.has(key)) return { ok: true, value: String(value) };
  if (APP_STATE_SCALAR_KEYS.has(key) && typeof value === 'string') {
    try {
      return { ok: true, value: JSON.parse(value) };
    } catch {
      return { ok: true, value };
    }
  }
  if (typeof value !== 'string') return { ok: true, value };
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
};

const listFilesRecursively = async (root, relative = '') => {
  const directory = ensureInside(root, path.join(root, relative));
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryRelative = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    const absolute = ensureInside(root, path.join(root, ...entryRelative.split('/')));
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursively(root, entryRelative));
    } else if (entry.isFile()) {
      files.push({ relative: entryRelative, absolute });
    } else {
      throw new AppError('UNSAFE_BACKUP_FILE', 'Katalog danych zawiera nieobsługiwany typ pliku.', 400);
    }
  }
  return files;
};

export class AnalysisStore {
  constructor({ dataDir = path.resolve(process.cwd(), 'data'), clock } = {}) {
    this.dataDir = path.resolve(dataDir);
    this.dbPath = ensureInside(this.dataDir, path.join(this.dataDir, 'analysis.sqlite'));
    this.documentsDir = ensureInside(this.dataDir, path.join(this.dataDir, 'documents'));
    this.backupsDir = ensureInside(this.dataDir, path.join(this.dataDir, 'backups'));
    this.tempDir = ensureInside(this.dataDir, path.join(this.dataDir, 'tmp'));
    this.clock = clock || (() => new Date());
    this.db = null;
  }

  async initialize() {
    await Promise.all([
      mkdir(this.dataDir, { recursive: true }),
      mkdir(this.documentsDir, { recursive: true }),
      mkdir(this.backupsDir, { recursive: true }),
      mkdir(this.tempDir, { recursive: true }),
    ]);
    this.openDatabase();
    this.initializeSchema();
    this.seedPilotProfiles();
    return this;
  }

  openDatabase() {
    if (this.db) return;
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE;');
  }

  close() {
    if (this.db) this.db.close();
    this.db = null;
  }

  initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        asset_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        canonical_id TEXT NOT NULL DEFAULT '',
        aliases_json TEXT NOT NULL DEFAULT '[]',
        watched INTEGER NOT NULL DEFAULT 0,
        is_pilot INTEGER NOT NULL DEFAULT 0,
        portfolios_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES profiles(asset_id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(asset_id, url)
      );
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES profiles(asset_id) ON DELETE CASCADE,
        parent_document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
        source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'report',
        reporting_period TEXT NOT NULL DEFAULT '',
        published_at TEXT,
        source_url TEXT NOT NULL DEFAULT '',
        filename TEXT NOT NULL,
        stored_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        format TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'archived',
        analyzable INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(asset_id, sha256, parent_document_id)
      );
      CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES profiles(asset_id) ON DELETE CASCADE,
        source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'report',
        reporting_period TEXT NOT NULL DEFAULT '',
        published_at TEXT,
        rationale TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'candidate',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(asset_id, url)
      );
      CREATE TABLE IF NOT EXISTS analyses (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES profiles(asset_id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'draft',
        title TEXT NOT NULL,
        schema_version TEXT NOT NULL DEFAULT '1.0',
        document_ids_json TEXT NOT NULL DEFAULT '[]',
        content_json TEXT NOT NULL DEFAULT '{}',
        provider TEXT NOT NULL DEFAULT 'perplexity',
        model TEXT NOT NULL DEFAULT 'sonar-pro',
        cost_usd REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        approved_at TEXT
      );
      CREATE TABLE IF NOT EXISTS approved_report_metrics (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES profiles(asset_id) ON DELETE CASCADE,
        analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
        document_id TEXT NOT NULL DEFAULT '',
        metric_key TEXT NOT NULL,
        label TEXT NOT NULL,
        value_json TEXT NOT NULL DEFAULT 'null',
        value_numeric REAL,
        unit TEXT NOT NULL DEFAULT '',
        period TEXT NOT NULL,
        page INTEGER,
        section TEXT NOT NULL DEFAULT '',
        quote TEXT NOT NULL DEFAULT '',
        confidence REAL,
        aggregation TEXT NOT NULL DEFAULT '',
        source_json TEXT NOT NULL DEFAULT '{}',
        approved_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(asset_id, metric_key, period, document_id)
      );
      CREATE TABLE IF NOT EXISTS budget_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        monthly_limit_usd REAL NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS api_usage (
        id TEXT PRIMARY KEY,
        month TEXT NOT NULL,
        action TEXT NOT NULL,
        cost_usd REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_documents_asset ON documents(asset_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_candidates_asset ON candidates(asset_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_analyses_asset ON analyses(asset_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_approved_report_metrics_asset ON approved_report_metrics(asset_id, period, metric_key);
      CREATE INDEX IF NOT EXISTS idx_approved_report_metrics_analysis ON approved_report_metrics(analysis_id);
      CREATE INDEX IF NOT EXISTS idx_usage_month ON api_usage(month);
    `);
    const current = this.db.prepare('SELECT id FROM budget_settings WHERE id = 1').get();
    if (!current) {
      this.db.prepare('INSERT INTO budget_settings (id, monthly_limit_usd, updated_at) VALUES (1, ?, ?)')
        .run(DEFAULT_BUDGET_USD, nowIso(this.clock));
    }
  }

  seedPilotProfiles() {
    for (const profile of PILOT_PROFILES) {
      this.upsertProfile(profile);
      for (const source of profile.sources) {
        const existing = this.db.prepare('SELECT id FROM sources WHERE asset_id = ? AND url = ?').get(profile.assetId, source.url);
        if (!existing) this.addSource(profile.assetId, source);
      }
    }
  }

  ensureProfileExists(assetId) {
    const profile = this.db.prepare('SELECT * FROM profiles WHERE asset_id = ?').get(safeAssetId(assetId));
    if (!profile) throw new AppError('PROFILE_NOT_FOUND', 'Profil aktywa nie istnieje jeszcze w lokalnej bazie.', 404);
    return profile;
  }

  upsertProfile(input) {
    const data = ensurePlainObject(input, 'Profil musi być obiektem.');
    const assetId = safeAssetId(data.assetId || data.id);
    const type = stringOrEmpty(data.type || data.assetType) || 'instrument';
    const name = stringOrEmpty(data.name || data.displayName) || assetId;
    const canonicalId = stringOrEmpty(data.canonicalId || data.isin || data.identifier || data.ticker);
    const aliases = normalizeStringArray(data.aliases);
    const portfolios = normalizeStringArray(data.portfolios);
    const watched = asBoolean(data.watched);
    const isPilot = asBoolean(data.isPilot);
    const timestamp = nowIso(this.clock);
    const existing = this.db.prepare('SELECT * FROM profiles WHERE asset_id = ?').get(assetId);

    if (!existing) {
      this.db.prepare(`INSERT INTO profiles
        (asset_id, type, name, canonical_id, aliases_json, watched, is_pilot, portfolios_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(assetId, type, name, canonicalId, JSON.stringify(aliases), watched ? 1 : 0, isPilot ? 1 : 0, JSON.stringify(portfolios), timestamp, timestamp);
    } else {
      this.db.prepare(`UPDATE profiles SET type = ?, name = ?, canonical_id = ?, aliases_json = ?, watched = ?, is_pilot = ?, portfolios_json = ?, updated_at = ? WHERE asset_id = ?`)
        .run(
          type || existing.type,
          name || existing.name,
          canonicalId || existing.canonical_id,
          JSON.stringify(aliases.length ? aliases : parseJson(existing.aliases_json, [])),
          data.watched === undefined ? existing.watched : (watched ? 1 : 0),
          data.isPilot === undefined ? existing.is_pilot : (isPilot ? 1 : 0),
          JSON.stringify(portfolios.length ? portfolios : parseJson(existing.portfolios_json, [])),
          timestamp,
          assetId,
        );
    }
    return this.getProfile(assetId);
  }

  listAppState() {
    const rows = this.db.prepare('SELECT key, value_json, updated_at FROM app_state ORDER BY key COLLATE NOCASE').all();
    const state = {};
    const metadata = {};
    rows.forEach((row) => {
      state[row.key] = parseJson(row.value_json, null);
      metadata[row.key] = { updatedAt: row.updated_at };
    });
    return {
      state,
      metadata,
      keys: rows.map((row) => row.key),
      empty: rows.length === 0,
    };
  }

  updateAppState(input) {
    const data = ensurePlainObject(input, 'Stan aplikacji musi byc obiektem.');
    const entries = Object.entries(data);
    const timestamp = nowIso(this.clock);
    const saved = {};
    const ignored = [];
    const statement = this.db.prepare(`INSERT INTO app_state (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`);

    entries.forEach(([rawKey, rawValue]) => {
      if (!APP_STATE_KEYS.has(rawKey)) {
        ignored.push(rawKey);
        return;
      }
      const key = safeStateKey(rawKey);
      const value = normalizeStateValue(key, rawValue);
      statement.run(key, JSON.stringify(value), timestamp);
      saved[key] = value;
    });

    return {
      saved,
      ignored,
      state: this.listAppState().state,
    };
  }

  deleteAppStateKey(key) {
    const safeKey = safeStateKey(key);
    this.db.prepare('DELETE FROM app_state WHERE key = ?').run(safeKey);
    return { deleted: true, key: safeKey, state: this.listAppState().state };
  }

  migrateAppState(snapshot) {
    const data = ensurePlainObject(snapshot, 'Snapshot localStorage musi byc obiektem.');
    const state = data.localStorage && typeof data.localStorage === 'object' && !Array.isArray(data.localStorage)
      ? data.localStorage
      : data;
    const migrated = {};
    const ignored = [];

    Object.entries(state).forEach(([key, value]) => {
      if (!APP_STATE_KEYS.has(key)) {
        ignored.push(key);
        return;
      }
      const parsed = parseLegacyStateValue(key, value);
      if (!parsed.ok) {
        ignored.push(key);
        return;
      }
      migrated[key] = parsed.value;
    });

    const result = this.updateAppState(migrated);
    return {
      migrated: Object.keys(result.saved),
      ignored: [...new Set([...ignored, ...result.ignored])],
      state: result.state,
    };
  }

  updateProfile(assetId, changes) {
    const current = this.ensureProfileExists(assetId);
    return this.upsertProfile({
      ...mapProfile(current),
      ...ensurePlainObject(changes, 'Zmiany profilu muszą być obiektem.'),
      assetId: current.asset_id,
    });
  }

  syncProfiles(positions) {
    if (!Array.isArray(positions)) throw new AppError('INVALID_INPUT', 'Pozycje do synchronizacji muszą być tablicą.', 400);
    const grouped = new Map();
    positions.slice(0, 2_000).forEach((position) => {
      if (!position || typeof position !== 'object') return;
      const assetId = safeAssetId(position.assetId || position.id);
      const current = grouped.get(assetId) || { ...position, assetId, portfolios: [] };
      const portfolioName = stringOrEmpty(position.portfolioName);
      if (portfolioName && !current.portfolios.includes(portfolioName)) current.portfolios.push(portfolioName);
      grouped.set(assetId, current);
    });
    for (const profile of grouped.values()) this.upsertProfile(profile);
    return this.listProfiles();
  }

  listProfiles() {
    const rows = this.db.prepare('SELECT * FROM profiles ORDER BY is_pilot DESC, watched DESC, name COLLATE NOCASE').all();
    return rows.map((row) => {
      const profile = mapProfile(row);
      const sourceCount = this.db.prepare('SELECT COUNT(*) AS count FROM sources WHERE asset_id = ?').get(profile.assetId).count;
      const documentCount = this.db.prepare('SELECT COUNT(*) AS count FROM documents WHERE asset_id = ?').get(profile.assetId).count;
      const latest = this.db.prepare('SELECT * FROM analyses WHERE asset_id = ? ORDER BY CASE status WHEN \'approved\' THEN 0 ELSE 1 END, created_at DESC LIMIT 1').get(profile.assetId);
      return {
        ...profile,
        sourceCount,
        documentCount,
        latestAnalysis: latest ? mapAnalysis(latest, { includeContent: false }) : null,
      };
    });
  }

  getProfile(assetId) {
    const profile = mapProfile(this.ensureProfileExists(assetId));
    return {
      ...profile,
      sources: this.listSources(profile.assetId),
      documents: this.listDocuments(profile.assetId),
      candidates: this.listCandidates(profile.assetId),
      analyses: this.listAnalyses(profile.assetId),
      reportMetrics: this.listApprovedReportMetrics(profile.assetId),
    };
  }

  listSources(assetId) {
    this.ensureProfileExists(assetId);
    return this.db.prepare('SELECT * FROM sources WHERE asset_id = ? ORDER BY CASE role WHEN \'official\' THEN 0 WHEN \'reference\' THEN 1 ELSE 2 END, title COLLATE NOCASE').all(assetId).map(mapSource);
  }

  addSource(assetId, input) {
    this.ensureProfileExists(assetId);
    const data = ensurePlainObject(input, 'Źródło musi być obiektem.');
    const url = safeUrl(data.url);
    if (!url) throw new AppError('INVALID_URL', 'Podaj adres źródła.', 400);
    const source = {
      id: stringOrEmpty(data.id) || newId('src'),
      title: stringOrEmpty(data.title) || url,
      url,
      role: stringOrEmpty(data.role) || 'manual',
    };
    const timestamp = nowIso(this.clock);
    const existing = this.db.prepare('SELECT * FROM sources WHERE asset_id = ? AND url = ?').get(assetId, source.url);
    if (existing) return mapSource(existing);
    this.db.prepare('INSERT INTO sources (id, asset_id, title, url, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(source.id, assetId, source.title, source.url, source.role, timestamp, timestamp);
    return mapSource(this.db.prepare('SELECT * FROM sources WHERE id = ?').get(source.id));
  }

  updateSource(assetId, sourceId, input) {
    this.ensureProfileExists(assetId);
    const source = this.db.prepare('SELECT * FROM sources WHERE id = ? AND asset_id = ?').get(sourceId, assetId);
    if (!source) throw new AppError('SOURCE_NOT_FOUND', 'Źródło nie istnieje.', 404);
    const changes = ensurePlainObject(input, 'Zmiany źródła muszą być obiektem.');
    const title = stringOrEmpty(changes.title) || source.title;
    const url = changes.url === undefined ? source.url : safeUrl(changes.url);
    const role = stringOrEmpty(changes.role) || source.role;
    this.db.prepare('UPDATE sources SET title = ?, url = ?, role = ?, updated_at = ? WHERE id = ?')
      .run(title, url, role, nowIso(this.clock), source.id);
    return mapSource(this.db.prepare('SELECT * FROM sources WHERE id = ?').get(source.id));
  }

  deleteSource(assetId, sourceId) {
    this.ensureProfileExists(assetId);
    const result = this.db.prepare('DELETE FROM sources WHERE id = ? AND asset_id = ?').run(sourceId, assetId);
    if (!result.changes) throw new AppError('SOURCE_NOT_FOUND', 'Źródło nie istnieje.', 404);
    return { deleted: true, id: sourceId };
  }

  getDocumentRow(documentId) {
    const row = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId);
    if (!row) throw new AppError('DOCUMENT_NOT_FOUND', 'Dokument nie istnieje.', 404);
    return row;
  }

  getDocumentPath(document) {
    return ensureInside(this.dataDir, path.join(this.dataDir, ...String(document.stored_path).split('/')));
  }

  listDocuments(assetId) {
    this.ensureProfileExists(assetId);
    return this.db.prepare('SELECT * FROM documents WHERE asset_id = ? ORDER BY created_at DESC, filename COLLATE NOCASE').all(assetId).map(mapDocument);
  }

  async saveDocument(assetId, {
    buffer,
    filename,
    title,
    type = 'report',
    period = '',
    publishedAt = null,
    sourceUrl = '',
    sourceId = null,
    mimeType = '',
    parentDocumentId = null,
  }) {
    this.ensureProfileExists(assetId);
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new AppError('EMPTY_DOCUMENT', 'Dokument nie zawiera danych.', 400);
    if (buffer.length > MAX_UPLOAD_BYTES) throw new AppError('PAYLOAD_TOO_LARGE', 'Dokument przekracza limit 50 MB.', 413);
    const cleanFilename = safeFilename(filename || 'document');
    const checksum = sha256(buffer);
    const duplicate = this.db.prepare('SELECT * FROM documents WHERE asset_id = ? AND sha256 = ? AND parent_document_id IS ?').get(assetId, checksum, parentDocumentId || null);
    if (duplicate) return { document: mapDocument(duplicate), duplicate: true, extracted: [] };

    if (sourceId) {
      const source = this.db.prepare('SELECT id FROM sources WHERE id = ? AND asset_id = ?').get(sourceId, assetId);
      if (!source) throw new AppError('SOURCE_NOT_FOUND', 'Wybrane źródło nie istnieje.', 404);
    }
    const documentId = newId('doc');
    const assetFolder = sha256(assetId).slice(0, 20);
    const relativeDirectory = path.posix.join('documents', assetFolder, documentId);
    const relativePath = path.posix.join(relativeDirectory, cleanFilename);
    const absoluteDirectory = ensureInside(this.dataDir, path.join(this.dataDir, ...relativeDirectory.split('/')));
    const absolutePath = ensureInside(this.dataDir, path.join(this.dataDir, ...relativePath.split('/')));
    const timestamp = nowIso(this.clock);
    const row = {
      id: documentId,
      assetId,
      parentDocumentId,
      sourceId,
      title: stringOrEmpty(title) || cleanFilename,
      type: stringOrEmpty(type) || 'report',
      period: stringOrEmpty(period),
      publishedAt: stringOrEmpty(publishedAt) || null,
      sourceUrl: sourceUrl ? safeUrl(sourceUrl) : '',
      filename: cleanFilename,
      storedPath: relativePath,
      mimeType: stringOrEmpty(mimeType) || guessMimeType(cleanFilename),
      format: extensionOf(cleanFilename),
      sizeBytes: buffer.length,
      sha256: checksum,
      status: 'archived',
      analyzable: isAnalyzableFilename(cleanFilename),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    if (isZip(cleanFilename, row.mimeType)) inspectZip(buffer);
    await mkdir(absoluteDirectory, { recursive: true });
    try {
      await writeFile(absolutePath, buffer, { flag: 'wx' });
      this.db.prepare(`INSERT INTO documents
        (id, asset_id, parent_document_id, source_id, title, type, reporting_period, published_at, source_url, filename, stored_path, mime_type, format, size_bytes, sha256, status, analyzable, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(row.id, row.assetId, row.parentDocumentId, row.sourceId, row.title, row.type, row.period, row.publishedAt, row.sourceUrl, row.filename, row.storedPath, row.mimeType, row.format, row.sizeBytes, row.sha256, row.status, row.analyzable ? 1 : 0, row.createdAt, row.updatedAt);

      const extracted = isZip(cleanFilename, row.mimeType)
        ? await this.registerExtractedFiles(assetId, row, buffer, absoluteDirectory)
        : [];
      return {
        document: mapDocument(this.getDocumentRow(documentId)),
        duplicate: false,
        extracted,
      };
    } catch (error) {
      this.db.prepare('DELETE FROM documents WHERE id = ?').run(documentId);
      await rm(absoluteDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  async registerExtractedFiles(assetId, parent, archive, documentDirectory) {
    const extractionDirectory = ensureInside(this.dataDir, path.join(documentDirectory, 'extracted'));
    const files = await extractZipSafely(archive, extractionDirectory);
    const timestamp = nowIso(this.clock);
    const records = [];
    for (const file of files) {
      const filename = safeFilename(path.posix.basename(file.path));
      const content = await readFile(file.absolutePath);
      const id = newId('doc');
      const relativePath = path.posix.join(...path.relative(this.dataDir, file.absolutePath).split(path.sep));
      const record = {
        id,
        assetId,
        parentDocumentId: parent.id,
        title: `${parent.title}: ${file.path}`,
        type: parent.type || 'report',
        period: parent.reporting_period || '',
        publishedAt: parent.published_at || null,
        sourceUrl: parent.source_url || '',
        filename,
        storedPath: relativePath,
        mimeType: guessMimeType(filename),
        format: extensionOf(filename),
        sizeBytes: file.sizeBytes,
        sha256: sha256(content),
        status: 'extracted',
        analyzable: isAnalyzableFilename(filename),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.db.prepare(`INSERT INTO documents
        (id, asset_id, parent_document_id, source_id, title, type, reporting_period, published_at, source_url, filename, stored_path, mime_type, format, size_bytes, sha256, status, analyzable, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(record.id, record.assetId, record.parentDocumentId, parent.source_id || null, record.title, record.type, record.period, record.publishedAt, record.sourceUrl, record.filename, record.storedPath, record.mimeType, record.format, record.sizeBytes, record.sha256, record.status, record.analyzable ? 1 : 0, record.createdAt, record.updatedAt);
      records.push(mapDocument(this.getDocumentRow(id)));
    }
    return records;
  }

  async deleteDocument(documentId) {
    const document = this.getDocumentRow(documentId);
    const topLevelId = document.parent_document_id || document.id;
    const topLevel = this.getDocumentRow(topLevelId);
    const directory = path.dirname(this.getDocumentPath(topLevel));
    ensureInside(this.documentsDir, directory);
    this.db.prepare('DELETE FROM documents WHERE id = ? OR parent_document_id = ?').run(topLevelId, topLevelId);
    await rm(directory, { recursive: true, force: true });
    return { deleted: true, id: documentId };
  }

  getCandidateRow(assetId, candidateId) {
    const row = this.db.prepare('SELECT * FROM candidates WHERE id = ? AND asset_id = ?').get(candidateId, assetId);
    if (!row) throw new AppError('CANDIDATE_NOT_FOUND', 'Kandydat dokumentu nie istnieje.', 404);
    return row;
  }

  listCandidates(assetId) {
    this.ensureProfileExists(assetId);
    return this.db.prepare('SELECT * FROM candidates WHERE asset_id = ? ORDER BY updated_at DESC').all(assetId).map(mapCandidate);
  }

  addCandidate(assetId, input) {
    this.ensureProfileExists(assetId);
    const data = ensurePlainObject(input, 'Kandydat dokumentu musi być obiektem.');
    const url = safeUrl(data.url);
    if (!url) throw new AppError('INVALID_URL', 'Kandydat musi zawierać adres dokumentu.', 400);
    const timestamp = nowIso(this.clock);
    const existing = this.db.prepare('SELECT * FROM candidates WHERE asset_id = ? AND url = ?').get(assetId, url);
    const candidate = {
      id: stringOrEmpty(data.id) || newId('candidate'),
      sourceId: stringOrEmpty(data.sourceId) || null,
      title: stringOrEmpty(data.title) || url,
      url,
      type: stringOrEmpty(data.type) || 'report',
      period: stringOrEmpty(data.period),
      publishedAt: stringOrEmpty(data.publishedAt) || null,
      rationale: stringOrEmpty(data.rationale),
      status: stringOrEmpty(data.status) || 'candidate',
      metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {},
    };
    if (existing) {
      this.db.prepare(`UPDATE candidates SET title = ?, type = ?, reporting_period = ?, published_at = ?, rationale = ?, status = ?, metadata_json = ?, updated_at = ? WHERE id = ?`)
        .run(candidate.title, candidate.type, candidate.period, candidate.publishedAt, candidate.rationale, candidate.status, JSON.stringify(candidate.metadata), timestamp, existing.id);
      return mapCandidate(this.db.prepare('SELECT * FROM candidates WHERE id = ?').get(existing.id));
    }
    this.db.prepare(`INSERT INTO candidates
      (id, asset_id, source_id, title, url, type, reporting_period, published_at, rationale, status, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(candidate.id, assetId, candidate.sourceId, candidate.title, candidate.url, candidate.type, candidate.period, candidate.publishedAt, candidate.rationale, candidate.status, JSON.stringify(candidate.metadata), timestamp, timestamp);
    return mapCandidate(this.getCandidateRow(assetId, candidate.id));
  }

  updateCandidateStatus(assetId, candidateId, status) {
    const candidate = this.getCandidateRow(assetId, candidateId);
    this.db.prepare('UPDATE candidates SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(this.clock), candidate.id);
    return mapCandidate(this.getCandidateRow(assetId, candidate.id));
  }

  listAnalyses(assetId) {
    this.ensureProfileExists(assetId);
    return this.db.prepare('SELECT * FROM analyses WHERE asset_id = ? ORDER BY created_at DESC').all(assetId).map(mapAnalysis);
  }

  listApprovedReportMetrics(assetId) {
    this.ensureProfileExists(assetId);
    return this.db.prepare(`
      SELECT *
      FROM approved_report_metrics
      WHERE asset_id = ?
      ORDER BY period DESC, metric_key COLLATE NOCASE, document_id COLLATE NOCASE
    `).all(assetId).map(mapApprovedReportMetric);
  }

  getAnalysis(analysisId) {
    const analysis = this.db.prepare('SELECT * FROM analyses WHERE id = ?').get(analysisId);
    if (!analysis) throw new AppError('ANALYSIS_NOT_FOUND', 'Analiza nie istnieje.', 404);
    return analysis;
  }

  createDraftAnalysis(assetId, {
    documentIds,
    content,
    model = 'sonar-pro',
    provider = 'perplexity',
    costUsd = 0,
  }) {
    this.ensureProfileExists(assetId);
    const ids = normalizeStringArray(documentIds);
    if (!ids.length) throw new AppError('NO_DOCUMENTS_SELECTED', 'Wybierz co najmniej jeden dokument do analizy.', 400);
    const placeholders = ids.map(() => '?').join(',');
    const documents = this.db.prepare(`SELECT * FROM documents WHERE asset_id = ? AND id IN (${placeholders})`).all(assetId, ...ids);
    if (documents.length !== ids.length) throw new AppError('DOCUMENT_NOT_FOUND', 'Co najmniej jeden wybrany dokument nie należy do aktywa.', 404);
    const usable = documents.filter((document) => document.analyzable);
    if (!usable.length) throw new AppError('NO_ANALYZABLE_DOCUMENTS', 'Wybrane dokumenty nie mają formatu obsługiwanego przez analizę.', 400);
    const analysisContent = ensurePlainObject(content, 'Wynik analizy ma nieprawidłowy format.');
    const timestamp = nowIso(this.clock);
    const id = newId('analysis');
    const title = stringOrEmpty(analysisContent.title) || `Analiza ${this.ensureProfileExists(assetId).name}`;
    this.db.prepare(`INSERT INTO analyses
      (id, asset_id, status, title, schema_version, document_ids_json, content_json, provider, model, cost_usd, created_at, updated_at, approved_at)
      VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
      .run(id, assetId, title, stringOrEmpty(analysisContent.schemaVersion) || '1.0', JSON.stringify(ids), JSON.stringify(analysisContent), provider, model, Math.max(0, asFiniteNumber(costUsd, 0)), timestamp, timestamp);
    return mapAnalysis(this.getAnalysis(id));
  }

  approveAnalysis(analysisId) {
    const analysis = this.getAnalysis(analysisId);
    const timestamp = nowIso(this.clock);
    const approvedMetrics = approvedMetricRowsFromAnalysis(analysis, timestamp);
    const upsertMetric = this.db.prepare(`
      INSERT INTO approved_report_metrics
        (id, asset_id, analysis_id, document_id, metric_key, label, value_json, value_numeric, unit, period, page, section, quote, confidence, aggregation, source_json, approved_at, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_id, metric_key, period, document_id) DO UPDATE SET
        analysis_id = excluded.analysis_id,
        label = excluded.label,
        value_json = excluded.value_json,
        value_numeric = excluded.value_numeric,
        unit = excluded.unit,
        page = excluded.page,
        section = excluded.section,
        quote = excluded.quote,
        confidence = excluded.confidence,
        aggregation = excluded.aggregation,
        source_json = excluded.source_json,
        approved_at = excluded.approved_at,
        updated_at = excluded.updated_at
    `);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE analyses SET status = ?, approved_at = ?, updated_at = ? WHERE id = ?')
        .run('approved', timestamp, timestamp, analysis.id);
      approvedMetrics.forEach((metric) => {
        upsertMetric.run(
          metric.id,
          metric.assetId,
          metric.analysisId,
          metric.documentId,
          metric.metricKey,
          metric.label,
          metric.valueJson,
          metric.valueNumeric,
          metric.unit,
          metric.period,
          metric.page,
          metric.section,
          metric.quote,
          metric.confidence,
          metric.aggregation,
          metric.sourceJson,
          metric.approvedAt,
          metric.createdAt,
          metric.updatedAt,
        );
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return mapAnalysis(this.getAnalysis(analysis.id));
  }

  updateAnalysisTitle(analysisId, title) {
    const analysis = this.getAnalysis(analysisId);
    const nextTitle = normalizeAnalysisTitle(title);
    const timestamp = nowIso(this.clock);
    const content = parseJson(analysis.content_json, {});
    if (content && typeof content === 'object' && !Array.isArray(content)) {
      content.title = nextTitle;
    }
    this.db.prepare('UPDATE analyses SET title = ?, content_json = ?, updated_at = ? WHERE id = ?')
      .run(nextTitle, JSON.stringify(content), timestamp, analysis.id);
    return mapAnalysis(this.getAnalysis(analysis.id));
  }

  deleteAnalysis(analysisId) {
    const analysis = this.getAnalysis(analysisId);
    this.db.prepare('DELETE FROM analyses WHERE id = ?').run(analysis.id);
    return { deleted: true, id: analysis.id, analysisId: analysis.id, assetId: analysis.asset_id };
  }

  getBudget() {
    const settings = this.db.prepare('SELECT * FROM budget_settings WHERE id = 1').get();
    const month = monthKey(this.clock());
    const spentUsd = Number(this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM api_usage WHERE month = ?').get(month).total || 0);
    const monthlyLimitUsd = Number(settings.monthly_limit_usd);
    return {
      month,
      monthlyLimitUsd,
      spentUsd,
      remainingUsd: Math.max(0, monthlyLimitUsd - spentUsd),
      blocked: spentUsd >= monthlyLimitUsd,
      updatedAt: settings.updated_at,
    };
  }

  updateBudget(value) {
    const limit = asFiniteNumber(value, null);
    if (limit === null || limit < 0 || limit > 10_000) {
      throw new AppError('INVALID_BUDGET', 'Limit miesięczny musi być liczbą od 0 do 10 000 USD.', 400);
    }
    this.db.prepare('UPDATE budget_settings SET monthly_limit_usd = ?, updated_at = ? WHERE id = 1')
      .run(limit, nowIso(this.clock));
    return this.getBudget();
  }

  assertBudget(estimatedCostUsd) {
    const estimate = Math.max(0, asFiniteNumber(estimatedCostUsd, 0));
    const budget = this.getBudget();
    if (budget.monthlyLimitUsd <= 0 || budget.spentUsd + estimate > budget.monthlyLimitUsd) {
      throw new AppError('BUDGET_EXCEEDED', `Lokalny limit ${budget.monthlyLimitUsd.toFixed(2)} USD nie pozwala na kolejne wywołanie.`, 402, budget);
    }
    return budget;
  }

  recordUsage({ action, costUsd, metadata = {} }) {
    const cost = Math.max(0, asFiniteNumber(costUsd, 0));
    this.db.prepare('INSERT INTO api_usage (id, month, action, cost_usd, created_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(newId('usage'), monthKey(this.clock()), stringOrEmpty(action) || 'api', cost, nowIso(this.clock), JSON.stringify(metadata));
    return this.getBudget();
  }

  async createBackup(browserState = {}) {
    ensurePlainObject(browserState, 'Stan przeglądarki do backupu musi być obiektem.');
    this.db.exec('PRAGMA wal_checkpoint(FULL);');
    const entries = [];
    let totalBytes = 0;
    const addEntry = (entryPath, content) => {
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
      totalBytes += buffer.length;
      if (totalBytes > MAX_BACKUP_BYTES) throw new AppError('BACKUP_TOO_LARGE', 'Backup przekracza limit 500 MB.', 413);
      entries.push({ path: entryPath, content: buffer });
    };
    addEntry('analysis.sqlite', await readFile(this.dbPath));
    addEntry('browser-state.json', JSON.stringify(browserState, null, 2));
    const documents = await listFilesRecursively(this.documentsDir);
    for (const document of documents) addEntry(path.posix.join('documents', document.relative), await readFile(document.absolute));
    const manifest = {
      type: 'stock-analyzer-analysis-backup',
      version: DATA_VERSION,
      createdAt: nowIso(this.clock),
      entries: entries.map((entry) => ({ path: entry.path, sizeBytes: entry.content.length, sha256: sha256(entry.content) })),
    };
    addEntry('manifest.json', JSON.stringify(manifest, null, 2));
    const archive = createStoredZip(entries, { modifiedAt: this.clock() });
    const filename = `analysis_backup_${nowIso(this.clock).replaceAll(':', '-').replaceAll('.', '-')}.zip`;
    const backupPath = ensureInside(this.backupsDir, path.join(this.backupsDir, filename));
    await writeFile(backupPath, archive, { flag: 'wx' });
    return { filename, absolutePath: backupPath, sizeBytes: archive.length, createdAt: manifest.createdAt };
  }

  async importBackup(buffer) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new AppError('INVALID_BACKUP', 'Backup jest pusty.', 400);
    if (buffer.length > MAX_BACKUP_BYTES) throw new AppError('BACKUP_TOO_LARGE', 'Backup przekracza limit 500 MB.', 413);
    const staging = ensureInside(this.tempDir, path.join(this.tempDir, newId('import')));
    await mkdir(staging, { recursive: true });
    try {
      await extractZipSafely(buffer, staging, { maxEntries: 2_000, maxExtractedBytes: MAX_BACKUP_BYTES, maxSingleFileBytes: MAX_UPLOAD_BYTES });
      const manifestPath = ensureInside(staging, path.join(staging, 'manifest.json'));
      const databasePath = ensureInside(staging, path.join(staging, 'analysis.sqlite'));
      const manifest = parseJson((await readFile(manifestPath)).toString('utf8'), null);
      if (!manifest || manifest.type !== 'stock-analyzer-analysis-backup' || manifest.version !== DATA_VERSION) {
        throw new AppError('INVALID_BACKUP', 'Plik nie jest kompatybilnym backupem analizy.', 400);
      }
      if (!Array.isArray(manifest.entries) || !manifest.entries.length) {
        throw new AppError('INVALID_BACKUP', 'Backup nie zawiera manifestu plików.', 400);
      }
      for (const entry of manifest.entries) {
        if (!entry || typeof entry.path !== 'string' || typeof entry.sha256 !== 'string') {
          throw new AppError('INVALID_BACKUP', 'Manifest backupu ma nieprawidłowy wpis.', 400);
        }
        const filePath = ensureInside(staging, path.join(staging, ...entry.path.split('/')));
        const file = await readFile(filePath);
        if (file.length !== entry.sizeBytes || sha256(file) !== entry.sha256) {
          throw new AppError('INVALID_BACKUP', `Plik „${entry.path}” nie przeszedł kontroli integralności backupu.`, 400);
        }
      }
      const probe = new DatabaseSync(databasePath);
      try {
        probe.prepare('SELECT name FROM sqlite_master LIMIT 1').all();
      } finally {
        probe.close();
      }
      const importedDocuments = ensureInside(staging, path.join(staging, 'documents'));
      try {
        const details = await stat(importedDocuments);
        if (!details.isDirectory()) throw new Error('not directory');
      } catch {
        await mkdir(importedDocuments, { recursive: true });
      }
      let browserState = {};
      try {
        browserState = parseJson((await readFile(ensureInside(staging, path.join(staging, 'browser-state.json')))).toString('utf8'), {});
      } catch {
        browserState = {};
      }

      const nextDbPath = ensureInside(this.dataDir, path.join(this.dataDir, 'analysis.sqlite.import'));
      await copyFile(databasePath, nextDbPath);
      this.close();
      await rm(this.documentsDir, { recursive: true, force: true });
      await rm(this.dbPath, { force: true });
      await rename(importedDocuments, this.documentsDir);
      await rename(nextDbPath, this.dbPath);
      this.openDatabase();
      this.initializeSchema();
      return { imported: true, browserState, importedAt: nowIso(this.clock) };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}

export const createAnalysisStore = async (options) => {
  const store = new AnalysisStore(options);
  await store.initialize();
  return store;
};

export { ANALYZABLE_EXTENSIONS, PILOT_PROFILES };
