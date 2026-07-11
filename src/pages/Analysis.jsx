import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import useLiveData from '../hooks/useLiveData.js';
import { getPositionMetrics } from '../utils/investmentDetails.js';
import { normalizeText, parseNumericValue } from '../utils/number.js';
import {
  ANALYSIS_ASSET_IDS,
  getAnalysisRoute,
  getAnalysisTypeLabel,
  getPortfolioAnalysisAssets,
  mergeAnalysisProfiles,
  resolveAnalysisIdentity,
} from '../utils/analysisAssets.js';
import {
  analysisApi,
  isHelperUnavailable,
} from '../utils/analysisApi.js';
import {
  PERSISTENT_STATE_KEYS,
  hydratePersistentState,
} from '../utils/persistentStorage.js';

const EMPTY_VALUE = '—';

const formatDate = (value, { withTime = false } = {}) => {
  if (!value) return EMPTY_VALUE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
};

const formatCurrency = (value) => (
  Number.isFinite(Number(value))
    ? new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency: 'PLN',
      maximumFractionDigits: 2,
    }).format(Number(value))
    : EMPTY_VALUE
);

const formatUsd = (value) => (
  Number.isFinite(Number(value))
    ? new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(Number(value))
    : EMPTY_VALUE
);

const formatNumber = (value, maximumFractionDigits = 2) => (
  Number.isFinite(Number(value))
    ? new Intl.NumberFormat('pl-PL', { maximumFractionDigits }).format(Number(value))
    : EMPTY_VALUE
);

const getItemId = (item) => String(item?.id || item?.analysisId || item?.documentId || item?.candidateId || '');

const getStatusStyle = (status) => {
  const normalized = String(status || '').toLowerCase();
  if (['approved', 'complete', 'completed', 'archived', 'downloaded', 'ready', 'online'].includes(normalized)) {
    return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300';
  }
  if (['draft', 'pending', 'processing', 'discovering', 'running'].includes(normalized)) {
    return 'border-amber-500/20 bg-amber-500/10 text-amber-300';
  }
  if (['error', 'failed', 'rejected', 'offline'].includes(normalized)) {
    return 'border-rose-500/20 bg-rose-500/10 text-rose-300';
  }
  return 'border-slate-700/70 bg-slate-800/60 text-slate-300';
};

const getStatusLabel = (status) => {
  const labels = {
    approved: 'zatwierdzona',
    draft: 'szkic',
    pending: 'oczekuje',
    processing: 'przetwarzanie',
    downloaded: 'zarchiwizowany',
    archived: 'zarchiwizowany',
    complete: 'gotowe',
    completed: 'gotowe',
    error: 'błąd',
  };
  const normalized = String(status || '').toLowerCase();
  return labels[normalized] || status || 'brak statusu';
};

const Badge = ({ children, status, className = '' }) => (
  <span className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${status ? getStatusStyle(status) : 'border-slate-700/70 bg-slate-800/60 text-slate-300'} ${className}`}>
    {children}
  </span>
);

const SectionHeading = ({ title, description, action }) => (
  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div>
      <h2 className="text-base font-bold text-white">{title}</h2>
      {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
    </div>
    {action}
  </div>
);

const EmptyState = ({ children }) => (
  <div className="rounded-xl border border-dashed border-slate-700/70 bg-slate-950/35 px-4 py-5 text-sm leading-6 text-slate-500">
    {children}
  </div>
);

const LoadingCallout = ({ message }) => (
  <div className="rounded-xl border border-blue-500/25 bg-blue-500/10 px-4 py-3 text-sm text-blue-100 shadow-lg shadow-blue-950/20">
    <div className="flex items-center gap-3">
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-blue-200/30 border-t-blue-200" aria-hidden="true" />
      <div>
        <p className="font-semibold">{message}</p>
        <p className="mt-0.5 text-xs text-blue-100/70">Możesz zostać na tej stronie, widok odświeży się automatycznie po zakończeniu operacji.</p>
      </div>
    </div>
  </div>
);

const ActionButton = ({ children, className = '', disabled = false, ...props }) => (
  <button
    type="button"
    disabled={disabled}
    className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    {...props}
  >
    {children}
  </button>
);

const PrimaryButton = (props) => (
  <ActionButton {...props} className={`bg-blue-600 text-white hover:bg-blue-500 ${props.className || ''}`} />
);

const SecondaryButton = (props) => (
  <ActionButton {...props} className={`border border-slate-700/70 bg-slate-800/60 text-slate-200 hover:bg-slate-800 ${props.className || ''}`} />
);

const HelperBanner = ({ status, error, onRetry }) => {
  if (status === 'online') return null;

  const isLoading = status === 'loading';
  return (
    <div className={`mb-6 rounded-xl border p-4 text-sm ${
      isLoading
        ? 'border-blue-500/20 bg-blue-500/10 text-blue-200'
        : 'border-amber-500/20 bg-amber-500/10 text-amber-200'
    }`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">
            {isLoading ? 'Sprawdzanie lokalnego helpera analizy…' : 'Lokalny helper analizy jest niedostępny'}
          </p>
          <p className="mt-1 text-xs leading-5 opacity-80">
            {isLoading
              ? 'Pobrane wcześniej dane pozostają lokalne.'
              : (error || 'Uruchom helper, aby archiwizować dokumenty i korzystać z Perplexity. Widok portfela działa bez niego.')}
          </p>
        </div>
        {!isLoading && <SecondaryButton onClick={onRetry}>Spróbuj ponownie</SecondaryButton>}
      </div>
    </div>
  );
};

const getBrowserState = () => {
  const localStorageSnapshot = {};
  PERSISTENT_STATE_KEYS.forEach((key) => {
    const value = window.localStorage.getItem(key);
    if (value !== null) localStorageSnapshot[key] = value;
  });

  return {
    exportedAt: new Date().toISOString(),
    localStorage: localStorageSnapshot,
  };
};

const downloadBackupPayload = (payload) => {
  const downloadUrl = payload?.downloadUrl || payload?.url;
  if (downloadUrl) {
    window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    return;
  }

  const blob = new Blob([JSON.stringify(payload ?? {}, null, 2)], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `analysis_backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
};

const BudgetPanel = ({ budget, helperOnline, onUpdate, onExport, onImport, busy, compact = false }) => {
  const importInputRef = useRef(null);
  const [limit, setLimit] = useState(() => String(budget?.monthlyLimitUsd ?? budget?.limitUsd ?? 10));

  const spent = budget?.spentUsd ?? budget?.usedUsd ?? budget?.monthSpentUsd ?? 0;
  const configuredLimit = budget?.monthlyLimitUsd ?? budget?.limitUsd ?? 10;
  const remaining = budget?.remainingUsd ?? Math.max(0, Number(configuredLimit) - Number(spent || 0));

  return (
    <section className={`rounded-2xl border border-slate-800/80 bg-slate-900 shadow-xl ${compact ? 'p-4' : 'p-5'}`}>
      <SectionHeading
        title="Lokalny budżet i backup"
        description={compact ? 'Lokalny limit i kopia danych analizy.' : 'Limit jest kontrolą po stronie aplikacji. Rozliczenia dostawcy API pozostają źródłem ostatecznym.'}
      />
      <div className={`grid gap-4 ${compact ? '' : 'lg:grid-cols-[1.2fr_1fr]'}`}>
        <div className={`grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-3'}`}>
          <div className="rounded-xl border border-slate-800/70 bg-slate-950/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Wykorzystano</p>
            <p className="mt-1 font-mono text-sm font-semibold text-slate-200">{formatUsd(spent)}</p>
          </div>
          <div className="rounded-xl border border-slate-800/70 bg-slate-950/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Pozostało</p>
            <p className="mt-1 font-mono text-sm font-semibold text-emerald-300">{formatUsd(remaining)}</p>
          </div>
          <label className="rounded-xl border border-slate-800/70 bg-slate-950/60 p-3">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Limit / miesiąc</span>
            <div className="mt-1 flex items-center gap-1">
              <span className="font-mono text-sm text-slate-500">$</span>
              <input
                type="number"
                min="0"
                step="1"
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                disabled={!helperOnline || busy}
                className="w-full bg-transparent font-mono text-sm font-semibold text-slate-100 outline-none"
                aria-label="Miesięczny limit budżetu w USD"
              />
            </div>
          </label>
        </div>
        <div className={`${compact ? 'grid gap-2' : 'flex flex-wrap items-end justify-start gap-2 lg:justify-end'}`}>
          <SecondaryButton
            disabled={!helperOnline || busy}
            onClick={() => onUpdate(Number(limit))}
            className={compact ? 'w-full' : ''}
          >
            Zapisz limit
          </SecondaryButton>
          <SecondaryButton disabled={!helperOnline || busy} onClick={onExport} className={compact ? 'w-full' : ''}>
            Eksportuj pełny backup
          </SecondaryButton>
          <input
            ref={importInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(event) => {
              const [file] = event.target.files || [];
              if (file) onImport(file);
              event.target.value = '';
            }}
          />
          <SecondaryButton
            disabled={!helperOnline || busy}
            onClick={() => importInputRef.current?.click()}
            className={compact ? 'w-full' : ''}
          >
            Importuj backup
          </SecondaryButton>
        </div>
      </div>
    </section>
  );
};

const AnalysisProfilesTable = ({ profiles, onOpen }) => (
  <div className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900 shadow-xl">
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-800/80 text-left text-sm">
        <thead className="bg-slate-950/45 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Instrument</th>
            <th className="px-4 py-3">Typ</th>
            <th className="px-4 py-3">Portfele</th>
            <th className="px-4 py-3 text-right">Pozycje</th>
            <th className="px-4 py-3 text-right">Źródła</th>
            <th className="px-4 py-3">Ostatnia analiza</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {profiles.map((profile) => {
            const latest = profile.latestAnalysis || profile.analysis || profile.analyses?.[0];
            const identifier = profile.isin || profile.canonicalId || (profile.ticker && profile.exchange
              ? `${profile.ticker}:${profile.exchange}`
              : profile.ticker);
            return (
              <tr
                key={profile.assetId}
                tabIndex={0}
                className="cursor-pointer bg-slate-900 transition-colors hover:bg-slate-800/60 focus:bg-slate-800/60 focus:outline-none"
                onClick={() => onOpen(profile.assetId)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpen(profile.assetId);
                  }
                }}
              >
                <td className="max-w-[24rem] px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-100">{profile.name}</p>
                    <p className="mt-1 truncate font-mono text-xs text-slate-500">{identifier || profile.assetId}</p>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge>{getAnalysisTypeLabel(profile.type)}</Badge>
                    {profile.watched && <Badge>obserwowane</Badge>}
                    {profile.isPilot && <Badge>pilot</Badge>}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {profile.portfolios?.length ? profile.portfolios.join(', ') : 'Lista obserwowanych'}
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-300">{profile.positions?.length || 0}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-300">{profile.sources?.length || 0}</td>
                <td className="px-4 py-3 text-slate-300">
                  {latest ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge status={latest.status}>{getStatusLabel(latest.status)}</Badge>
                      <span className="text-xs text-slate-500">{formatDate(latest.approvedAt || latest.createdAt || latest.updatedAt)}</span>
                    </div>
                  ) : (
                    <span className="text-slate-500">Brak analizy</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </div>
);

const WatchlistForm = ({ helperOnline, onCreate, busy }) => {
  const [visible, setVisible] = useState(false);
  const [form, setForm] = useState({ name: '', identifier: '', type: 'company' });

  const submit = (event) => {
    event.preventDefault();
    const name = form.name.trim();
    const identifier = form.identifier.trim();
    if (!name && !identifier) return;

    const identity = resolveAnalysisIdentity({ quote: identifier, label: name || identifier });
    onCreate({
      ...identity,
      name: name || identity.name,
      type: form.type === 'etf' ? 'etf' : identity.type,
      watched: true,
    }).then(() => {
      setVisible(false);
      setForm({ name: '', identifier: '', type: 'company' });
    }).catch(() => {});
  };

  if (!visible) {
    return (
      <SecondaryButton disabled={!helperOnline || busy} onClick={() => setVisible(true)}>
        + Dodaj obserwowane
      </SecondaryButton>
    );
  }

  return (
    <form onSubmit={submit} className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-slate-700/70 bg-slate-950/60 p-3 sm:w-auto">
      <input
        value={form.name}
        onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
        placeholder="Nazwa"
        className="min-w-32 flex-1 rounded-lg border border-slate-700/70 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-500 sm:w-40"
      />
      <input
        value={form.identifier}
        onChange={(event) => setForm((current) => ({ ...current, identifier: event.target.value }))}
        placeholder="Ticker / ISIN"
        className="min-w-28 flex-1 rounded-lg border border-slate-700/70 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-500 sm:w-32"
      />
      <select
        value={form.type}
        onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}
        className="rounded-lg border border-slate-700/70 bg-slate-900 px-3 py-2 text-xs text-slate-200 outline-none focus:border-blue-500"
      >
        <option value="company">Spółka</option>
        <option value="etf">ETF</option>
      </select>
      <PrimaryButton type="submit" disabled={busy}>Dodaj</PrimaryButton>
      <SecondaryButton type="button" onClick={() => setVisible(false)}>Anuluj</SecondaryButton>
    </form>
  );
};

const AnalysisList = ({ profiles, helperStatus, helperError, budget, onRefresh, onCreate, onBudgetUpdate, onExport, onImport, busy }) => {
  const navigate = useNavigate();

  return (
  <div className="mx-auto max-w-7xl p-8 animate-fadeIn">
    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-blue-400">Biblioteka badań</p>
        <h1 className="text-3xl font-bold text-white">Analiza aktywów</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
          Raporty, wnioski i metryki są wspólne dla pozycji z Maklera oraz IKZE, a ich koszt i historia pozostają lokalne.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge status={helperStatus === 'online' ? 'online' : 'offline'}>
          Helper: {helperStatus === 'online' ? 'online' : 'offline'}
        </Badge>
        <SecondaryButton disabled={busy} onClick={onRefresh}>Synchronizuj widok</SecondaryButton>
        <WatchlistForm helperOnline={helperStatus === 'online'} onCreate={onCreate} busy={busy} />
      </div>
    </div>

      <HelperBanner status={helperStatus} error={helperError} onRetry={onRefresh} />

      {helperStatus === 'loading' && (
        <div className="mb-6">
          <LoadingCallout message="Synchronizuję profile analityczne, budżet i lokalny stan helpera..." />
        </div>
      )}

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Profile analityczne</p>
        <p className="mt-2 text-2xl font-bold text-white">{profiles.length}</p>
      </div>
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pozycje w portfelach</p>
        <p className="mt-2 text-2xl font-bold text-white">{profiles.reduce((total, profile) => total + (profile.positions?.length || 0), 0)}</p>
      </div>
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Limit miesięczny</p>
        <p className="mt-2 text-2xl font-bold text-white">{formatUsd(budget?.monthlyLimitUsd ?? budget?.limitUsd ?? 10)}</p>
      </div>
    </div>

    {profiles.length ? (
      <AnalysisProfilesTable
        profiles={profiles}
        onOpen={(nextAssetId) => navigate(getAnalysisRoute(nextAssetId))}
      />
    ) : (
      <EmptyState>
        Brak aktywów do analizy. Zaimportuj pozycje w Dane Live lub dodaj instrument do listy obserwowanych.
      </EmptyState>
    )}

    <div className="mt-8">
      <BudgetPanel
        key={`budget-${budget?.monthlyLimitUsd ?? budget?.limitUsd ?? 10}`}
        budget={budget}
        helperOnline={helperStatus === 'online'}
        onUpdate={onBudgetUpdate}
        onExport={onExport}
        onImport={onImport}
        busy={busy}
      />
    </div>
  </div>
  );
};

const Metric = ({ label, value, tone = 'default' }) => (
  <div className="rounded-lg border border-slate-800/70 bg-slate-950/60 px-3 py-2.5">
    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className={`mt-1 font-mono text-sm font-semibold ${
      tone === 'positive' ? 'text-emerald-300' : tone === 'negative' ? 'text-rose-300' : 'text-slate-100'
    }`}>{value}</p>
  </div>
);

const PositionSummary = ({ positions }) => {
  if (!positions?.length) {
    return <EmptyState>To aktywo nie ma obecnie pozycji w zaimportowanych portfelach.</EmptyState>;
  }

  return (
    <div className="space-y-3">
      {positions.map((position, index) => {
        const metrics = getPositionMetrics(position.row, position.portfolioRows);
        const resultTone = metrics.profitLoss > 0 ? 'positive' : metrics.profitLoss < 0 ? 'negative' : 'default';
        return (
          <div key={`${position.portfolioName}-${index}`} className="rounded-xl border border-slate-800/70 bg-slate-950/50 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-200">{position.portfolioName}</p>
              <Badge>{metrics.quantity === null ? 'brak liczby jednostek' : `${formatNumber(metrics.quantity, 4)} jednostek`}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Aktualna wartość" value={formatCurrency(metrics.marketValue)} />
              <Metric label="Aktualny kurs" value={formatCurrency(metrics.currentPrice)} />
              <Metric label="Zysk / strata" value={formatCurrency(metrics.profitLoss)} tone={resultTone} />
              <Metric label="Udział w portfelu" value={metrics.portfolioShare === null ? EMPTY_VALUE : `${formatNumber(metrics.portfolioShare)}%`} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const SourceList = ({ sources, helperOnline, busy, onAdd, onDelete }) => {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', url: '', role: 'official' });

  const submit = (event) => {
    event.preventDefault();
    if (!form.url.trim()) return;
    onAdd({ ...form, title: form.title.trim() || form.url.trim() }).then(() => {
      setForm({ title: '', url: '', role: 'official' });
      setAdding(false);
    }).catch(() => {});
  };

  return (
    <section className="rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl">
      <SectionHeading
        title="Źródła"
        description="Najpierw używane są zapisane źródła. Dodanie lub wyszukanie nowego źródła zawsze wymaga działania użytkownika."
        action={!adding && (
          <SecondaryButton disabled={!helperOnline || busy} onClick={() => setAdding(true)}>+ Dodaj źródło</SecondaryButton>
        )}
      />
      {adding && (
        <form onSubmit={submit} className="mb-4 grid gap-2 rounded-xl border border-slate-700/70 bg-slate-950/60 p-3 md:grid-cols-[1fr_1.2fr_auto_auto]">
          <input
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            placeholder="Nazwa źródła"
            className="rounded-lg border border-slate-700/70 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-500"
          />
          <input
            value={form.url}
            onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
            type="url"
            required
            placeholder="https://…"
            className="rounded-lg border border-slate-700/70 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-500"
          />
          <select
            value={form.role}
            onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}
            className="rounded-lg border border-slate-700/70 bg-slate-900 px-3 py-2 text-xs text-slate-200 outline-none focus:border-blue-500"
          >
            <option value="official">Oficjalne</option>
            <option value="reference">Pomocnicze</option>
          </select>
          <div className="flex gap-2">
            <PrimaryButton type="submit" disabled={busy}>Zapisz</PrimaryButton>
            <SecondaryButton type="button" onClick={() => setAdding(false)}>Anuluj</SecondaryButton>
          </div>
        </form>
      )}
      {sources?.length ? (
        <div className="space-y-2">
          {sources.map((source, index) => {
            const sourceId = getItemId(source) || source.url || String(index);
            const url = source.url || source.sourceUrl;
            return (
              <div key={sourceId} className="flex flex-col gap-2 rounded-xl border border-slate-800/70 bg-slate-950/45 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={url} target="_blank" rel="noreferrer" className="truncate text-sm font-semibold text-blue-300 hover:text-blue-200 hover:underline">
                      {source.title || source.name || url}
                    </a>
                    <Badge>{source.role === 'official' ? 'oficjalne' : 'pomocnicze'}</Badge>
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-slate-500">{url}</p>
                </div>
                {source.persisted !== false && getItemId(source) && (
                  <ActionButton
                    className="self-start text-slate-500 hover:bg-rose-500/10 hover:text-rose-300 sm:self-auto"
                    disabled={!helperOnline || busy}
                    onClick={() => onDelete(getItemId(source))}
                    title="Usuń zapisane źródło"
                  >
                    Usuń
                  </ActionButton>
                )}
              </div>
            );
          })}
        </div>
      ) : <EmptyState>Nie zapisano źródeł. Możesz dodać oficjalną stronę emitenta albo później zlecić ich wyszukanie.</EmptyState>}
    </section>
  );
};

const CandidateList = ({ candidates, helperOnline, busy, onDiscover, onApprove }) => (
  <section className="rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl">
    <SectionHeading
      title="Kandydaci dokumentów"
      description="Najpierw wybierasz dokument, dopiero potem pobierany jest oryginał i może powstać płatna analiza."
      action={<PrimaryButton disabled={!helperOnline || busy} onClick={onDiscover}>Wyszukaj dokument</PrimaryButton>}
    />
    {candidates?.length ? (
      <div className="space-y-2">
        {candidates.map((candidate, index) => {
          const candidateId = getItemId(candidate) || String(index);
          const url = candidate.url || candidate.sourceUrl;
          return (
            <div key={candidateId} className="flex flex-col gap-3 rounded-xl border border-slate-800/70 bg-slate-950/50 p-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {url ? <a href={url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue-300 hover:underline">{candidate.title || candidate.name || 'Dokument'}</a> : <p className="text-sm font-semibold text-slate-200">{candidate.title || candidate.name || 'Dokument'}</p>}
                  {candidate.type && <Badge>{candidate.type}</Badge>}
                  {candidate.period && <Badge>{candidate.period}</Badge>}
                </div>
                <p className="mt-1 text-xs text-slate-500">{candidate.sourceTitle || candidate.publisher || 'Źródło znalezione na żądanie'}{candidate.publishedAt ? ` · ${formatDate(candidate.publishedAt)}` : ''}</p>
              </div>
              <PrimaryButton disabled={!helperOnline || busy || !getItemId(candidate)} onClick={() => onApprove(getItemId(candidate))}>
                Zatwierdź i pobierz
              </PrimaryButton>
            </div>
          );
        })}
      </div>
    ) : <EmptyState>Nie wyszukiwano jeszcze kandydatów w tej sesji.</EmptyState>}
  </section>
);

const DocumentList = ({ documents, selectedIds, helperOnline, busy, onToggle, onImport, onDelete, getDownloadUrl, compact = false }) => {
  const inputRef = useRef(null);
  const [metadata, setMetadata] = useState({ title: '', type: '', period: '' });

  const upload = async (event) => {
    const [file] = event.target.files || [];
    event.target.value = '';
    if (!file) return;
    try {
      await onImport(file, metadata);
      setMetadata({ title: '', type: '', period: '' });
    } catch {
      // The invoking page displays the error in a single, visible location.
    }
  };

  return (
    <section className={`rounded-2xl border border-slate-800/80 bg-slate-900 shadow-xl ${compact ? 'p-4' : 'p-5'}`}>
      {compact ? (
        <div className="mb-4">
          <h2 className="text-base font-bold text-white">Archiwum dokumentów</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Zaznaczone dokumenty trafią do Perplexity dopiero po kliknięciu „Analizuj”.
          </p>
          <SecondaryButton disabled={!helperOnline || busy} onClick={() => inputRef.current?.click()} className="mt-3 w-full">
            Wgraj raport ręcznie
          </SecondaryButton>
        </div>
      ) : (
        <SectionHeading
          title="Archiwum dokumentów"
          description="Oryginalny PDF, HTML lub ZIP pozostaje lokalnie. Zaznaczone dokumenty są wysyłane do Perplexity dopiero po kliknięciu „Analizuj”."
          action={(
            <SecondaryButton disabled={!helperOnline || busy} onClick={() => inputRef.current?.click()}>
              Wgraj raport ręcznie
            </SecondaryButton>
          )}
        />
      )}
      <input ref={inputRef} type="file" accept=".pdf,.html,.htm,.zip,.txt,.doc,.docx" className="hidden" onChange={upload} />
      <div className={`mb-4 grid gap-2 rounded-xl border border-slate-800/70 bg-slate-950/50 p-3 ${compact ? '' : 'md:grid-cols-3'}`}>
        <input
          value={metadata.title}
          onChange={(event) => setMetadata((current) => ({ ...current, title: event.target.value }))}
          placeholder="Tytuł (opcjonalnie)"
          className="rounded-lg border border-slate-700/70 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-500"
        />
        <input
          value={metadata.type}
          onChange={(event) => setMetadata((current) => ({ ...current, type: event.target.value }))}
          placeholder="Typ, np. raport kwartalny"
          className="rounded-lg border border-slate-700/70 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-500"
        />
        <input
          value={metadata.period}
          onChange={(event) => setMetadata((current) => ({ ...current, period: event.target.value }))}
          placeholder="Okres, np. Q1 2026"
          className="rounded-lg border border-slate-700/70 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-500"
        />
      </div>
      {documents?.length ? (
        <div className="space-y-2">
          {documents.map((document, index) => {
            const documentId = getItemId(document) || String(index);
            const title = document.title || document.name || document.fileName || 'Dokument';
            const isSelected = selectedIds.includes(documentId);
            return (
              <div key={documentId} className={`flex flex-col gap-3 rounded-xl border p-3 ${compact ? '' : 'lg:flex-row lg:items-center lg:justify-between'} ${isSelected ? 'border-blue-500/35 bg-blue-500/5' : 'border-slate-800/70 bg-slate-950/50'}`}>
                <label className="flex min-w-0 cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(documentId)}
                    disabled={document.analyzable === false}
                    className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-200">{title}</span>
                      {document.type && <Badge>{document.type}</Badge>}
                      {document.format && <Badge>{String(document.format).toUpperCase()}</Badge>}
                      <Badge status={document.status}>{getStatusLabel(document.status)}</Badge>
                    </span>
                    <span className="mt-1 block break-words text-xs text-slate-500">
                      {[document.period || document.reportingPeriod, document.publishedAt && formatDate(document.publishedAt), (document.sha256 || document.hash) && `hash: ${String(document.sha256 || document.hash).slice(0, 10)}…`, document.analyzable === false && 'archiwum — wybierz rozpakowany plik'].filter(Boolean).join(' · ') || 'Brak metadanych'}
                    </span>
                  </span>
                </label>
                <div className={`flex shrink-0 flex-wrap gap-2 ${compact ? 'pl-7' : ''}`}>
                  {getItemId(document) && (
                    <a
                      href={getDownloadUrl(getItemId(document))}
                      target="_blank"
                      rel="noreferrer"
                      className={`inline-flex items-center justify-center rounded-lg border border-slate-700/70 bg-slate-800/60 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-800 ${compact ? 'flex-1' : ''}`}
                    >
                      Otwórz
                    </a>
                  )}
                  {getItemId(document) && (
                    <ActionButton
                      disabled={!helperOnline || busy}
                      className={`${compact ? 'flex-1' : ''} text-slate-500 hover:bg-rose-500/10 hover:text-rose-300`}
                      onClick={() => onDelete(getItemId(document))}
                    >
                      Usuń
                    </ActionButton>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : <EmptyState>Brak zarchiwizowanych dokumentów. Wyszukaj kandydatów lub użyj ręcznego importu jako fallback.</EmptyState>}
    </section>
  );
};

const getAnalysisSummary = (analysis) => (
  analysis?.summary
  || analysis?.content?.summary
  || analysis?.overview
  || analysis?.result?.summary
  || ''
);

const getAnalysisItems = (analysis, keys) => {
  const source = analysis?.content || analysis?.result || analysis || {};
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) return [value];
  }
  return [];
};

const VALUATION_METRIC_SPECS = [
  { label: 'C/Z', aliases: ['C/Z', 'P/E', 'PE', 'Cena/Zysk'], valueType: 'multiple' },
  { label: 'C/WK', aliases: ['C/WK', 'P/B', 'PB', 'Cena/Wartość księgowa'] },
  { label: 'C/WK Grahama', aliases: ['C/WK Grahama', 'Graham P/B', 'Wskaźnik Grahama'] },
  { label: 'C/P', aliases: ['C/P', 'P/CF', 'Cena/Przepływy'] },
  { label: 'C/S', aliases: ['C/S', 'P/S', 'Cena/Sprzedaż'] },
  { label: 'C/ZO', aliases: ['C/ZO', 'Cena/Zysk operacyjny', 'P/EBIT'] },
  { label: 'EV/P', aliases: ['EV/P', 'EV/Sales', 'EV/Przychody'] },
  { label: 'EV/EBIT', aliases: ['EV/EBIT'] },
  { label: 'EV/EBITDA', aliases: ['EV/EBITDA'] },
  { label: 'ROA', aliases: ['ROA', 'Rentowność aktywów'], valueType: 'percent' },
  { label: 'ROE', aliases: ['ROE', 'Rentowność kapitału własnego'], valueType: 'percent' },
].map((spec) => ({ valueType: 'multiple', ...spec, aliases: spec.aliases.map(normalizeText) }));

const FINANCIAL_RESULT_SPECS = [
  { label: 'Przychody ze sprzedaży', aliases: ['Przychody ze sprzedaży', 'Przychody', 'Sprzedaż'], aggregation: 'sum' },
  { label: 'Zysk (strata) ze sprzedaży', aliases: ['Zysk ze sprzedaży', 'Strata ze sprzedaży', 'Zysk strata ze sprzedaży'], aggregation: 'sum' },
  { label: 'Zysk operacyjny (EBIT)', aliases: ['Zysk operacyjny', 'EBIT'], aggregation: 'sum' },
  { label: 'Zysk (strata) z działalności gospodarczej', aliases: ['Zysk z działalności gospodarczej', 'Strata z działalności gospodarczej', 'Wynik z działalności gospodarczej'], aggregation: 'sum' },
  { label: 'Zysk netto', aliases: ['Zysk netto', 'Strata netto', 'Wynik netto'], aggregation: 'sum' },
  { label: 'Aktywa ogółem', aliases: ['Aktywa ogółem', 'Suma aktywów', 'Aktywa razem'], aggregation: 'q4' },
  { label: 'Aktywa obrotowe', aliases: ['Aktywa obrotowe'], aggregation: 'q4' },
  { label: 'Zobowiązania ogółem', aliases: ['Zobowiązania ogółem', 'Zobowiązania razem'], aggregation: 'q4' },
  { label: 'Zobowiązania długoterminowe', aliases: ['Zobowiązania długoterminowe'], aggregation: 'q4' },
  { label: 'Zobowiązania krótkoterminowe', aliases: ['Zobowiązania krótkoterminowe'], aggregation: 'q4' },
  { label: 'Przepływy pieniężne razem', aliases: ['Przepływy pieniężne razem', 'Przepływy pieniężne netto', 'Cash flow razem'], aggregation: 'sum' },
  { label: 'Dywidenda za dany rok', aliases: ['Dywidenda za dany rok', 'Dywidenda', 'Dividend'], aggregation: 'annual' },
].map((spec) => ({ valueType: 'money', ...spec, aliases: spec.aliases.map(normalizeText) }));

const getMetricLabel = (metric, index) => (
  typeof metric === 'object'
    ? metric.label || metric.name || metric.key || `Metryka ${index + 1}`
    : `Metryka ${index + 1}`
);

const getMetricPeriod = (metric) => (
  typeof metric === 'object'
    ? metric.period || metric.reportingPeriod || metric.date || metric.year || 'Okres niepodany'
    : 'Okres niepodany'
);

const getMetricRawValue = (metric) => (
  typeof metric === 'object'
    ? metric.value ?? metric.displayValue ?? metric.text ?? EMPTY_VALUE
    : metric
);

const findMetricSpec = (label, specs) => {
  const normalized = normalizeText(label);
  return specs.find((spec) => spec.aliases.some((alias) => normalized === alias))
    || specs.find((spec) => spec.aliases.some((alias) => alias.length >= 5 && normalized.includes(alias)));
};

const getMetricPeriodInfo = (period) => {
  const text = String(period || 'Okres niepodany');
  const normalized = normalizeText(text);
  const year = Number((text.match(/(?:19|20)\d{2}/) || [])[0]) || null;
  const romanQuarter = normalized.match(/(?:^|[^a-z0-9])(i{1,3}|iv)(?:kw|kwartal)/)?.[1];
  const quarter = Number((normalized.match(/q([1-4])/) || normalized.match(/([1-4])q/) || normalized.match(/([1-4])kw/))?.[1])
    || ({ i: 1, ii: 2, iii: 3, iv: 4 }[romanQuarter] || null);

  return {
    key: text,
    label: text,
    year,
    quarter,
    isQuarter: Boolean(year && quarter),
    isSynthetic: false,
  };
};

const getMetricUnitText = (metric) => {
  if (!metric || typeof metric !== 'object') return '';
  return [metric.unit, metric.currency, metric.value].filter(Boolean).join(' ');
};

const getPlnAmount = (metric) => {
  const value = getMetricRawValue(metric);
  const number = parseNumericValue(value);
  if (!Number.isFinite(number)) return null;

  const unit = normalizeText(getMetricUnitText(metric));
  if (unit.includes('mld') || unit.includes('bnpln') || unit.includes('billionpln')) return number * 1_000_000_000;
  if (unit.includes('mln') || unit.includes('millionpln')) return number * 1_000_000;
  if (unit.includes('tys') || unit.includes('thousandpln')) return number * 1_000;
  if (unit.includes('pln') || unit.includes('zl')) return number;
  return null;
};

const formatMlnPln = (amountPln) => {
  const value = amountPln / 1_000_000;
  return `${new Intl.NumberFormat('pl-PL', {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1,
  }).format(value)} mln PLN`;
};

const formatMetricNumber = (value, maximumFractionDigits = 2) => new Intl.NumberFormat('pl-PL', {
  maximumFractionDigits,
}).format(value);

const formatMetricValue = (metric, spec) => {
  const rawValue = getMetricRawValue(metric);
  const number = parseNumericValue(rawValue);
  const normalizedUnit = normalizeText(getMetricUnitText(metric));

  if (spec.valueType === 'money') {
    if (normalizeText(spec.label).includes('dywidenda') && normalizedUnit.includes('akcj') && Number.isFinite(number)) {
      return `${formatMetricNumber(number, 2)} PLN/akcję`;
    }
    const amountPln = getPlnAmount(metric);
    if (amountPln !== null) return formatMlnPln(amountPln);
  }

  if (spec.valueType === 'percent' && Number.isFinite(number)) {
    const percent = !normalizedUnit.includes('proc') && !normalizedUnit.includes('percent') && !normalizedUnit.includes('%') && Math.abs(number) <= 1
      ? number * 100
      : number;
    return `${formatMetricNumber(percent, 2)}%`;
  }

  if (spec.valueType === 'multiple' && Number.isFinite(number)) {
    return `${formatMetricNumber(number, 2)}x`;
  }

  if (Number.isFinite(number) && !normalizedUnit) return formatMetricNumber(number, 2);
  return String(rawValue ?? EMPTY_VALUE);
};

const normalizeMetricCell = (metric, spec) => {
  const source = typeof metric === 'object' ? metric.source || metric.sourceTitle : '';
  const trend = typeof metric === 'object' ? metric.trend || metric.yearOverYear : '';
  return {
    metric,
    display: formatMetricValue(metric, spec),
    amountPln: getPlnAmount(metric),
    source,
    trend,
    note: '',
  };
};

const sortPeriods = (left, right) => {
  if (left.year !== right.year) return (right.year || 0) - (left.year || 0);
  if (left.isSynthetic !== right.isSynthetic) return left.isSynthetic ? -1 : 1;
  if (left.quarter !== right.quarter) return (right.quarter || 0) - (left.quarter || 0);
  return left.label.localeCompare(right.label, 'pl');
};

const buildMetricTable = (metrics, specs, { aggregateAnnual = false } = {}) => {
  const rows = specs.map((spec) => ({ spec, values: new Map() }));
  const byLabel = new Map(rows.map((row) => [row.spec.label, row]));
  const periods = new Map();

  metrics.forEach((metric, index) => {
    const spec = findMetricSpec(getMetricLabel(metric, index), specs);
    if (!spec) return;

    const periodInfo = getMetricPeriodInfo(getMetricPeriod(metric));
    periods.set(periodInfo.key, periodInfo);
    byLabel.get(spec.label).values.set(periodInfo.key, normalizeMetricCell(metric, spec));
  });

  if (aggregateAnnual) {
    rows.forEach((row) => {
      const byYear = new Map();
      [...row.values.entries()].forEach(([key, cell]) => {
        const periodInfo = periods.get(key);
        if (!periodInfo?.isQuarter) return;
        if (!byYear.has(periodInfo.year)) byYear.set(periodInfo.year, new Map());
        byYear.get(periodInfo.year).set(periodInfo.quarter, cell);
      });

      byYear.forEach((quarters, year) => {
        if (![1, 2, 3, 4].every((quarter) => quarters.has(quarter))) return;
        const key = `FY:${year}`;
        const periodInfo = { key, label: `${year}`, year, quarter: 5, isSynthetic: true };
        periods.set(key, periodInfo);

        if (row.spec.aggregation === 'sum') {
          const amountPln = [1, 2, 3, 4].reduce((total, quarter) => total + (quarters.get(quarter).amountPln || 0), 0);
          row.values.set(key, {
            display: formatMlnPln(amountPln),
            amountPln,
            note: 'suma Q1-Q4',
            source: '',
            trend: '',
          });
        }

        if (row.spec.aggregation === 'q4') {
          row.values.set(key, {
            ...quarters.get(4),
            note: 'stan na koniec Q4',
          });
        }
      });
    });
  }

  const sortedPeriods = [...periods.values()].sort(sortPeriods);
  return {
    periods: sortedPeriods.length ? sortedPeriods : [{ key: 'current', label: 'Wartość', isSynthetic: false }],
    rows,
  };
};

const FinancialMetricTable = ({ title, description, metrics, specs, aggregateAnnual = false }) => {
  const table = buildMetricTable(metrics, specs, { aggregateAnnual });

  return (
    <div>
      <div className="mb-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
        {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-800/80">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800/80 text-left text-sm">
            <thead className="bg-slate-950/60 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="sticky left-0 z-10 min-w-56 bg-slate-950/95 px-3 py-3">Metryka</th>
                {table.periods.map((period) => (
                  <th key={period.key} className="min-w-40 px-3 py-3">
                    <span>{period.label}</span>
                    {period.isSynthetic && <span className="ml-2 rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">rok</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 bg-slate-900">
              {table.rows.map((row) => (
                <tr key={row.spec.label}>
                  <th className="sticky left-0 z-10 bg-slate-900 px-3 py-3 text-xs font-semibold text-slate-300">{row.spec.label}</th>
                  {table.periods.map((period) => {
                    const cell = row.values.get(period.key);
                    return (
                      <td key={`${row.spec.label}-${period.key}`} className="px-3 py-3 align-top text-slate-200">
                        {cell ? (
                          <div>
                            <p className="font-mono text-sm font-semibold">{cell.display}</p>
                            {(cell.note || cell.trend || cell.source) && (
                              <p className="mt-1 text-xs leading-5 text-slate-500">
                                {[cell.note, cell.trend && `Trend: ${cell.trend}`, cell.source].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-600">{EMPTY_VALUE}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const MetricMatrix = ({ metrics }) => (
  <div className="space-y-6">
    <FinancialMetricTable
      title="Wskaźniki wyceny i rentowności"
      description="Stały układ najważniejszych wskaźników; brak wartości oznacza, że model nie znalazł jej wiarygodnie w dokumentach."
      metrics={metrics}
      specs={VALUATION_METRIC_SPECS}
    />
    <FinancialMetricTable
      title="Wyniki finansowe"
      description="Kwoty są normalizowane do mln PLN. Dla kompletu Q1-Q4 dodawana jest kolumna roczna: suma dla wyników i przepływów, stan Q4 dla pozycji bilansowych."
      metrics={metrics}
      specs={FINANCIAL_RESULT_SPECS}
      aggregateAnnual
    />
  </div>
);

const AnalysisPreview = ({ analysis, helperOnline, busy, onApprove }) => {
  if (!analysis) {
    return (
      <section className="rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl">
        <SectionHeading title="Wynik analizy" description="Po uruchomieniu analizy zobaczysz szkic przed jego zapisaniem w historii." />
        <EmptyState>Brak szkicu lub zatwierdzonej analizy dla wybranych dokumentów.</EmptyState>
      </section>
    );
  }

  const analysisId = getItemId(analysis);
  const isDraft = String(analysis.status || '').toLowerCase() === 'draft';
  const insights = getAnalysisItems(analysis, ['conclusions', 'keyTakeaways', 'insights', 'findings']);
  const risks = getAnalysisItems(analysis, ['risks', 'riskFactors']);
  const metrics = getAnalysisItems(analysis, ['metrics', 'keyMetrics']);
  const citations = getAnalysisItems(analysis, ['sources', 'citations', 'evidence']);

  return (
    <section className="rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl">
      <SectionHeading
        title={isDraft ? 'Podgląd szkicu analizy' : 'Najnowsza zatwierdzona analiza'}
        description={`Schemat ${analysis.schemaVersion || analysis.version || 'v1'} · ${analysis.model || analysis.provider || 'lokalna analiza'} · ${formatDate(analysis.createdAt || analysis.updatedAt, { withTime: true })}`}
        action={isDraft && (
          <PrimaryButton disabled={!helperOnline || busy || !analysisId} onClick={() => onApprove(analysisId)}>
            Zatwierdź i zapisz
          </PrimaryButton>
        )}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge status={analysis.status}>{getStatusLabel(analysis.status)}</Badge>
        {analysis.costUsd !== undefined && <Badge>Koszt: {formatUsd(analysis.costUsd)}</Badge>}
        {analysis.documentIds?.length && <Badge>Dokumenty: {analysis.documentIds.length}</Badge>}
      </div>
      <div className="space-y-5 text-sm leading-6 text-slate-300">
        <div className="rounded-xl border border-slate-800/70 bg-slate-950/50 p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Podsumowanie</p>
          <p>{getAnalysisSummary(analysis) || 'Model nie zwrócił jeszcze podsumowania w zapisanym schemacie.'}</p>
        </div>
        {insights.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Wnioski</p>
            <ul className="space-y-2">
              {insights.map((item, index) => <li key={`${index}-${String(item).slice(0, 16)}`} className="rounded-lg border border-slate-800/70 bg-slate-950/40 px-3 py-2">{typeof item === 'string' ? item : item.text || item.value || JSON.stringify(item)}</li>)}
            </ul>
          </div>
        )}
        <MetricMatrix metrics={metrics} />
        {risks.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-rose-300">Ryzyka</p>
            <ul className="space-y-2">
              {risks.map((item, index) => <li key={`${index}-${String(item).slice(0, 16)}`} className="rounded-lg border border-rose-500/15 bg-rose-500/5 px-3 py-2 text-slate-300">{typeof item === 'string' ? item : item.text || item.value || JSON.stringify(item)}</li>)}
            </ul>
          </div>
        )}
        {citations.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Dowody i źródła</p>
            <div className="space-y-2">
              {citations.map((citation, index) => {
                const url = typeof citation === 'object' ? citation.url || citation.sourceUrl : '';
                const label = typeof citation === 'object' ? citation.title || citation.text || citation.url : citation;
                return url ? <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="block rounded-lg border border-slate-800/70 bg-slate-950/40 px-3 py-2 text-blue-300 hover:underline">{label}</a> : <p key={`${String(label)}-${index}`} className="rounded-lg border border-slate-800/70 bg-slate-950/40 px-3 py-2">{label}</p>;
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

const AnalysisHistory = ({ analyses }) => (
  <section className="rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl">
    <SectionHeading title="Historia analiz" description="Zatwierdzone wersje pozostają przypisane do dokumentów wejściowych." />
    {analyses?.length ? (
      <div className="space-y-2">
        {analyses.map((analysis, index) => (
          <div key={getItemId(analysis) || index} className="flex flex-col gap-2 rounded-xl border border-slate-800/70 bg-slate-950/45 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-200">{analysis.title || `Analiza ${formatDate(analysis.createdAt || analysis.updatedAt)}`}</p>
              <p className="mt-1 text-xs text-slate-500">{analysis.model || analysis.provider || 'model niepodany'} · {analysis.schemaVersion || analysis.version || 'v1'} · {analysis.costUsd === undefined ? 'koszt niepodany' : formatUsd(analysis.costUsd)}</p>
            </div>
            <Badge status={analysis.status}>{getStatusLabel(analysis.status)}</Badge>
          </div>
        ))}
      </div>
    ) : <EmptyState>Historia będzie widoczna po zatwierdzeniu pierwszego szkicu.</EmptyState>}
  </section>
);

const SecondOpinion = ({ profile }) => (
  <details className="rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl">
    <summary className="cursor-pointer text-base font-bold text-white">Opcjonalna druga opinia</summary>
    <p className="mt-3 text-sm leading-6 text-slate-400">
      NotebookLM lub ChatGPT możesz użyć osobno na tych samych zarchiwizowanych dokumentach. Ta opinia ma charakter pomocniczy i nie nadpisuje analizy bazowej ze źródłami.
    </p>
    <p className="mt-3 rounded-lg border border-slate-800/70 bg-slate-950/50 p-3 font-mono text-xs leading-5 text-slate-300">
      Przeanalizuj dokumenty dla: {profile.name}. Oddziel fakty od interpretacji, wskaż strony/sekcje źródłowe i porównaj okres rok do roku.
    </p>
  </details>
);

const getProfileParts = (response, fallback) => {
  const profile = response?.profile || response || {};
  const pickArray = (key) => (
    Array.isArray(response?.[key]) ? response[key] : Array.isArray(profile?.[key]) ? profile[key] : []
  );
  return {
    profile: { ...fallback, ...profile },
    sources: pickArray('sources'),
    documents: pickArray('documents'),
    candidates: pickArray('candidates'),
    analyses: pickArray('analyses'),
  };
};

const AssetAnalysisDetail = ({ assetId, fallbackProfile, helperStatus, helperError, budget, onRefreshOverview, onBudgetUpdate, busy, setBusy, setNotice }) => {
  const [detail, setDetail] = useState(() => getProfileParts(null, fallbackProfile));
  const [loading, setLoading] = useState(false);
  const [operationMessage, setOperationMessage] = useState('');
  const [detailError, setDetailError] = useState('');
  const [selectedDocumentIds, setSelectedDocumentIds] = useState([]);

  const helperOnline = helperStatus === 'online';
  const profile = detail.profile || fallbackProfile;
  const sources = detail.sources.length ? detail.sources : profile.sources || [];
  const activeAnalysis = detail.analyses.find((analysis) => String(analysis.status || '').toLowerCase() === 'draft')
    || detail.analyses.find((analysis) => String(analysis.status || '').toLowerCase() === 'approved')
    || detail.analyses[0]
    || profile.latestAnalysis
    || null;

  const refreshDetail = useCallback(async () => {
    if (!helperOnline) return;
    setLoading(true);
    setDetailError('');
    try {
      const [profileResult, sourcesResult, documentsResult, candidatesResult, analysesResult] = await Promise.all([
        analysisApi.getProfile(assetId),
        analysisApi.listSources(assetId),
        analysisApi.listDocuments(assetId),
        analysisApi.listCandidates(assetId),
        analysisApi.listAnalyses(assetId),
      ]);
      const next = getProfileParts(profileResult, fallbackProfile);
      next.sources = sourcesResult.length ? sourcesResult : next.sources;
      next.documents = documentsResult.length ? documentsResult : next.documents;
      next.candidates = candidatesResult.length ? candidatesResult : next.candidates;
      next.analyses = analysesResult.length ? analysesResult : next.analyses;
      setDetail(next);
    } catch (error) {
      setDetailError(error.message || 'Nie udało się odczytać danych profilu.');
    } finally {
      setLoading(false);
    }
  }, [assetId, fallbackProfile, helperOnline]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshDetail();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshDetail]);

  const ensureProfile = async () => {
    try {
      return await analysisApi.getProfile(assetId);
    } catch (error) {
      if (error.status !== 404) throw error;
      return analysisApi.createProfile({
        assetId,
        type: fallbackProfile.type,
        name: fallbackProfile.name,
        canonicalId: fallbackProfile.isin || fallbackProfile.ticker,
        aliases: fallbackProfile.aliases || [],
        watched: Boolean(fallbackProfile.watched),
      });
    }
  };

  const perform = async (task, successMessage, loadingMessage = 'Przetwarzam operację analizy...') => {
    if (!helperOnline) {
      setNotice({ type: 'error', text: 'Uruchom lokalny helper, aby wykonać tę akcję.' });
      return null;
    }
    setBusy(true);
    setOperationMessage(loadingMessage);
    try {
      const result = await task();
      if (successMessage) setNotice({ type: 'success', text: successMessage });
      await Promise.all([refreshDetail(), onRefreshOverview()]);
      return result;
    } catch (error) {
      setNotice({ type: 'error', text: error.message || 'Nie udało się wykonać akcji.' });
      return null;
    } finally {
      setBusy(false);
      setOperationMessage('');
    }
  };

  const addSource = (source) => perform(async () => {
    await ensureProfile();
    return analysisApi.addSource(assetId, source);
  }, 'Źródło zapisane.', 'Zapisuję źródło w lokalnym profilu analizy...');

  const deleteSource = (sourceId) => perform(
    () => analysisApi.deleteSource(assetId, sourceId),
    'Źródło usunięte.',
    'Usuwam źródło z konfiguracji profilu...',
  );

  const discover = () => perform(async () => {
    await ensureProfile();
    return analysisApi.discoverCandidates(assetId, {
      sourceIds: sources.map(getItemId).filter(Boolean),
    });
  }, 'Wyszukiwanie kandydatów zostało zakończone. Wybierz dokument przed analizą.', 'Szukam dokumentów w zapisanych źródłach...');

  const approveCandidate = (candidateId) => perform(
    () => analysisApi.approveCandidate(assetId, candidateId, { download: true }),
    'Dokument został zatwierdzony i zarchiwizowany lokalnie.',
    'Pobieram i archiwizuję wybrany dokument lokalnie...',
  );

  const importDocument = (file, metadata) => perform(async () => {
    await ensureProfile();
    return analysisApi.importDocument(assetId, file, metadata);
  }, 'Dokument został zapisany lokalnie.', 'Importuję dokument do lokalnego archiwum...');

  const deleteDocument = (documentId) => perform(
    () => analysisApi.deleteDocument(documentId),
    'Dokument usunięty z archiwum.',
    'Usuwam dokument z lokalnego archiwum...',
  );

  const runAnalysis = () => perform(
    () => analysisApi.runAnalysis(assetId, { documentIds: selectedDocumentIds, model: 'sonar-pro' }),
    'Powstał szkic analizy. Sprawdź go przed zapisaniem.',
    'Wysyłam zaznaczone dokumenty do analizy i czekam na szkic...',
  );

  const approveAnalysis = (analysisId) => perform(
    () => analysisApi.approveAnalysis(analysisId),
    'Analiza została zatwierdzona i dodana do historii.',
    'Zatwierdzam szkic i zapisuję go w historii...',
  );

  const toggleDocument = (documentId) => {
    setSelectedDocumentIds((current) => (
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId]
    ));
  };

  const identifier = profile.isin || profile.canonicalId || (profile.ticker && profile.exchange ? `${profile.ticker}:${profile.exchange}` : profile.ticker);

  return (
    <div className="mx-auto max-w-7xl p-8 animate-fadeIn">
      <div className="mb-8">
        <Link to="/analysis" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 transition-colors hover:text-blue-300">← Wszystkie aktywa</Link>
        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge>{getAnalysisTypeLabel(profile.type)}</Badge>
              {profile.isPilot && <Badge>profil pilota</Badge>}
              {helperOnline ? <Badge status="online">helper online</Badge> : <Badge status="offline">helper offline</Badge>}
            </div>
            <h1 className="text-3xl font-bold text-white">{profile.name}</h1>
            <p className="mt-2 font-mono text-sm text-slate-500">{identifier || assetId}</p>
          </div>
        </div>
      </div>

      <HelperBanner status={helperStatus} error={helperError || detailError} onRetry={onRefreshOverview} />

      {(loading || operationMessage) && (
        <div className="mb-6">
          <LoadingCallout message={operationMessage || 'Wczytuję profil, źródła, dokumenty i historię analiz...'} />
        </div>
      )}

      {detailError && helperOnline && (
        <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
          {detailError} Jeśli profil nie istnieje jeszcze w bazie, dodanie źródła, import dokumentu albo wyszukiwanie utworzy go lokalnie.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <AnalysisPreview analysis={activeAnalysis} helperOnline={helperOnline} busy={busy} onApprove={approveAnalysis} />
          <section className="rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl">
            <SectionHeading
              title="Bieżąca pozycja"
              description="Wycena pochodzi wyłącznie z zaimportowanych danych portfela; nie jest pobierana przez Perplexity."
            />
            <PositionSummary positions={profile.positions || fallbackProfile.positions} />
          </section>
          <AnalysisHistory analyses={detail.analyses} />
          <SecondOpinion profile={profile} />
        </div>
        <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <section className="rounded-2xl border border-slate-800/80 bg-slate-900 p-4 shadow-xl">
            <SectionHeading
              title="Konfiguracja analizy"
              description="Wybierz dokumenty, odśwież dane albo uruchom analizę dla zaznaczonych materiałów."
            />
            <div className="grid gap-2">
              <SecondaryButton disabled={!helperOnline || busy || loading} onClick={refreshDetail}>Odśwież dane</SecondaryButton>
              <PrimaryButton
                disabled={!helperOnline || busy || selectedDocumentIds.length === 0}
                onClick={runAnalysis}
                title={selectedDocumentIds.length === 0 ? 'Zaznacz co najmniej jeden zarchiwizowany dokument.' : undefined}
              >
                Analizuj {selectedDocumentIds.length ? `(${selectedDocumentIds.length})` : ''}
              </PrimaryButton>
              <p className="text-xs leading-5 text-slate-500">
                Zaznaczone dokumenty: {selectedDocumentIds.length}. Analiza korzysta z lokalnego archiwum i zapisanych źródeł.
              </p>
            </div>
          </section>
          <SourceList
            sources={sources}
            helperOnline={helperOnline}
            busy={busy}
            onAdd={addSource}
            onDelete={deleteSource}
          />
          <CandidateList
            candidates={detail.candidates}
            helperOnline={helperOnline}
            busy={busy}
            onDiscover={discover}
            onApprove={approveCandidate}
          />
          <DocumentList
            documents={detail.documents}
            selectedIds={selectedDocumentIds}
            helperOnline={helperOnline}
            busy={busy}
            onToggle={toggleDocument}
            onImport={importDocument}
            onDelete={deleteDocument}
            getDownloadUrl={analysisApi.getDocumentDownloadUrl}
            compact
          />
          <BudgetPanel
            key={`budget-${budget?.monthlyLimitUsd ?? budget?.limitUsd ?? 10}`}
            budget={budget}
            helperOnline={helperOnline}
            onUpdate={onBudgetUpdate}
            onExport={() => setNotice({ type: 'info', text: 'Pełny backup jest dostępny z listy wszystkich aktywów.' })}
            onImport={() => setNotice({ type: 'info', text: 'Import backupu jest dostępny z listy wszystkich aktywów.' })}
            busy={busy}
            compact
          />
        </div>
      </div>
    </div>
  );
};

const normaliseRouteAssetId = (value) => {
  try {
    return decodeURIComponent(value || '');
  } catch {
    return value || '';
  }
};

const toSyncPositions = (profiles) => profiles.flatMap((profile) => (
  (profile.positions || []).map((position) => ({
    assetId: profile.assetId,
    type: profile.type,
    name: profile.name,
    canonicalId: profile.isin || (profile.ticker && profile.exchange ? `${profile.ticker}:${profile.exchange}` : profile.ticker),
    aliases: profile.aliases || [],
    portfolioName: position.portfolioName,
  }))
));

const Analysis = () => {
  const { assetId: routeAssetId } = useParams();
  const liveData = useLiveData();
  const [serverProfiles, setServerProfiles] = useState([]);
  const [budget, setBudget] = useState(null);
  const [helperStatus, setHelperStatus] = useState('loading');
  const [helperError, setHelperError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const portfolioAssets = useMemo(() => getPortfolioAnalysisAssets(liveData), [liveData]);
  const profiles = useMemo(
    () => mergeAnalysisProfiles(portfolioAssets, serverProfiles),
    [portfolioAssets, serverProfiles],
  );
  const assetId = normaliseRouteAssetId(routeAssetId);
  const fallbackProfile = useMemo(() => {
    const found = profiles.find((profile) => profile.assetId === assetId);
    if (found) return found;
    if (assetId === ANALYSIS_ASSET_IDS.CDR || assetId === ANALYSIS_ASSET_IDS.EIMI) {
      return mergeAnalysisProfiles([], []).find((profile) => profile.assetId === assetId);
    }
    return resolveAnalysisIdentity({ quote: assetId, label: assetId || 'Instrument' });
  }, [assetId, profiles]);

  const refreshOverview = useCallback(async () => {
    setHelperStatus('loading');
    setHelperError('');
    try {
      await analysisApi.getHealth();
      setHelperStatus('online');
      const positions = toSyncPositions(portfolioAssets);
      await analysisApi.syncProfiles(positions);
      const [profilesResult, budgetResult] = await Promise.all([
        analysisApi.listProfiles(),
        analysisApi.getBudget(),
      ]);
      setServerProfiles(profilesResult);
      setBudget(budgetResult);
    } catch (error) {
      setHelperStatus('offline');
      setHelperError(error.message || 'Nie udało się połączyć z lokalnym helperem.');
      if (!isHelperUnavailable(error)) setNotice({ type: 'error', text: error.message || 'Błąd lokalnego helpera.' });
    }
  }, [portfolioAssets]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshOverview();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshOverview]);

  const performGlobal = async (task, successMessage) => {
    if (helperStatus !== 'online') {
      setNotice({ type: 'error', text: 'Uruchom lokalny helper, aby wykonać tę akcję.' });
      throw new Error('Lokalny helper jest niedostępny.');
    }
    setBusy(true);
    try {
      const result = await task();
      if (successMessage) setNotice({ type: 'success', text: successMessage });
      await refreshOverview();
      return result;
    } catch (error) {
      setNotice({ type: 'error', text: error.message || 'Nie udało się wykonać akcji.' });
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const createProfile = (profile) => performGlobal(
    () => analysisApi.createProfile(profile),
    'Instrument dodany do listy obserwowanych.',
  );
  const updateBudget = (limit) => performGlobal(
    () => analysisApi.updateBudget(limit),
    'Miesięczny limit został zapisany.',
  );
  const exportBackup = () => performGlobal(async () => {
    const result = await analysisApi.exportBackup(getBrowserState());
    downloadBackupPayload(result);
    return result;
  }, 'Backup został przygotowany.');
  const importBackup = async (file) => {
    const result = await performGlobal(
      () => analysisApi.importBackup(file),
      'Backup został zaimportowany. Odświeżono lokalny stan analizy.',
    );
    const savedState = result?.browserState?.localStorage;
    if (savedState && typeof savedState === 'object') {
      Object.entries(savedState).forEach(([key, value]) => {
        if (PERSISTENT_STATE_KEYS.includes(key) && typeof value === 'string') window.localStorage.setItem(key, value);
      });
      await hydratePersistentState();
      window.setTimeout(() => window.location.reload(), 700);
    }
    return result;
  };

  return (
    <>
      {notice && (
        <div className="fixed right-5 top-5 z-[60] max-w-md animate-fadeIn">
          <div className={`rounded-xl border px-4 py-3 text-sm shadow-2xl ${
            notice.type === 'error'
              ? 'border-rose-500/30 bg-rose-950 text-rose-100'
              : notice.type === 'info'
                ? 'border-blue-500/30 bg-slate-900 text-blue-100'
                : 'border-emerald-500/30 bg-emerald-950 text-emerald-100'
          }`}>
            <div className="flex items-start gap-3">
              <p className="flex-1">{notice.text}</p>
              <button type="button" onClick={() => setNotice(null)} className="text-current/70 hover:text-current" aria-label="Zamknij komunikat">×</button>
            </div>
          </div>
        </div>
      )}
      {assetId ? (
          <AssetAnalysisDetail
            key={assetId}
          assetId={assetId}
          fallbackProfile={fallbackProfile}
          helperStatus={helperStatus}
          helperError={helperError}
          budget={budget}
          onRefreshOverview={refreshOverview}
          onBudgetUpdate={updateBudget}
          busy={busy}
          setBusy={setBusy}
          setNotice={setNotice}
        />
      ) : (
        <AnalysisList
          profiles={profiles}
          helperStatus={helperStatus}
          helperError={helperError}
          budget={budget}
          onRefresh={refreshOverview}
          onCreate={createProfile}
          onBudgetUpdate={updateBudget}
          onExport={exportBackup}
          onImport={importBackup}
          busy={busy}
        />
      )}
    </>
  );
};

export default Analysis;
