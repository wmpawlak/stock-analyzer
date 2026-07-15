import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ANALYSIS_V2_SCHEMA_VERSION,
  BANK_REPORT_METRICS,
  COMMON_REPORT_METRICS,
  REPORT_METRIC_CATALOG,
  findReportMetricSpec,
  getReportMetricsForProfile,
  isBankReportProfile,
  validateAnalysisV2Shape,
} from '../server/analysisMetricCatalog.js';

const fixturePath = path.join(
  process.cwd(),
  'tests',
  'fixtures',
  'analysis',
  'alior-q1-2026.v2.json',
);

test('report metric catalog contains common and bank metrics for the v2 workshop', () => {
  assert.equal(COMMON_REPORT_METRICS.length, 7);
  assert.equal(BANK_REPORT_METRICS.length, 13);
  assert.equal(REPORT_METRIC_CATALOG.length, 20);

  const keys = new Set(REPORT_METRIC_CATALOG.map((metric) => metric.metricKey));
  [
    'net_income',
    'total_assets',
    'equity',
    'net_interest_income',
    'net_fee_commission_income',
    'cost_income_ratio',
    'cost_of_risk',
    'cet1',
    'tcr',
    'npl_ratio',
    'loan_deposit_ratio',
    'eps',
    'dividend_amount',
    'dividend_net_profit_ratio',
    'customer_deposits',
    'customer_loans',
  ].forEach((key) => assert.equal(keys.has(key), true, `${key} missing from catalog`));

  REPORT_METRIC_CATALOG.forEach((metric) => {
    assert.equal(typeof metric.description, 'string', `${metric.metricKey} description missing`);
    assert.ok(metric.description.length >= 20, `${metric.metricKey} description too short`);
  });
});

test('bank catalog labels match the requested Alior metric set', () => {
  const labelsByKey = new Map(REPORT_METRIC_CATALOG.map((metric) => [metric.metricKey, metric.label]));
  assert.equal(labelsByKey.get('net_income'), 'Zysk netto');
  assert.equal(labelsByKey.get('net_interest_income'), 'Wynik z tytulu odsetek');
  assert.equal(labelsByKey.get('net_fee_commission_income'), 'Wynik z oplat i prowizji');
  assert.equal(labelsByKey.get('roe'), 'ROE');
  assert.equal(labelsByKey.get('roa'), 'ROA');
  assert.equal(labelsByKey.get('cost_income_ratio'), 'C/I');
  assert.equal(labelsByKey.get('npl_ratio'), 'NPL');
  assert.equal(labelsByKey.get('cost_of_risk'), 'CoR');
  assert.equal(labelsByKey.get('tcr'), 'TCR');
  assert.equal(labelsByKey.get('loan_deposit_ratio'), 'L/D');
  assert.equal(labelsByKey.get('eps'), 'EPS');
  assert.equal(labelsByKey.get('dividend_net_profit_ratio'), 'Dividend/net profit');
});

test('bank aliases resolve to stable metric keys', () => {
  assert.equal(findReportMetricSpec('Wynik z tytulu odsetek')?.metricKey, 'net_interest_income');
  assert.equal(findReportMetricSpec('wynik z tytułu prowizji i opłat')?.metricKey, 'net_fee_commission_income');
  assert.equal(findReportMetricSpec('Zobowiązania wobec klientów')?.metricKey, 'customer_deposits');
  assert.equal(findReportMetricSpec('Współczynnik wypłacalności')?.metricKey, 'tcr');
  assert.equal(findReportMetricSpec('Należności od klientów')?.metricKey, 'customer_loans');
});

test('new bank aliases resolve Polish abbreviations and English metric names', () => {
  assert.equal(findReportMetricSpec('Cost to Income')?.metricKey, 'cost_income_ratio');
  assert.equal(findReportMetricSpec('C/I')?.metricKey, 'cost_income_ratio');
  assert.equal(findReportMetricSpec('Non-Performing Loans')?.metricKey, 'npl_ratio');
  assert.equal(findReportMetricSpec('Cost of Risk')?.metricKey, 'cost_of_risk');
  assert.equal(findReportMetricSpec('Total Capital Ratio')?.metricKey, 'tcr');
  assert.equal(findReportMetricSpec('Loan to Deposit')?.metricKey, 'loan_deposit_ratio');
  assert.equal(findReportMetricSpec('L/D')?.metricKey, 'loan_deposit_ratio');
  assert.equal(findReportMetricSpec('Earnings per Share')?.metricKey, 'eps');
  assert.equal(findReportMetricSpec('payout ratio')?.metricKey, 'dividend_net_profit_ratio');
});

test('bank profiles receive common plus bank metrics', () => {
  const metrics = getReportMetricsForProfile({
    type: 'instrument',
    name: 'Alior Bank',
    canonicalId: 'ALR:WSE',
  });
  assert.equal(metrics.length, REPORT_METRIC_CATALOG.length);

  const nonBankMetrics = getReportMetricsForProfile({ type: 'company', name: 'CD PROJEKT' });
  assert.equal(nonBankMetrics.length, COMMON_REPORT_METRICS.length);
});

test('bank profile detection is shared by catalog and prompt rules', () => {
  assert.equal(isBankReportProfile({ type: 'instrument', name: 'Alior Bank', canonicalId: 'ALR:WSE' }), true);
  assert.equal(isBankReportProfile({ type: 'company', name: 'CD PROJEKT', canonicalId: 'WSE:CDR' }), false);
});

test('Alior Q1 2026 workshop fixture matches analysis schema v2 shape', async () => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  assert.equal(fixture.schemaVersion, ANALYSIS_V2_SCHEMA_VERSION);

  const result = validateAnalysisV2Shape(fixture);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);

  const metricKeys = fixture.metricFacts.map((fact) => fact.metricKey);
  assert.equal(metricKeys.includes('net_income'), true);
  assert.equal(metricKeys.includes('net_interest_income'), true);
  assert.equal(metricKeys.includes('npl_ratio'), false);
  assert.equal(fixture.extractionWarnings.some((warning) => warning.metricKey === 'npl_ratio'), true);
});

test('analysis v2 validation rejects stale schema versions', async () => { 
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')); 
  const result = validateAnalysisV2Shape({ ...fixture, schemaVersion: '1.0' }); 
 
  assert.equal(result.valid, false); 
  assert.ok(result.errors.includes(`schemaVersion must be ${ANALYSIS_V2_SCHEMA_VERSION}`)); 
}); 

test('analysis v2 validation checks structured summary when present', async () => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const result = validateAnalysisV2Shape({
    ...fixture,
    structuredSummary: {
      headline: '',
      stance: 'kupuj',
      sections: [],
    },
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('structuredSummary.headline must be a non-empty string'));
  assert.ok(result.errors.includes('structuredSummary.stance must be one of pozytywny, mieszany, ostrozny, negatywny'));
  assert.ok(result.errors.includes('structuredSummary.sections must be a non-empty array'));
});
