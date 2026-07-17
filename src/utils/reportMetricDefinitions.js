import {
  PRIORITY_BANK_REPORT_METRICS,
  REPORT_METRIC_CATALOG,
  findReportMetricSpec,
} from '../../server/analysisMetricCatalog.js';
import { normalizeReportPeriod } from '../../shared/reportPeriods.js';

const metricDefinitionsByKey = new Map(
  REPORT_METRIC_CATALOG.map((metric) => [metric.metricKey, metric]),
);
const metricOrderByKey = new Map(
  REPORT_METRIC_CATALOG.map((metric, index) => [metric.metricKey, index]),
);

export const getReportMetricDefinition = (value) => {
  const spec = metricDefinitionsByKey.get(value) || findReportMetricSpec(value);
  if (!spec) return null;
  return {
    metricKey: spec.metricKey,
    label: spec.label,
    description: spec.description || '',
    aggregation: spec.aggregation || '',
    category: spec.category || '',
    tier: spec.tier || 'secondary',
    catalogIndex: metricOrderByKey.get(spec.metricKey) ?? Number.POSITIVE_INFINITY,
  };
};

export const getPriorityBankReportMetricDefinitions = () => PRIORITY_BANK_REPORT_METRICS.map((spec, index) => ({
  metricKey: spec.metricKey,
  label: spec.label,
  description: spec.description || '',
  aggregation: spec.aggregation || '',
  tier: spec.tier || 'primary',
  catalogIndex: metricOrderByKey.get(spec.metricKey) ?? index,
  priorityIndex: index,
}));

export const filterReportMetricFactsForPeriod = (metrics, reportPeriod) => {
  const facts = Array.isArray(metrics) ? metrics.filter(Boolean) : [];
  const normalizedReportPeriod = normalizeReportPeriod(reportPeriod);
  if (!normalizedReportPeriod) return facts;

  return facts
    .filter((fact) => {
      const factPeriod = normalizeReportPeriod(fact?.period);
      return !factPeriod || factPeriod === normalizedReportPeriod;
    })
    .map((fact) => ({ ...fact, period: normalizedReportPeriod }));
};

export const sortReportMetricFacts = (metrics) => [...(Array.isArray(metrics) ? metrics : [])]
  .sort((left, right) => {
    const leftDefinition = getReportMetricDefinition(left?.metricKey) || getReportMetricDefinition(left?.label);
    const rightDefinition = getReportMetricDefinition(right?.metricKey) || getReportMetricDefinition(right?.label);
    const leftTier = leftDefinition?.tier === 'primary' ? 0 : 1;
    const rightTier = rightDefinition?.tier === 'primary' ? 0 : 1;
    if (leftTier !== rightTier) return leftTier - rightTier;
    if (leftDefinition?.catalogIndex !== rightDefinition?.catalogIndex) {
      return (leftDefinition?.catalogIndex ?? Number.POSITIVE_INFINITY)
        - (rightDefinition?.catalogIndex ?? Number.POSITIVE_INFINITY);
    }
    return String(left?.label || left?.metricKey || '').localeCompare(
      String(right?.label || right?.metricKey || ''),
      'pl',
    );
  });

const formatReportMetricNumber = (value) => new Intl.NumberFormat('pl-PL', {
  maximumFractionDigits: 2,
}).format(value);

export const formatReportMetricValue = (metric, emptyValue = '—') => {
  const value = metric?.value ?? metric?.displayValue ?? metric?.text;
  const unit = String(metric?.unit || metric?.currency || '').trim();
  if (value === null || value === undefined || value === '') return emptyValue;
  const displayValue = typeof value === 'number' ? formatReportMetricNumber(value) : String(value);
  return [displayValue, unit].filter(Boolean).join(' ');
};
