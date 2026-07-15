import { AppError, extensionOf, stringOrEmpty } from './utils.js';
import {
  ANALYSIS_V2_SCHEMA_VERSION,
  getReportMetricsForProfile,
  isBankReportProfile,
} from './analysisMetricCatalog.js';
import { extractPdfText } from './pdfText.js';

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
    return `Nie udalo sie polaczyc z Perplexity: Node odrzucil certyfikat TLS (${code}). Uruchom helper przez npm run dev po aktualizacji; helper startuje z --use-system-ca. Jesli problem zostanie, ustaw NODE_EXTRA_CA_CERTS na firmowy certyfikat CA.`;
  }
  if (code) return `Nie udalo sie polaczyc z Perplexity: ${base} (${code}).`;
  return `Nie udalo sie polaczyc z Perplexity: ${base}.`;
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
    throw new AppError('PERPLEXITY_UNAVAILABLE', fetchFailureMessage(error), 502);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = stringOrEmpty(payload?.error?.message) || `Perplexity zwrocil HTTP ${response.status}.`;
    throw new AppError('PERPLEXITY_ERROR', message, 502);
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new AppError('PERPLEXITY_INVALID_RESPONSE', 'Perplexity nie zwrocil tresci analizy.', 502);
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
      content: 'Jestes analitykiem inwestycyjnym. Szukasz wylacznie dokumentow pierwotnych i oficjalnych. Odpowiadasz po polsku, bez rekomendacji kupna lub sprzedazy.',
    },
    {
      role: 'user',
      content: `Znajdz najnowszy oficjalny raport okresowy dla aktywa. Dla spolki moze to byc raport kwartalny, polroczny albo roczny; gdy emitent publikuje pelny pakiet ZIP, zwroc link do tego pakietu zamiast samej prezentacji lub informacji prasowej. Dla ETF-u zwroc aktualny factsheet, KID oraz dokument ze skladem/holdings, jesli jest dostepny. Preferuj podane zrodla i zwroc tylko kandydatow z bezposrednim URL-em do dokumentu lub oficjalnej strony raportu. Nie wybieraj mediow, agregatorow ani strony z samym kursem.\n\nAktywo:\n${JSON.stringify({ assetId: profile.assetId, type: profile.type, name: profile.name, canonicalId: profile.canonicalId })}\n\nZrodla zapisane przez uzytkownika:\n${JSON.stringify(sourceList)}`,
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
    text: `\n\nDokument ${document.filename} ma format ${extension.toUpperCase()}, ktorego nie dolaczono binarnie. Korzystaj wylacznie z zarchiwizowanej metadanej i oficjalnego adresu: ${source || 'brak URL'}. Nie wymyslaj danych niedostepnych w pliku.`,
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

const normaliseAnalysis = (parsed, fallback) => {
  const metricFacts = Array.isArray(parsed?.metricFacts) ? parsed.metricFacts.filter(Boolean).slice(0, 120) : [];
  const risks = Array.isArray(parsed?.risks) ? parsed.risks.filter(Boolean).slice(0, 30) : [];
  const conclusions = Array.isArray(parsed?.conclusions) ? parsed.conclusions.filter(Boolean).slice(0, 30) : [];
  const extractionWarnings = Array.isArray(parsed?.extractionWarnings) ? parsed.extractionWarnings.filter(Boolean).slice(0, 60) : [];
  const legacyMetrics = Array.isArray(parsed?.metrics)
    ? parsed.metrics.filter(Boolean).slice(0, 120)
    : metricFacts.map(metricFactToMetric);

  return { 
    schemaVersion: ANALYSIS_V2_SCHEMA_VERSION, 
    title: stringOrEmpty(parsed?.title) || fallback.title, 
    reportPeriod: stringOrEmpty(parsed?.reportPeriod) || fallback.reportPeriod, 
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
  category: spec.category,
  valueType: spec.valueType,
  defaultUnit: spec.defaultUnit,
  aggregation: spec.aggregation,
  description: spec.description,
  aliases: spec.aliases,
  keywords: spec.keywords,
}));

const bankAnalysisRules = (profile) => (isBankReportProfile(profile) ? `
Reguly profilu bankowego:
- Dla profilu bankowego priorytetem jest bankowy katalog metryk ponizej. Nie zbieraj dowolnych liczb ani pobocznych KPI spoza katalogu jako metricFacts.
- Szukaj kazdej metryki po nazwach polskich, nazwach angielskich oraz skrotach z pola aliases, np. Return on Equity, Return on Assets, Cost to Income, Non-Performing Loans, Cost of Risk, Total Capital Ratio, Loan to Deposit, Earnings per Share.
- Dla wartosci pienieznych wiodace sa PLN / tys. PLN / mln PLN. Jezeli tabela lub kolumna jest w innej walucie, nie uzywaj jej jako glownego zrodla metricFact; wpisz niepewnosc albo brak zgodnej waluty do extractionWarnings.
- Jezeli raport pokazuje kilka kwartalow albo okresow porownawczych dla tej samej metryki bankowej, zwroc wszystkie wiarygodne okresy widoczne w tabeli, a nie tylko najnowszy.
` : '');

const buildAnalysisPrompt = ({ profile, metadata }) => {
  const catalog = metricCatalogForPrompt(profile);
  return `Przeanalizuj zatwierdzone dokumenty dla aktywa ponizej. Odpowiedz musi byc po polsku i wylacznie jako JSON zgodny ze schematem.

Cel pracy: 
1. Ekstrakcja faktow: znajdz metryki z katalogu metryk, uzywajac metricKey, aliasow i slow kluczowych. 
2. Kompozycja analizy: napisz summary, structuredSummary, risks i conclusions wylacznie na podstawie wyekstrahowanych faktow i cytowanych fragmentow dokumentu. 

Twarde reguly:
- Nie zgaduj. Brak pewnego zrodla oznacza brak metricFact i wpis w extractionWarnings.
- Kazda liczba w metricFacts musi miec metricKey, label, value, unit, period, page, section, quote i confidence.
- Kazde risk i conclusion musi miec source z documentId, page, section i evidence.
- quote oraz source.evidence maja byc krotkimi dowodami z dokumentu, nie parafraza bez zakotwiczenia.
- Jezeli numer strony nie jest dostepny w narzedziu, ustaw page na null, ale nadal wypelnij section i quote/evidence.
- value ma byc sama liczba albo null; jednostka trafia tylko do unit.
- Czytaj nie tylko kolumny okresu glownego raportu, ale tez kolumny porownawcze w tych samych tabelach, np. Q1 2025 albo 31.03.2025 w raporcie Q1 2026.
- Dla kazdej metryki zwroc osobny metricFact dla kazdego wiarygodnie odczytanego okresu porownawczego. Przyklad: net_income dla Q1 2026 i net_income dla Q1 2025 to dwa metricFacts.
- Normalizuj okresy kwartalne do formatu Q1 2026, Q2 2026, Q3 2026 albo Q4 2026. Daty konca kwartalu 31.03.YYYY, 30.06.YYYY, 30.09.YYYY i 31.12.YYYY traktuj odpowiednio jako Q1, Q2, Q3 i Q4 tego roku.
- Jezeli tabela pokazuje date bilansowa bedaca koncem kwartalu, w polu period wpisz kwartal, np. Q1 2026 zamiast 31.03.2026.
- Nie tworz okresu porownawczego, jezeli wartosc nie jest bezposrednio widoczna w dokumencie. 
- Nie zwracaj rekomendacji kupna/sprzedazy. 

Reguly structuredSummary:
- Pisz jak analityk dla czlowieka: przystepnie, konkretnie i bez suchego wyliczania liczb.
- structuredSummary.headline ma zawierac jedna najwazniejsza teze z raportu.
- structuredSummary.stance ustaw jako syntetyczna ocene tonu raportu bez rekomendacji inwestycyjnej: pozytywny, mieszany, ostrozny albo negatywny.
- structuredSummary.sections ma zawierac sekcje: Najwazniejsze fakty, Zmiana vs rok temu, Jakosc wyniku, Ryzyka i kapital, Co sprawdzic dalej. Dla profilu niebankowego dopasuj nazwy do raportu, ale zachowaj sens tych obszarow.
- W bullets wyjasniaj znaczenie danych: co sie poprawilo/pogorszylo, czy wynik wyglada powtarzalnie, jakie ryzyka moga znieksztalcac obraz oraz co uzytkownik powinien sprawdzic w kolejnym kroku.
- Gdy bullet opiera sie na liczbach, dodaj metricKeys z odpowiednimi metricKey z katalogu i source, jezeli wniosek ma bezposrednie zakotwiczenie w dokumencie.
${bankAnalysisRules(profile)} 

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
    period: document.period,
    publishedAt: document.publishedAt,
    sourceUrl: document.sourceUrl,
  }));
  const prompt = buildAnalysisPrompt({ profile, metadata });
  const messages = [
    {
      role: 'system',
      content: 'Jestes ostroznym analitykiem raportow spolek, bankow i ETF-ow. Pracujesz provider-neutralnie: najpierw ekstrahujesz fakty ze zrodlami, potem komponujesz analize tylko z tych faktow. Zwracasz wylacznie JSON zgodny ze schematem.',
    },
    { role: 'user', content: [{ type: 'text', text: prompt }, ...attachments] },
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
