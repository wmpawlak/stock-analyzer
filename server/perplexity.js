import { AppError, extensionOf, stringOrEmpty } from './utils.js';
import {
  ANALYSIS_V2_SCHEMA_VERSION,
  getReportMetricsForProfile,
  metricUnitMatchesValueType,
} from './analysisMetricCatalog.js';
import { extractPdfText } from './pdfText.js';
import { inferReportPeriodFromText, normalizeReportPeriod } from '../shared/reportPeriods.js';

const PERPLEXITY_ENDPOINT = 'https://api.perplexity.ai/chat/completions';
const INLINE_TEXT_EXTENSIONS = new Set(['txt', 'rtf', 'html', 'htm', 'csv']);
const MAX_INLINE_TEXT_CHARS = 180_000;

const SOURCE_SCHEMA = { 
  type: 'object', 
  additionalProperties: false, 
  required: ['documentId', 'page', 'section', 'evidence'], 
  properties: {
    documentId: { type: 'string' },
    page: { type: ['integer', 'string', 'null'] },
    section: { type: 'string' },
    evidence: { type: 'string' },
  }, 
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
              required: ['text'],
              properties: {
                text: { type: 'string' },
                metricKeys: {
                  type: 'array',
                  maxItems: 6,
                  items: { type: 'string' },
                },
                source: SOURCE_SCHEMA,
              },
            },
          },
        },
      },
    },
  },
};

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
  required: ['schemaVersion', 'title', 'reportPeriod', 'summary', 'structuredSummary', 'metricFacts', 'risks', 'conclusions', 'extractionWarnings'], 
  properties: { 
    schemaVersion: { type: 'string', enum: [ANALYSIS_V2_SCHEMA_VERSION] }, 
    title: { type: 'string' }, 
    reportPeriod: { type: 'string' }, 
    summary: { type: 'string' }, 
    structuredSummary: STRUCTURED_SUMMARY_SCHEMA,
    metricFacts: { 
      type: 'array',
      maxItems: 120,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['metricKey', 'label', 'value', 'unit', 'period', 'page', 'section', 'quote', 'confidence'],
        properties: {
          metricKey: { type: 'string' },
          label: { type: 'string' },
          value: { type: ['string', 'number', 'null'] },
          unit: { type: 'string' },
          period: { type: 'string' },
          page: { type: ['integer', 'string', 'null'] },
          section: { type: 'string' },
          quote: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    },
    risks: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'source'],
        properties: {
          text: { type: 'string' },
          source: SOURCE_SCHEMA,
        },
      },
    },
    conclusions: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'source'],
        properties: {
          text: { type: 'string' },
          source: SOURCE_SCHEMA,
        },
      },
    },
    extractionWarnings: {
      type: 'array',
      maxItems: 60,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['metricKey', 'label', 'reason', 'evidence'],
        properties: {
          metricKey: { type: 'string' },
          label: { type: 'string' },
          reason: { type: 'string' },
          evidence: { type: 'string' },
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

const fetchFailureMessage = (error) => {
  const code = stringOrEmpty(error?.cause?.code);
  const base = stringOrEmpty(error?.message) || 'fetch failed';
  if (['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT'].includes(code)) {
    return `Nie udało się połączyć z Perplexity: Node odrzucił certyfikat TLS (${code}). Uruchom helper przez npm run dev po aktualizacji; helper startuje z --use-system-ca. Jeśli problem zostanie, ustaw NODE_EXTRA_CA_CERTS na firmowy certyfikat CA.`;
  }
  if (code === 'UND_ERR_SOCKET') {
    return 'Nie udało się połączyć z Perplexity: połączenie HTTP zostało zerwane przez warstwę sieciową (UND_ERR_SOCKET). Spróbuj ponownie; helper ponawia takie wywołania automatycznie, ale API albo sieć lokalna nadal mogą przerwać duży request z dokumentem PDF.';
  }
  if (code) return `Nie udało się połączyć z Perplexity: ${base} (${code}).`;
  return `Nie udało się połączyć z Perplexity: ${base}.`;
};

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const isTransientFetchError = (error) => [
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
].includes(stringOrEmpty(error?.cause?.code));

const requestCompletion = async ({ apiKey, model, messages, schema, fetchImpl = fetch }) => {
  const key = stringOrEmpty(apiKey);
  if (!key) {
    throw new AppError('PERPLEXITY_NOT_CONFIGURED', 'Ustaw PERPLEXITY_API_KEY w pliku .env.local lokalnego helpera.', 412);
  }
  let response;
  const requestBody = JSON.stringify({
    model,
    messages,
    response_format: {
      type: 'json_schema',
      json_schema: { schema },
    },
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetchImpl(PERPLEXITY_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: requestBody,
      });
      break;
    } catch (error) {
      if (attempt < 2 && isTransientFetchError(error)) {
        await sleep(350 * (attempt + 1));
        continue;
      }
      throw new AppError('PERPLEXITY_UNAVAILABLE', fetchFailureMessage(error), 502);
    }
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
  if (extension === 'pdf') return extractPdfText(buffer, { maxChars: MAX_INLINE_TEXT_CHARS });
  if (!INLINE_TEXT_EXTENSIONS.has(extension)) return '';
  const text = buffer.toString('utf8').split('\0').join('');
  if (extension === 'html' || extension === 'htm') {
    return text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, MAX_INLINE_TEXT_CHARS);
  }
  return text.slice(0, MAX_INLINE_TEXT_CHARS);
};

const documentReportPeriod = (document) => (
  normalizeReportPeriod(document.period)
  || inferReportPeriodFromText([document.title, document.filename, document.type].filter(Boolean).join(' '))
);

const documentContentPart = (document, buffer) => {
  const extension = extensionOf(document.filename);
  const inline = textFromBuffer(document, buffer);
  if (inline) {
    const extractionNote = extension === 'pdf' ? ' (tekst wyodrebniony lokalnie z PDF)' : '';
    return { type: 'text', text: `\n\n--- ${document.filename}${extractionNote} ---\n${inline}` };
  }
  const source = stringOrEmpty(document.sourceUrl);
  return {
    type: 'text',
    text: `\n\nDokument ${document.filename} ma format ${extension.toUpperCase()}, którego nie dołączono binarnie. Korzystaj wyłącznie z zarchiwizowanej metadanej i oficjalnego adresu: ${source || 'brak URL'}. Nie wymyślaj danych niedostępnych w pliku.`,
  };
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

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normaliseSummaryBullet = (bullet) => {
  if (typeof bullet === 'string') return { text: bullet };
  if (!isPlainObject(bullet)) return null;
  const text = stringOrEmpty(bullet.text);
  if (!text) return null;
  const result = { text };
  if (Array.isArray(bullet.metricKeys)) result.metricKeys = bullet.metricKeys.map(stringOrEmpty).filter(Boolean).slice(0, 6);
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

const normalizeMetricFacts = ({ facts, reportPeriod, catalog }) => {
  const specs = new Map(catalog.map((spec) => [spec.metricKey, spec]));
  const selected = new Map();
  const warnings = [];

  for (const fact of facts) {
    if (!isPlainObject(fact)) continue;
    const factPeriod = normalizeReportPeriod(fact.period);
    if (reportPeriod && factPeriod && factPeriod !== reportPeriod) continue;
    const spec = specs.get(stringOrEmpty(fact.metricKey));
    if (!spec) continue;
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
    if (!current || Number(normalizedFact.confidence || 0) > Number(current.confidence || 0)) {
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

  return { metricFacts: [...selected.values()].slice(0, 120), warnings };
};

const normaliseAnalysis = (parsed, fallback, profile) => {
  const reportPeriod = normalizeReportPeriod(parsed?.reportPeriod) || normalizeReportPeriod(fallback.reportPeriod);
  const normalizedFacts = normalizeMetricFacts({
    facts: Array.isArray(parsed?.metricFacts) ? parsed.metricFacts.filter(Boolean) : [],
    reportPeriod,
    catalog: getReportMetricsForProfile(profile),
  });
  const metricFacts = normalizedFacts.metricFacts;
  const risks = Array.isArray(parsed?.risks) ? parsed.risks.filter(Boolean).slice(0, 30) : [];
  const conclusions = Array.isArray(parsed?.conclusions) ? parsed.conclusions.filter(Boolean).slice(0, 30) : [];
  const extractionWarnings = [
    ...(Array.isArray(parsed?.extractionWarnings) ? parsed.extractionWarnings.filter(Boolean) : []),
    ...normalizedFacts.warnings,
  ].slice(0, 60);
  const legacyMetrics = Array.isArray(parsed?.metrics)
    ? parsed.metrics
      .filter(Boolean)
      .filter((metric) => {
        const metricPeriod = normalizeReportPeriod(metric?.period || metric?.reportingPeriod || metric?.date || metric?.year);
        return !reportPeriod || !metricPeriod || metricPeriod === reportPeriod;
      })
      .map((metric) => (isPlainObject(metric)
        ? { ...metric, period: reportPeriod || stringOrEmpty(metric.period) }
        : metric))
      .slice(0, 120)
    : metricFacts.map(metricFactToMetric);

  return { 
    schemaVersion: ANALYSIS_V2_SCHEMA_VERSION, 
    title: stringOrEmpty(parsed?.title) || fallback.title, 
    reportPeriod,
    summary: stringOrEmpty(parsed?.summary) || fallback.summary, 
    structuredSummary: normaliseStructuredSummary(parsed?.structuredSummary, stringOrEmpty(parsed?.summary) || fallback.summary),
    metricFacts, 
    risks, 
    conclusions,
    extractionWarnings,
    metrics: legacyMetrics,
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

const buildAnalysisPrompt = ({ profile, metadata }) => {
  const catalog = metricCatalogForPrompt(profile);
  return `Przeanalizuj zatwierdzone dokumenty dla aktywa poniżej. Odpowiedź musi być po polsku i wyłącznie jako JSON zgodny ze schematem.

Cel pracy:
1. Ekstrakcja faktów: znajdź metryki z katalogu metryk, używając metricKey, aliasów i słów kluczowych.
2. Kompozycja analizy: napisz summary, structuredSummary, risks i conclusions wyłącznie na podstawie wyekstrahowanych faktów i cytowanych fragmentów dokumentu.

Twarde reguły:
- Nie zgaduj. Brak pewnego źródła oznacza brak metricFact i wpis w extractionWarnings.
- Katalog poniżej jest jedyną listą dozwolonych metricKey. Przejdź kolejno przez każdy wpis katalogu i dla każdego metricKey wykonaj osobną próbę odnalezienia metryki w dokumencie.
- Przy wyszukiwaniu każdego metricKey używaj łącznie jego pól shortName, namePl, nameEn, aliases, keywords, description, valueType i aggregation. metricKey jest identyfikatorem wyniku, a nazwa w dokumencie może być polska, angielska, skrócona albo opisana jednym z aliasów.
- Jeżeli znajdziesz wiarygodną wartość zgodną z definicją, typem wartości, jednostką i okresem danego wpisu katalogu, zwróć ją jako metricFact z dokładnie tym metricKey. Nie wymagaj dosłownego wystąpienia samego tekstu metricKey w dokumencie.
- Metryki z tier primary traktuj jako obowiązkową checklistę: brak wiarygodnego źródła opisz w extractionWarnings. Metryk z tier secondary również aktywnie szukaj i zwróć je, gdy są dobrze uźródłowione; ich braku nie musisz dodawać do extractionWarnings.
- Nie zbieraj dowolnych liczb ani KPI spoza katalogu jako metricFacts.
- Przy tekstach wyciągniętych lokalnie z PDF/OCR nie wymagaj idealnego tekstu tabeli: jeżeli nagłówek okresów, kolejność kolumn, etykieta metryki i wartości są widoczne w tym samym fragmencie lub bezpośrednim sąsiedztwie tabeli, zwróć metricFacts z niższą confidence zamiast odrzucać całą metrykę.
- Artefakty OCR, dodatkowe spacje i rozdzielone litery nie są same w sobie powodem do pominięcia metryki, jeżeli kontekst tabeli pozwala jednoznacznie przypisać wartość do okresu. Nigdy nie sklejaj cyfr z sąsiednich kolumn. Gdy w wierszu występuje kilka wartości, dopasuj każdą komórkę do jej nagłówka i wybierz wyłącznie komórkę okresu głównego raportu.
- Zachowuj strukturę tekstu wyodrębnionego lokalnie: podziały linii odzwierciedlają wiersze PDF, a komórki w jednej linii należą do tego samego wiersza tabeli. Etykieta zawinięta do kolejnej linii nadal należy do poprzedniego wiersza, jeśli nie zaczyna nowego zestawu wartości.
- Dla kwot pieniężnych użyj dokładnie waluty i skali widocznej w raporcie, np. tys. PLN, mln EUR, USD albo EUR/akcję. Nie przeliczaj walut i nie preferuj PLN. Brak widocznej jednostki przy kwocie oznacza brak metricFact i wpis w extractionWarnings. Dla wskaźników procentowych wystarczy widoczny znak procentu przy wartości i jednoznaczny nagłówek okresu.
- Każda liczba w metricFacts musi mieć metricKey, label, value, unit, period, page, section, quote i confidence.
- Każde risk i conclusion musi mieć source z documentId, page, section i evidence.
- quote oraz source.evidence mają być krótkimi dowodami z dokumentu, nie parafrazą bez zakotwiczenia.
- Jeżeli numer strony nie jest dostępny w narzędziu, ustaw page na null, ale nadal wypełnij section i quote/evidence.
- value ma być samą liczbą albo null; pełna jednostka wraz z walutą i skalą trafia tylko do unit.
- Czytaj wartości tylko z kolumny okresu głównego raportu. Przykład: w raporcie Q1 2025 zwracaj metricFacts tylko dla Q1 2025, a kolumnę Q1 2024 pomiń jako metricFacts.
- Dla każdej metryki zwróć najwyżej jeden metricFact dla okresu raportu. Jeżeli ta sama tabela pokazuje Q1 2025 oraz Q1 2024, wybierz wyłącznie Q1 2025, gdy raport dotyczy Q1 2025.
- metricKey cost_of_risk oznacza wyłącznie wskaźnik CoR wyrażony w % albo bps. Nie przypisuj do niego kwot pozycji "wynik z tytułu oczekiwanych strat kredytowych", "odpisy aktualizujące" ani "koszty ryzyka prawnego". Takie kwoty nie są CoR i nie mają osobnego metricKey w katalogu.
- Normalizuj okresy kwartalne do formatu Q1 YYYY, Q2 YYYY, Q3 YYYY albo Q4 YYYY. Równoważniki okresów to: Q1 = 31.03.YYYY lub 01.01.YYYY-31.03.YYYY; Q2 = 30.06.YYYY lub 01.04.YYYY-30.06.YYYY; Q3 = 30.09.YYYY lub 01.07.YYYY-30.09.YYYY; Q4 = 31.12.YYYY lub 01.10.YYYY-31.12.YYYY.
- Zakresów narastających 01.01.YYYY-30.06.YYYY i 01.01.YYYY-30.09.YYYY nie traktuj jako czystych Q2 ani Q3 i nie używaj ich jako metricFacts dla raportu kwartalnego.
- Jeżeli tabela pokazuje datę bilansową będącą końcem kwartału, w polu period wpisz kwartał, np. Q1 2026 zamiast 31.03.2026.
- Nie twórz metricFacts dla okresów porównawczych, nawet jeżeli wartości są bezpośrednio widoczne w dokumencie.
- Nie zwracaj rekomendacji kupna/sprzedaży.

Reguły structuredSummary:
- Pisz jak analityk dla człowieka: przystępnie, konkretnie i bez suchego wyliczania liczb.
- structuredSummary.headline ma zawierać jedną najważniejszą tezę z raportu.
- structuredSummary.stance ustaw jako syntetyczną ocenę tonu raportu bez rekomendacji inwestycyjnej: pozytywny, mieszany, ostrozny albo negatywny.
- structuredSummary.sections ma zawierać sekcje: Najważniejsze fakty, Zmiana vs rok temu, Jakość wyniku, Ryzyka i kapitał, Co sprawdzić dalej. Dla profilu niebankowego dopasuj nazwy do raportu, ale zachowaj sens tych obszarów.
- W bullets wyjaśniaj znaczenie danych: co jest korzystne lub niekorzystne, co się poprawiło lub pogorszyło, co wygląda na jednorazowe lub powtarzalne, jakie ryzyka mogą zniekształcać obraz oraz co użytkownik powinien sprawdzić w kolejnym kroku.
- Gdy bullet opiera się na liczbach, dodaj metricKeys z odpowiednimi metricKey z katalogu i source, jeżeli wniosek ma bezpośrednie zakotwiczenie w dokumencie.
Aktywo:
${JSON.stringify({ assetId: profile.assetId, type: profile.type, name: profile.name, canonicalId: profile.canonicalId })}

Dokumenty:
${JSON.stringify(metadata)}

Katalog metryk do ekstrakcji:
${JSON.stringify(catalog, null, 2)}`;
};

export const analyzeDocumentsWithPerplexity = async ({ apiKey, profile, documents, documentBuffers, fetchImpl }) => {
  if (!Array.isArray(documents) || !documents.length || !Array.isArray(documentBuffers) || documentBuffers.length !== documents.length) {
    throw new AppError('NO_DOCUMENTS_SELECTED', 'Wybierz dokumenty do analizy.', 400);
  }
  const attachments = documents.map((document, index) => documentContentPart(document, documentBuffers[index]));
  const metadata = documents.map((document) => ({
    id: document.id,
    filename: document.filename,
    title: document.title,
    type: document.type,
    period: documentReportPeriod(document),
    publishedAt: document.publishedAt,
    sourceUrl: document.sourceUrl,
  }));
  const prompt = buildAnalysisPrompt({ profile, metadata });
  const messages = [
    {
      role: 'system',
      content: 'Jesteś ostrożnym analitykiem raportów spółek, banków i ETF-ów. Pracujesz provider-neutralnie: najpierw ekstrahujesz fakty ze źródłami, potem komponujesz analizę tylko z tych faktów. Zwracasz wyłącznie JSON zgodny ze schematem.',
    },
    { role: 'user', content: [{ type: 'text', text: prompt }, ...attachments] },
  ];
  const result = await requestCompletion({ apiKey, model: 'sonar-pro', messages, schema: ANALYSIS_SCHEMA, fetchImpl });
  const parsed = safeJson(result.content, {});
  const fallback = {
    title: `Analiza ${profile.name}`,
    reportPeriod: documents.map(documentReportPeriod).filter(Boolean).join(', '),
    summary: result.content,
  };
  return {
    content: {
      ...normaliseAnalysis(parsed, fallback, profile),
      citations: result.citations,
    },
    costUsd: result.costUsd,
    model: 'sonar-pro',
  };
};
