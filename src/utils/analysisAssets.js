import {
  ASSET_COLUMN_ALIASES,
  getValueByAliases,
} from './investmentDetails.js';
import { normalizeText } from './number.js';

export const ANALYSIS_ASSET_IDS = {
  CDR: 'company:WSE:CDR',
  EIMI: 'etf:IE00BKM4GZ66',
};

export const ANALYSIS_PORTFOLIO_NAMES = ['Portfel Makler', 'Portfel IKZE'];

const cdProjektSources = [
  {
    id: 'cdr-periodic-reports',
    title: 'CD PROJEKT — raporty okresowe',
    url: 'https://www.cdprojekt.com/pl/typ-raportu/periodical/',
    role: 'official',
  },
];

const eimiSources = [
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
];

export const DEFAULT_ANALYSIS_PROFILES = [
  {
    assetId: ANALYSIS_ASSET_IDS.CDR,
    type: 'company',
    name: 'CD PROJEKT',
    ticker: 'CDR',
    exchange: 'WSE',
    aliases: ['CDR:WSE', 'CDR'],
    sources: cdProjektSources,
    isPilot: true,
  },
  {
    assetId: ANALYSIS_ASSET_IDS.EIMI,
    type: 'etf',
    name: 'iShares Core MSCI EM IMI UCITS ETF USD (Acc)',
    isin: 'IE00BKM4GZ66',
    ticker: 'EIMI',
    exchange: 'LON',
    aliases: ['EIMI:LON', 'EIMI', 'IE00BKM4GZ66'],
    sources: eimiSources,
    isPilot: true,
  },
];

const unwrapMarkdownLink = (value) => {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  return match ? match[1].trim() : raw;
};

const toSafeIdPart = (value) => encodeURIComponent(String(value || 'instrument'))
  .replace(/%/g, '_')
  .replace(/[^a-zA-Z0-9:_-]/g, '_');

export const getAssetQuoteFromValue = (value) => {
  const raw = unwrapMarkdownLink(value);
  return raw.split(/\s+/)[0]?.trim().toUpperCase() || '';
};

export const getAssetLabelFromValue = (value) => {
  const raw = unwrapMarkdownLink(value);
  if (!raw) return '';

  const [, ...nameParts] = raw.split(/\s+/);
  return nameParts.join(' ').trim() || raw;
};

export const resolveAnalysisIdentity = ({ value, quote, label } = {}) => {
  const normalizedQuote = String(quote || getAssetQuoteFromValue(value)).trim().toUpperCase();
  const resolvedLabel = String(label || getAssetLabelFromValue(value) || normalizedQuote || 'Instrument').trim();
  const normalizedLabel = normalizeText(resolvedLabel);

  if (['CDR:WSE', 'CDR'].includes(normalizedQuote) || normalizedLabel.includes('cdprojekt')) {
    return { ...DEFAULT_ANALYSIS_PROFILES[0] };
  }

  if (
    ['EIMI:LON', 'EIMI', 'IE00BKM4GZ66'].includes(normalizedQuote)
    || normalizedLabel.includes('msciemimi')
    || normalizedLabel.includes('isharescoremsciemimi')
  ) {
    return { ...DEFAULT_ANALYSIS_PROFILES[1] };
  }

  const safeQuote = normalizedQuote || resolvedLabel;
  const [ticker = safeQuote, exchange = ''] = normalizedQuote.split(':');

  return {
    assetId: `instrument:${toSafeIdPart(safeQuote)}`,
    type: 'instrument',
    name: resolvedLabel,
    ticker,
    exchange,
    aliases: normalizedQuote ? [normalizedQuote] : [],
    sources: [],
    isPilot: false,
  };
};

const findPortfolioKey = (liveData, portfolioName) => Object.keys(liveData || {}).find(
  (key) => normalizeText(key) === normalizeText(portfolioName),
);

/**
 * Builds one analysis profile per instrument. Position details deliberately stay
 * attached to the original portfolio rows, so one research profile can serve
 * several accounts without combining their quantities or cost basis.
 */
export const getPortfolioAnalysisAssets = (liveData) => {
  if (!liveData || typeof liveData !== 'object') return [];

  const assets = new Map();

  ANALYSIS_PORTFOLIO_NAMES.forEach((portfolioName) => {
    const matchingKey = findPortfolioKey(liveData, portfolioName);
    const rows = matchingKey && Array.isArray(liveData[matchingKey]) ? liveData[matchingKey] : [];

    rows.forEach((row) => {
      const rawAsset = getValueByAliases(row, ASSET_COLUMN_ALIASES);
      if (!String(rawAsset ?? '').trim()) return;

      const profile = resolveAnalysisIdentity({ value: rawAsset });
      const existing = assets.get(profile.assetId);
      const position = { portfolioName, row, portfolioRows: rows };

      if (existing) {
        existing.positions.push(position);
        if (!existing.portfolios.includes(portfolioName)) existing.portfolios.push(portfolioName);
      } else {
        assets.set(profile.assetId, {
          ...profile,
          positions: [position],
          portfolios: [portfolioName],
        });
      }
    });
  });

  return [...assets.values()];
};

const normalizeServerProfile = (profile) => {
  if (!profile || typeof profile !== 'object') return null;

  const identity = resolveAnalysisIdentity({
    quote: profile.ticker && profile.exchange ? `${profile.ticker}:${profile.exchange}` : profile.ticker,
    label: profile.name || profile.displayName,
  });
  const assetId = profile.assetId || profile.id || identity.assetId;

  return {
    ...identity,
    ...profile,
    assetId,
    name: profile.name || profile.displayName || identity.name,
    type: profile.type || profile.assetType || identity.type,
    sources: Array.isArray(profile.sources) ? profile.sources : identity.sources,
    aliases: Array.isArray(profile.aliases) ? profile.aliases : identity.aliases,
  };
};

/** Merges local portfolio positions, fixed pilot definitions and helper records. */
export const mergeAnalysisProfiles = (portfolioAssets = [], serverProfiles = []) => {
  const byId = new Map();

  [...DEFAULT_ANALYSIS_PROFILES, ...portfolioAssets].forEach((profile) => {
    const current = byId.get(profile.assetId);
    byId.set(profile.assetId, {
      ...current,
      ...profile,
      sources: profile.sources?.length ? profile.sources : current?.sources || [],
      positions: profile.positions || current?.positions || [],
      portfolios: profile.portfolios || current?.portfolios || [],
    });
  });

  serverProfiles.map(normalizeServerProfile).filter(Boolean).forEach((profile) => {
    const current = byId.get(profile.assetId);
    byId.set(profile.assetId, {
      ...current,
      ...profile,
      sources: profile.sources?.length ? profile.sources : current?.sources || [],
      positions: current?.positions || [],
      portfolios: current?.portfolios || [],
    });
  });

  return [...byId.values()].sort((left, right) => {
    const leftHeld = left.positions?.length ? 0 : 1;
    const rightHeld = right.positions?.length ? 0 : 1;
    return leftHeld - rightHeld || left.name.localeCompare(right.name, 'pl');
  });
};

export const getAnalysisRoute = (assetId) => `/analysis/${encodeURIComponent(assetId)}`;

export const getAnalysisTypeLabel = (type) => {
  if (type === 'company') return 'Spółka';
  if (type === 'etf') return 'ETF';
  return 'Instrument';
};
