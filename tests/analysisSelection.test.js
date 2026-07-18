import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAnalysisSelectionModel,
  createAnalysisViewSelection,
  filterReportMetricsForSelection,
  reduceAnalysisViewSelection,
} from '../src/utils/analysisSelection.js';
import { filterReportMetricFactsForPeriod } from '../src/utils/reportMetricDefinitions.js';

const analysis = ({ id, period, status = 'approved', approvedAt, createdAt, title }) => ({
  id,
  status,
  title: title || id,
  approvedAt,
  createdAt: createdAt || approvedAt,
  content: { reportPeriod: period },
});

test('selection model keeps the latest approved analysis per annual year and quarter', () => {
  const model = buildAnalysisSelectionModel([
    analysis({ id: 'fy-2025-old', period: '2025', approvedAt: '2026-01-10T00:00:00Z' }),
    analysis({ id: 'fy-2025-new', period: '2025', approvedAt: '2026-02-10T00:00:00Z' }),
    analysis({ id: 'fy-2024-late', period: '2024', approvedAt: '2026-06-10T00:00:00Z' }),
    analysis({ id: 'q1-old', period: 'Q1 2026', approvedAt: '2026-04-10T00:00:00Z' }),
    analysis({ id: 'q1-new', period: 'Q1 2026', approvedAt: '2026-04-20T00:00:00Z' }),
    analysis({ id: 'q4-2025', period: 'Q4 2025', approvedAt: '2026-05-20T00:00:00Z' }),
  ]);

  assert.deepEqual(model.annualOptions.map((option) => option.analysisId), ['fy-2025-new', 'fy-2024-late']);
  assert.deepEqual(model.approvedQuarterOptions.map((option) => option.analysisId), ['q1-new', 'q4-2025']);
  assert.equal(model.defaultReportAnalysisId, 'q1-new');
  assert.deepEqual(model.reportGroups.map((group) => group.year), [2026, 2025, 2024]);
});

test('the newest report year wins, with the annual report preferred within that year', () => {
  const model = buildAnalysisSelectionModel([
    analysis({ id: 'fy-2025', period: '2025', approvedAt: '2026-01-10T00:00:00Z' }),
    analysis({ id: 'fy-2024', period: '2024', approvedAt: '2026-07-10T00:00:00Z' }),
    analysis({ id: 'q2-2026', period: 'Q2 2026', approvedAt: '2026-07-15T00:00:00Z' }),
  ]);

  assert.equal(model.defaultReportAnalysisId, 'q2-2026');

  const withAnnualForNewestYear = buildAnalysisSelectionModel([
    ...model.reportOptions.map((option) => option.analysis),
    analysis({ id: 'fy-2026', period: '2026', approvedAt: '2027-01-10T00:00:00Z' }),
  ]);
  assert.equal(withAnnualForNewestYear.defaultReportAnalysisId, 'fy-2026');
});

test('newest report quarter is the fallback when no approved annual report exists', () => {
  const model = buildAnalysisSelectionModel([
    analysis({ id: 'q4-2025-late', period: 'Q4 2025', approvedAt: '2026-07-15T00:00:00Z' }),
    analysis({ id: 'q1-2026-early', period: 'Q1 2026', approvedAt: '2026-04-15T00:00:00Z' }),
    analysis({ id: 'annual-draft', period: '2026', status: 'draft', createdAt: '2026-07-16T00:00:00Z' }),
  ]);

  assert.equal(model.defaultReportAnalysisId, 'q1-2026-early');
});

test('all quarterly drafts remain separate options grouped with approved quarters by year', () => {
  const model = buildAnalysisSelectionModel([
    analysis({ id: 'q1-approved', period: 'Q1 2026', approvedAt: '2026-04-15T00:00:00Z' }),
    analysis({ id: 'q1-draft-a', period: 'Q1 2026', status: 'draft', createdAt: '2026-04-16T00:00:00Z' }),
    analysis({ id: 'q1-draft-b', period: 'Q1 2026', status: 'draft', createdAt: '2026-04-17T00:00:00Z' }),
    analysis({ id: 'q4-draft', period: 'Q4 2025', status: 'draft', createdAt: '2026-01-17T00:00:00Z' }),
    analysis({ id: 'annual-draft', period: '2025', status: 'draft', createdAt: '2026-01-18T00:00:00Z' }),
  ]);

  assert.deepEqual(model.quarterDraftOptions.map((option) => option.analysisId), [
    'q1-draft-b',
    'q1-draft-a',
    'q4-draft',
  ]);
  assert.deepEqual(model.reportGroups.map((group) => group.year), [2026, 2025]);
  assert.deepEqual(model.reportGroups[0].approvedQuarterOptions.map((option) => option.analysisId), ['q1-approved']);
  assert.deepEqual(model.reportGroups[0].quarterDraftOptions.map((option) => option.analysisId), ['q1-draft-b', 'q1-draft-a']);
});

test('selecting a report closes history preview without changing visible metric quarters', () => {
  const current = {
    selectedReportAnalysisId: 'fy-2024',
    visibleQuarterMetricAnalysisIds: ['q1-2025', 'q2-2025'],
    previewAnalysisId: 'history-version',
  };

  const next = reduceAnalysisViewSelection(current, {
    type: 'select_report',
    analysisId: 'q2-2025',
  });

  assert.deepEqual(next, {
    selectedReportAnalysisId: 'q2-2025',
    visibleQuarterMetricAnalysisIds: ['q1-2025', 'q2-2025'],
    previewAnalysisId: '',
  });
});

test('quarter metric visibility is independent and deleted analyses leave no stale selection', () => {
  let selection = createAnalysisViewSelection();
  selection = reduceAnalysisViewSelection(selection, { type: 'select_report', analysisId: 'q2-draft' });
  selection = reduceAnalysisViewSelection(selection, { type: 'open_preview', analysisId: 'history-version' });
  selection = reduceAnalysisViewSelection(selection, {
    type: 'toggle_quarter_metrics',
    analysisId: 'q2-draft',
    availableAnalysisIds: ['q1-approved', 'q2-draft'],
  });

  assert.equal(selection.previewAnalysisId, 'history-version');
  assert.equal(selection.selectedReportAnalysisId, 'q2-draft');
  assert.deepEqual(selection.visibleQuarterMetricAnalysisIds, ['q2-draft']);

  selection = reduceAnalysisViewSelection(selection, { type: 'remove_analysis', analysisId: 'q2-draft' });
  assert.equal(selection.selectedReportAnalysisId, '');
  assert.deepEqual(selection.visibleQuarterMetricAnalysisIds, []);

  selection = reduceAnalysisViewSelection(selection, { type: 'remove_analysis', analysisId: 'history-version' });
  assert.equal(selection.previewAnalysisId, '');
});

test('metric filtering shows annual periods by default and only quarters enabled with the eye', () => {
  const model = buildAnalysisSelectionModel([
    analysis({ id: 'fy-2025', period: '2025', approvedAt: '2026-02-10T00:00:00Z' }),
    analysis({ id: 'q1-2026', period: 'Q1 2026', approvedAt: '2026-04-20T00:00:00Z' }),
    analysis({ id: 'q2-2026', period: 'Q2 2026', approvedAt: '2026-07-20T00:00:00Z' }),
  ]);
  const metrics = [
    { metricKey: 'net_income', period: '2025', value: 100 },
    { metricKey: 'net_income', period: '2024', value: 80 },
    { metricKey: 'net_income', period: 'Q1 2026', value: 30 },
    { metricKey: 'net_income', period: 'Q2 2026', value: 40 },
  ];

  assert.deepEqual(
    filterReportMetricsForSelection(metrics, model, []).map((metric) => metric.period),
    ['2025', '2024'],
  );
  assert.deepEqual(
    filterReportMetricsForSelection(metrics, model, ['q2-2026']).map((metric) => metric.period),
    ['2025', '2024', 'Q2 2026'],
  );
});

test('isolated preview metric filtering keeps only the selected report period', () => {
  const metrics = [
    { metricKey: 'net_income', period: '2025', value: 100 },
    { metricKey: 'net_income', period: 'Q1 2026', value: 30 },
    { metricKey: 'net_income', period: 'Q2 2026', value: 40 },
  ];

  assert.deepEqual(
    filterReportMetricFactsForPeriod(metrics, 'Q1 2026').map((metric) => metric.period),
    ['Q1 2026'],
  );
});
