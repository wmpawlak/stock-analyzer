import { AppError, extensionOf, stringOrEmpty } from './utils.js';

const PERPLEXITY_ENDPOINT = 'https://api.perplexity.ai/chat/completions';
const FILE_ATTACHMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'txt', 'rtf']);
const INLINE_TEXT_EXTENSIONS = new Set(['txt', 'rtf', 'html', 'htm', 'csv']);
const MAX_INLINE_TEXT_CHARS = 180_000;
const MAX_FILE_ATTACHMENTS = 30;
const VALUATION_METRIC_LABELS = [
  'C/Z',
  'C/WK',
  'C/WK Grahama',
  'C/P',
  'C/S',
  'C/ZO',
  'EV/P',
  'EV/EBIT',
  'EV/EBITDA',
  'ROA',
  'ROE',
];
const FINANCIAL_RESULT_LABELS = [
  'Przychody ze sprzedaży',
  'Zysk (strata) ze sprzedaży',
  'Zysk operacyjny (EBIT)',
  'Zysk (strata) z działalności gospodarczej',
  'Zysk netto',
  'Aktywa ogółem',
  'Aktywa obrotowe',
  'Zobowiązania ogółem',
  'Zobowiązania długoterminowe',
  'Zobowiązania krótkoterminowe',
  'Przepływy pieniężne razem',
  'Dywidenda za dany rok',
];

const DISCOVERY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'url', 'type', 'period', 'rationale'],
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          type: { type: 'string' },
          period: { type: 'string' },
          publishedAt: { type: ['string', 'null'] },
          rationale: { type: 'string' },
        },
      },
    },
  },
};

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'title', 'summary', 'conclusions', 'metrics', 'risks', 'reportPeriod'],
  properties: {
    schemaVersion: { type: 'string' },
    title: { type: 'string' },
    reportPeriod: { type: 'string' },
    summary: { type: 'string' },
    conclusions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: {
          text: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
    metrics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'value'],
        properties: {
          label: { type: 'string' },
          value: { type: ['string', 'number', 'null'] },
          unit: { type: 'string' },
          period: { type: 'string' },
          trend: { type: 'string' },
          yearOverYear: { type: ['string', 'number', 'null'] },
          source: { type: 'string' },
        },
      },
    },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: {
          text: { type: 'string' },
          source: { type: 'string' },
        },
      },
    },
  },
};

const safeJson = (text, fallback) => {
  if (typeof text !== 'string') return fallback;
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const readCost = (payload) => {
  const candidate = payload?.usage?.cost?.total_cost ?? payload?.usage?.cost?.totalCost ?? payload?.usage?.cost;
  const cost = Number(candidate);
  return Number.isFinite(cost) && cost >= 0 ? cost : 0;
};

const normalizeCitations = (payload) => {
  const fromSearch = Array.isArray(payload?.search_results)
    ? payload.search_results.map((result) => ({
      title: stringOrEmpty(result?.title) || stringOrEmpty(result?.url),
      url: stringOrEmpty(result?.url),
    }))
    : [];
  const fromCitations = Array.isArray(payload?.citations)
    ? payload.citations.map((url) => ({ title: String(url), url: String(url) }))
    : [];
  const seen = new Set();
  return [...fromSearch, ...fromCitations]
    .filter((citation) => {
      if (!citation.url || seen.has(citation.url)) return false;
      seen.add(citation.url);
      return true;
    })
    .slice(0, 30);
};

const requestCompletion = async ({ apiKey, model, messages, schema, fetchImpl = fetch }) => {
  const key = stringOrEmpty(apiKey);
  if (!key) {
    throw new AppError('PERPLEXITY_NOT_CONFIGURED', 'Ustaw PERPLEXITY_API_KEY w pliku .env.local lokalnego helpera.', 412);
  }
  let response;
  try {
    response = await fetchImpl(PERPLEXITY_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: { schema },
        },
      }),
    });
  } catch (error) {
    throw new AppError('PERPLEXITY_UNAVAILABLE', `Nie udało się połączyć z Perplexity: ${error.message}`, 502);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = stringOrEmpty(payload?.error?.message) || `Perplexity zwrócił HTTP ${response.status}.`;
    throw new AppError('PERPLEXITY_ERROR', message, 502);
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new AppError('PERPLEXITY_INVALID_RESPONSE', 'Perplexity nie zwrócił treści analizy.', 502);
  }
  return { payload, content, costUsd: readCost(payload), citations: normalizeCitations(payload) };
};

const asCandidate = (value) => {
  if (!value || typeof value !== 'object') return null;
  const url = stringOrEmpty(value.url);
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return null;
  } catch {
    return null;
  }
  return {
    title: stringOrEmpty(value.title) || url,
    url,
    type: stringOrEmpty(value.type) || 'report',
    period: stringOrEmpty(value.period),
    publishedAt: stringOrEmpty(value.publishedAt) || null,
    rationale: stringOrEmpty(value.rationale),
  };
};

export const discoverCandidatesWithPerplexity = async ({ apiKey, profile, sources, fetchImpl }) => {
  const sourceList = (sources || []).map((source) => ({ title: source.title, url: source.url, role: source.role }));
  const messages = [
    {
      role: 'system',
      content: 'Jesteś analitykiem inwestycyjnym. Szukasz wyłącznie dokumentów pierwotnych i oficjalnych. Odpowiadasz po polsku, bez rekomendacji kupna lub sprzedaży.',
    },
    {
      role: 'user',
      content: `Znajdź najnowszy oficjalny raport okresowy dla aktywa. Dla spółki może to być raport kwartalny, półroczny albo roczny; gdy emitent publikuje pełny pakiet ZIP, zwróć link do tego pakietu zamiast samej prezentacji lub informacji prasowej. Dla ETF-u zwróć aktualny factsheet, KID oraz dokument ze składem/holdings, jeśli jest dostępny. Preferuj podane źródła i zwróć tylko kandydatów z bezpośrednim URL-em do dokumentu lub oficjalnej strony raportu. Nie wybieraj mediów, agregatorów ani strony z samym kursem.\n\nAktywo:\n${JSON.stringify({ assetId: profile.assetId, type: profile.type, name: profile.name, canonicalId: profile.canonicalId })}\n\nŹródła zapisane przez użytkownika:\n${JSON.stringify(sourceList)}`,
    },
  ];
  const result = await requestCompletion({ apiKey, model: 'sonar', messages, schema: DISCOVERY_SCHEMA, fetchImpl });
  const parsed = safeJson(result.content, { candidates: [] });
  return {
    candidates: (Array.isArray(parsed.candidates) ? parsed.candidates : []).map(asCandidate).filter(Boolean),
    costUsd: result.costUsd,
    citations: result.citations,
    model: 'sonar',
  };
};

const textFromBuffer = (document, buffer) => {
  const extension = extensionOf(document.filename);
  if (!INLINE_TEXT_EXTENSIONS.has(extension)) return '';
  const text = buffer.toString('utf8').split('\0').join('');
  if (extension === 'html' || extension === 'htm') {
    return text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, MAX_INLINE_TEXT_CHARS);
  }
  return text.slice(0, MAX_INLINE_TEXT_CHARS);
};

const documentContentPart = (document, buffer) => {
  const extension = extensionOf(document.filename);
  if (FILE_ATTACHMENT_EXTENSIONS.has(extension)) {
    return {
      type: 'file_url',
      file_url: { url: buffer.toString('base64') },
    };
  }
  const inline = textFromBuffer(document, buffer);
  if (inline) return { type: 'text', text: `\n\n--- ${document.filename} ---\n${inline}` };
  const source = stringOrEmpty(document.sourceUrl);
  return {
    type: 'text',
    text: `\n\nDokument ${document.filename} ma format ${extension.toUpperCase()}, którego nie dołączono binarnie. Korzystaj wyłącznie z zarchiwizowanej metadanej i oficjalnego adresu: ${source || 'brak URL'}. Nie wymyślaj danych niedostępnych w pliku.`,
  };
};

const normaliseAnalysis = (parsed, fallback) => ({
  schemaVersion: stringOrEmpty(parsed?.schemaVersion) || '1.0',
  title: stringOrEmpty(parsed?.title) || fallback.title,
  reportPeriod: stringOrEmpty(parsed?.reportPeriod) || fallback.reportPeriod,
  summary: stringOrEmpty(parsed?.summary) || fallback.summary,
  conclusions: Array.isArray(parsed?.conclusions) ? parsed.conclusions.filter(Boolean).slice(0, 20) : [],
  metrics: Array.isArray(parsed?.metrics) ? parsed.metrics.filter(Boolean).slice(0, 80) : [],
  risks: Array.isArray(parsed?.risks) ? parsed.risks.filter(Boolean).slice(0, 30) : [],
});

export const analyzeDocumentsWithPerplexity = async ({ apiKey, profile, documents, documentBuffers, fetchImpl }) => {
  if (!Array.isArray(documents) || !documents.length || !Array.isArray(documentBuffers) || documentBuffers.length !== documents.length) {
    throw new AppError('NO_DOCUMENTS_SELECTED', 'Wybierz dokumenty do analizy.', 400);
  }
  const attachments = [];
  let fileAttachmentCount = 0;
  documents.forEach((document, index) => {
    const part = documentContentPart(document, documentBuffers[index]);
    if (part.type === 'file_url' && fileAttachmentCount >= MAX_FILE_ATTACHMENTS) return;
    attachments.push(part);
    if (part.type === 'file_url') fileAttachmentCount += 1;
  });
  const metadata = documents.map((document) => ({
    id: document.id,
    filename: document.filename,
    title: document.title,
    type: document.type,
    period: document.period,
    publishedAt: document.publishedAt,
    sourceUrl: document.sourceUrl,
  }));
  const metricInstructions = `W polu metrics zwracaj w pierwszej kolejności poniższe etykiety, dokładnie w tym brzmieniu, jeśli dane są dostępne:
- wskaźniki wyceny i rentowności: ${VALUATION_METRIC_LABELS.join(', ')}
- wyniki finansowe: ${FINANCIAL_RESULT_LABELS.join(', ')}

Dla każdej metryki ustaw: label jako jedną z powyższych etykiet, value jako samą liczbę lub null, unit jako osobną jednostkę (np. "x", "%", "tys. PLN", "mln PLN", "PLN/akcję"), period jako "Q1 2026", "Q2 2026", "2026" itd. Nie doklejaj jednostki do value. Dla danych rachunku wyników i przepływów zwracaj okresy kwartalne, jeśli są w dokumencie. Dla aktywów i zobowiązań traktuj wartość jako stan na koniec okresu.`;
  const prompt = `Przeanalizuj zatwierdzone dokumenty dla aktywa poniżej. Odpowiedź musi być po polsku. Traktuj dokumenty jako źródło główne; wyraźnie oddziel fakty od interpretacji. Porównuj rok do roku, gdy dokument zawiera porównywalne dane. Jeśli metryki nie da się wiarygodnie ustalić, nie dodawaj jej. Nie podawaj rekomendacji inwestycyjnej.\n\nAktywo: ${JSON.stringify({ assetId: profile.assetId, type: profile.type, name: profile.name, canonicalId: profile.canonicalId })}\n\nDokumenty: ${JSON.stringify(metadata)}`;
  const messages = [
    {
      role: 'system',
      content: 'Jesteś ostrożnym analitykiem raportów spółek i ETF-ów. Każda liczba powinna mieć okres i źródło. Zwróć wyłącznie strukturę JSON zgodną ze schematem.',
    },
    { role: 'user', content: [{ type: 'text', text: `${prompt}\n\n${metricInstructions}` }, ...attachments] },
  ];
  const result = await requestCompletion({ apiKey, model: 'sonar-pro', messages, schema: ANALYSIS_SCHEMA, fetchImpl });
  const parsed = safeJson(result.content, {});
  const fallback = {
    title: `Analiza ${profile.name}`,
    reportPeriod: documents.map((document) => document.period).filter(Boolean).join(', '),
    summary: result.content,
  };
  return {
    content: {
      ...normaliseAnalysis(parsed, fallback),
      citations: result.citations,
    },
    costUsd: result.costUsd,
    model: 'sonar-pro',
  };
};
