import { AppError, stringOrEmpty } from './utils.js';
import {
  ANALYSIS_V2_SCHEMA_VERSION,
  getReportMetricsForProfile,
  metricUnitMatchesValueType,
} from './analysisMetricCatalog.js';
import {
  getReportPeriodInfo,
  inferReportPeriodFromText,
  normalizeReportMetricPeriod,
  normalizeReportPeriod,
} from '../shared/reportPeriods.js';

const SOURCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['documentId', 'page', 'section', 'evidence'],
  properties: {
    documentId: { type: 'string', minLength: 1 },
    page: { type: ['integer', 'string', 'null'] },
    section: { type: 'string', minLength: 1 },
    evidence: { type: 'string', minLength: 1 },
  },
};

const NULLABLE_SOURCE_SCHEMA = {
  anyOf: [
    SOURCE_SCHEMA,
    { type: 'null' },
  ],
};

const STRUCTURED_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'stance', 'sections'],
  properties: {
    headline: { type: 'string' },
    stance: { type: 'string', enum: ['pozytywny', 'mieszany', 'ostrozny', 'negatywny'] },
    sections: {
      type: 'array',
      minItems: 3,
      maxItems: 7,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'bullets'],
        properties: {
          title: { type: 'string' },
          bullets: {
            type: 'array',
            minItems: 1,
            maxItems: 5,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 'metricKeys', 'source'],
              properties: {
                text: { type: 'string' },
                metricKeys: {
                  type: 'array',
                  maxItems: 6,
                  items: { type: 'string' },
                },
                source: NULLABLE_SOURCE_SCHEMA,
              },
            },
          },
        },
      },
    },
  },
};

const METRIC_FACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['documentId', 'metricKey', 'label', 'value', 'unit', 'period', 'page', 'section', 'quote', 'confidence'],
  properties: {
    documentId: { type: 'string', minLength: 1 },
    metricKey: { type: 'string', minLength: 1 },
    label: { type: 'string', minLength: 1 },
    value: { type: ['string', 'number', 'null'] },
    unit: { type: 'string', minLength: 1 },
    period: { type: 'string', minLength: 1 },
    page: { type: ['integer', 'string', 'null'] },
    section: { type: 'string', minLength: 1 },
    quote: { type: 'string', minLength: 1 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

const EXTRACTION_WARNING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['metricKey', 'label', 'reason', 'evidence'],
  properties: {
    metricKey: { type: 'string', minLength: 1 },
    label: { type: 'string', minLength: 1 },
    reason: { type: 'string', minLength: 1 },
    evidence: { type: 'string' },
  },
};

export const METRIC_EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['metricFacts', 'extractionWarnings'],
  properties: {
    metricFacts: {
      type: 'array',
      maxItems: 120,
      items: METRIC_FACT_SCHEMA,
    },
    extractionWarnings: {
      type: 'array',
      maxItems: 60,
      items: EXTRACTION_WARNING_SCHEMA,
    },
  },
};

const SYNTHESIS_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'source'],
  properties: {
    text: { type: 'string', minLength: 1 },
    source: SOURCE_SCHEMA,
  },
};

export const SYNTHESIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'structuredSummary', 'risks', 'conclusions'],
  properties: {
    title: { type: 'string', minLength: 1 },
    summary: { type: 'string', minLength: 1 },
    structuredSummary: STRUCTURED_SUMMARY_SCHEMA,
    risks: {
      type: 'array',
      maxItems: 30,
      items: SYNTHESIS_ITEM_SCHEMA,
    },
    conclusions: {
      type: 'array',
      maxItems: 30,
      items: SYNTHESIS_ITEM_SCHEMA,
    },
  },
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value, expectedKeys) => {
  if (!isPlainObject(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  return actualKeys.length === sortedExpected.length
    && actualKeys.every((key, index) => key === sortedExpected[index]);
};

const isNonEmptyString = (value) => typeof value === 'string' && Boolean(value.trim());

const strictJsonObject = (text, responseLabel) => {
  if (typeof text !== 'string') {
    throw new AppError('ANALYSIS_INVALID_RESPONSE', `Provider zwrócił wynik ${responseLabel}, który nie jest tekstem JSON.`, 502);
  }
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new AppError('ANALYSIS_INVALID_RESPONSE', `Provider zwrócił niepoprawny JSON ${responseLabel}.`, 502);
  }
  if (!isPlainObject(parsed)) {
    throw new AppError('ANALYSIS_INVALID_RESPONSE', `Provider zwrócił JSON ${responseLabel} o niepoprawnym kształcie.`, 502);
  }
  return parsed;
};

const sourceLabel = (source) => {
  if (!source || typeof source !== 'object') return '';
  return [
    source.section,
    source.page !== null && source.page !== undefined && source.page !== '' ? `strona ${source.page}` : '',
    source.evidence || source.quote,
  ].filter(Boolean).join(' - ');
};

const metricFactToMetric = (fact) => ({
  label: stringOrEmpty(fact?.label) || stringOrEmpty(fact?.metricKey),
  value: fact?.value ?? null,
  unit: stringOrEmpty(fact?.unit),
  period: stringOrEmpty(fact?.period),
  source: sourceLabel(fact),
});

const documentReportPeriod = (document) => (
  normalizeReportPeriod(document.period)
  || inferReportPeriodFromText([document.title, document.filename, document.type].filter(Boolean).join(' '))
);

export const metadataFromDocuments = (documents) => documents.map((document) => ({
  id: document.id,
  filename: document.filename,
  title: document.title,
  type: document.type,
  period: documentReportPeriod(document),
  publishedAt: document.publishedAt,
  sourceUrl: document.sourceUrl,
}));

export const approvedReportPeriodFromDocuments = (documents) => {
  const periods = [...new Set(documents.map((document) => normalizeReportPeriod(document.period)).filter(Boolean))];
  if (periods.length !== 1) {
    throw new AppError(
      periods.length ? 'DOCUMENT_PERIOD_MISMATCH' : 'DOCUMENT_PERIOD_REQUIRED',
      periods.length
        ? 'Dokumenty etapu ekstrakcji muszą mieć ten sam zatwierdzony okres raportowy.'
        : 'Każdy dokument etapu ekstrakcji musi mieć zatwierdzony okres raportowy.',
      400,
    );
  }
  return periods[0];
};

const extractionShapeErrors = (value) => {
  const errors = [];
  if (!hasExactKeys(value, ['metricFacts', 'extractionWarnings'])) {
    return ['root must contain only metricFacts and extractionWarnings'];
  }
  if (!Array.isArray(value.metricFacts) || value.metricFacts.length > 120) {
    errors.push('metricFacts must be an array with at most 120 items');
  }
  if (!Array.isArray(value.extractionWarnings) || value.extractionWarnings.length > 60) {
    errors.push('extractionWarnings must be an array with at most 60 items');
  }

  (Array.isArray(value.metricFacts) ? value.metricFacts : []).forEach((fact, index) => {
    const fields = ['documentId', 'metricKey', 'label', 'value', 'unit', 'period', 'page', 'section', 'quote', 'confidence'];
    if (!hasExactKeys(fact, fields)) {
      errors.push(`metricFacts[${index}] has fields incompatible with the extraction schema`);
      return;
    }
    ['documentId', 'metricKey', 'label', 'unit', 'period', 'section', 'quote'].forEach((field) => {
      if (!isNonEmptyString(fact[field])) errors.push(`metricFacts[${index}].${field} must be a non-empty string`);
    });
    if (!(fact.value === null || typeof fact.value === 'string' || (typeof fact.value === 'number' && Number.isFinite(fact.value)))) {
      errors.push(`metricFacts[${index}].value must be a string, finite number or null`);
    }
    if (!(fact.page === null || typeof fact.page === 'string' || Number.isInteger(fact.page))) {
      errors.push(`metricFacts[${index}].page must be an integer, string or null`);
    }
    if (typeof fact.confidence !== 'number' || !Number.isFinite(fact.confidence) || fact.confidence < 0 || fact.confidence > 1) {
      errors.push(`metricFacts[${index}].confidence must be a number from 0 to 1`);
    }
  });

  (Array.isArray(value.extractionWarnings) ? value.extractionWarnings : []).forEach((warning, index) => {
    const fields = ['metricKey', 'label', 'reason', 'evidence'];
    if (!hasExactKeys(warning, fields)) {
      errors.push(`extractionWarnings[${index}] has fields incompatible with the extraction schema`);
      return;
    }
    ['metricKey', 'label', 'reason'].forEach((field) => {
      if (!isNonEmptyString(warning[field])) errors.push(`extractionWarnings[${index}].${field} must be a non-empty string`);
    });
    if (typeof warning.evidence !== 'string') errors.push(`extractionWarnings[${index}].evidence must be a string`);
  });

  return errors;
};

const parseMetricExtraction = (content) => {
  const parsed = strictJsonObject(content, 'ekstrakcji metryk');
  const errors = extractionShapeErrors(parsed);
  if (errors.length) {
    throw new AppError(
      'ANALYSIS_INVALID_RESPONSE',
      'Provider zwrócił wynik ekstrakcji niezgodny ze schematem.',
      502,
      { errors: errors.slice(0, 20) },
    );
  }
  return parsed;
};

const sourceShapeErrors = (source, path, allowedDocumentIds) => {
  if (!hasExactKeys(source, ['documentId', 'page', 'section', 'evidence'])) {
    return [`${path} must contain documentId, page, section and evidence`];
  }
  const errors = [];
  if (!isNonEmptyString(source.documentId) || !allowedDocumentIds.has(source.documentId)) {
    errors.push(`${path}.documentId must reference an analyzed document`);
  }
  if (!(source.page === null || typeof source.page === 'string' || Number.isInteger(source.page))) {
    errors.push(`${path}.page must be an integer, string or null`);
  }
  if (!isNonEmptyString(source.section)) errors.push(`${path}.section must be a non-empty string`);
  if (!isNonEmptyString(source.evidence)) errors.push(`${path}.evidence must be a non-empty string`);
  return errors;
};

const synthesisShapeErrors = (value, allowedDocumentIds) => {
  if (!hasExactKeys(value, ['title', 'summary', 'structuredSummary', 'risks', 'conclusions'])) {
    return ['root must contain only title, summary, structuredSummary, risks and conclusions'];
  }
  const errors = [];
  if (!isNonEmptyString(value.title)) errors.push('title must be a non-empty string');
  if (!isNonEmptyString(value.summary)) errors.push('summary must be a non-empty string');

  const structured = value.structuredSummary;
  if (!hasExactKeys(structured, ['headline', 'stance', 'sections'])) {
    errors.push('structuredSummary has an invalid shape');
  } else {
    if (!isNonEmptyString(structured.headline)) errors.push('structuredSummary.headline must be a non-empty string');
    if (!['pozytywny', 'mieszany', 'ostrozny', 'negatywny'].includes(structured.stance)) {
      errors.push('structuredSummary.stance is invalid');
    }
    if (!Array.isArray(structured.sections) || structured.sections.length < 3 || structured.sections.length > 7) {
      errors.push('structuredSummary.sections must contain from 3 to 7 sections');
    }
    (Array.isArray(structured.sections) ? structured.sections : []).forEach((section, sectionIndex) => {
      if (!hasExactKeys(section, ['title', 'bullets'])) {
        errors.push(`structuredSummary.sections[${sectionIndex}] has an invalid shape`);
        return;
      }
      if (!isNonEmptyString(section.title)) errors.push(`structuredSummary.sections[${sectionIndex}].title must be a non-empty string`);
      if (!Array.isArray(section.bullets) || !section.bullets.length || section.bullets.length > 5) {
        errors.push(`structuredSummary.sections[${sectionIndex}].bullets must contain from 1 to 5 items`);
      }
      (Array.isArray(section.bullets) ? section.bullets : []).forEach((bullet, bulletIndex) => {
        const path = `structuredSummary.sections[${sectionIndex}].bullets[${bulletIndex}]`;
        if (!isPlainObject(bullet)) {
          errors.push(`${path} must be an object`);
          return;
        }
        const keys = Object.keys(bullet);
        if (!keys.includes('text') || keys.some((key) => !['text', 'metricKeys', 'source'].includes(key))) {
          errors.push(`${path} has fields incompatible with the synthesis schema`);
          return;
        }
        if (!isNonEmptyString(bullet.text)) errors.push(`${path}.text must be a non-empty string`);
        if (bullet.metricKeys !== undefined && (
          !Array.isArray(bullet.metricKeys)
          || bullet.metricKeys.length > 6
          || bullet.metricKeys.some((key) => !isNonEmptyString(key))
        )) errors.push(`${path}.metricKeys must contain at most 6 non-empty strings`);
        if (bullet.source !== undefined && bullet.source !== null) {
          errors.push(...sourceShapeErrors(bullet.source, `${path}.source`, allowedDocumentIds));
        }
      });
    });
  }

  ['risks', 'conclusions'].forEach((collection) => {
    if (!Array.isArray(value[collection]) || value[collection].length > 30) {
      errors.push(`${collection} must be an array with at most 30 items`);
      return;
    }
    value[collection].forEach((item, index) => {
      const path = `${collection}[${index}]`;
      if (!hasExactKeys(item, ['text', 'source'])) {
        errors.push(`${path} has an invalid shape`);
        return;
      }
      if (!isNonEmptyString(item.text)) errors.push(`${path}.text must be a non-empty string`);
      errors.push(...sourceShapeErrors(item.source, `${path}.source`, allowedDocumentIds));
    });
  });
  return errors;
};

const parseSynthesis = (content, allowedDocumentIds) => {
  const parsed = strictJsonObject(content, 'syntezy');
  const errors = synthesisShapeErrors(parsed, allowedDocumentIds);
  if (errors.length) {
    throw new AppError(
      'ANALYSIS_INVALID_RESPONSE',
      'Provider zwrócił wynik syntezy niezgodny ze schematem.',
      502,
      { errors: errors.slice(0, 20) },
    );
  }
  return parsed;
};

const normaliseSummaryBullet = (bullet) => {
  if (typeof bullet === 'string') return { text: bullet };
  if (!isPlainObject(bullet)) return null;
  const text = stringOrEmpty(bullet.text);
  if (!text) return null;
  const result = { text };
  const metricKeys = Array.isArray(bullet.metricKeys)
    ? bullet.metricKeys.map(stringOrEmpty).filter(Boolean).slice(0, 6)
    : [];
  if (metricKeys.length) result.metricKeys = metricKeys;
  if (isPlainObject(bullet.source)) result.source = bullet.source;
  return result;
};

const normaliseStructuredSummary = (value, fallbackSummary) => {
  if (isPlainObject(value)) {
    const sections = Array.isArray(value.sections)
      ? value.sections.map((section) => {
        if (!isPlainObject(section)) return null;
        const title = stringOrEmpty(section.title);
        const bullets = Array.isArray(section.bullets)
          ? section.bullets.map(normaliseSummaryBullet).filter(Boolean).slice(0, 5)
          : [];
        return title && bullets.length ? { title, bullets } : null;
      }).filter(Boolean).slice(0, 7)
      : [];
    if (stringOrEmpty(value.headline) && sections.length) {
      const stance = ['pozytywny', 'mieszany', 'ostrozny', 'negatywny'].includes(value.stance) ? value.stance : 'mieszany';
      return { headline: stringOrEmpty(value.headline), stance, sections };
    }
  }

  const text = stringOrEmpty(fallbackSummary);
  if (!text) return null;
  return {
    headline: text.length > 180 ? `${text.slice(0, 177).trim()}...` : text,
    stance: 'mieszany',
    sections: [{
      title: 'Podsumowanie',
      bullets: [{ text }],
    }],
  };
};

const numericMetricValue = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
};

const warningKey = (warning) => [
  stringOrEmpty(warning?.metricKey).toLowerCase(),
  stringOrEmpty(warning?.reason).toLowerCase(),
  stringOrEmpty(warning?.evidence).toLowerCase(),
].join('\u0000');

const deduplicateWarnings = (warnings) => {
  const seen = new Set();
  return warnings.filter((warning) => {
    if (!isPlainObject(warning)) return false;
    const normalized = {
      metricKey: stringOrEmpty(warning.metricKey),
      label: stringOrEmpty(warning.label) || stringOrEmpty(warning.metricKey),
      reason: stringOrEmpty(warning.reason),
      evidence: stringOrEmpty(warning.evidence),
    };
    if (!normalized.metricKey || !normalized.reason) return false;
    const key = warningKey(normalized);
    if (seen.has(key)) return false;
    seen.add(key);
    Object.assign(warning, normalized);
    return true;
  });
};

const metricFactScore = (fact) => (
  Number(fact.confidence || 0) * 100
  + (fact.page !== null && fact.page !== undefined && fact.page !== '' ? 2 : 0)
  + (stringOrEmpty(fact.section) ? 1 : 0)
  + Math.min(stringOrEmpty(fact.quote).length, 200) / 1000
);

export const normalizeMetricFacts = ({
  facts,
  reportPeriod,
  catalog,
  allowedDocumentIds,
  modelWarnings = [],
  requireDocumentId = false,
  requireExactPeriod = false,
  requireValue = false,
  addMissingPrimaryWarnings = false,
  warnOnUnknownMetric = false,
}) => {
  const specs = new Map(catalog.map((spec) => [spec.metricKey, spec]));
  const selected = new Map();
  const modelWarningList = deduplicateWarnings(modelWarnings.map((warning) => ({ ...warning })));
  const warnings = [];
  const documentIdSet = allowedDocumentIds instanceof Set
    ? allowedDocumentIds
    : Array.isArray(allowedDocumentIds) ? new Set(allowedDocumentIds) : null;

  for (const fact of facts) {
    if (!isPlainObject(fact)) continue;
    const factPeriod = normalizeReportMetricPeriod(fact.period, reportPeriod);
    const spec = specs.get(stringOrEmpty(fact.metricKey));
    if (!spec) {
      if (warnOnUnknownMetric) {
        warnings.push({
          metricKey: stringOrEmpty(fact.metricKey) || 'unknown',
          label: stringOrEmpty(fact.label) || stringOrEmpty(fact.metricKey) || 'Nieznana metryka',
          reason: 'Odrzucono metrykę spoza zatwierdzonego katalogu.',
          evidence: stringOrEmpty(fact.quote),
        });
      }
      continue;
    }
    if (reportPeriod && ((requireExactPeriod && factPeriod !== reportPeriod) || (factPeriod && factPeriod !== reportPeriod))) {
      warnings.push({
        metricKey: spec.metricKey,
        label: spec.label,
        reason: `Odrzucono wartość spoza okresu raportowego ${reportPeriod}.`,
        evidence: stringOrEmpty(fact.quote),
      });
      continue;
    }
    const documentId = stringOrEmpty(fact.documentId);
    if (requireDocumentId && (!documentId || !documentIdSet?.has(documentId))) {
      warnings.push({
        metricKey: spec.metricKey,
        label: spec.label,
        reason: 'Odrzucono wartość wskazującą dokument spoza analizowanego zestawu.',
        evidence: stringOrEmpty(fact.quote),
      });
      continue;
    }
    if (requireValue && (
      fact.value === null
      || fact.value === undefined
      || (typeof fact.value === 'string' && !fact.value.trim())
    )) {
      warnings.push({
        metricKey: spec.metricKey,
        label: spec.label,
        reason: 'Odrzucono metricFact bez odnalezionej wartości.',
        evidence: stringOrEmpty(fact.quote),
      });
      continue;
    }
    const number = numericMetricValue(fact.value);
    const evidence = stringOrEmpty(fact.quote);
    const incompatibleUnit = fact.value !== null && fact.value !== undefined
      && !metricUnitMatchesValueType(fact.unit, spec.valueType);
    const suspiciousInteger = spec.valueType === 'money'
      && number !== null
      && Number.isInteger(number)
      && !Number.isSafeInteger(number);

    if (incompatibleUnit || suspiciousInteger) {
      warnings.push({
        metricKey: spec.metricKey,
        label: spec.label,
        reason: incompatibleUnit
          ? `Odrzucono wartość z jednostką niezgodną z typem metryki ${spec.valueType}.`
          : 'Odrzucono liczbę przekraczającą bezpieczny zakres; prawdopodobnie sklejono wartości z kilku kolumn tabeli.',
        evidence,
      });
      continue;
    }

    const normalizedFact = {
      ...fact,
      value: number ?? fact.value,
      period: reportPeriod || stringOrEmpty(fact.period),
    };
    const current = selected.get(spec.metricKey);
    if (!current || metricFactScore(normalizedFact) > metricFactScore(current)) {
      if (current) {
        warnings.push({
          metricKey: spec.metricKey,
          label: spec.label,
          reason: 'Odrzucono zduplikowaną wartość metryki dla tego samego okresu.',
          evidence: stringOrEmpty(current.quote),
        });
      }
      selected.set(spec.metricKey, normalizedFact);
    } else {
      warnings.push({
        metricKey: spec.metricKey,
        label: spec.label,
        reason: 'Odrzucono zduplikowaną wartość metryki dla tego samego okresu.',
        evidence,
      });
    }
  }

  if (addMissingPrimaryWarnings) {
    catalog.filter((spec) => spec.tier === 'primary' && !selected.has(spec.metricKey)).forEach((spec) => {
      if ([...warnings, ...modelWarningList].some((warning) => stringOrEmpty(warning.metricKey) === spec.metricKey)) return;
      warnings.push({
        metricKey: spec.metricKey,
        label: spec.label,
        reason: `Nie znaleziono wiarygodnej wartości metryki primary dla okresu ${reportPeriod}.`,
        evidence: '',
      });
    });
  }

  return {
    metricFacts: [...selected.values()].slice(0, 120),
    warnings: deduplicateWarnings([...warnings, ...modelWarningList]).slice(0, 60),
  };
};

const metricCatalogForPrompt = (profile) => getReportMetricsForProfile(profile).map((spec) => ({
  metricKey: spec.metricKey,
  label: spec.label,
  shortName: spec.shortName,
  namePl: spec.namePl,
  nameEn: spec.nameEn,
  category: spec.category,
  tier: spec.tier,
  valueType: spec.valueType,
  aggregation: spec.aggregation,
  description: spec.description,
  aliases: spec.aliases,
  keywords: spec.keywords,
}));

const quarterlyAnalysisPeriodRules = `
Reguły okresu dla raportu kwartalnego:
- Czytaj wartości tylko z kolumny okresu głównego raportu. Przykład: w raporcie Q1 2025 zwracaj metricFacts tylko dla Q1 2025, a kolumnę Q1 2024 pomiń jako metricFacts.
- Dla każdej metryki zwróć najwyżej jeden metricFact dla okresu raportu. Jeżeli ta sama tabela pokazuje Q1 2025 oraz Q1 2024, wybierz wyłącznie Q1 2025, gdy raport dotyczy Q1 2025.
- Normalizuj okresy kwartalne do formatu Q1 YYYY, Q2 YYYY, Q3 YYYY albo Q4 YYYY. Równoważniki okresów to: Q1 = 31.03.YYYY lub 01.01.YYYY-31.03.YYYY; Q2 = 30.06.YYYY lub 01.04.YYYY-30.06.YYYY; Q3 = 30.09.YYYY lub 01.07.YYYY-30.09.YYYY; Q4 = 31.12.YYYY lub 01.10.YYYY-31.12.YYYY.
- Zakresów narastających 01.01.YYYY-30.06.YYYY i 01.01.YYYY-30.09.YYYY nie traktuj jako czystych Q2 ani Q3 i nie używaj ich jako metricFacts dla raportu kwartalnego.
- Jeżeli tabela pokazuje datę bilansową będącą końcem kwartału, w polu period wpisz kwartał, np. Q1 2026 zamiast 31.03.2026.
- Nie twórz metricFacts dla okresów porównawczych, nawet jeżeli wartości są bezpośrednio widoczne w dokumencie.
`;

const annualMetricExtractionPeriodRules = (year) => `
Reguły okresu dla raportu rocznego ${year}:
- Ekstrahuj wyłącznie wartości pełnego roku ${year}; w period każdego metricFact wpisz dokładnie ${year}.
- Dla metryk z aggregation sum wybieraj wartość obejmującą 01.01.${year}-31.12.${year}, nigdy samo Q4.
- Dla metryk z aggregation point_in_time wybieraj stan na 31.12.${year}; w period nadal wpisz ${year}.
- Dla metryk z aggregation derived używaj wyłącznie danych wejściowych dotyczących pełnego roku ${year}.
- Kolumny za ${year - 1} i inne okresy porównawcze pomiń w metricFacts.
- Nie sumuj kwartałów i nie twórz syntetycznej wartości rocznej z Q1-Q4.
- Dla każdego metricKey zwróć najwyżej jeden metricFact za ${year}.
`;

const metricExtractionPeriodRules = (reportPeriod) => {
  const periodInfo = getReportPeriodInfo(reportPeriod);
  return periodInfo.isAnnual ? annualMetricExtractionPeriodRules(periodInfo.year) : quarterlyAnalysisPeriodRules;
};

export const buildMetricExtractionPrompt = ({ profile, metadata, reportPeriod }) => {
  const catalog = metricCatalogForPrompt(profile);
  return `Wykonaj wyłącznie ekstrakcję metryk i ostrzeżeń z zatwierdzonych dokumentów. Odpowiedź musi być po polsku i wyłącznie jako JSON zgodny ze schematem ekstrakcji.

Twarde reguły:
- Nie zgaduj. Brak pewnego źródła oznacza brak metricFact.
- Katalog poniżej jest jedyną listą dozwolonych metricKey. Przejdź kolejno przez każdy wpis i dla każdego wykonaj osobną próbę odnalezienia metryki.
- Używaj łącznie pól shortName, namePl, nameEn, aliases, keywords, description, valueType i aggregation. Nie wymagaj dosłownego wystąpienia metricKey w dokumencie.
- Metryki z tier primary są obowiązkową checklistą. Dla każdej metryki primary bez wiarygodnej wartości dodaj dokładnie jeden extractionWarning.
- Metryk z tier secondary również aktywnie szukaj i zwracaj, gdy są dobrze uźródłowione. Nie dodawaj warningu wyłącznie z powodu braku metryki secondary.
- Nie zbieraj dowolnych liczb ani KPI spoza katalogu.
- Każdy metricFact musi wskazywać documentId jednego z dokumentów wejściowych oraz zawierać metricKey, label, value, unit, period, page, section, quote i confidence.
- quote ma być krótkim dowodem z dokumentu. Jeśli numer strony jest niedostępny, ustaw page na null, ale nadal wypełnij section i quote.
- value ma być samą liczbą albo null; pełna jednostka wraz z walutą i skalą trafia tylko do unit.
- Przy tekstach wyciągniętych lokalnie z PDF/OCR nie wymagaj idealnego tekstu tabeli. Artefakty OCR, dodatkowe spacje i rozdzielone litery nie są same w sobie powodem do pominięcia metryki, jeżeli kontekst jednoznacznie wiąże wartość z okresem.
- Nigdy nie sklejaj cyfr z sąsiednich kolumn. Gdy w wierszu występuje kilka wartości, dopasuj każdą komórkę do jej nagłówka i wybierz wyłącznie komórkę okresu głównego raportu.
- Zachowuj strukturę tekstu wyodrębnionego lokalnie: podziały linii odzwierciedlają wiersze PDF, a komórki w jednej linii należą do tego samego wiersza tabeli.
- Dla kwot pieniężnych użyj dokładnie waluty i skali widocznej w raporcie, np. tys. PLN, mln EUR, USD albo EUR/akcję. Nie przeliczaj walut i nie preferuj PLN.
- Jednostka zadeklarowana w tytule, nagłówku, podpisie albo nawiasie obejmującym całą tabelę lub sekcję obowiązuje dla wszystkich jej wierszy. Nie wymagaj powtórzenia jednostki bezpośrednio przy każdej liczbie.
- Traktuj zapis „w tysiącach złotych”, także rozstrzelony przez PDF/OCR jako „w t y s i ą c a c h z ł o t y c h”, jako wystarczający dowód jednostki tys. PLN. Analogicznie „w milionach złotych” oznacza mln PLN.
- Dla metryki money_per_share połącz walutę z nagłówka lub zapisu „(w zł)” z informacją „na jedną akcję” w nazwie wiersza i zwróć np. PLN/akcję.
- Dodaj warning no_unit dopiero wtedy, gdy waluty lub skali nie ma ani w wierszu, ani w obowiązującym nagłówku, podpisie lub kontekście tabeli. Nie odrzucaj wartości tylko dlatego, że jednostka występuje raz nad tabelą.
- metricKey cost_of_risk oznacza wyłącznie wskaźnik CoR wyrażony w % albo bps. Nie przypisuj do niego kwot odpisów, oczekiwanych strat kredytowych ani kosztów ryzyka prawnego.
- Nie wykonuj syntezy analitycznej ani oceny inwestycyjnej.

Backend ustalił zatwierdzony okres raportowy: ${reportPeriod}.
${metricExtractionPeriodRules(reportPeriod)}

Aktywo:
${JSON.stringify({ assetId: profile.assetId, type: profile.type, name: profile.name, canonicalId: profile.canonicalId })}

Dokumenty wejściowe i dozwolone documentId:
${JSON.stringify(metadata)}

Katalog metryk do ekstrakcji:
${JSON.stringify(catalog, null, 2)}`;
};

export const buildSynthesisPrompt = ({ profile, metadata, reportPeriod, metricFacts, extractionWarnings }) => `Wykonaj syntezę analizy zatwierdzonych dokumentów. Odpowiedź musi być po polsku i wyłącznie jako JSON zgodny ze schematem syntezy.

Twarde reguły:
- Zwróć wyłącznie title, summary, structuredSummary, risks i conclusions.
- Przekazane metricFacts oraz extractionWarnings są zatwierdzonym, niezmiennym wynikiem backendu. Nie poprawiaj ich, nie uzupełniaj, nie usuwaj, nie przeliczaj i nie generuj ich ponownie.
- Nie szukaj ponownie metryk katalogowych. Gdy opisujesz liczbę katalogową, korzystaj wyłącznie z przekazanych metricFacts.
- Oryginalne dokumenty służą do opisania ryzyk, zdarzeń jednorazowych, kontekstu biznesowego, danych porównawczych i wniosków, które nie są metrykami katalogowymi.
- Dane porównawcze z dokumentów mogą służyć do opisu zmian rok do roku, ale nie mogą zastępować ani zmieniać przekazanych metricFacts dla okresu ${reportPeriod}.
- Każde risk i conclusion musi mieć source z documentId należącym do dokumentów wejściowych oraz page, section i evidence.
- source.evidence ma być krótkim dowodem z dokumentu, a nie parafrazą bez zakotwiczenia. Jeśli numer strony nie jest dostępny, ustaw page na null.
- Pisz jak analityk dla człowieka: przystępnie, konkretnie i bez suchego wyliczania liczb.
- structuredSummary.headline ma zawierać jedną najważniejszą tezę z raportu.
- structuredSummary.stance ustaw jako syntetyczną ocenę tonu raportu bez rekomendacji inwestycyjnej: pozytywny, mieszany, ostrozny albo negatywny.
- structuredSummary.sections ma zawierać od 3 do 7 użytecznych sekcji. Preferuj: Najważniejsze fakty, Zmiana vs rok temu, Jakość wyniku, Ryzyka i kapitał, Co sprawdzić dalej; dla profilu niebankowego dopasuj nazwy do raportu.
- W bullets wyjaśniaj znaczenie danych: co jest korzystne lub niekorzystne, co się poprawiło lub pogorszyło, co wygląda na jednorazowe lub powtarzalne, jakie ryzyka zniekształcają obraz i co sprawdzić dalej.
- Każdy bullet musi zawierać text, metricKeys i source. Gdy bullet opiera się na przekazanej metryce, dodaj wyłącznie jej metricKey w metricKeys; w przeciwnym razie ustaw metricKeys na []. Nie wymyślaj nowych metricKey. Ustaw source na cytat z dokumentu albo null, gdy bullet nie wymaga cytatu.
- Nie zwracaj rekomendacji kupna ani sprzedaży.

Aktywo:
${JSON.stringify({ assetId: profile.assetId, type: profile.type, name: profile.name, canonicalId: profile.canonicalId })}

Zatwierdzony okres raportowy:
${reportPeriod}

Dokumenty wejściowe i dozwolone documentId:
${JSON.stringify(metadata)}

Niezmienne metricFacts z etapu ekstrakcji:
${JSON.stringify(metricFacts, null, 2)}

Niezmienne extractionWarnings z etapu ekstrakcji:
${JSON.stringify(extractionWarnings, null, 2)}`;

const defaultMapError = (error) => error;

const mapAdapterError = (adapter, error) => (adapter.mapError || defaultMapError)(error);

const decorateAdapterError = (adapter, error, result) => (
  adapter.decorateError ? adapter.decorateError(error, result) : error
);

const mergeCitations = (...collections) => {
  const seen = new Set();
  return collections.flat().filter((citation) => {
    const url = stringOrEmpty(citation?.url);
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  }).slice(0, 30);
};

const ensureDocumentsInput = (documents, documentBuffers, message) => {
  if (!Array.isArray(documents) || !documents.length || !Array.isArray(documentBuffers) || documentBuffers.length !== documents.length) {
    throw new AppError('NO_DOCUMENTS_SELECTED', message, 400);
  }
};

export const extractMetricsWithAdapter = async ({ profile, documents, documentBuffers, adapter }) => {
  ensureDocumentsInput(documents, documentBuffers, 'Wybierz dokumenty do ekstrakcji metryk.');
  const reportPeriod = approvedReportPeriodFromDocuments(documents);
  const metadata = metadataFromDocuments(documents).map((document) => ({ ...document, period: reportPeriod }));
  const preparedDocuments = adapter.prepareDocuments({ documents, documentBuffers, stage: 'extraction' });
  const prompt = buildMetricExtractionPrompt({ profile, metadata, reportPeriod });
  const result = await adapter.requestStructured({
    stage: 'extraction',
    systemPrompt: 'Jesteś ostrożnym ekstraktorem danych z raportów spółek, banków i ETF-ów. Zwracasz wyłącznie JSON zgodny ze schematem ekstrakcji.',
    prompt,
    preparedDocuments,
    schema: METRIC_EXTRACTION_SCHEMA,
  });
  try {
    const parsed = parseMetricExtraction(result.content);
    const normalized = normalizeMetricFacts({
      facts: parsed.metricFacts,
      reportPeriod,
      catalog: getReportMetricsForProfile(profile),
      allowedDocumentIds: new Set(documents.map((document) => stringOrEmpty(document.id))),
      modelWarnings: parsed.extractionWarnings,
      requireDocumentId: true,
      requireExactPeriod: true,
      requireValue: true,
      addMissingPrimaryWarnings: true,
      warnOnUnknownMetric: true,
    });

    return {
      reportPeriod,
      metricFacts: normalized.metricFacts,
      extractionWarnings: normalized.warnings,
      costUsd: result.costUsd || 0,
      citations: result.citations || [],
      model: result.model,
      usage: result.usage || null,
      stage: result.stage || 'extraction',
    };
  } catch (error) {
    throw mapAdapterError(adapter, decorateAdapterError(adapter, error, result));
  }
};

export const synthesizeAnalysisWithAdapter = async ({
  profile,
  documents,
  documentBuffers,
  reportPeriod,
  metricFacts,
  extractionWarnings,
  adapter,
}) => {
  ensureDocumentsInput(documents, documentBuffers, 'Wybierz dokumenty do syntezy analizy.');
  const metadata = metadataFromDocuments(documents).map((document) => ({ ...document, period: reportPeriod }));
  const preparedDocuments = adapter.prepareDocuments({ documents, documentBuffers, stage: 'synthesis' });
  const prompt = buildSynthesisPrompt({ profile, metadata, reportPeriod, metricFacts, extractionWarnings });
  const result = await adapter.requestStructured({
    stage: 'synthesis',
    systemPrompt: 'Jesteś ostrożnym analitykiem raportów spółek, banków i ETF-ów. Tworzysz wyłącznie syntezę na podstawie niezmiennych faktów backendu i cytowanych dokumentów. Zwracasz tylko JSON zgodny ze schematem syntezy.',
    prompt,
    preparedDocuments,
    schema: SYNTHESIS_SCHEMA,
  });
  try {
    const parsed = parseSynthesis(
      result.content,
      new Set(documents.map((document) => stringOrEmpty(document.id))),
    );
    return {
      ...parsed,
      costUsd: result.costUsd || 0,
      citations: result.citations || [],
      model: result.model,
      usage: result.usage || null,
      stage: result.stage || 'synthesis',
    };
  } catch (error) {
    throw mapAdapterError(adapter, decorateAdapterError(adapter, error, result));
  }
};

export const analyzeDocumentsWithAdapter = async ({ profile, documents, documentBuffers, adapter }) => {
  ensureDocumentsInput(documents, documentBuffers, 'Wybierz dokumenty do analizy.');
  const extraction = await extractMetricsWithAdapter({
    profile,
    documents,
    documentBuffers,
    adapter,
  });
  let synthesis;
  try {
    synthesis = await synthesizeAnalysisWithAdapter({
      profile,
      documents,
      documentBuffers,
      reportPeriod: extraction.reportPeriod,
      metricFacts: extraction.metricFacts,
      extractionWarnings: extraction.extractionWarnings,
      adapter,
    });
  } catch (error) {
    throw mapAdapterError(adapter, decorateAdapterError(adapter, error, extraction));
  }
  const allowedMetricKeys = new Set(extraction.metricFacts.map((fact) => stringOrEmpty(fact.metricKey)));
  const structuredSummary = normaliseStructuredSummary(synthesis.structuredSummary, synthesis.summary);
  structuredSummary.sections.forEach((section) => {
    section.bullets.forEach((bullet) => {
      if (Array.isArray(bullet.metricKeys)) {
        bullet.metricKeys = bullet.metricKeys.filter((metricKey) => allowedMetricKeys.has(metricKey));
      }
    });
  });
  const usage = adapter.combineUsage ? adapter.combineUsage({
    extraction: extraction.usage,
    synthesis: synthesis.usage,
  }) : undefined;
  const model = adapter.combinedModel
    ? adapter.combinedModel({ extraction, synthesis })
    : `${extraction.model || ''} + ${synthesis.model || ''}`.trim();
  return {
    content: {
      schemaVersion: ANALYSIS_V2_SCHEMA_VERSION,
      title: synthesis.title,
      reportPeriod: extraction.reportPeriod,
      summary: synthesis.summary,
      structuredSummary,
      metricFacts: extraction.metricFacts,
      risks: synthesis.risks,
      conclusions: synthesis.conclusions,
      extractionWarnings: extraction.extractionWarnings,
      metrics: extraction.metricFacts.map(metricFactToMetric),
      citations: mergeCitations(extraction.citations, synthesis.citations),
    },
    costUsd: Number(((extraction.costUsd || 0) + (synthesis.costUsd || 0)).toFixed(8)),
    model,
    ...(usage !== undefined ? { usage } : {}),
  };
};
