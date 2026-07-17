import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getReportPeriodInfo,
  inferReportPeriodFromText,
  normalizeReportPeriod,
} from '../shared/reportPeriods.js';

test('report periods normalize explicit quarters, quarter-end dates and full quarter ranges', () => {
  assert.equal(normalizeReportPeriod('Q1 2025'), 'Q1 2025');
  assert.equal(normalizeReportPeriod('Raport za III kwartał 2025'), 'Q3 2025');
  assert.equal(normalizeReportPeriod('31.03.2025'), 'Q1 2025');
  assert.equal(normalizeReportPeriod('2025-06-30'), 'Q2 2025');
  assert.equal(normalizeReportPeriod('01.01.2025-31.03.2025'), 'Q1 2025');
  assert.equal(normalizeReportPeriod('01.04.2025 - 30.06.2025'), 'Q2 2025');
  assert.equal(normalizeReportPeriod('01.07.2025 do 30.09.2025'), 'Q3 2025');
  assert.equal(normalizeReportPeriod('2025-10-01 to 2025-12-31'), 'Q4 2025');
});

test('cumulative half-year and nine-month ranges are not inferred as standalone quarters', () => {
  assert.equal(inferReportPeriodFromText('01.01.2025-30.06.2025'), '');
  assert.equal(inferReportPeriodFromText('01.01.2025-30.09.2025'), '');
  assert.equal(inferReportPeriodFromText('H1 2025 zakończone 30.06.2025'), '');
  assert.equal(inferReportPeriodFromText('9M 2025 zakończone 30.09.2025'), '');
  assert.notEqual(normalizeReportPeriod('01.01.2025-30.06.2025'), 'Q2 2025');
});

test('report period info exposes one canonical key to backend and UI consumers', () => {
  assert.deepEqual(getReportPeriodInfo('31.03.2025'), {
    key: 'Q:2025:1',
    label: 'Q1 2025',
    year: 2025,
    quarter: 1,
    isQuarter: true,
  });
});
