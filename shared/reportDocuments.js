import { getReportPeriodInfo, normalizeReportPeriod } from './reportPeriods.js';

export const REPORT_DOCUMENT_TYPES = Object.freeze({
  ANNUAL: 'annual_report',
  QUARTERLY: 'quarterly_report',
  OTHER: 'other',
});

const REPORT_DOCUMENT_TYPE_LABELS = Object.freeze({
  [REPORT_DOCUMENT_TYPES.ANNUAL]: 'Raport roczny',
  [REPORT_DOCUMENT_TYPES.QUARTERLY]: 'Raport kwartalny',
  [REPORT_DOCUMENT_TYPES.OTHER]: 'Inny dokument',
});

const VALID_REPORT_DOCUMENT_TYPES = new Set(Object.values(REPORT_DOCUMENT_TYPES));

const validYear = (value) => {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1900 && year <= 2099 ? year : null;
};

export const getReportDocumentTypeLabel = (type) => REPORT_DOCUMENT_TYPE_LABELS[type] || type || 'Dokument';

export const validateReportDocumentMetadata = ({ type, period } = {}) => {
  if (!VALID_REPORT_DOCUMENT_TYPES.has(type)) {
    return { valid: false, code: 'INVALID_DOCUMENT_TYPE', message: 'Wybierz obsługiwany typ dokumentu.' };
  }

  const normalizedPeriod = normalizeReportPeriod(period, { preserveUnknown: false });
  const periodInfo = normalizedPeriod ? getReportPeriodInfo(normalizedPeriod) : null;

  if (type === REPORT_DOCUMENT_TYPES.ANNUAL && !periodInfo?.isAnnual) {
    return { valid: false, code: 'ANNUAL_PERIOD_REQUIRED', message: 'Raport roczny wymaga roku w formacie YYYY.' };
  }
  if (type === REPORT_DOCUMENT_TYPES.QUARTERLY && !periodInfo?.isQuarter) {
    return { valid: false, code: 'QUARTER_PERIOD_REQUIRED', message: 'Raport kwartalny wymaga roku i kwartału Q1-Q4.' };
  }
  if (type === REPORT_DOCUMENT_TYPES.OTHER && String(period || '').trim()) {
    return { valid: false, code: 'OTHER_PERIOD_NOT_ALLOWED', message: 'Dla innego dokumentu nie podawaj okresu raportowego.' };
  }

  return {
    valid: true,
    type,
    period: periodInfo?.label || '',
    periodInfo,
  };
};

export const buildManualReportMetadata = ({ title = '', type, year, quarter } = {}) => {
  const normalizedYear = validYear(year);
  let period = '';

  if (type === REPORT_DOCUMENT_TYPES.ANNUAL && normalizedYear) period = String(normalizedYear);
  if (type === REPORT_DOCUMENT_TYPES.QUARTERLY && normalizedYear && /^[1-4]$/.test(String(quarter))) {
    period = `Q${quarter} ${normalizedYear}`;
  }

  const validation = validateReportDocumentMetadata({ type, period });
  return validation.valid
    ? { ...validation, title: String(title || '').trim() }
    : validation;
};

const documentPeriod = (document) => (
  document?.period ?? document?.reportingPeriod ?? document?.reporting_period ?? ''
);

export const getDocumentReportPeriodInfo = (document) => {
  const period = normalizeReportPeriod(documentPeriod(document), { preserveUnknown: false });
  if (!period) return null;
  const info = getReportPeriodInfo(period);
  return info.isAnnual || info.isQuarter ? info : null;
};

export const validateAnalysisDocumentSelection = (documents = []) => {
  if (!documents.length) {
    return {
      valid: false,
      code: 'NO_ANALYZABLE_DOCUMENTS',
      message: 'Zaznacz co najmniej jeden zarchiwizowany dokument.',
      periodInfo: null,
    };
  }

  const missingPeriod = documents.find((document) => !String(documentPeriod(document)).trim());
  if (missingPeriod) {
    return {
      valid: false,
      code: 'DOCUMENT_PERIOD_REQUIRED',
      message: 'Każdy dokument użyty w analizie musi mieć jawnie podany okres raportowy.',
      periodInfo: null,
    };
  }

  const periodInfos = documents.map(getDocumentReportPeriodInfo);
  if (periodInfos.some((info) => !info)) {
    return {
      valid: false,
      code: 'INVALID_DOCUMENT_PERIOD',
      message: 'Okres dokumentu musi mieć format YYYY albo Q1-Q4 YYYY.',
      periodInfo: null,
    };
  }

  const [periodInfo] = periodInfos;
  if (periodInfos.some((info) => info.key !== periodInfo.key)) {
    return {
      valid: false,
      code: 'MIXED_REPORT_PERIODS',
      message: 'Jedna analiza może obejmować wyłącznie dokumenty z tego samego okresu raportowego.',
      periodInfo: null,
    };
  }

  return { valid: true, code: '', message: '', periodInfo };
};
