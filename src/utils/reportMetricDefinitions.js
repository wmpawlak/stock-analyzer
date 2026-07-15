import {
  REPORT_METRIC_CATALOG,
  findReportMetricSpec,
} from '../../server/analysisMetricCatalog.js';

const metricDefinitionsByKey = new Map(
  REPORT_METRIC_CATALOG.map((metric) => [metric.metricKey, metric]),
);

export const getReportMetricDefinition = (value) => {
  const spec = metricDefinitionsByKey.get(value) || findReportMetricSpec(value);
  if (!spec) return null;
  return {
    metricKey: spec.metricKey,
    label: spec.label,
    description: spec.description || '',
  };
};
