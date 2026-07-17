import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ANALYSIS_V2_SCHEMA_VERSION,
  BANK_REPORT_METRICS,
  COMMON_REPORT_METRICS,
  PRIORITY_BANK_REPORT_METRIC_KEYS,
  REPORT_METRIC_CATALOG,
  findReportMetricSpec,
  getReportMetricsForProfile,
  isBankReportProfile,
  metricUnitMatchesValueType,
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
  assert.equal(COMMON_REPORT_METRICS.length, 16);
  assert.equal(BANK_REPORT_METRICS.length, 16);
  assert.equal(REPORT_METRIC_CATALOG.length, 32);

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
    'roic',
    'gross_margin',
    'operating_margin',
    'net_margin',
    'nim',
    'mrel',
    'net_debt_ebitda',
    'current_ratio',
    'quick_ratio',
    'lcr',
    'free_cash_flow',
    'dividend_per_share',
  ].forEach((key) => assert.equal(keys.has(key), true, `${key} missing from catalog`));

  REPORT_METRIC_CATALOG.forEach((metric) => {
    assert.equal(typeof metric.description, 'string', `${metric.metricKey} description missing`);
    assert.ok(metric.description.length >= 20, `${metric.metricKey} description too short`);
    assert.equal(typeof metric.shortName, 'string', `${metric.metricKey} shortName missing`);
    assert.equal(typeof metric.namePl, 'string', `${metric.metricKey} namePl missing`);
    assert.equal(typeof metric.nameEn, 'string', `${metric.metricKey} nameEn missing`);
    assert.ok(['primary', 'secondary'].includes(metric.tier), `${metric.metricKey} tier invalid`);
    assert.ok(metric.aliases.includes(metric.shortName), `${metric.metricKey} shortName missing from aliases`);
    assert.ok(metric.aliases.includes(metric.namePl), `${metric.metricKey} namePl missing from aliases`);
    assert.ok(metric.aliases.includes(metric.nameEn), `${metric.metricKey} nameEn missing from aliases`);
  });
});

test('catalog tiers keep the bank checklist primary and all additional metrics secondary', () => {
  const primaryKeys = REPORT_METRIC_CATALOG
    .filter((metric) => metric.tier === 'primary')
    .map((metric) => metric.metricKey);
  assert.deepEqual(primaryKeys, PRIORITY_BANK_REPORT_METRIC_KEYS);

  [
    'roic',
    'gross_margin',
    'operating_margin',
    'net_margin',
    'nim',
    'mrel',
    'net_debt_ebitda',
    'current_ratio',
    'quick_ratio',
    'lcr',
    'free_cash_flow',
    'dividend_per_share',
  ].forEach((key) => assert.equal(findReportMetricSpec(key)?.tier, 'secondary'));

  assert.equal(findReportMetricSpec('Payout Ratio')?.metricKey, 'dividend_net_profit_ratio');
  assert.equal(REPORT_METRIC_CATALOG.some((metric) => metric.metricKey === 'payout_ratio'), false);
});

test('bank catalog labels match the requested Alior metric set', () => {
  const labelsByKey = new Map(REPORT_METRIC_CATALOG.map((metric) => [metric.metricKey, metric.label]));
  assert.equal(labelsByKey.get('net_income'), 'Zysk netto');
  assert.equal(labelsByKey.get('net_interest_income'), 'Wynik z tytułu odsetek');
  assert.equal(labelsByKey.get('net_fee_commission_income'), 'Wynik z opłat i prowizji');
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

test('bank priority metric checklist keeps the requested display order', () => {
  assert.deepEqual(PRIORITY_BANK_REPORT_METRIC_KEYS, [
    'net_income',
    'net_interest_income',
    'net_fee_commission_income',
    'roe',
    'roa',
    'cost_income_ratio',
    'npl_ratio',
    'cost_of_risk',
    'tcr',
    'loan_deposit_ratio',
    'eps',
    'dividend_net_profit_ratio',
  ]);
});

test('bank aliases resolve to stable metric keys', () => {
  assert.equal(findReportMetricSpec('Wynik z tytułu odsetek')?.metricKey, 'net_interest_income');
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

test('CoR is a percentage metric and does not alias monetary risk costs', () => {
  const costOfRisk = findReportMetricSpec('CoR');
  assert.equal(costOfRisk?.valueType, 'percent');
  assert.equal(costOfRisk?.aggregation, 'point_in_time');
  assert.equal(findReportMetricSpec('Koszty ryzyka prawnego'), null);
  assert.equal(metricUnitMatchesValueType('%', costOfRisk.valueType), true);
  assert.equal(metricUnitMatchesValueType('PLN', costOfRisk.valueType), false);
});

test('bank profiles receive common plus bank metrics', () => {
  const metrics = getReportMetricsForProfile({
    type: 'instrument',
    name: 'Alior Bank',
    canonicalId: 'ALR:WSE',
  });
  assert.equal(metrics.length, REPORT_METRIC_CATALOG.length);
  assert.equal(metrics.some((metric) => metric.metricKey === 'nim'), true);
  assert.equal(metrics.some((metric) => metric.metricKey === 'free_cash_flow'), true);

  const nonBankMetrics = getReportMetricsForProfile({ type: 'company', name: 'CD PROJEKT' });
  assert.equal(nonBankMetrics.length, COMMON_REPORT_METRICS.length);
  assert.equal(nonBankMetrics.some((metric) => metric.metricKey === 'free_cash_flow'), true);
  assert.equal(nonBankMetrics.some((metric) => metric.metricKey === 'nim'), false);
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
