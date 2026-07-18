import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPORT_DOCUMENT_TYPES,
  buildManualReportMetadata,
  validateAnalysisDocumentSelection,
  validateReportDocumentMetadata,
} from '../shared/reportDocuments.js';

test('manual report metadata builds canonical annual and quarterly periods', () => {
  assert.deepEqual(
    buildManualReportMetadata({ type: REPORT_DOCUMENT_TYPES.ANNUAL, year: '2025' }),
    {
      valid: true,
      type: REPORT_DOCUMENT_TYPES.ANNUAL,
      period: '2025',
      periodInfo: {
        key: 'FY:2025', label: '2025', year: 2025, quarter: null, kind: 'annual', isQuarter: false, isAnnual: true,
      },
      title: '',
    },
  );
  assert.equal(
    buildManualReportMetadata({ type: REPORT_DOCUMENT_TYPES.QUARTERLY, year: 2026, quarter: 2 }).period,
    'Q2 2026',
  );
  assert.equal(buildManualReportMetadata({ type: REPORT_DOCUMENT_TYPES.OTHER }).period, '');
});

test('manual report metadata requires the fields appropriate for its type', () => {
  assert.equal(buildManualReportMetadata({ type: REPORT_DOCUMENT_TYPES.ANNUAL }).code, 'ANNUAL_PERIOD_REQUIRED');
  assert.equal(buildManualReportMetadata({ type: REPORT_DOCUMENT_TYPES.QUARTERLY, year: 2026 }).code, 'QUARTER_PERIOD_REQUIRED');
  assert.equal(validateReportDocumentMetadata({ type: REPORT_DOCUMENT_TYPES.OTHER, period: '2025' }).code, 'OTHER_PERIOD_NOT_ALLOWED');
});

test('analysis document selection accepts one explicit period and rejects missing or mixed periods', () => {
  const annual = { id: 'annual', period: '2025' };
  const annualAttachment = { id: 'annual-notes', reporting_period: 'FY 2025' };
  const quarter = { id: 'quarter', reportingPeriod: 'Q4 2025' };

  assert.equal(validateAnalysisDocumentSelection([annual, annualAttachment]).valid, true);
  assert.equal(validateAnalysisDocumentSelection([{ id: 'missing', period: '' }]).code, 'DOCUMENT_PERIOD_REQUIRED');
  assert.equal(validateAnalysisDocumentSelection([{ id: 'unknown', period: 'H1 2025' }]).code, 'INVALID_DOCUMENT_PERIOD');
  assert.equal(validateAnalysisDocumentSelection([annual, quarter]).code, 'MIXED_REPORT_PERIODS');
});
