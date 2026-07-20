import { AppError, extensionOf, stringOrEmpty } from './utils.js';
import {
  analyzeDocumentsWithAdapter,
  extractMetricsWithAdapter,
  synthesizeAnalysisWithAdapter,
} from './analysisCore.js';
import { estimateOpenAIStageUsage, summarizeOpenAIUsage } from './openaiPricing.js';

export const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
export const DEFAULT_OPENAI_ANALYSIS_MODEL = 'gpt-5.6';
export const OPENAI_MAX_OUTPUT_TOKENS = 32_000;
export const OPENAI_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
export const MAX_OPENAI_ANALYSIS_INPUT_BYTES = 50 * 1024 * 1024;
export const OPENAI_PDF_DETAIL = 'high';

const RETRYABLE_HTTP_STATUSES = new Set([429]);

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const normalizeUsage = (usage) => {
  if (!usage || typeof usage !== 'object') return null;
  const inputTokens = Number(usage.input_tokens);
  const cachedInputTokens = Number(usage.input_tokens_details?.cached_tokens);
  const cacheWriteTokens = Number(
    usage.input_tokens_details?.cache_write_tokens
    ?? usage.input_tokens_details?.cache_creation_tokens,
  );
  const outputTokens = Number(usage.output_tokens);
  const totalTokens = Number(usage.total_tokens);
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    cachedInputTokens: Number.isFinite(cachedInputTokens) ? cachedInputTokens : 0,
    cacheWriteTokens: Number.isFinite(cacheWriteTokens) ? cacheWriteTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
    totalTokens: Number.isFinite(totalTokens)
      ? totalTokens
      : [inputTokens, outputTokens].filter(Number.isFinite).reduce((sum, value) => sum + value, 0),
  };
};

const attachOpenAIUsageEstimate = (error, fallbackModel) => {
  if (!Array.isArray(error?.confirmedOpenAIUsage) || !error.confirmedOpenAIUsage.length) return error;
  error.openAIUsageEstimate = summarizeOpenAIUsage(error.confirmedOpenAIUsage, { fallbackModel });
  error.costEstimated = true;
  return error;
};

const withResponseUsage = (error, payload, stage, fallbackModel) => {
  const usage = normalizeUsage(payload?.usage);
  if (!usage) return error;
  error.confirmedOpenAIUsage = [{
    stage,
    model: stringOrEmpty(payload?.model) || fallbackModel,
    ...usage,
  }];
  return attachOpenAIUsageEstimate(error, fallbackModel);
};

const outputContentItems = (payload) => (Array.isArray(payload?.output) ? payload.output : [])
  .flatMap((item) => (Array.isArray(item?.content) ? item.content : []));

const readRefusal = (payload) => {
  const direct = stringOrEmpty(payload?.refusal);
  if (direct) return direct;
  const refusal = outputContentItems(payload).find((item) => item?.type === 'refusal');
  return stringOrEmpty(refusal?.refusal) || stringOrEmpty(refusal?.text);
};

const readOutputText = (payload) => {
  const direct = stringOrEmpty(payload?.output_text);
  if (direct) return direct;
  return outputContentItems(payload)
    .filter((item) => item?.type === 'output_text')
    .map((item) => stringOrEmpty(item?.text))
    .filter(Boolean)
    .join('');
};

const transportMessage = (error) => {
  if (error?.name === 'AbortError') return 'Przekroczono 10-minutowy limit czasu odpowiedzi OpenAI.';
  const code = stringOrEmpty(error?.cause?.code);
  const message = stringOrEmpty(error?.message) || 'fetch failed';
  return code
    ? `Nie udało się połączyć z OpenAI: ${message} (${code}).`
    : `Nie udało się połączyć z OpenAI: ${message}.`;
};

const isInputTooLarge = (response, payload) => {
  if (response?.status === 413) return true;
  const code = stringOrEmpty(payload?.error?.code).toLowerCase();
  const message = stringOrEmpty(payload?.error?.message).toLowerCase();
  return ['context_length_exceeded', 'request_too_large', 'tokens_exceeded'].includes(code)
    || /input|request|file|context/.test(message) && /too large|maximum|limit|exceed/.test(message);
};

const isRetryableStatus = (status) => RETRYABLE_HTTP_STATUSES.has(status) || status >= 500;

const requestOpenAIResponse = async ({
  apiKey,
  model,
  stage,
  systemPrompt,
  prompt,
  preparedDocuments,
  schema,
  fetchImpl = fetch,
  sleepImpl = sleep,
}) => {
  const key = stringOrEmpty(apiKey);
  if (!key) {
    throw new AppError(
      'OPENAI_NOT_CONFIGURED',
      'Ustaw OPENAI_API_KEY w pliku .env.local lokalnego helpera.',
      412,
    );
  }

  const requestBody = {
    model,
    reasoning: { effort: 'high' },
    store: false,
    max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
    input: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [{ type: 'input_text', text: prompt }, ...preparedDocuments],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: stage === 'extraction' ? 'analysis_metric_extraction' : 'analysis_synthesis',
        strict: true,
        schema,
      },
    },
  };

  let response;
  let payload;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS);
    try {
      response = await fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      payload = await response.json().catch(() => null);
    } catch (error) {
      if (attempt < 2) {
        await sleepImpl(350 * (attempt + 1));
        continue;
      }
      throw new AppError('OPENAI_UNAVAILABLE', transportMessage(error), 502);
    } finally {
      clearTimeout(timeout);
    }

    if (response.ok || attempt === 2 || !isRetryableStatus(response.status)) break;
    await sleepImpl(350 * (attempt + 1));
  }

  if (!response?.ok) {
    const message = stringOrEmpty(payload?.error?.message) || `OpenAI zwrócił HTTP ${response?.status || 0}.`;
    if (isInputTooLarge(response, payload)) {
      throw withResponseUsage(new AppError('OPENAI_INPUT_TOO_LARGE', message, 413), payload, stage, model);
    }
    throw withResponseUsage(new AppError('OPENAI_ERROR', message, 502, {
      status: response?.status || 0,
      type: stringOrEmpty(payload?.error?.type),
      code: stringOrEmpty(payload?.error?.code),
    }), payload, stage, model);
  }

  if (!payload || typeof payload !== 'object') {
    throw new AppError('OPENAI_INVALID_RESPONSE', 'OpenAI zwrócił odpowiedź, która nie jest obiektem JSON.', 502);
  }
  const refusal = readRefusal(payload);
  if (refusal) {
    throw withResponseUsage(new AppError('OPENAI_INVALID_RESPONSE', `OpenAI odmówił wygenerowania wyniku: ${refusal}`, 502, {
      refusal,
    }), payload, stage, model);
  }
  if (payload.status === 'incomplete' || payload.incomplete_details) {
    throw withResponseUsage(new AppError('OPENAI_INVALID_RESPONSE', 'OpenAI zwrócił niekompletną odpowiedź.', 502, {
      incompleteDetails: payload.incomplete_details || null,
    }), payload, stage, model);
  }
  if (payload.status && payload.status !== 'completed') {
    throw withResponseUsage(
      new AppError('OPENAI_INVALID_RESPONSE', `OpenAI zakończył odpowiedź ze statusem ${payload.status}.`, 502),
      payload,
      stage,
      model,
    );
  }

  const content = readOutputText(payload);
  if (!content) {
    throw withResponseUsage(
      new AppError('OPENAI_INVALID_RESPONSE', 'OpenAI nie zwrócił treści output_text.', 502),
      payload,
      stage,
      model,
    );
  }
  const actualModel = stringOrEmpty(payload.model) || model;
  const usage = normalizeUsage(payload.usage);
  const estimatedUsage = usage ? estimateOpenAIStageUsage({
    stage,
    model: actualModel,
    pricingModel: model,
    usage,
  }) : null;
  return {
    stage,
    content,
    costUsd: estimatedUsage?.costUsd || 0,
    citations: [],
    usage: usage ? { stage, model: actualModel, ...usage } : null,
    model: actualModel,
  };
};

const documentMimeType = (document) => (
  extensionOf(document?.filename) === 'pdf'
    ? 'application/pdf'
    : stringOrEmpty(document?.mimeType) || stringOrEmpty(document?.mime_type) || 'application/octet-stream'
);

const prepareOpenAIDocuments = ({ documents, documentBuffers }) => {
  const totalBytes = documentBuffers.reduce((total, buffer) => total + (Buffer.isBuffer(buffer) ? buffer.length : 0), 0);
  if (totalBytes > MAX_OPENAI_ANALYSIS_INPUT_BYTES) {
    throw new AppError(
      'OPENAI_INPUT_TOO_LARGE',
      'Łączny rozmiar dokumentów dla OpenAI przekracza 50 MB.',
      413,
    );
  }

  return documents.map((document, index) => {
    const buffer = documentBuffers[index];
    const filename = stringOrEmpty(document?.filename) || `document-${index + 1}`;
    if (extensionOf(filename) !== 'pdf') {
      throw new AppError(
        'OPENAI_REQUIRES_PDF',
        `OpenAI obsługuje w analizie wyłącznie oryginalne pliki PDF. Dokument „${filename}” ma nieobsługiwany format.`,
        400,
      );
    }
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
      throw new AppError('OPENAI_ERROR', `Dokument „${filename}” nie zawiera danych.`, 400);
    }
    if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new AppError(
        'OPENAI_INVALID_PDF',
        `Plik „${filename}” nie ma poprawnego nagłówka PDF.`,
        400,
      );
    }

    return {
      type: 'input_file',
      filename,
      file_data: `data:${documentMimeType(document)};base64,${buffer.toString('base64')}`,
      detail: OPENAI_PDF_DETAIL,
    };
  });
};

const mapCoreError = (error) => {
  if (error?.code !== 'ANALYSIS_INVALID_RESPONSE') return error;
  const mapped = new AppError(
    'OPENAI_INVALID_RESPONSE',
    stringOrEmpty(error.message).replace(/^Provider\b/, 'OpenAI') || 'OpenAI zwrócił niepoprawną odpowiedź.',
    error.status || 502,
    error.details,
  );
  if (Array.isArray(error.confirmedOpenAIUsage)) {
    mapped.confirmedOpenAIUsage = error.confirmedOpenAIUsage;
  }
  if (error.openAIUsageEstimate) mapped.openAIUsageEstimate = error.openAIUsageEstimate;
  if (error.costEstimated) mapped.costEstimated = true;
  return mapped;
};

const appendConfirmedUsage = (error, result, fallbackModel) => {
  const target = error instanceof Error
    ? error
    : new AppError('OPENAI_INVALID_RESPONSE', 'Nie udało się przetworzyć odpowiedzi OpenAI.', 502);
  if (!result?.usage) return attachOpenAIUsageEstimate(target, fallbackModel);
  const current = Array.isArray(target.confirmedOpenAIUsage) ? target.confirmedOpenAIUsage : [];
  target.confirmedOpenAIUsage = [...current, { stage: result.stage, model: result.model, ...result.usage }];
  return attachOpenAIUsageEstimate(target, fallbackModel);
};

const combineUsage = ({ extraction, synthesis }) => {
  const stages = { extraction: extraction || null, synthesis: synthesis || null };
  const present = [extraction, synthesis].filter(Boolean);
  if (!present.length) return { ...stages, total: null };
  return {
    ...stages,
    total: present.reduce((total, usage) => ({
      inputTokens: total.inputTokens + (usage.inputTokens || 0),
      cachedInputTokens: total.cachedInputTokens + (usage.cachedInputTokens || 0),
      cacheWriteTokens: total.cacheWriteTokens + (usage.cacheWriteTokens || 0),
      outputTokens: total.outputTokens + (usage.outputTokens || 0),
      totalTokens: total.totalTokens + (usage.totalTokens || 0),
    }), { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, totalTokens: 0 }),
  };
};

const createOpenAIAdapter = ({ apiKey, model, fetchImpl, sleepImpl }) => {
  const resolvedModel = stringOrEmpty(model) || DEFAULT_OPENAI_ANALYSIS_MODEL;
  return {
    prepareDocuments: prepareOpenAIDocuments,
    requestStructured: (input) => requestOpenAIResponse({
      ...input,
      apiKey,
      model: resolvedModel,
      fetchImpl,
      sleepImpl,
    }),
    mapError: mapCoreError,
    decorateError: (error, result) => appendConfirmedUsage(error, result, resolvedModel),
    combinedModel: ({ extraction, synthesis }) => (
      extraction.model === synthesis.model
        ? `${extraction.model} (extraction + synthesis)`
        : `${extraction.model} + ${synthesis.model}`
    ),
    combineUsage,
  };
};

export const extractMetricsWithOpenAI = async ({
  apiKey,
  model,
  profile,
  documents,
  documentBuffers,
  fetchImpl,
  sleepImpl,
}) => extractMetricsWithAdapter({
  profile,
  documents,
  documentBuffers,
  adapter: createOpenAIAdapter({ apiKey, model, fetchImpl, sleepImpl }),
});

export const synthesizeAnalysisWithOpenAI = async ({
  apiKey,
  model,
  profile,
  documents,
  documentBuffers,
  reportPeriod,
  metricFacts,
  extractionWarnings,
  fetchImpl,
  sleepImpl,
}) => synthesizeAnalysisWithAdapter({
  profile,
  documents,
  documentBuffers,
  reportPeriod,
  metricFacts,
  extractionWarnings,
  adapter: createOpenAIAdapter({ apiKey, model, fetchImpl, sleepImpl }),
});

export const analyzeDocumentsWithOpenAI = async ({
  apiKey,
  model,
  profile,
  documents,
  documentBuffers,
  fetchImpl,
  sleepImpl,
}) => {
  const fallbackModel = stringOrEmpty(model) || DEFAULT_OPENAI_ANALYSIS_MODEL;
  const result = await analyzeDocumentsWithAdapter({
    profile,
    documents,
    documentBuffers,
    adapter: createOpenAIAdapter({ apiKey, model, fetchImpl, sleepImpl }),
  });
  const usageEstimate = summarizeOpenAIUsage(
    [result.usage?.extraction, result.usage?.synthesis].filter(Boolean),
    { fallbackModel },
  );
  return {
    ...result,
    provider: 'openai',
    costUsd: usageEstimate.costUsd,
    costEstimated: true,
    usageEstimate,
  };
};
