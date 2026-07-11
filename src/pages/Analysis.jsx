import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import useLiveData from '../hooks/useLiveData.js';
import { getPositionMetrics } from '../utils/investmentDetails.js';
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

const BudgetPanel = ({ budget, helperOnline, onUpdate, onExport, onImport, busy }) => {
  const importInputRef = useRef(null);
  const [limit, setLimit] = useState(() => String(budget?.monthlyLimitUsd ?? budget?.limitUsd ?? 10));

  const spent = budget?.spentUsd ?? budget?.usedUsd ?? budget?.monthSpentUsd ?? 0;
  const configuredLimit = budget?.monthlyLimitUsd ?? budget?.limitUsd ?? 10;
  const remaining = budget?.remainingUsd ?? Math.max(0, Number(configuredLimit) - Number(spent || 0));

  return (
    <section className="rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl">
      <SectionHeading
        title="Lokalny budżet i backup"
        description="Limit jest kontrolą po stronie aplikacji. Rozliczenia dostawcy API pozostają źródłem ostatecznym."
      />
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="grid grid-cols-3 gap-3">
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
        <div className="flex flex-wrap items-end justify-start gap-2 lg:justify-end">
          <SecondaryButton
            disabled={!helperOnline || busy}
            onClick={() => onUpdate(Number(limit))}
          >
            Zapisz limit
          </SecondaryButton>
          <SecondaryButton disabled={!helperOnline || busy} onClick={onExport}>
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
          >
            Importuj backup
          </SecondaryButton>
        </div>
      </div>
    </section>
  );
};

const ProfileCard = ({ profile }) => {
  const latest = profile.latestAnalysis || profile.analysis || profile.analyses?.[0];
  const identifier = profile.isin || profile.canonicalId || (profile.ticker && profile.exchange
    ? `${profile.ticker}:${profile.exchange}`
    : profile.ticker);

  return (
    <Link
      to={getAnalysisRoute(profile.assetId)}
      className="group flex h-full flex-col rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl transition-all hover:-translate-y-0.5 hover:border-blue-500/35 hover:bg-slate-900/90"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge>{getAnalysisTypeLabel(profile.type)}</Badge>
            {profile.watched && <Badge>obserwowane</Badge>}
            {profile.isPilot && <Badge>pilot</Badge>}
          </div>
          <h2 className="truncate text-base font-bold text-white group-hover:text-blue-200">{profile.name}</h2>
          <p className="mt-1 truncate font-mono text-xs text-slate-500">{identifier || profile.assetId}</p>
        </div>
        <span className="text-slate-600 transition-colors group-hover:text-blue-300">→</span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-800/70 pt-4 text-xs">
        <div>
          <p className="text-slate-500">Portfele</p>
          <p className="mt-1 font-semibold text-slate-300">
            {profile.portfolios?.length ? profile.portfolios.join(', ') : 'Lista obserwowanych'}
          </p>
        </div>
        <div>
          <p className="text-slate-500">Źródła</p>
          <p className="mt-1 font-semibold text-slate-300">{profile.sources?.length || 0}</p>
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-slate-800/70 bg-slate-950/55 px-3 py-2.5 text-xs">
        <p className="text-slate-500">Ostatnia analiza</p>
        <p className="mt-1 font-medium text-slate-300">
          {latest ? `${getStatusLabel(latest.status)} · ${formatDate(latest.approvedAt || latest.createdAt || latest.updatedAt)}` : 'Brak zatwierdzonej analizy'}
        </p>
      </div>
    </Link>
  );
};

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

const AnalysisList = ({ profiles, helperStatus, helperError, budget, onRefresh, onCreate, onBudgetUpdate, onExport, onImport, busy }) => (
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
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {profiles.map((profile) => <ProfileCard key={profile.assetId} profile={profile} />)}
      </div>
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

const DocumentList = ({ documents, selectedIds, helperOnline, busy, onToggle, onImport, onDelete, getDownloadUrl }) => {
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
    <section className="rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl">
      <SectionHeading
        title="Archiwum dokumentów"
        description="Oryginalny PDF, HTML lub ZIP pozostaje lokalnie. Zaznaczone dokumenty są wysyłane do Perplexity dopiero po kliknięciu „Analizuj”."
        action={(
          <SecondaryButton disabled={!helperOnline || busy} onClick={() => inputRef.current?.click()}>
            Wgraj raport ręcznie
          </SecondaryButton>
        )}
      />
      <input ref={inputRef} type="file" accept=".pdf,.html,.htm,.zip,.txt,.doc,.docx" className="hidden" onChange={upload} />
      <div className="mb-4 grid gap-2 rounded-xl border border-slate-800/70 bg-slate-950/50 p-3 md:grid-cols-3">
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
              <div key={documentId} className={`flex flex-col gap-3 rounded-xl border p-3 lg:flex-row lg:items-center lg:justify-between ${isSelected ? 'border-blue-500/35 bg-blue-500/5' : 'border-slate-800/70 bg-slate-950/50'}`}>
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
                    <span className="mt-1 block text-xs text-slate-500">
                      {[document.period || document.reportingPeriod, document.publishedAt && formatDate(document.publishedAt), (document.sha256 || document.hash) && `hash: ${String(document.sha256 || document.hash).slice(0, 10)}…`, document.analyzable === false && 'archiwum — wybierz rozpakowany plik'].filter(Boolean).join(' · ') || 'Brak metadanych'}
                    </span>
                  </span>
                </label>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {getItemId(document) && (
                    <a
                      href={getDownloadUrl(getItemId(document))}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center rounded-lg border border-slate-700/70 bg-slate-800/60 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-800"
                    >
                      Otwórz
                    </a>
                  )}
                  {getItemId(document) && (
                    <ActionButton
                      disabled={!helperOnline || busy}
                      className="text-slate-500 hover:bg-rose-500/10 hover:text-rose-300"
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
        {metrics.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Metryki</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {metrics.map((metric, index) => {
                const label = typeof metric === 'object' ? metric.label || metric.name || metric.key : `Metryka ${index + 1}`;
                const value = typeof metric === 'object' ? metric.value ?? metric.displayValue ?? metric.text : metric;
                const context = typeof metric === 'object' ? [metric.period, metric.unit].filter(Boolean).join(' · ') : '';
                return <Metric key={`${label}-${index}`} label={label} value={`${value ?? EMPTY_VALUE}${context ? ` · ${context}` : ''}`} />;
              })}
            </div>
          </div>
        )}
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

  const perform = async (task, successMessage) => {
    if (!helperOnline) {
      setNotice({ type: 'error', text: 'Uruchom lokalny helper, aby wykonać tę akcję.' });
      return null;
    }
    setBusy(true);
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
    }
  };

  const addSource = (source) => perform(async () => {
    await ensureProfile();
    return analysisApi.addSource(assetId, source);
  }, 'Źródło zapisane.');

  const deleteSource = (sourceId) => perform(
    () => analysisApi.deleteSource(assetId, sourceId),
    'Źródło usunięte.',
  );

  const discover = () => perform(async () => {
    await ensureProfile();
    return analysisApi.discoverCandidates(assetId, {
      sourceIds: sources.map(getItemId).filter(Boolean),
    });
  }, 'Wyszukiwanie kandydatów zostało zakończone. Wybierz dokument przed analizą.');

  const approveCandidate = (candidateId) => perform(
    () => analysisApi.approveCandidate(assetId, candidateId, { download: true }),
    'Dokument został zatwierdzony i zarchiwizowany lokalnie.',
  );

  const importDocument = (file, metadata) => perform(async () => {
    await ensureProfile();
    return analysisApi.importDocument(assetId, file, metadata);
  }, 'Dokument został zapisany lokalnie.');

  const deleteDocument = (documentId) => perform(
    () => analysisApi.deleteDocument(documentId),
    'Dokument usunięty z archiwum.',
  );

  const runAnalysis = () => perform(
    () => analysisApi.runAnalysis(assetId, { documentIds: selectedDocumentIds, model: 'sonar-pro' }),
    'Powstał szkic analizy. Sprawdź go przed zapisaniem.',
  );

  const approveAnalysis = (analysisId) => perform(
    () => analysisApi.approveAnalysis(analysisId),
    'Analiza została zatwierdzona i dodana do historii.',
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
          <div className="flex flex-wrap gap-2">
            <SecondaryButton disabled={!helperOnline || busy || loading} onClick={refreshDetail}>Odśwież dane</SecondaryButton>
            <PrimaryButton
              disabled={!helperOnline || busy || selectedDocumentIds.length === 0}
              onClick={runAnalysis}
              title={selectedDocumentIds.length === 0 ? 'Zaznacz co najmniej jeden zarchiwizowany dokument.' : undefined}
            >
              Analizuj {selectedDocumentIds.length ? `(${selectedDocumentIds.length})` : ''}
            </PrimaryButton>
          </div>
        </div>
      </div>

      <HelperBanner status={helperStatus} error={helperError || detailError} onRetry={onRefreshOverview} />

      {detailError && helperOnline && (
        <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
          {detailError} Jeśli profil nie istnieje jeszcze w bazie, dodanie źródła, import dokumentu albo wyszukiwanie utworzy go lokalnie.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.85fr]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl">
            <SectionHeading
              title="Bieżąca pozycja"
              description="Wycena pochodzi wyłącznie z zaimportowanych danych portfela; nie jest pobierana przez Perplexity."
            />
            <PositionSummary positions={profile.positions || fallbackProfile.positions} />
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
          />
        </div>
        <div className="space-y-6">
          <AnalysisPreview analysis={activeAnalysis} helperOnline={helperOnline} busy={busy} onApprove={approveAnalysis} />
          <AnalysisHistory analyses={detail.analyses} />
          <SecondOpinion profile={profile} />
      <BudgetPanel
        key={`budget-${budget?.monthlyLimitUsd ?? budget?.limitUsd ?? 10}`}
            budget={budget}
            helperOnline={helperOnline}
            onUpdate={onBudgetUpdate}
            onExport={() => setNotice({ type: 'info', text: 'Pełny backup jest dostępny z listy wszystkich aktywów.' })}
            onImport={() => setNotice({ type: 'info', text: 'Import backupu jest dostępny z listy wszystkich aktywów.' })}
            busy={busy}
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
