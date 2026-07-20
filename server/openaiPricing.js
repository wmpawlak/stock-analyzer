import { AppError, stringOrEmpty } from './utils.js';

export const OPENAI_PRICING_VERSION = '2026-07-18';
export const OPENAI_PRICING_SOURCE = 'https://developers.openai.com/api/docs/pricing';
export const OPENAI_LONG_CONTEXT_THRESHOLD_TOKENS = 272_000;

export const OPENAI_PRICING_TABLE = Object.freeze({
  'gpt-5.6-sol': Object.freeze({
    short: Object.freeze({ input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 30 }),
    long: Object.freeze({ input: 10, cachedInput: 1, cacheWrite: 12.5, output: 45 }),
  }),
  'gpt-5.6-terra': Object.freeze({
    short: Object.freeze({ input: 2.5, cachedInput: 0.25, cacheWrite: 3.125, output: 15 }),
    long: Object.freeze({ input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 22.5 }),
  }),
  'gpt-5.6-luna': Object.freeze({
    short: Object.freeze({ input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 6 }),
    long: Object.freeze({ input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 9 }),
  }),
});

const nonNegativeInteger = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};

const roundUsd = (value) => Number(Math.max(0, value).toFixed(8));

export const resolveOpenAIPricingModel = (model) => {
  const normalized = stringOrEmpty(model).toLowerCase();
  if (/^gpt-5\.6-terra(?:-|$)/.test(normalized)) return 'gpt-5.6-terra';
  if (/^gpt-5\.6-luna(?:-|$)/.test(normalized)) return 'gpt-5.6-luna';
  if (normalized === 'gpt-5.6' || /^gpt-5\.6-sol(?:-|$)/.test(normalized) || /^gpt-5\.6-\d/.test(normalized)) {
    return 'gpt-5.6-sol';
  }
  return '';
};

export const assertOpenAIPricingModel = (model) => {
  const pricingModel = resolveOpenAIPricingModel(model);
  if (!pricingModel) {
    throw new AppError(
      'OPENAI_PRICING_UNAVAILABLE',
      `Brak wersjonowanej tabeli cen dla modelu „${stringOrEmpty(model) || 'niepodany'}”.`,
      500,
    );
  }
  return pricingModel;
};

export const estimateOpenAIStageUsage = ({ stage, model, pricingModel, usage }) => {
  const resolvedPricingModel = resolveOpenAIPricingModel(model) || assertOpenAIPricingModel(pricingModel);
  const inputTokens = nonNegativeInteger(usage?.inputTokens);
  const cachedInputTokens = Math.min(inputTokens, nonNegativeInteger(usage?.cachedInputTokens));
  const cacheWriteTokens = Math.min(
    Math.max(0, inputTokens - cachedInputTokens),
    nonNegativeInteger(usage?.cacheWriteTokens),
  );
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens - cacheWriteTokens);
  const outputTokens = nonNegativeInteger(usage?.outputTokens);
  const totalTokens = nonNegativeInteger(usage?.totalTokens) || inputTokens + outputTokens;
  const contextTier = inputTokens > OPENAI_LONG_CONTEXT_THRESHOLD_TOKENS ? 'long' : 'short';
  const ratesUsdPerMillion = OPENAI_PRICING_TABLE[resolvedPricingModel][contextTier];
  const costUsd = roundUsd((
    (uncachedInputTokens * ratesUsdPerMillion.input)
    + (cachedInputTokens * ratesUsdPerMillion.cachedInput)
    + (cacheWriteTokens * ratesUsdPerMillion.cacheWrite)
    + (outputTokens * ratesUsdPerMillion.output)
  ) / 1_000_000);

  return {
    stage: stringOrEmpty(stage) || 'unknown',
    model: stringOrEmpty(model) || stringOrEmpty(pricingModel),
    pricingModel: resolvedPricingModel,
    contextTier,
    tokens: {
      input: inputTokens,
      uncachedInput: uncachedInputTokens,
      cachedInput: cachedInputTokens,
      cacheWrite: cacheWriteTokens,
      output: outputTokens,
      total: totalTokens,
    },
    ratesUsdPerMillion: { ...ratesUsdPerMillion },
    costUsd,
  };
};

export const summarizeOpenAIUsage = (entries, { fallbackModel } = {}) => {
  const stages = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => estimateOpenAIStageUsage({
      stage: entry.stage,
      model: entry.model,
      pricingModel: fallbackModel,
      usage: entry,
    }))
    .sort((left, right) => ['extraction', 'synthesis'].indexOf(left.stage) - ['extraction', 'synthesis'].indexOf(right.stage));

  const tokens = stages.reduce((total, item) => ({
    input: total.input + item.tokens.input,
    uncachedInput: total.uncachedInput + item.tokens.uncachedInput,
    cachedInput: total.cachedInput + item.tokens.cachedInput,
    cacheWrite: total.cacheWrite + item.tokens.cacheWrite,
    output: total.output + item.tokens.output,
    total: total.total + item.tokens.total,
  }), { input: 0, uncachedInput: 0, cachedInput: 0, cacheWrite: 0, output: 0, total: 0 });

  return {
    pricingVersion: OPENAI_PRICING_VERSION,
    pricingSource: OPENAI_PRICING_SOURCE,
    costEstimated: true,
    tokens,
    stages,
    costUsd: roundUsd(stages.reduce((total, item) => total + item.costUsd, 0)),
  };
};
