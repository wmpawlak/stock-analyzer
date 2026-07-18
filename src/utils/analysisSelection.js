import { getReportPeriodInfo } from '../../shared/reportPeriods.js';

const getAnalysisId = (analysis) => String(analysis?.id || analysis?.analysisId || '');

export const getAnalysisTime = (analysis) => {
  const date = new Date(analysis?.approvedAt || analysis?.updatedAt || analysis?.createdAt || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

export const getAnalysisReportPeriodInfo = (analysis) => {
  const content = analysis?.content || analysis?.result || analysis || {};
  const period = content.reportPeriod || analysis?.reportPeriod || analysis?.period || '';
  return period ? getReportPeriodInfo(period) : null;
};

const compareVersions = (left, right) => (
  getAnalysisTime(right) - getAnalysisTime(left)
  || getAnalysisId(right).localeCompare(getAnalysisId(left), 'pl')
);

const compareReportPeriods = (left, right) => (
  (right.year || 0) - (left.year || 0)
  || (right.quarter || 0) - (left.quarter || 0)
  || compareVersions(left.analysis, right.analysis)
);

const toOption = (analysis, periodInfo, kind) => ({
  id: getAnalysisId(analysis),
  analysisId: getAnalysisId(analysis),
  analysis,
  kind,
  status: String(analysis?.status || '').toLowerCase(),
  title: analysis?.title || analysis?.content?.title || periodInfo.label,
  periodKey: periodInfo.key,
  label: periodInfo.label,
  year: periodInfo.year,
  quarter: periodInfo.quarter,
  timestamp: getAnalysisTime(analysis),
});

const latestApprovedByPeriod = (analyses, periodKind) => {
  const latest = new Map();

  analyses.forEach((analysis) => {
    if (String(analysis?.status || '').toLowerCase() !== 'approved') return;
    const periodInfo = getAnalysisReportPeriodInfo(analysis);
    if (!periodInfo || periodInfo.kind !== periodKind) return;

    const current = latest.get(periodInfo.key);
    if (!current || compareVersions(analysis, current.analysis) < 0) {
      latest.set(periodInfo.key, toOption(analysis, periodInfo, 'approved'));
    }
  });

  return [...latest.values()].sort(compareReportPeriods);
};

const groupReportOptions = (annualOptions, approvedQuarterOptions, quarterDraftOptions) => {
  const groups = new Map();

  [...annualOptions, ...approvedQuarterOptions, ...quarterDraftOptions].forEach((option) => {
    if (!groups.has(option.year)) {
      groups.set(option.year, {
        year: option.year,
        annualOptions: [],
        approvedQuarterOptions: [],
        quarterDraftOptions: [],
      });
    }
    const group = groups.get(option.year);
    if (option.kind === 'draft') group.quarterDraftOptions.push(option);
    else if (option.quarter) group.approvedQuarterOptions.push(option);
    else group.annualOptions.push(option);
  });

  return [...groups.values()]
    .sort((left, right) => (right.year || 0) - (left.year || 0))
    .map((group) => ({
      ...group,
      annualOptions: group.annualOptions.sort(compareReportPeriods),
      approvedQuarterOptions: group.approvedQuarterOptions.sort(compareReportPeriods),
      quarterDraftOptions: group.quarterDraftOptions.sort(compareReportPeriods),
    }));
};

export const buildAnalysisSelectionModel = (analyses = []) => {
  const safeAnalyses = Array.isArray(analyses) ? analyses : [];
  const annualOptions = latestApprovedByPeriod(safeAnalyses, 'annual');
  const approvedQuarterOptions = latestApprovedByPeriod(safeAnalyses, 'quarter');
  const quarterDraftOptions = safeAnalyses
    .filter((analysis) => String(analysis?.status || '').toLowerCase() === 'draft')
    .map((analysis) => {
      const periodInfo = getAnalysisReportPeriodInfo(analysis);
      return periodInfo?.isQuarter ? toOption(analysis, periodInfo, 'draft') : null;
    })
    .filter(Boolean)
    .sort(compareReportPeriods);
  const reportGroups = groupReportOptions(annualOptions, approvedQuarterOptions, quarterDraftOptions);
  const reportOptions = reportGroups.flatMap((group) => [
    ...group.annualOptions,
    ...group.approvedQuarterOptions,
    ...group.quarterDraftOptions,
  ]);
  const newestApprovedYear = Math.max(
    0,
    ...annualOptions.map((option) => option.year || 0),
    ...approvedQuarterOptions.map((option) => option.year || 0),
  );
  const defaultReportOption = annualOptions.find((option) => option.year === newestApprovedYear)
    || approvedQuarterOptions.find((option) => option.year === newestApprovedYear)
    || null;

  return {
    annualOptions,
    approvedQuarterOptions,
    quarterDraftOptions,
    reportGroups,
    reportOptions,
    defaultReportAnalysisId: defaultReportOption?.analysisId || '',
    defaultReportAnalysis: defaultReportOption?.analysis || null,
  };
};

export const createAnalysisViewSelection = () => ({
  selectedReportAnalysisId: '',
  visibleQuarterMetricAnalysisIds: [],
  previewAnalysisId: '',
});

export const filterReportMetricsForSelection = (
  metrics = [],
  selectionModel,
  visibleQuarterMetricAnalysisIds = [],
) => {
  const visibleAnalysisIds = new Set(visibleQuarterMetricAnalysisIds.map(String));
  const visibleQuarterPeriodKeys = new Set([
    ...(selectionModel?.approvedQuarterOptions || []),
    ...(selectionModel?.quarterDraftOptions || []),
  ]
    .filter((option) => visibleAnalysisIds.has(option.analysisId))
    .map((option) => option.periodKey));

  return (Array.isArray(metrics) ? metrics : []).filter((metric) => {
    const periodInfo = getReportPeriodInfo(metric?.period || metric?.reportingPeriod || '');
    return periodInfo.isAnnual || (periodInfo.isQuarter && visibleQuarterPeriodKeys.has(periodInfo.key));
  });
};

export const reduceAnalysisViewSelection = (selection, action) => {
  const current = selection || createAnalysisViewSelection();
  if (!action || typeof action !== 'object') return current;

  if (action.type === 'open_preview') {
    return { ...current, previewAnalysisId: String(action.analysisId || '') };
  }

  if (action.type === 'select_report') {
    return {
      ...current,
      selectedReportAnalysisId: String(action.analysisId || ''),
      previewAnalysisId: '',
    };
  }

  if (action.type === 'toggle_quarter_metrics') {
    const analysisId = String(action.analysisId || '');
    const availableIds = new Set((action.availableAnalysisIds || []).map(String));
    const validIds = current.visibleQuarterMetricAnalysisIds.filter((id) => availableIds.has(id));
    const visibleQuarterMetricAnalysisIds = !analysisId || !availableIds.has(analysisId)
      ? validIds
      : validIds.includes(analysisId)
        ? validIds.filter((id) => id !== analysisId)
        : [...validIds, analysisId];
    return { ...current, visibleQuarterMetricAnalysisIds };
  }

  if (action.type === 'close_preview') {
    if (action.analysisId && current.previewAnalysisId !== action.analysisId) return current;
    return { ...current, previewAnalysisId: '' };
  }

  if (action.type === 'remove_analysis') {
    const analysisId = String(action.analysisId || '');
    if (!analysisId) return current;
    return {
      selectedReportAnalysisId: current.selectedReportAnalysisId === analysisId ? '' : current.selectedReportAnalysisId,
      visibleQuarterMetricAnalysisIds: current.visibleQuarterMetricAnalysisIds.filter((id) => id !== analysisId),
      previewAnalysisId: current.previewAnalysisId === analysisId ? '' : current.previewAnalysisId,
    };
  }

  return current;
};
