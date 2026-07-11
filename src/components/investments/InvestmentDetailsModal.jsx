import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { fetchAlphaVantageOverview } from '../../utils/alphaVantage.js';
import { getAnalysisRoute, resolveAnalysisIdentity } from '../../utils/analysisAssets.js';
import {
  METRIC_DEFINITIONS,
  getPositionMetrics,
  resolveInstrument,
} from '../../utils/investmentDetails.js';

const EMPTY_VALUE = '-';

const formatCurrency = (value) => (
  Number.isFinite(value)
    ? new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency: 'PLN',
      maximumFractionDigits: 2,
    }).format(value)
    : EMPTY_VALUE
);

const formatNumber = (value, maximumFractionDigits = 2) => (
  Number.isFinite(value)
    ? new Intl.NumberFormat('pl-PL', { maximumFractionDigits }).format(value)
    : EMPTY_VALUE
);

const formatPercent = (value) => (
  Number.isFinite(value)
    ? `${new Intl.NumberFormat('pl-PL', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value)}%`
    : EMPTY_VALUE
);

const formatAlphaNumber = (value, maximumFractionDigits = 2) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? formatNumber(numericValue, maximumFractionDigits) : (value || EMPTY_VALUE);
};

const formatAlphaPercent = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return value || EMPTY_VALUE;
  return formatPercent(numericValue * 100);
};

const formatMarketCap = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return value || EMPTY_VALUE;

  return new Intl.NumberFormat('pl-PL', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(numericValue);
};

const formatAge = (days) => {
  if (!Number.isFinite(days)) return EMPTY_VALUE;
  if (days < 31) return `${days} dni`;

  const months = days / 30.4375;
  if (months < 24) return `${formatNumber(months, 1)} mies.`;

  return `${formatNumber(months / 12, 1)} lat`;
};

const getStatusBadge = (status) => {
  if (status === 'fresh' || status === 'cached') {
    return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
  }
  if (status === 'loading') return 'bg-blue-500/10 text-blue-300 border-blue-500/20';
  if (status === 'missing-key' || status === 'missing-symbol') {
    return 'bg-amber-500/10 text-amber-300 border-amber-500/20';
  }
  return 'bg-rose-500/10 text-rose-300 border-rose-500/20';
};

const MetricTile = ({ label, value, tone = 'default', tooltip }) => {
  const toneClass = {
    default: 'text-slate-100',
    positive: 'text-emerald-300',
    negative: 'text-rose-300',
    muted: 'text-slate-400',
  }[tone];

  return (
    <div className="rounded-lg border border-slate-800/70 bg-slate-950/60 px-4 py-3">
      <div className="mb-1 flex items-center gap-2">
        <p className="text-[11px] font-semibold uppercase text-slate-500">{label}</p>
        {tooltip && (
          <span
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-700 text-[10px] font-bold text-slate-500"
            title={tooltip}
            aria-label={tooltip}
          >
            i
          </span>
        )}
      </div>
      <p className={`font-mono text-sm font-semibold ${toneClass}`}>{value || EMPTY_VALUE}</p>
    </div>
  );
};

const SectionTitle = ({ children }) => (
  <h4 className="text-xs font-bold uppercase text-slate-400">{children}</h4>
);

const getResultTone = (value) => {
  if (!Number.isFinite(value) || value === 0) return 'default';
  return value > 0 ? 'positive' : 'negative';
};

const InvestmentDetailsModal = ({ portfolioName, row, portfolioRows, onClose }) => {
  const [overviewResult, setOverviewResult] = useState(null);

  const instrument = useMemo(() => resolveInstrument(row), [row]);
  const analysisProfile = useMemo(() => resolveAnalysisIdentity({
    quote: instrument.quote,
    label: instrument.label,
  }), [instrument.label, instrument.quote]);
  const positionMetrics = useMemo(
    () => getPositionMetrics(row, portfolioRows),
    [row, portfolioRows],
  );

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  useEffect(() => {
    let isMounted = true;

    fetchAlphaVantageOverview(instrument.symbol)
      .then((result) => {
        if (!isMounted) return;

        setOverviewResult({ symbol: instrument.symbol, result });
      })
      .catch((error) => {
        if (!isMounted) return;

        setOverviewResult({
          symbol: instrument.symbol,
          result: {
            data: null,
            status: 'error',
            message: error.message || 'Nie udalo sie pobrac danych Alpha Vantage.',
          },
        });
      });

    return () => {
      isMounted = false;
    };
  }, [instrument.symbol]);

  const activeOverview = overviewResult?.symbol === instrument.symbol ? overviewResult.result : null;
  const fundamentals = activeOverview?.data ?? null;
  const apiStatus = activeOverview?.status ?? 'loading';
  const apiMessage = activeOverview?.message ?? 'Pobieranie danych Alpha Vantage...';
  const description = fundamentals?.description || 'Opis niedostepny dla tego instrumentu.';
  const rawEntries = Object.entries(row || {}).filter(([key]) => key !== 'id');
  const sectorIndustry = [fundamentals?.sector, fundamentals?.industry].filter(Boolean).join(' / ');

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-slate-800/80 bg-slate-900/50 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded-lg border border-slate-700/60 bg-slate-800/70 px-2.5 py-1 font-mono text-xs font-semibold text-slate-300">
                  {instrument.symbol || instrument.quote || EMPTY_VALUE}
                </span>
                <span className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${getStatusBadge(apiStatus)}`}>
                  {apiStatus === 'loading' ? 'Alpha Vantage: pobieranie' : `Alpha Vantage: ${apiStatus}`}
                </span>
              </div>
              <h3 className="truncate text-xl font-bold text-white">
                {fundamentals?.name || instrument.label}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {portfolioName}{sectorIndustry ? ` - ${sectorIndustry}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                to={getAnalysisRoute(analysisProfile.assetId)}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-200 transition-colors hover:bg-violet-500/20"
              >
                Pełna analiza
              </Link>
              {instrument.url && (
                <a
                  href={instrument.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-300 transition-colors hover:bg-blue-500/20"
                >
                  Google Finance
                </a>
              )}
              <button
                onClick={onClose}
                className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
                aria-label="Zamknij szczegoly inwestycji"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-950/40 p-6">
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-800/80 bg-slate-950/70 p-5">
              <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <SectionTitle>Opis instrumentu</SectionTitle>
                <p className="text-xs text-slate-500">{apiMessage}</p>
              </div>
              <p className="max-w-5xl text-sm leading-6 text-slate-300">{description}</p>
            </div>

            <div className="space-y-3">
              <SectionTitle>Pozycja w portfelu</SectionTitle>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricTile label="Ilosc" value={formatNumber(positionMetrics.quantity, 4)} />
                <MetricTile label="Kurs kupna" value={formatCurrency(positionMetrics.buyPrice)} />
                <MetricTile label="Aktualny kurs" value={formatCurrency(positionMetrics.currentPrice)} />
                <MetricTile label="Koszt calkowity" value={formatCurrency(positionMetrics.totalCost)} />
                <MetricTile label="Wartosc aktualna" value={formatCurrency(positionMetrics.marketValue)} />
                <MetricTile
                  label="Zysk / strata"
                  value={formatCurrency(positionMetrics.profitLoss)}
                  tone={getResultTone(positionMetrics.profitLoss)}
                />
                <MetricTile
                  label="Zysk %"
                  value={formatPercent(positionMetrics.profitPercent)}
                  tone={getResultTone(positionMetrics.profitPercent)}
                />
                <MetricTile label="Dywidenda netto" value={formatCurrency(positionMetrics.dividendNet)} />
                <MetricTile
                  label="Wynik z dywidenda"
                  value={formatCurrency(positionMetrics.totalResult)}
                  tone={getResultTone(positionMetrics.totalResult)}
                />
                <MetricTile label="Udzial w portfelu" value={formatPercent(positionMetrics.portfolioShare)} />
                <MetricTile label="Break-even" value={formatCurrency(positionMetrics.breakEvenPrice)} />
                <MetricTile label="Wiek pozycji" value={formatAge(positionMetrics.positionAgeDays)} />
              </div>
            </div>

            <div className="space-y-3">
              <SectionTitle>Metryki fundamentalne</SectionTitle>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricTile label="P/E" value={formatAlphaNumber(fundamentals?.peRatio)} tooltip={METRIC_DEFINITIONS.peRatio} />
                <MetricTile label="EPS" value={formatAlphaNumber(fundamentals?.eps)} tooltip={METRIC_DEFINITIONS.eps} />
                <MetricTile label="Market cap" value={formatMarketCap(fundamentals?.marketCapitalization)} />
                <MetricTile label="Dividend yield" value={formatAlphaPercent(fundamentals?.dividendYield)} tooltip={METRIC_DEFINITIONS.dividendYield} />
                <MetricTile label="Beta" value={formatAlphaNumber(fundamentals?.beta)} tooltip={METRIC_DEFINITIONS.beta} />
                <MetricTile label="52W high" value={formatAlphaNumber(fundamentals?.fiftyTwoWeekHigh)} />
                <MetricTile label="52W low" value={formatAlphaNumber(fundamentals?.fiftyTwoWeekLow)} />
                <MetricTile label="P/B" value={formatAlphaNumber(fundamentals?.priceToBook)} tooltip={METRIC_DEFINITIONS.priceToBook} />
                <MetricTile label="P/S" value={formatAlphaNumber(fundamentals?.priceToSales)} tooltip={METRIC_DEFINITIONS.priceToSales} />
                <MetricTile label="Profit margin" value={formatAlphaPercent(fundamentals?.profitMargin)} />
                <MetricTile label="ROE" value={formatAlphaPercent(fundamentals?.roe)} tooltip={METRIC_DEFINITIONS.roe} />
                <MetricTile label="Payout ratio" value={formatAlphaPercent(fundamentals?.payoutRatio)} tooltip={METRIC_DEFINITIONS.payoutRatio} />
              </div>
            </div>

            <details className="rounded-xl border border-slate-800/80 bg-slate-950/70 p-5">
              <summary className="cursor-pointer text-xs font-bold uppercase text-slate-400">
                Surowe dane z wiersza
              </summary>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                {rawEntries.map(([key, value]) => (
                  <div key={key} className="rounded-lg border border-slate-800/70 bg-slate-900/50 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase text-slate-500">{key}</p>
                    <p className="mt-1 break-words font-mono text-xs text-slate-300">{String(value ?? '') || EMPTY_VALUE}</p>
                  </div>
                ))}
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default InvestmentDetailsModal;
