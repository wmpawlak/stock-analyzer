import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import useLiveData from '../hooks/useLiveData.js';
import { getPositionMetrics } from '../utils/investmentDetails.js';
import { normalizeText, parseNumericValue } from '../utils/number.js';
import {
  filterReportMetricFactsForPeriod,
  formatReportMetricValue,
  getPriorityBankReportMetricDefinitions,
  getReportMetricDefinition,
  sortReportMetricFacts,
} from '../utils/reportMetricDefinitions.js';
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
  buildAnalysisSelectionModel,
  createAnalysisViewSelection,
  filterReportMetricsForSelection,
  reduceAnalysisViewSelection,
} from '../utils/analysisSelection.js';
import { getReportPeriodInfo } from '../../shared/reportPeriods.js';
import {
  REPORT_DOCUMENT_TYPES,
  buildManualReportMetadata,
  getDocumentReportPeriodInfo,
  getReportDocumentTypeLabel,
  validateAnalysisDocumentSelection,
} from '../../shared/reportDocuments.js';

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
    <section className="rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl">
      <h2 className="text-base font-bold text-white">{title}</h2>
      {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
    </section>
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
              : (error || 'Uruchom helper, aby archiwizować dokumenty i korzystać z analizy Perplexity lub OpenAI. Widok portfela działa bez niego.')}
          </p>
        </div>
        {!isLoading && <SecondaryButton onClick={onRetry}>Spróbuj ponownie</SecondaryButton>}
      </div>
    </div>
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

const AnalysisList = ({ profiles, helperStatus, helperError, onRefresh, onCreate, busy }) => {
  const navigate = useNavigate();

  return (
  <div className="mx-auto max-w-7xl p-8 animate-fadeIn">
    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-blue-400">Biblioteka badań</p>
        <h1 className="text-3xl font-bold text-white">Analiza aktywów</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
          Raporty, wnioski i metryki są wspólne dla pozycji z Maklera oraz IKZE, a historia pozostaje lokalna.
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
          <LoadingCallout message="Synchronizuję profile analityczne i lokalny stan helpera..." />
        </div>
      )}

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Profile analityczne</p>
        <p className="mt-2 text-2xl font-bold text-white">{profiles.length}</p>
      </div>
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pozycje w portfelach</p>
        <p className="mt-2 text-2xl font-bold text-white">{profiles.reduce((total, profile) => total + (profile.positions?.length || 0), 0)}</p>
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
  </div>
  );
};

const Metric = ({ label, value, tone = 'default' }) => (
  <div className="min-w-0 rounded-lg border border-slate-800/70 bg-slate-950/60 px-3 py-2.5">
    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className={`mt-1 break-words font-mono text-sm font-semibold ${
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
          <div key={`${position.portfolioName}-${index}`} className="min-w-0 rounded-xl border border-slate-800/70 bg-slate-950/50 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-200">{position.portfolioName}</p>
              <Badge className="max-w-full whitespace-normal text-center">{metrics.quantity === null ? 'brak liczby jednostek' : `${formatNumber(metrics.quantity, 4)} jednostek`}</Badge>
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

const PositionSummaryPanel = ({ positions }) => (
  <div className="rounded-xl border border-slate-800/70 bg-slate-950/45 p-4">
    <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Biezaca pozycja</p>
    <PositionSummary positions={positions} />
  </div>
);

const createInitialDocumentMetadata = () => ({
  title: '',
  type: REPORT_DOCUMENT_TYPES.QUARTERLY,
  year: '',
  quarter: '1',
});

const MANUAL_REPORT_FILE_TYPES = '.pdf,.html,.htm,.zip,.txt,.rtf,.csv,.doc,.docx';

const formatUploadFileSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

const DocumentList = ({ documents, selectedIds, helperOnline, busy, onToggle, onImport, onDelete, getDownloadUrl, compact = false }) => {
  const inputRef = useRef(null);
  const [metadata, setMetadata] = useState(createInitialDocumentMetadata);
  const [selectedFile, setSelectedFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const importMetadata = buildManualReportMetadata(metadata);
  const selectedDocuments = documents.filter((document) => selectedIds.includes(getItemId(document)));
  const selectedPeriodInfo = validateAnalysisDocumentSelection(selectedDocuments).periodInfo;
  const fileSelectionDisabled = !helperOnline || busy;
  const uploadDisabled = fileSelectionDisabled || !selectedFile || !importMetadata.valid;

  const chooseFile = (file) => {
    if (!file || fileSelectionDisabled) return;
    setSelectedFile(file);
  };

  const upload = async () => {
    if (uploadDisabled) return;
    try {
      const result = await onImport(selectedFile, {
        title: importMetadata.title,
        type: importMetadata.type,
        period: importMetadata.period,
      });
      if (result) {
        setMetadata(createInitialDocumentMetadata());
        setSelectedFile(null);
      }
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
            Zaznaczone dokumenty trafią do wybranego providera dopiero po kliknięciu „Analizuj”.
          </p>
        </div>
      ) : (
        <SectionHeading
          title="Archiwum dokumentów"
          description="Oryginalny dokument pozostaje lokalnie. Zaznaczone pliki są wysyłane do wybranego providera dopiero po kliknięciu „Analizuj”."
        />
      )}
      <input
        ref={inputRef}
        type="file"
        accept={MANUAL_REPORT_FILE_TYPES}
        className="hidden"
        onChange={(event) => {
          const [file] = event.target.files || [];
          event.target.value = '';
          chooseFile(file);
        }}
      />
      <div className={`mb-4 grid gap-2 rounded-xl border border-slate-800/70 bg-slate-950/50 p-3 ${compact ? '' : 'md:grid-cols-2'}`}>
        <div className={compact ? '' : 'md:col-span-2'}>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Ręczne wgrywanie raportu</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">Ustaw typ i okres raportu, a następnie dodaj plik do lokalnego archiwum.</p>
        </div>
        <input
          value={metadata.title}
          onChange={(event) => setMetadata((current) => ({ ...current, title: event.target.value }))}
          placeholder="Tytuł (opcjonalnie)"
          className="rounded-lg border border-slate-700/70 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-500"
        />
        <select
          value={metadata.type}
          onChange={(event) => setMetadata((current) => ({
            ...current,
            type: event.target.value,
            year: '',
            quarter: '1',
          }))}
          aria-label="Typ dokumentu"
          className="rounded-lg border border-slate-700/70 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-500"
        >
          <option value={REPORT_DOCUMENT_TYPES.ANNUAL}>Raport roczny</option>
          <option value={REPORT_DOCUMENT_TYPES.QUARTERLY}>Raport kwartalny</option>
          <option value={REPORT_DOCUMENT_TYPES.OTHER}>Inny dokument</option>
        </select>
        {metadata.type !== REPORT_DOCUMENT_TYPES.OTHER && (
          <input
            type="number"
            min="1900"
            max="2099"
            inputMode="numeric"
            value={metadata.year}
            onChange={(event) => setMetadata((current) => ({ ...current, year: event.target.value }))}
            placeholder="Rok, np. 2025"
            aria-label="Rok raportu"
            className="rounded-lg border border-slate-700/70 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-500"
          />
        )}
        {metadata.type === REPORT_DOCUMENT_TYPES.QUARTERLY && (
          <select
            value={metadata.quarter}
            onChange={(event) => setMetadata((current) => ({ ...current, quarter: event.target.value }))}
            aria-label="Kwartał raportu"
            className="rounded-lg border border-slate-700/70 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none focus:border-blue-500"
          >
            <option value="1">Q1</option>
            <option value="2">Q2</option>
            <option value="3">Q3</option>
            <option value="4">Q4</option>
          </select>
        )}
        <p className={`text-xs leading-5 ${importMetadata.valid ? 'text-slate-500' : 'text-amber-300'} ${compact ? '' : 'md:col-span-2'}`}>
          {metadata.type === REPORT_DOCUMENT_TYPES.OTHER
            ? 'Inny dokument zostanie zapisany bez okresu i nie będzie samodzielną podstawą analizy.'
            : importMetadata.valid
              ? `Okres raportowy: ${importMetadata.period}`
              : importMetadata.message}
        </p>
      </div>
      <div className="mb-5">
        <button
          type="button"
          disabled={fileSelectionDisabled}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            if (!fileSelectionDisabled) setDragActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            if (!fileSelectionDisabled) setDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            if (!event.currentTarget.contains(event.relatedTarget)) setDragActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            chooseFile(event.dataTransfer.files?.[0]);
          }}
          className={`flex min-h-28 w-full flex-col items-center justify-center rounded-lg border border-dashed px-4 py-5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/35 ${
            dragActive
              ? 'border-blue-400 bg-blue-500/10'
              : selectedFile
                ? 'border-emerald-500/40 bg-emerald-500/5 hover:border-emerald-400/60'
                : 'border-slate-700 bg-slate-950/45 hover:border-blue-400/60 hover:bg-blue-500/5'
          } disabled:cursor-not-allowed disabled:opacity-50`}
          aria-label={selectedFile ? `Zmień wybrany plik ${selectedFile.name}` : 'Wybierz plik raportu lub przeciągnij go tutaj'}
        >
          {selectedFile ? (
            <>
              <span className="max-w-full break-words text-sm font-semibold text-emerald-200">{selectedFile.name}</span>
              <span className="mt-1 text-xs text-slate-500">{formatUploadFileSize(selectedFile.size)} · kliknij, aby wybrać inny plik</span>
            </>
          ) : (
            <>
              <span className="text-sm font-semibold text-slate-200">Przeciągnij plik tutaj</span>
              <span className="mt-1 text-xs text-slate-500">lub kliknij, aby wybrać PDF, ZIP, HTML, DOCX, TXT, RTF albo CSV</span>
            </>
          )}
        </button>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className={`text-xs leading-5 ${uploadDisabled ? 'text-slate-500' : 'text-emerald-300'}`}>
            {!helperOnline
              ? 'Lokalny helper jest offline.'
              : !selectedFile
                ? 'Wybierz plik raportu.'
                : !importMetadata.valid
                  ? importMetadata.message
                  : `${selectedFile.name} jest gotowy do wgrania jako ${importMetadata.period || getReportDocumentTypeLabel(importMetadata.type)}.`}
          </p>
          <div className="flex shrink-0 gap-2">
            {selectedFile && (
              <SecondaryButton disabled={busy} onClick={() => setSelectedFile(null)}>
                Usuń wybór
              </SecondaryButton>
            )}
            <PrimaryButton disabled={uploadDisabled} onClick={upload}>
              Wgraj do archiwum
            </PrimaryButton>
          </div>
        </div>
      </div>
      {documents?.length ? (
        <div className="space-y-2">
          {documents.map((document, index) => {
            const documentId = getItemId(document) || String(index);
            const title = document.title || document.name || document.fileName || 'Dokument';
            const isSelected = selectedIds.includes(documentId);
            const documentPeriodInfo = getDocumentReportPeriodInfo(document);
            const rawPeriod = document.period || document.reportingPeriod || '';
            const periodBlockReason = !rawPeriod
              ? 'Dokument nie ma jawnie podanego okresu raportowego.'
              : !documentPeriodInfo
                ? 'Okres dokumentu musi mieć format YYYY albo Q1-Q4 YYYY.'
                : selectedPeriodInfo && selectedPeriodInfo.key !== documentPeriodInfo.key
                  ? `Wybrane dokumenty dotyczą okresu ${selectedPeriodInfo.label}.`
                  : '';
            const selectionDisabled = !isSelected && (document.analyzable === false || Boolean(periodBlockReason));
            return (
              <div key={documentId} className={`flex flex-col gap-3 rounded-xl border p-3 ${compact ? '' : 'lg:flex-row lg:items-center lg:justify-between'} ${isSelected ? 'border-blue-500/35 bg-blue-500/5' : 'border-slate-800/70 bg-slate-950/50'}`}>
                <label className="flex min-w-0 cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(documentId)}
                    disabled={selectionDisabled}
                    title={periodBlockReason || undefined}
                    className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-200">{title}</span>
                      {document.type && <Badge>{getReportDocumentTypeLabel(document.type)}</Badge>}
                      {document.format && <Badge>{String(document.format).toUpperCase()}</Badge>}
                      <Badge status={document.status}>{getStatusLabel(document.status)}</Badge>
                    </span>
                    <span className="mt-1 block break-words text-xs text-slate-500">
                      {[document.period || document.reportingPeriod, document.publishedAt && formatDate(document.publishedAt), (document.sha256 || document.hash) && `hash: ${String(document.sha256 || document.hash).slice(0, 10)}…`, document.analyzable === false && 'archiwum — wybierz rozpakowany plik'].filter(Boolean).join(' · ') || 'Brak metadanych'}
                    </span>
                    {periodBlockReason && !isSelected && (
                      <span className="mt-1 block text-xs text-amber-300">{periodBlockReason}</span>
                    )}
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

const getStructuredSummary = (analysis) => {
  const source = analysis?.content || analysis?.result || analysis || {};
  const summary = source.structuredSummary;
  return summary && typeof summary === 'object' && !Array.isArray(summary) ? summary : null;
};

const getAnalysisItems = (analysis, keys) => {
  const source = analysis?.content || analysis?.result || analysis || {};
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) return [value];
  }
  return [];
};

const getAnalysisContent = (analysis) => analysis?.content || analysis?.result || analysis || {};

const formatPage = (page) => {
  if (page === null || page === undefined || page === '') return '';
  const number = Number(page);
  return Number.isFinite(number) ? `str. ${number}` : `str. ${page}`;
};

const getSourceParts = (source = {}) => [
  stringOrEmpty(source.documentId || source.document_id) && `dok. ${source.documentId || source.document_id}`,
  formatPage(source.page),
  stringOrEmpty(source.section),
].filter(Boolean);

const stringOrEmpty = (value) => (typeof value === 'string' ? value.trim() : '');

const getFactSource = (fact) => ({
  documentId: fact?.documentId || fact?.source?.documentId || fact?.source?.document_id || '',
  page: fact?.page ?? fact?.source?.page ?? null,
  section: fact?.section || fact?.source?.section || '',
  evidence: fact?.quote || fact?.source?.evidence || '',
});

const formatConfidenceLabel = (value) => {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return '';
  const percent = confidence <= 1 ? confidence * 100 : confidence;
  return `Pewność: ${formatNumber(percent, 0)}%`;
};

const SourceTooltip = ({ source, evidence, confidence, className = '' }) => {
  const sourceText = typeof source === 'string' ? source.trim() : '';
  const parts = sourceText ? [] : getSourceParts(source);
  const proof = stringOrEmpty(evidence || sourceText || source?.evidence || source?.quote);
  const confidenceText = formatConfidenceLabel(confidence);
  if (!parts.length && !proof && !confidenceText) return null;

  const tooltipId = `source-tooltip-${[
    sourceText || source?.documentId || source?.document_id || '',
    source?.page ?? '',
    source?.section || '',
    proof.slice(0, 24),
  ].join('-').replace(/[^a-z0-9_-]/gi, '-')}`;

  return (
    <span className={`group relative inline-flex shrink-0 ${className}`}>
      <button
        type="button"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-[10px] font-bold leading-none text-slate-400 transition-colors hover:border-blue-400/60 hover:text-blue-200 focus-visible:border-blue-300 focus-visible:text-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/30"
        aria-label="Źródło wartości"
        aria-describedby={tooltipId}
      >
        i
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute right-0 top-5 z-50 hidden max-h-56 w-80 max-w-[min(20rem,calc(100vw-3rem))] overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-left text-xs font-normal leading-5 text-slate-300 shadow-xl shadow-slate-950/40 group-hover:block group-focus-within:block"
      >
        {parts.length > 0 && <span className="block font-semibold text-slate-200">{parts.join(' · ')}</span>}
        {proof && <span className="mt-1 block whitespace-pre-wrap text-slate-400">{proof}</span>}
        {confidenceText && <span className="mt-1 block text-slate-500">{confidenceText}</span>}
      </span>
    </span>
  );
};

const MetricValueWithSource = ({ value, source, evidence, confidence, className = '' }) => (
  <div className={`inline-flex max-w-full items-start gap-1.5 ${className}`}>
    <p className="min-w-0 break-words font-mono text-sm font-semibold">{value}</p>
    <SourceTooltip source={source} evidence={evidence} confidence={confidence} className="mt-0.5" />
  </div>
);

const SourceInlineInfo = ({ source, evidence, confidence, className = '' }) => (
  <SourceTooltip source={source} evidence={evidence} confidence={confidence} className={className} />
);

const SUMMARY_STANCE_LABELS = {
  pozytywny: 'Pozytywny',
  mieszany: 'Mieszany',
  ostrozny: 'Ostrozny',
  negatywny: 'Negatywny',
};

const SUMMARY_STANCE_CLASSES = {
  pozytywny: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
  mieszany: 'border-blue-500/20 bg-blue-500/10 text-blue-200',
  ostrozny: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
  negatywny: 'border-rose-500/20 bg-rose-500/10 text-rose-200',
};

const MarkdownInline = ({ text }) => (
  String(text || '').split(/(\*\*[^*]+\*\*)/g).map((part, index) => (
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={`${index}-${part.slice(0, 8)}`} className="font-semibold text-slate-100">{part.slice(2, -2)}</strong>
      : <span key={`${index}-${part.slice(0, 8)}`}>{part}</span>
  ))
);

const pushMarkdownParagraph = (blocks, lines) => {
  if (!lines.length) return;
  blocks.push({ type: 'paragraph', text: lines.join(' ') });
  lines.length = 0;
};

const MarkdownSummary = ({ text }) => {
  const blocks = [];
  const paragraphLines = [];
  const bulletLines = [];
  const flushBullets = () => {
    if (!bulletLines.length) return;
    blocks.push({ type: 'list', items: [...bulletLines] });
    bulletLines.length = 0;
  };

  String(text || '').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      pushMarkdownParagraph(blocks, paragraphLines);
      flushBullets();
      return;
    }
    const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      pushMarkdownParagraph(blocks, paragraphLines);
      flushBullets();
      blocks.push({ type: 'heading', text: heading[1] });
      return;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      pushMarkdownParagraph(blocks, paragraphLines);
      bulletLines.push(bullet[1]);
      return;
    }
    flushBullets();
    paragraphLines.push(trimmed);
  });
  pushMarkdownParagraph(blocks, paragraphLines);
  flushBullets();

  if (!blocks.length) return null;
  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return <h4 key={`${index}-${block.text}`} className="text-sm font-bold text-slate-100"><MarkdownInline text={block.text} /></h4>;
        }
        if (block.type === 'list') {
          return (
            <ul key={`${index}-list`} className="space-y-2 pl-4 text-slate-300">
              {block.items.map((item, itemIndex) => (
                <li key={`${itemIndex}-${item.slice(0, 16)}`} className="list-disc pl-1"><MarkdownInline text={item} /></li>
              ))}
            </ul>
          );
        }
        return <p key={`${index}-${block.text.slice(0, 16)}`}><MarkdownInline text={block.text} /></p>;
      })}
    </div>
  );
};

const StructuredSummary = ({ summary }) => {
  const sections = Array.isArray(summary?.sections) ? summary.sections : [];
  if (!summary?.headline || !sections.length) return null;
  const stance = SUMMARY_STANCE_LABELS[summary.stance] ? summary.stance : 'mieszany';

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h3 className="text-lg font-bold leading-7 text-white">{summary.headline}</h3>
        <span className={`inline-flex shrink-0 items-center self-start rounded-full border px-3 py-1 text-xs font-bold uppercase ${SUMMARY_STANCE_CLASSES[stance]}`}>
          {SUMMARY_STANCE_LABELS[stance]}
        </span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {sections.map((section, sectionIndex) => {
          const bullets = Array.isArray(section.bullets) ? section.bullets : [];
          return (
            <div key={`${sectionIndex}-${section.title}`} className="rounded-xl border border-slate-800/70 bg-slate-900/70 p-4">
              <h4 className="text-sm font-bold text-slate-100">{section.title}</h4>
              <ul className="mt-3 space-y-3">
                {bullets.map((bullet, bulletIndex) => {
                  const isObject = bullet && typeof bullet === 'object';
                  const text = isObject ? bullet.text : String(bullet || '');
                  const metricKeys = isObject && Array.isArray(bullet.metricKeys) ? bullet.metricKeys.filter(Boolean) : [];
                  return (
                    <li key={`${bulletIndex}-${text.slice(0, 16)}`} className="text-slate-300">
                      <p className="inline-flex max-w-full items-start gap-1.5">
                        <span className="min-w-0"><MarkdownInline text={text} /></span>
                        {isObject && bullet.source && <SourceInlineInfo source={bullet.source} className="mt-0.5" />}
                      </p>
                      {metricKeys.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {metricKeys.map((metricKey) => <Badge key={metricKey}>{metricKey}</Badge>)}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const SummaryPanel = ({ analysis }) => {
  const structuredSummary = getStructuredSummary(analysis);
  const summary = getAnalysisSummary(analysis);

  return (
    <div className="rounded-xl border border-slate-800/70 bg-slate-950/50 p-4">
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Podsumowanie</p>
      {structuredSummary ? (
        <StructuredSummary summary={structuredSummary} />
      ) : (
        <MarkdownSummary text={summary || 'Model nie zwrócił jeszcze podsumowania w zapisanym schemacie.'} />
      )}
    </div>
  );
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
  return {
    ...getReportPeriodInfo(period),
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

const buildMetricTable = (metrics, specs) => {
  const rows = specs.map((spec) => ({ spec, values: new Map() }));
  const byLabel = new Map(rows.map((row) => [row.spec.label, row]));
  const periods = new Map();

  (metrics || []).forEach((metric, index) => {
    const spec = findMetricSpec(getMetricLabel(metric, index), specs);
    if (!spec) return;

    const periodInfo = getMetricPeriodInfo(getMetricPeriod(metric));
    periods.set(periodInfo.key, periodInfo);
    byLabel.get(spec.label).values.set(periodInfo.key, normalizeMetricCell(metric, spec));
  });

  const sortedPeriods = [...periods.values()].sort(sortPeriods);
  return {
    periods: sortedPeriods.length ? sortedPeriods : [{ key: 'current', label: 'Wartość', isSynthetic: false }],
    rows,
  };
};

const FinancialMetricTable = ({ title, description, metrics, specs }) => {
  const table = buildMetricTable(metrics, specs);

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
                            <MetricValueWithSource value={cell.display} source={cell.source} />
                            {(cell.note || cell.trend) && (
                              <p className="mt-1 text-xs leading-5 text-slate-500">
                                {[cell.note, cell.trend && `Trend: ${cell.trend}`].filter(Boolean).join(' · ')}
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
      description="Kwoty są normalizowane do mln PLN. Kolumna roczna pojawia się wyłącznie wtedy, gdy metryki pochodzą bezpośrednio z zatwierdzonego raportu rocznego."
      metrics={metrics}
      specs={FINANCIAL_RESULT_SPECS}
    />
  </div>
);

const buildReportMetricMatrix = (metrics, fallbackPrefix = 'metric', { includePriorityRows = false } = {}) => {
  const periods = new Map();
  const rows = new Map();
  const priorityDefinitions = includePriorityRows ? getPriorityBankReportMetricDefinitions() : [];
  const priorityOrder = new Map(priorityDefinitions.map((definition) => [definition.metricKey, definition.priorityIndex]));

  priorityDefinitions.forEach((definition) => {
    rows.set(definition.metricKey, {
      key: definition.metricKey,
      label: definition.label,
      description: definition.description,
      aggregation: definition.aggregation,
      tier: definition.tier,
      catalogIndex: definition.catalogIndex,
      priorityIndex: definition.priorityIndex,
      values: new Map(),
    });
  });

  metrics.forEach((metric, index) => {
    const periodInfo = getMetricPeriodInfo(metric.period);
    periods.set(periodInfo.key, periodInfo);
    const definition = getReportMetricDefinition(metric.metricKey) || getReportMetricDefinition(metric.label);
    const metricKey = definition?.metricKey || metric.metricKey || metric.label || `${fallbackPrefix}_${index + 1}`;
    if (!rows.has(metricKey)) {
      rows.set(metricKey, {
        key: metricKey,
        label: definition?.label || metric.label || metric.metricKey || `Metryka ${index + 1}`,
        description: definition?.description || '',
        aggregation: metric.aggregation || '',
        tier: definition?.tier || 'secondary',
        catalogIndex: definition?.catalogIndex ?? Number.POSITIVE_INFINITY,
        priorityIndex: priorityOrder.has(metricKey) ? priorityOrder.get(metricKey) : null,
        values: new Map(),
      });
    }
    const row = rows.get(metricKey);
    if (definition?.label) row.label = definition.label;
    if (!row.description && definition?.description) row.description = definition.description;
    if (!row.aggregation && metric.aggregation) row.aggregation = metric.aggregation;
    row.values.set(periodInfo.key, metric);
  });

  return {
    periods: [...periods.values()].sort(sortPeriods),
    rows: [...rows.values()].sort((left, right) => {
      const leftTier = left.tier === 'primary' ? 0 : 1;
      const rightTier = right.tier === 'primary' ? 0 : 1;
      if (leftTier !== rightTier) return leftTier - rightTier;
      const leftPriority = Number.isInteger(left.priorityIndex) ? left.priorityIndex : Number.POSITIVE_INFINITY;
      const rightPriority = Number.isInteger(right.priorityIndex) ? right.priorityIndex : Number.POSITIVE_INFINITY;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      if (left.catalogIndex !== right.catalogIndex) return left.catalogIndex - right.catalogIndex;
      return left.label.localeCompare(right.label, 'pl');
    }),
  };
};

const ReportMetricLabel = ({ row, size = 'sm', idPrefix = 'metric' }) => {
  const labelClass = size === 'xs' ? 'text-xs text-slate-300' : 'text-sm text-slate-200';
  const tooltipId = `${idPrefix}-metric-tooltip-${String(row.key).replace(/[^a-z0-9_-]/gi, '-')}`;

  return (
    <div className="flex items-start gap-2">
      <p className={`${labelClass} font-semibold leading-5`}>{row.label}</p>
      {row.description && (
        <span className="group relative mt-0.5 inline-flex shrink-0">
          <button
            type="button"
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-[10px] font-bold leading-none text-slate-400 transition-colors hover:border-blue-400/60 hover:text-blue-200 focus-visible:border-blue-300 focus-visible:text-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/30"
            aria-label={`Definicja metryki ${row.label}`}
            aria-describedby={tooltipId}
          >
            i
          </button>
          <span
            id={tooltipId}
            role="tooltip"
            className="pointer-events-none absolute left-0 top-5 z-50 hidden w-72 max-w-[min(18rem,calc(100vw-3rem))] rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-left text-xs font-normal leading-5 text-slate-300 shadow-xl shadow-slate-950/40 group-hover:block group-focus-within:block"
          >
            {row.description}
          </span>
        </span>
      )}
    </div>
  );
};

const DraftMetricFactsTable = ({ metrics }) => {
  const table = buildReportMetricMatrix(metrics, 'draft_metric', { includePriorityRows: true });
  if (!table.rows.length) return <EmptyState>Brak metryk w szkicu analizy.</EmptyState>;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800/80">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-800/80 text-left text-sm">
          <thead className="bg-slate-950/60 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="sticky left-0 z-10 min-w-56 bg-slate-950/95 px-3 py-3">Metryka</th>
              {table.periods.map((period) => (
                <th key={period.key} className="min-w-64 px-3 py-3">{period.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70 bg-slate-900">
            {table.rows.map((row) => (
              <tr key={row.key}>
                <th className="sticky left-0 z-10 bg-slate-900 px-3 py-3 align-top">
                  <ReportMetricLabel row={row} idPrefix="draft" />
                  <p className="mt-1 font-mono text-[11px] text-slate-500">{row.key}</p>
                  {row.aggregation && <Badge className="mt-2">{row.aggregation}</Badge>}
                </th>
                {table.periods.map((period) => {
                  const metric = row.values.get(period.key);
                  const source = getFactSource(metric);
                  return (
                    <td key={`${row.key}-${period.key}`} className="px-3 py-3 align-top text-slate-200">
                      {metric ? (
                        <div>
                          <MetricValueWithSource
                            value={formatReportMetricValue(metric, EMPTY_VALUE)}
                            source={source}
                            evidence={source.evidence}
                            confidence={metric.confidence}
                          />
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
  );
};

const ApprovedReportMetricMatrix = ({ metrics }) => {
  const table = buildReportMetricMatrix(metrics || [], 'approved_metric', { includePriorityRows: true });

  return (
    <div>
      <SectionHeading
        title="Metryki"
        description="Pełne lata są widoczne domyślnie. Dodatkowe kwartały włączysz ikoną oka w zakresie analizy."
      />
      {table.rows.length ? (
        <div className="overflow-hidden rounded-xl border border-slate-800/80">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800/80 text-left text-sm">
              <thead className="bg-slate-950/60 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="sticky left-0 z-10 min-w-56 bg-slate-950/95 px-3 py-3">Metryka</th>
                  {table.periods.map((period) => (
                    <th
                      key={period.key}
                      className={`min-w-64 px-3 py-3 ${period.isAnnual ? 'border-x border-emerald-500/15 bg-emerald-500/[0.06] text-emerald-200' : ''}`}
                    >
                      <span>{period.label}</span>
                      {period.isAnnual && (
                        <span className="ml-2 inline-flex rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold lowercase text-emerald-300">
                          roczny
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 bg-slate-900">
                {table.rows.map((row) => (
                  <tr key={row.key}>
                    <th className="sticky left-0 z-10 bg-slate-900 px-3 py-3 align-top">
                      <ReportMetricLabel row={row} size="xs" idPrefix="approved" />
                      <p className="mt-1 font-mono text-[11px] text-slate-500">{row.key}</p>
                      {row.aggregation && <Badge className="mt-2">{row.aggregation}</Badge>}
                    </th>
                    {table.periods.map((period) => {
                      const metric = row.values.get(period.key);
                      return (
                        <td
                          key={`${row.key}-${period.key}`}
                          className={`px-3 py-3 align-top text-slate-200 ${period.isAnnual ? 'border-x border-emerald-500/10 bg-emerald-500/[0.035]' : ''}`}
                        >
                          {metric ? (
                            <div>
                              <MetricValueWithSource
                                value={formatReportMetricValue(metric, EMPTY_VALUE)}
                                source={metric.source || metric}
                                evidence={metric.quote || metric.source?.evidence}
                                confidence={metric.confidence}
                              />
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
      ) : <EmptyState>Brak zatwierdzonych metryk dla widocznych okresów. Włącz kwartał ikoną oka albo zatwierdź analizę roczną.</EmptyState>}
    </div>
  );
};

const SourceBackedList = ({ title, tone = 'default', items }) => {
  if (!items.length) return null;
  const titleClass = tone === 'risk' ? 'text-rose-300' : tone === 'warning' ? 'text-amber-300' : 'text-slate-500';
  const itemClass = tone === 'risk'
    ? 'border-rose-500/15 bg-rose-500/5'
    : tone === 'warning'
      ? 'border-amber-500/15 bg-amber-500/5'
      : 'border-slate-800/70 bg-slate-950/40';

  return (
    <div>
      <p className={`mb-2 text-xs font-bold uppercase tracking-wide ${titleClass}`}>{title}</p>
      <ul className="space-y-2">
        {items.map((item, index) => {
          const isObject = item && typeof item === 'object';
          const text = isObject ? item.text || item.reason || item.value || JSON.stringify(item) : String(item);
          const source = isObject ? item.source || {} : {};
          const evidence = isObject ? item.evidence || item.source?.evidence : '';
          return (
            <li key={`${index}-${text.slice(0, 16)}`} className={`rounded-lg border px-3 py-2 text-slate-300 ${itemClass}`}>
              <p className="inline-flex max-w-full items-start gap-1.5">
                <span className="min-w-0">{text}</span>
                <SourceInlineInfo source={source} evidence={evidence} className="mt-0.5" />
              </p>
              {isObject && item.metricKey && <p className="mt-1 font-mono text-[11px] text-slate-500">{item.metricKey}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const AnalysisEyeIcon = ({ visible }) => (
  <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12s3.5-6.25 9.75-6.25S21.75 12 21.75 12 18.25 18.25 12 18.25 2.25 12 2.25 12Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 12a2.25 2.25 0 1 0 4.5 0 2.25 2.25 0 0 0-4.5 0Z" />
    {!visible && <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5 19.5 4.5" />}
  </svg>
);

const AnalysisReportSelector = ({
  selectionModel,
  selectedReportAnalysisId,
  visibleQuarterMetricAnalysisIds,
  onReportChange,
  onQuarterMetricToggle,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const menuId = 'analysis-report-selector-menu';
  const reportGroups = selectionModel?.reportGroups || [];
  const reportOptions = selectionModel?.reportOptions || [];
  const selectedReport = reportOptions.find((option) => option.analysisId === selectedReportAnalysisId) || null;
  const visibleQuarterIds = new Set(visibleQuarterMetricAnalysisIds || []);
  const activeLabel = selectedReport?.label || 'Brak wybranego raportu';

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (!reportGroups.length) return null;

  const renderQuarterOption = (option) => {
    const metricsVisible = visibleQuarterIds.has(option.analysisId);
    const active = option.analysisId === selectedReportAnalysisId;
    const isDraft = option.kind === 'draft';
    const versionDate = formatDate(
      option.analysis?.updatedAt || option.analysis?.createdAt,
      { withTime: true },
    );
    return (
      <div
        key={option.analysisId}
        className={`flex items-stretch rounded-lg border transition-colors ${active ? 'border-blue-400/35 bg-blue-500/10' : 'border-transparent hover:border-slate-700/80 hover:bg-slate-900'}`}
      >
        <button
          type="button"
          onClick={() => {
            onReportChange(option.analysisId);
            setOpen(false);
          }}
          className={`min-w-0 flex-1 px-3 py-2.5 text-left ${active ? 'text-blue-100' : 'text-slate-300'}`}
        >
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
            <span>{option.label}</span>
            <span className={`text-[11px] font-bold uppercase ${isDraft ? 'text-amber-300' : 'text-emerald-300'}`}>
              {isDraft ? 'szkic' : 'zatwierdzony'}
            </span>
          </span>
          {isDraft && (
            <span className="mt-1 block break-words text-xs leading-5 text-slate-500">
              {option.title} · {versionDate}
            </span>
          )}
        </button>
        <button
          type="button"
          aria-pressed={metricsVisible}
          aria-label={`${metricsVisible ? 'Ukryj' : 'Pokaż'} kolumnę metryk dla ${option.label}`}
          title={`${metricsVisible ? 'Ukryj' : 'Pokaż'} kolumnę metryk ${option.label}`}
          onClick={() => onQuarterMetricToggle(option.analysisId)}
          className={`m-1.5 inline-flex w-9 shrink-0 items-center justify-center rounded-md border transition-colors ${metricsVisible ? 'border-blue-400/40 bg-blue-500/15 text-blue-200' : 'border-slate-700/70 bg-slate-950/60 text-slate-500 hover:text-slate-200'}`}
        >
          <AnalysisEyeIcon visible={metricsVisible} />
        </button>
      </div>
    );
  };

  const renderAnnualOption = (option) => {
    const active = option.analysisId === selectedReportAnalysisId;
    return (
      <button
        key={option.analysisId}
        type="button"
        onClick={() => {
          onReportChange(option.analysisId);
          setOpen(false);
        }}
        className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${active ? 'border-blue-400/35 bg-blue-500/10 font-bold text-blue-100' : 'border-transparent text-slate-300 hover:border-slate-700/80 hover:bg-slate-900'}`}
      >
        <span>{option.label}</span>
        <span className="text-[11px] font-bold uppercase text-emerald-300">raport roczny</span>
      </button>
    );
  };

  return (
    <div ref={containerRef} className="relative mb-5 w-full sm:max-w-md">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Zakres analizy</p>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="mt-2 flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border border-slate-700/80 bg-slate-950 px-3 py-2 text-left text-sm text-slate-100 shadow-inner shadow-slate-950/50 transition-colors hover:border-blue-400/50 focus-visible:border-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/25"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={menuId}
      >
        <span className="min-w-0">
          <span className="block truncate font-semibold">Aktywny raport: {activeLabel}</span>
          <span className="mt-0.5 block text-xs text-slate-500">
            {visibleQuarterIds.size
              ? `Widoczne kwartały w metrykach: ${visibleQuarterIds.size}`
              : 'Bez dodatkowych kwartałów w metrykach'}
          </span>
        </span>
        <span aria-hidden="true" className={`shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}>⌄</span>
      </button>
      {open && (
        <div
          id={menuId}
          role="dialog"
          aria-label="Wybór aktywnego raportu i widocznych kwartałów w metrykach"
          className="absolute left-0 top-full z-50 mt-2 max-h-[min(70vh,36rem)] w-full overflow-y-auto rounded-lg border border-slate-700/80 bg-slate-950 p-3 shadow-2xl shadow-slate-950/60 sm:min-w-[28rem]"
        >
          <p className="px-1 text-xs leading-5 text-slate-500">
            Kliknij raport, aby zmienić treść widoku. Oko przy kwartale steruje wyłącznie dodatkową kolumną w tabeli metryk.
          </p>
          <div className="mt-3 space-y-4">
            {reportGroups.map((group) => (
              <section key={group.year} aria-labelledby={`analysis-report-year-${group.year}`}>
                <h3 id={`analysis-report-year-${group.year}`} className="mb-1 px-1 text-xs font-bold text-slate-300">
                  {group.year}
                </h3>
                <div className="space-y-1">
                  {group.annualOptions.map(renderAnnualOption)}
                  {[...group.approvedQuarterOptions, ...group.quarterDraftOptions].map(renderQuarterOption)}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const AnalysisPreview = ({
  analysis,
  reportMetrics,
  positions,
  selectionModel,
  selectedReportAnalysisId,
  visibleQuarterMetricAnalysisIds,
  onReportChange,
  onQuarterMetricToggle,
  isolatedPreview,
  onClosePreview,
  extractionWarnings,
  helperOnline,
  busy,
  onApprove,
}) => {
  if (!analysis) {
    return (
      <section className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl">
        <SectionHeading title="Wynik analizy" description="Po uruchomieniu analizy zobaczysz szkic przed jego zapisaniem w historii." />
        <AnalysisReportSelector
          selectionModel={selectionModel}
          selectedReportAnalysisId={selectedReportAnalysisId}
          visibleQuarterMetricAnalysisIds={visibleQuarterMetricAnalysisIds}
          onReportChange={onReportChange}
          onQuarterMetricToggle={onQuarterMetricToggle}
        />
        <PositionSummaryPanel positions={positions} />
        <ApprovedReportMetricMatrix metrics={reportMetrics} />
        <EmptyState>Brak szkicu lub zatwierdzonej analizy dla wybranych dokumentów.</EmptyState>
      </section>
    );
  }

  const analysisId = getItemId(analysis);
  const isDraft = String(analysis.status || '').toLowerCase() === 'draft';
  const content = getAnalysisContent(analysis);
  const reportPeriod = content.reportPeriod || analysis?.reportPeriod || analysis?.period || '';
  const metricFacts = sortReportMetricFacts(filterReportMetricFactsForPeriod(content.metricFacts, reportPeriod));
  const insights = getAnalysisItems(analysis, ['conclusions', 'keyTakeaways', 'insights', 'findings']);
  const risks = getAnalysisItems(analysis, ['risks', 'riskFactors']);
  const metrics = getAnalysisItems(analysis, ['metrics', 'keyMetrics']);
  const metricsForReportPeriod = filterReportMetricFactsForPeriod(metrics, reportPeriod);
  const citations = getAnalysisItems(analysis, ['sources', 'citations', 'evidence']);
  const hasV2MetricFacts = metricFacts.length > 0;

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl">
      <SectionHeading
        title={isolatedPreview ? 'Izolowany podgląd analizy' : isDraft ? 'Podgląd szkicu analizy' : 'Podgląd analizy'}
        description={isolatedPreview
          ? `Wyświetlasz wyłącznie dane zapisane w tej wersji · ${formatDate(analysis.createdAt || analysis.updatedAt, { withTime: true })}`
          : `Schemat ${analysis.schemaVersion || analysis.version || 'v1'} · ${[
            analysis.provider === 'openai' ? 'OpenAI GPT' : analysis.provider === 'perplexity' ? 'Perplexity' : analysis.provider,
            analysis.model,
          ].filter(Boolean).join(' · ') || 'lokalna analiza'} · ${formatDate(analysis.createdAt || analysis.updatedAt, { withTime: true })}`}
        action={(isolatedPreview || isDraft) && (
          <div className="flex flex-wrap items-center gap-2">
            {isolatedPreview && <SecondaryButton onClick={onClosePreview}>Wróć do widoku instrumentu</SecondaryButton>}
            {isDraft && (
              <PrimaryButton disabled={!helperOnline || busy || !analysisId} onClick={() => onApprove(analysisId)}>
                Zatwierdź i zapisz
              </PrimaryButton>
            )}
          </div>
        )}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge status={analysis.status}>{getStatusLabel(analysis.status)}</Badge>
        {analysis.documentIds?.length && <Badge>Dokumenty: {analysis.documentIds.length}</Badge>}
      </div>
      {!isolatedPreview && (
        <AnalysisReportSelector
          selectionModel={selectionModel}
          selectedReportAnalysisId={selectedReportAnalysisId}
          visibleQuarterMetricAnalysisIds={visibleQuarterMetricAnalysisIds}
          onReportChange={onReportChange}
          onQuarterMetricToggle={onQuarterMetricToggle}
        />
      )}
      <div className="space-y-5 text-sm leading-6 text-slate-300">
        {!isolatedPreview && <PositionSummaryPanel positions={positions} />}
        <SummaryPanel analysis={analysis} />
        <SourceBackedList title="Wnioski" items={insights} />
        <SourceBackedList title="Ryzyka" tone="risk" items={risks} />
        {!isolatedPreview && <ApprovedReportMetricMatrix metrics={reportMetrics} />}
        {hasV2MetricFacts && (isDraft || isolatedPreview) && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              {isolatedPreview ? 'Metryki z analizy' : 'Metryki ze szkicu do zatwierdzenia'}
            </p>
            <DraftMetricFactsTable metrics={metricFacts} />
          </div>
        )}
        {!hasV2MetricFacts && metricsForReportPeriod.length > 0 && (isolatedPreview || !reportMetrics?.length) && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Metryki z analizy</p>
            <MetricMatrix metrics={metricsForReportPeriod} />
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
        {extractionWarnings?.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-300">Ostrzeżenia</p>
            <ExtractionWarningsButton warnings={extractionWarnings} />
          </div>
        )}
      </div>
    </section>
  );
};

const getAnalysisTitle = (analysis) => (
  analysis?.title || `Analiza ${formatDate(analysis?.createdAt || analysis?.updatedAt)}`
);

const AnalysisManageModal = ({ dialog, busy, onClose, onConfirm }) => {
  const analysis = dialog?.analysis;
  const mode = dialog?.mode;
  const currentTitle = getAnalysisTitle(analysis);
  const [title, setTitle] = useState(currentTitle);

  if (!analysis || !mode) return null;

  const isRename = mode === 'rename';
  const canSubmit = !busy && (!isRename || title.trim());

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/75 px-4 py-6 backdrop-blur-sm">
      <div className="max-h-[calc(100vh-3rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-slate-950/70">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{isRename ? 'Edycja analizy' : 'Usuwanie analizy'}</p>
            <h3 className="mt-1 text-lg font-bold text-white">{isRename ? 'Zmień nazwę' : 'Usuń analizę'}</h3>
          </div>
          <ActionButton disabled={busy} className="border border-slate-700/70 bg-slate-800/60 px-2.5 py-1.5 text-slate-300 hover:bg-slate-800" onClick={onClose}>
            Zamknij
          </ActionButton>
        </div>

        {isRename ? (
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nazwa</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={busy}
              className="mt-2 w-full rounded-xl border border-slate-700/80 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition-colors focus:border-blue-400"
              autoFocus
            />
          </label>
        ) : (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm leading-6 text-rose-100">
            <p>Usunąć analizę <span className="font-semibold text-white">{currentTitle}</span>?</p>
            <p className="mt-2 text-rose-100/75">Jeśli analiza była zatwierdzona, powiązane zatwierdzone metryki raportowe też zostaną usunięte.</p>
          </div>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <SecondaryButton disabled={busy} onClick={onClose}>Anuluj</SecondaryButton>
          <ActionButton
            disabled={!canSubmit}
            className={isRename ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-rose-600 text-white hover:bg-rose-500'}
            onClick={() => onConfirm({ title: title.trim() })}
          >
            {isRename ? 'Zapisz nazwę' : 'Usuń analizę'}
          </ActionButton>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const SettingsIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 4.3l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.31.45.99 1.51 1H21a2 2 0 0 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15Z" />
  </svg>
);

const WarningTriangleIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.3 4.4 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

const ExtractionWarningsButton = ({ warnings }) => {
  const [open, setOpen] = useState(false);
  if (!warnings?.length) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200 transition-colors hover:border-amber-300/60 hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/35"
        aria-label={`Ostrzeżenia ekstrakcji: ${warnings.length}`}
        title="Ostrzeżenia ekstrakcji"
      >
        <WarningTriangleIcon />
        <span>Ostrzeżenia ekstrakcji</span>
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold leading-none text-slate-950">{warnings.length}</span>
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/75 px-4 py-6 backdrop-blur-sm">
          <div className="max-h-[calc(100vh-3rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-slate-950/70">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-amber-300">Ostrzeżenia ekstrakcji</p>
                <h3 className="mt-1 text-lg font-bold text-white">Co model uznał za niepewne</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Te informacje nie blokują podglądu analizy, ale pokazują gdzie OCR, nagłówki tabel albo jednostki były zbyt niejednoznaczne dla pewnego odczytu.
                </p>
              </div>
              <ActionButton className="border border-slate-700/70 bg-slate-800/60 px-2.5 py-1.5 text-slate-300 hover:bg-slate-800" onClick={() => setOpen(false)}>
                Zamknij
              </ActionButton>
            </div>
            <div className="space-y-3">
              {warnings.map((warning, index) => {
                const isObject = warning && typeof warning === 'object';
                const label = isObject ? warning.label || warning.metricKey || `Ostrzeżenie ${index + 1}` : `Ostrzeżenie ${index + 1}`;
                const metricKey = isObject ? warning.metricKey : '';
                const reason = isObject ? warning.reason || warning.text || warning.value || '' : String(warning);
                const source = isObject ? warning.source || {} : {};
                const evidence = isObject ? warning.evidence || warning.source?.evidence || warning.quote || '' : '';
                return (
                  <div key={`${index}-${String(label).slice(0, 16)}`} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-amber-100">{label}</p>
                      {metricKey && <Badge>{metricKey}</Badge>}
                    </div>
                    {reason && (
                      <p className="mt-2 inline-flex max-w-full items-start gap-1.5 text-sm leading-6 text-slate-300">
                        <span className="min-w-0">{reason}</span>
                        <SourceInlineInfo source={source} evidence={evidence} className="mt-1" />
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

const AnalysisHistory = ({ analyses, activeAnalysisId, helperOnline, busy, onSelect, onRenameRequest, onDeleteRequest }) => (
  <section className="rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl">
    <SectionHeading title="Historia analiz" description="Wybierz wersję do podglądu albo zarządzaj nazwą i usuwaniem." />
    {analyses?.length ? (
      <div className="space-y-2">
        {analyses.map((analysis, index) => {
          const analysisId = getItemId(analysis);
          const isActive = analysisId && analysisId === activeAnalysisId;
          return (
            <div key={analysisId || index} className={`flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between ${isActive ? 'border-blue-500/35 bg-blue-500/10' : 'border-slate-800/70 bg-slate-950/45'}`}>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-200">{analysis.title || `Analiza ${formatDate(analysis.createdAt || analysis.updatedAt)}`}</p>
                  {isActive && <Badge status="online">podgląd</Badge>}
                </div>
                <p className="mt-1 text-xs text-slate-500">{[
                  analysis.provider === 'openai' ? 'OpenAI GPT' : analysis.provider === 'perplexity' ? 'Perplexity' : analysis.provider,
                  analysis.model,
                ].filter(Boolean).join(' · ') || 'provider lub model niepodany'} · {analysis.schemaVersion || analysis.version || 'v1'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge status={analysis.status}>{getStatusLabel(analysis.status)}</Badge>
                <SecondaryButton
                  disabled={!analysisId}
                  className="px-2.5 py-1.5"
                  onClick={() => onSelect(analysisId)}
                >
                  Podgląd
                </SecondaryButton>
                <SecondaryButton
                  disabled={!helperOnline || busy || !analysisId}
                  className="px-2.5 py-1.5"
                  onClick={() => onRenameRequest(analysis)}
                >
                  Zmień nazwę
                </SecondaryButton>
                <ActionButton
                  disabled={!helperOnline || busy || !analysisId}
                  className="border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-rose-200 hover:bg-rose-500/15"
                  onClick={() => onDeleteRequest(analysis)}
                >
                  Usuń
                </ActionButton>
              </div>
            </div>
          );
        })}
      </div>
    ) : <EmptyState>Historia będzie widoczna po zatwierdzeniu pierwszego szkicu.</EmptyState>}
  </section>
);

const AnalysisSettingsModal = ({
  open,
  profile,
  selectedDocumentIds,
  documentSelection,
  helperOnline,
  openaiConfigured,
  loading,
  busy,
  documents,
  analyses,
  activeAnalysisId,
  onClose,
  onRefresh,
  onRunAnalysis,
  onToggleDocument,
  onImportDocument,
  onDeleteDocument,
  getDownloadUrl,
  onSelectAnalysis,
  onRenameAnalysis,
  onDeleteAnalysis,
}) => {
  const [provider, setProvider] = useState('perplexity');

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/75 px-4 py-6 backdrop-blur-sm">
      <div className="flex max-h-[calc(100vh-3rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl shadow-slate-950/70">
        <div className="flex flex-col gap-3 border-b border-slate-800/80 bg-slate-900 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-blue-300">Konfiguracja analizy</p>
            <h3 className="mt-1 text-lg font-bold text-white">{profile?.name || 'Instrument'}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">Ręczne dokumenty i historia analiz w jednym miejscu.</p>
          </div>
          <ActionButton className="self-start border border-slate-700/70 bg-slate-800/60 px-3 py-2 text-slate-200 hover:bg-slate-800" onClick={onClose}>
            Zamknij
          </ActionButton>
        </div>
        <div className="overflow-y-auto p-5">
          <div className="space-y-5">
              <section className="rounded-2xl border border-slate-800/80 bg-slate-900 p-5 shadow-xl">
                <SectionHeading
                  title="Konfiguracja analizy"
                  description="Wybierz dokumenty i providera, a następnie uruchom analizę dla zaznaczonych materiałów."
                />
                <div className="mb-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Provider analizy</p>
                  <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Provider analizy">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={provider === 'perplexity'}
                      onClick={() => setProvider('perplexity')}
                      className={`rounded-xl border px-4 py-3 text-left transition-colors ${provider === 'perplexity'
                        ? 'border-blue-400/60 bg-blue-500/10 text-blue-100'
                        : 'border-slate-700/70 bg-slate-950/45 text-slate-300 hover:border-slate-600'}`}
                    >
                      <span className="block text-sm font-semibold">Perplexity</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-400">Domyślny provider analizy raportów.</span>
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={provider === 'openai'}
                      disabled={!openaiConfigured}
                      onClick={() => setProvider('openai')}
                      className={`rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${provider === 'openai'
                        ? 'border-blue-400/60 bg-blue-500/10 text-blue-100'
                        : 'border-slate-700/70 bg-slate-950/45 text-slate-300 hover:border-slate-600'}`}
                    >
                      <span className="block text-sm font-semibold">OpenAI GPT</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-400">Analiza natywnych plików PDF przez OpenAI.</span>
                    </button>
                  </div>
                  {!openaiConfigured && (
                    <p className="mt-2 text-xs leading-5 text-amber-300">
                      OpenAI GPT jest niedostępne: ustaw <code className="font-mono text-amber-200">OPENAI_API_KEY</code> w <code className="font-mono text-amber-200">.env.local</code> helpera i odśwież widok.
                    </p>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <SecondaryButton disabled={!helperOnline || busy || loading} onClick={onRefresh}>Odśwież dane</SecondaryButton>
                  <PrimaryButton
                    disabled={!helperOnline || busy || !documentSelection.valid || (provider === 'openai' && !openaiConfigured)}
                    onClick={() => onRunAnalysis(provider)}
                    title={!documentSelection.valid ? documentSelection.message : undefined}
                  >
                    Analizuj przez {provider === 'openai' ? 'OpenAI GPT' : 'Perplexity'} {selectedDocumentIds.length ? `(${selectedDocumentIds.length})` : ''}
                  </PrimaryButton>
                </div>
                <p className={`mt-3 text-xs leading-5 ${documentSelection.valid ? 'text-slate-500' : 'text-amber-300'}`}>
                  {documentSelection.valid
                    ? `Zaznaczone dokumenty: ${selectedDocumentIds.length}. Okres analizy: ${documentSelection.periodInfo.label}.`
                    : documentSelection.message}
                </p>
              </section>
              <DocumentList
                documents={documents}
                selectedIds={selectedDocumentIds}
                helperOnline={helperOnline}
                busy={busy}
                onToggle={onToggleDocument}
                onImport={onImportDocument}
                onDelete={onDeleteDocument}
                getDownloadUrl={getDownloadUrl}
              />
              <AnalysisHistory
                analyses={analyses}
                activeAnalysisId={activeAnalysisId}
                helperOnline={helperOnline}
                busy={busy}
                onSelect={onSelectAnalysis}
                onRenameRequest={onRenameAnalysis}
                onDeleteRequest={onDeleteAnalysis}
              />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

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
    documents: pickArray('documents'),
    analyses: pickArray('analyses'),
    reportMetrics: pickArray('reportMetrics'),
  };
};

const AssetAnalysisDetail = ({ assetId, fallbackProfile, helperStatus, helperHealth, helperError, onRefreshOverview, busy, setBusy, setNotice }) => {
  const [detail, setDetail] = useState(() => getProfileParts(null, fallbackProfile));
  const [loading, setLoading] = useState(false);
  const [operationMessage, setOperationMessage] = useState('');
  const [detailError, setDetailError] = useState('');
  const [selectedDocumentIds, setSelectedDocumentIds] = useState([]);
  const [analysisDialog, setAnalysisDialog] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [analysisSelection, dispatchAnalysisSelection] = useReducer(
    reduceAnalysisViewSelection,
    undefined,
    createAnalysisViewSelection,
  );
  const {
    selectedReportAnalysisId,
    visibleQuarterMetricAnalysisIds,
    previewAnalysisId,
  } = analysisSelection;

  const helperOnline = helperStatus === 'online';
  const openaiConfigured = Boolean(helperHealth?.openaiConfigured);
  const profile = detail.profile || fallbackProfile;
  const selectionModel = useMemo(() => buildAnalysisSelectionModel(detail.analyses), [detail.analyses]);
  const effectiveSelectedReportAnalysisId = selectionModel.reportOptions.some(
    (option) => option.analysisId === selectedReportAnalysisId,
  ) ? selectedReportAnalysisId : selectionModel.defaultReportAnalysisId;
  const availableQuarterAnalysisIdList = [
    ...selectionModel.approvedQuarterOptions,
    ...selectionModel.quarterDraftOptions,
  ].map((option) => option.analysisId);
  const availableQuarterAnalysisIds = new Set(availableQuarterAnalysisIdList);
  const effectiveVisibleQuarterMetricAnalysisIds = visibleQuarterMetricAnalysisIds.filter(
    (analysisId) => availableQuarterAnalysisIds.has(analysisId),
  );
  const visibleReportMetrics = useMemo(() => filterReportMetricsForSelection(
    detail.reportMetrics,
    selectionModel,
    effectiveVisibleQuarterMetricAnalysisIds,
  ), [detail.reportMetrics, effectiveVisibleQuarterMetricAnalysisIds, selectionModel]);
  const previewAnalysis = detail.analyses.find((analysis) => getItemId(analysis) === previewAnalysisId) || null;
  const selectedReportOption = selectionModel.reportOptions.find(
    (option) => option.analysisId === effectiveSelectedReportAnalysisId,
  );
  const selectedReportAnalysis = selectedReportOption?.analysis || selectionModel.defaultReportAnalysis;
  const activeAnalysis = previewAnalysis || selectedReportAnalysis || null;
  const isolatedPreview = Boolean(previewAnalysis);
  const activeExtractionWarnings = getAnalysisItems(activeAnalysis, ['extractionWarnings']);
  const selectedDocuments = detail.documents.filter((document) => selectedDocumentIds.includes(getItemId(document)));
  const documentSelection = selectedDocuments.length === selectedDocumentIds.length
    ? validateAnalysisDocumentSelection(selectedDocuments)
    : {
      valid: false,
      code: 'DOCUMENT_NOT_FOUND',
      message: 'Odśwież wybór dokumentów przed uruchomieniem analizy.',
      periodInfo: null,
    };

  const refreshDetail = useCallback(async () => {
    if (!helperOnline) return;
    setLoading(true);
    setDetailError('');
    try {
      const [profileResult, documentsResult, analysesResult] = await Promise.all([
        analysisApi.getProfile(assetId),
        analysisApi.listDocuments(assetId),
        analysisApi.listAnalyses(assetId),
      ]);
      const next = getProfileParts(profileResult, fallbackProfile);
      next.documents = documentsResult.length ? documentsResult : next.documents;
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

  const importDocument = (file, metadata) => perform(async () => {
    await ensureProfile();
    return analysisApi.importDocument(assetId, file, metadata);
  }, 'Dokument został zapisany lokalnie.', 'Importuję dokument do lokalnego archiwum...');

  const deleteDocument = async (documentId) => {
    const result = await perform(
      () => analysisApi.deleteDocument(documentId),
      'Dokument usunięty z archiwum.',
      'Usuwam dokument z lokalnego archiwum...',
    );
    if (result) setSelectedDocumentIds((current) => current.filter((id) => id !== documentId));
    return result;
  };

  const runAnalysis = (provider = 'perplexity') => {
    if (!documentSelection.valid) {
      setNotice({ type: 'error', text: documentSelection.message });
      return Promise.resolve(null);
    }
    return perform(async () => {
      const result = await analysisApi.runAnalysis(assetId, { documentIds: selectedDocumentIds, provider });
      const nextAnalysisId = getItemId(result);
      if (nextAnalysisId) {
        dispatchAnalysisSelection({ type: 'open_preview', analysisId: nextAnalysisId });
      }
      return result;
    }, 'Powstał szkic analizy. Sprawdź go przed zapisaniem.', 'Wysyłam zaznaczone dokumenty do analizy i czekam na szkic...');
  };

  const approveAnalysis = async (analysisId) => {
    const result = await perform(
      () => analysisApi.approveAnalysis(analysisId),
      'Analiza została zatwierdzona i dodana do historii.',
      'Zatwierdzam szkic i zapisuję go w historii...',
    );
    if (result) dispatchAnalysisSelection({ type: 'close_preview', analysisId });
    return result;
  };

  const renameAnalysis = (analysisId, title) => perform(
    () => analysisApi.updateAnalysisTitle(analysisId, title),
    'Nazwa analizy została zmieniona.',
    'Zapisuję nową nazwę analizy...',
  );

  const deleteAnalysis = async (analysisId) => {
    const result = await perform(
      () => analysisApi.deleteAnalysis(analysisId),
      'Analiza została usunięta.',
      'Usuwam analizę z lokalnej historii...',
    );
    if (result) dispatchAnalysisSelection({ type: 'remove_analysis', analysisId });
    return result;
  };

  const confirmAnalysisDialog = async ({ title } = {}) => {
    if (!analysisDialog?.analysis) return;
    const analysisId = getItemId(analysisDialog.analysis);
    const result = analysisDialog.mode === 'rename'
      ? await renameAnalysis(analysisId, title)
      : await deleteAnalysis(analysisId);
    if (result) setAnalysisDialog(null);
  };

  const toggleDocument = (documentId) => {
    if (selectedDocumentIds.includes(documentId)) {
      setSelectedDocumentIds((current) => current.filter((id) => id !== documentId));
      return;
    }

    const document = detail.documents.find((item) => getItemId(item) === documentId);
    const nextSelection = validateAnalysisDocumentSelection([...selectedDocuments, document].filter(Boolean));
    if (!nextSelection.valid) {
      setNotice({ type: 'error', text: nextSelection.message });
      return;
    }
    setSelectedDocumentIds((current) => [...current, documentId]);
  };

  const identifier = profile.isin || profile.canonicalId || (profile.ticker && profile.exchange ? `${profile.ticker}:${profile.exchange}` : profile.ticker);

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl p-4 sm:p-6 lg:p-8 animate-fadeIn">
      <div className="mb-8">
        <Link to="/analysis" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 transition-colors hover:text-blue-300">← Wszystkie aktywa</Link>
        <div className="mt-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge>{getAnalysisTypeLabel(profile.type)}</Badge>
              {profile.isPilot && <Badge>profil pilota</Badge>}
              {helperOnline ? <Badge status="online">helper online</Badge> : <Badge status="offline">helper offline</Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold text-white">{profile.name}</h1>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-700/70 bg-slate-900 text-slate-300 shadow-lg shadow-slate-950/30 transition-colors hover:border-blue-400/50 hover:bg-slate-800 hover:text-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/35"
                  aria-label="Otwórz konfigurację analizy"
                  title="Konfiguracja analizy"
                >
                  <SettingsIcon />
                </button>
              </div>
            </div>
            <p className="mt-2 font-mono text-sm text-slate-500">{identifier || assetId}</p>
          </div>
        </div>
      </div>

      <HelperBanner status={helperStatus} error={helperError || detailError} onRetry={onRefreshOverview} />
      <AnalysisManageModal
        key={`${analysisDialog?.mode || 'none'}-${getItemId(analysisDialog?.analysis) || 'none'}`}
        dialog={analysisDialog}
        busy={busy}
        onClose={() => setAnalysisDialog(null)}
        onConfirm={confirmAnalysisDialog}
      />
      {settingsOpen && <AnalysisSettingsModal
        open={settingsOpen}
        profile={profile}
        selectedDocumentIds={selectedDocumentIds}
        documentSelection={documentSelection}
        helperOnline={helperOnline}
        openaiConfigured={openaiConfigured}
        loading={loading}
        busy={busy}
        documents={detail.documents}
        analyses={detail.analyses}
        activeAnalysisId={getItemId(previewAnalysis)}
        onClose={() => setSettingsOpen(false)}
        onRefresh={refreshDetail}
        onRunAnalysis={runAnalysis}
        onToggleDocument={toggleDocument}
        onImportDocument={importDocument}
        onDeleteDocument={deleteDocument}
        getDownloadUrl={analysisApi.getDocumentDownloadUrl}
        onSelectAnalysis={(analysisId) => {
          dispatchAnalysisSelection({ type: 'open_preview', analysisId });
          setSettingsOpen(false);
        }}
        onRenameAnalysis={(analysis) => setAnalysisDialog({ mode: 'rename', analysis })}
        onDeleteAnalysis={(analysis) => setAnalysisDialog({ mode: 'delete', analysis })}
      />}

      {(loading || operationMessage) && (
        <div className="mb-6">
          <LoadingCallout message={operationMessage || 'Wczytuję profil, dokumenty i historię analiz...'} />
        </div>
      )}

      {detailError && helperOnline && (
        <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
          {detailError} Jeśli profil nie istnieje jeszcze w bazie, ręczny import dokumentu utworzy go lokalnie.
        </div>
      )}

      <div className="space-y-6">
        <AnalysisPreview
          analysis={activeAnalysis}
          reportMetrics={visibleReportMetrics}
          positions={profile.positions || fallbackProfile.positions}
          selectionModel={selectionModel}
          selectedReportAnalysisId={effectiveSelectedReportAnalysisId}
          visibleQuarterMetricAnalysisIds={effectiveVisibleQuarterMetricAnalysisIds}
          onReportChange={(analysisId) => {
            dispatchAnalysisSelection({ type: 'select_report', analysisId });
          }}
          onQuarterMetricToggle={(analysisId) => {
            dispatchAnalysisSelection({
              type: 'toggle_quarter_metrics',
              analysisId,
              availableAnalysisIds: availableQuarterAnalysisIdList,
            });
          }}
          isolatedPreview={isolatedPreview}
          onClosePreview={() => dispatchAnalysisSelection({ type: 'close_preview' })}
          extractionWarnings={activeExtractionWarnings}
          helperOnline={helperOnline}
          busy={busy}
          onApprove={approveAnalysis}
        />
        <SecondOpinion profile={profile} />
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
  const [helperStatus, setHelperStatus] = useState('loading');
  const [helperHealth, setHelperHealth] = useState(null);
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
      const health = await analysisApi.getHealth();
      setHelperHealth(health);
      setHelperStatus('online');
      const positions = toSyncPositions(portfolioAssets);
      await analysisApi.syncProfiles(positions);
      const profilesResult = await analysisApi.listProfiles();
      setServerProfiles(profilesResult);
    } catch (error) {
      setHelperStatus('offline');
      setHelperHealth(null);
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
          helperHealth={helperHealth}
          helperError={helperError}
          onRefreshOverview={refreshOverview}
          busy={busy}
          setBusy={setBusy}
          setNotice={setNotice}
        />
      ) : (
        <AnalysisList
          profiles={profiles}
          helperStatus={helperStatus}
          helperError={helperError}
          onRefresh={refreshOverview}
          onCreate={createProfile}
          busy={busy}
        />
      )}
    </>
  );
};

export default Analysis;
