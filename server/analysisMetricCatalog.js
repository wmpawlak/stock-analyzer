const METRIC_CATEGORY_COMMON = 'common';
const METRIC_CATEGORY_BANK = 'bank';

export const ANALYSIS_V2_SCHEMA_VERSION = '2.0';

const metric = ({
  metricKey,
  label,
  category,
  valueType,
  defaultUnit,
  aggregation,
  description,
  aliases = [],
  keywords = [],
}) => ({
  metricKey,
  label,
  category,
  valueType,
  defaultUnit,
  aggregation,
  description,
  aliases: [label, ...aliases],
  keywords,
});

export const COMMON_REPORT_METRICS = [
  metric({
    metricKey: 'net_income',
    label: 'Zysk netto',
    category: METRIC_CATEGORY_COMMON,
    valueType: 'money',
    defaultUnit: 'tys. PLN',
    aggregation: 'sum',
    description: 'Wynik finansowy po podatku za dany okres, pokazujacy ile zysku zostaje dla akcjonariuszy.',
    aliases: ['Strata netto', 'Wynik netto', 'Zysk netto przypadajacy akcjonariuszom', 'Net profit', 'Net income', 'Profit for the period', 'Net profit attributable to shareholders'],
    keywords: ['rachunek zyskow i strat', 'wynik finansowy', 'net profit'],
  }),
  metric({
    metricKey: 'total_assets',
    label: 'Aktywa ogolem',
    category: METRIC_CATEGORY_COMMON,
    valueType: 'money',
    defaultUnit: 'tys. PLN',
    aggregation: 'point_in_time',
    description: 'Suma majatku kontrolowanego przez spolka lub bank na koniec okresu.',
    aliases: ['Aktywa razem', 'Suma aktywow', 'Total assets'],
    keywords: ['sprawozdanie z sytuacji finansowej', 'bilans'],
  }),
  metric({
    metricKey: 'total_liabilities',
    label: 'Zobowiazania ogolem',
    category: METRIC_CATEGORY_COMMON,
    valueType: 'money',
    defaultUnit: 'tys. PLN',
    aggregation: 'point_in_time',
    description: 'Suma zobowiazan jednostki wobec finansujacych, klientow, dostawcow i innych stron.',
    aliases: ['Zobowiazania razem', 'Suma zobowiazan', 'Total liabilities'],
    keywords: ['sprawozdanie z sytuacji finansowej', 'bilans'],
  }),
  metric({
    metricKey: 'equity',
    label: 'Kapital wlasny',
    category: METRIC_CATEGORY_COMMON,
    valueType: 'money',
    defaultUnit: 'tys. PLN',
    aggregation: 'point_in_time',
    description: 'Wartosc kapitalu przypadajaca wlascicielom po odjeciu zobowiazan od aktywow.',
    aliases: ['Kapital wlasny razem', 'Equity', 'Total equity', 'Shareholders equity'],
    keywords: ['sprawozdanie z sytuacji finansowej', 'kapital'],
  }),
  metric({
    metricKey: 'cash_flow_total',
    label: 'Przeplywy pieniezne razem',
    category: METRIC_CATEGORY_COMMON,
    valueType: 'money',
    defaultUnit: 'tys. PLN',
    aggregation: 'sum',
    description: 'Laczna zmiana stanu srodkow pienieznych wynikajaca z przeplywow operacyjnych, inwestycyjnych i finansowych.',
    aliases: ['Przeplywy pieniezne netto', 'Zmiana stanu srodkow pienieznych', 'Cash flow razem', 'Net cash flow'],
    keywords: ['sprawozdanie z przeplywow pienieznych', 'cash flow'],
  }),
  metric({
    metricKey: 'roe',
    label: 'ROE',
    category: METRIC_CATEGORY_COMMON,
    valueType: 'percent',
    defaultUnit: '%',
    aggregation: 'point_in_time',
    description: 'Return on Equity: rentownosc kapitalu wlasnego, czyli relacja zysku netto do kapitalow wlasnych.',
    aliases: ['Rentownosc kapitalu wlasnego', 'Return on equity', 'ROE ratio'],
    keywords: ['wybrane wskazniki finansowe', 'rentownosc'],
  }),
  metric({
    metricKey: 'roa',
    label: 'ROA',
    category: METRIC_CATEGORY_COMMON,
    valueType: 'percent',
    defaultUnit: '%',
    aggregation: 'point_in_time',
    description: 'Return on Assets: rentownosc aktywow, czyli relacja zysku netto do aktywow.',
    aliases: ['Rentownosc aktywow', 'Return on assets', 'ROA ratio'],
    keywords: ['wybrane wskazniki finansowe', 'rentownosc'],
  }),
];

export const BANK_REPORT_METRICS = [
  metric({
    metricKey: 'net_interest_income',
    label: 'Wynik z tytulu odsetek',
    category: METRIC_CATEGORY_BANK,
    valueType: 'money',
    defaultUnit: 'tys. PLN',
    aggregation: 'sum',
    description: 'Net interest income: roznica miedzy przychodami odsetkowymi a kosztami odsetkowymi banku.',
    aliases: ['Wynik odsetkowy', 'Dochody odsetkowe netto', 'Przychody odsetkowe netto', 'Net interest income', 'Interest income net'],
    keywords: ['rachunek zyskow i strat', 'odsetki'],
  }),
  metric({
    metricKey: 'net_fee_commission_income',
    label: 'Wynik z oplat i prowizji',
    category: METRIC_CATEGORY_BANK,
    valueType: 'money',
    defaultUnit: 'tys. PLN',
    aggregation: 'sum',
    description: 'Net fee and commission income: wynik netto na oplatach i prowizjach pobieranych za uslugi bankowe.',
    aliases: ['Wynik prowizyjny', 'Wynik z tytulu prowizji i oplat', 'Wynik z tytulu oplat i prowizji', 'Net fee and commission income', 'Fee and commission income net'],
    keywords: ['rachunek zyskow i strat', 'prowizje', 'oplaty'],
  }),
  metric({
    metricKey: 'cost_income_ratio',
    label: 'C/I',
    category: METRIC_CATEGORY_BANK,
    valueType: 'percent',
    defaultUnit: '%',
    aggregation: 'point_in_time',
    description: 'Cost to Income: relacja kosztow dzialania do dochodow banku, pokazujaca efektywnosc kosztowa.',
    aliases: ['Cost to Income', 'Cost income ratio', 'CIR', 'Wskaznik kosztow do dochodow', 'Koszty do dochodow'],
    keywords: ['wybrane wskazniki finansowe', 'efektywnosc kosztowa', 'cost income'],
  }),
  metric({
    metricKey: 'cost_of_risk',
    label: 'CoR',
    category: METRIC_CATEGORY_BANK,
    valueType: 'percent_or_money',
    defaultUnit: '%',
    aggregation: 'sum',
    description: 'Cost of Risk: koszt ryzyka kredytowego, najczesciej relacja odpisow kredytowych do sredniego portfela kredytowego.',
    aliases: ['Koszt ryzyka', 'Cost of risk', 'Cost of Risk ratio', 'COR', 'Wskaznik kosztu ryzyka', 'Wynik z tytulu oczekiwanych strat kredytowych', 'Odpisy aktualizujace', 'Koszty ryzyka prawnego'],
    keywords: ['oczekiwane straty kredytowe', 'ECL', 'ryzyko prawne kredytow hipotecznych'],
  }),
  metric({
    metricKey: 'cet1',
    label: 'CET1',
    category: METRIC_CATEGORY_BANK,
    valueType: 'percent',
    defaultUnit: '%',
    aggregation: 'point_in_time',
    description: 'Common Equity Tier 1: podstawowy wspolczynnik kapitalowy oparty na najwyzszej jakosci kapitalach banku.',
    aliases: ['Common Equity Tier 1', 'Wspolczynnik CET1', 'Tier 1', 'CET 1 ratio'],
    keywords: ['adekwatnosc kapitalowa', 'zarzadzanie kapitalem', 'fundusze wlasne'],
  }),
  metric({
    metricKey: 'tcr',
    label: 'TCR',
    category: METRIC_CATEGORY_BANK,
    valueType: 'percent',
    defaultUnit: '%',
    aggregation: 'point_in_time',
    description: 'Total Capital Ratio: laczny wspolczynnik kapitalowy pokazujacy relacje funduszy wlasnych do aktywow wazonych ryzykiem.',
    aliases: ['Laczny wspolczynnik kapitalowy', 'Wspolczynnik wyplacalnosci', 'Total capital ratio', 'CAR', 'Total capital adequacy ratio'],
    keywords: ['adekwatnosc kapitalowa', 'zarzadzanie kapitalem', 'fundusze wlasne'],
  }),
  metric({
    metricKey: 'npl_ratio',
    label: 'NPL',
    category: METRIC_CATEGORY_BANK,
    valueType: 'percent',
    defaultUnit: '%',
    aggregation: 'point_in_time',
    description: 'Non-Performing Loans: udzial kredytow niepracujacych lub zagrozonych w portfelu kredytowym.',
    aliases: ['NPL ratio', 'Non-Performing Loans', 'Non performing loans', 'Udzial kredytow niepracujacych', 'Kredyty niepracujace'],
    keywords: ['jakosc portfela', 'ryzyko kredytowe', 'non-performing loans'],
  }),
  metric({
    metricKey: 'loan_deposit_ratio',
    label: 'L/D',
    category: METRIC_CATEGORY_BANK,
    valueType: 'percent',
    defaultUnit: '%',
    aggregation: 'point_in_time',
    description: 'Loan to Deposit: relacja kredytow klientow do depozytow klientow, przyblizajaca poziom finansowania akcji kredytowej depozytami.',
    aliases: ['Loan to Deposit', 'Loan deposit ratio', 'LDR', 'Wskaznik kredytow do depozytow', 'Kredyty do depozytow'],
    keywords: ['kredyty', 'depozyty', 'finansowanie'],
  }),
  metric({
    metricKey: 'eps',
    label: 'EPS',
    category: METRIC_CATEGORY_BANK,
    valueType: 'money_per_share',
    defaultUnit: 'PLN/akcje',
    aggregation: 'sum',
    description: 'Earnings per Share: zysk netto przypadajacy na jedna akcje.',
    aliases: ['Zysk na jedna akcje', 'Zysk na akcje', 'Earnings per share', 'Basic EPS', 'Diluted EPS'],
    keywords: ['akcje', 'zysk na akcje', 'earnings per share'],
  }),
  metric({
    metricKey: 'dividend_amount',
    label: 'Dywidenda',
    category: METRIC_CATEGORY_BANK,
    valueType: 'money',
    defaultUnit: 'tys. PLN',
    aggregation: 'sum',
    description: 'Laczna kwota dywidendy przeznaczona do wyplaty akcjonariuszom za dany okres lub rok.',
    aliases: ['Kwota dywidendy', 'Dywidenda wyplacona', 'Dywidenda za rok', 'Dividend amount', 'Total dividend', 'Dividend paid'],
    keywords: ['dywidenda', 'podzial zysku', 'dividend'],
  }),
  metric({
    metricKey: 'dividend_net_profit_ratio',
    label: 'Dividend/net profit',
    category: METRIC_CATEGORY_BANK,
    valueType: 'percent',
    defaultUnit: '%',
    aggregation: 'derived',
    description: 'Udzial lacznej dywidendy w zysku netto za ten sam okres lub rok; metryka powinna byc liczona z dywidendy i zysku netto.',
    aliases: ['Dividend net profit', 'Dividend to net profit', 'Dividend payout ratio', 'Payout ratio', 'Stopa wyplaty dywidendy', 'Dywidenda do zysku netto'],
    keywords: ['dywidenda', 'zysk netto', 'payout ratio'],
  }),
  metric({
    metricKey: 'customer_deposits',
    label: 'Depozyty klientow',
    category: METRIC_CATEGORY_BANK,
    valueType: 'money',
    defaultUnit: 'tys. PLN',
    aggregation: 'point_in_time',
    description: 'Zobowiazania banku wobec klientow z tytulu zdeponowanych srodkow.',
    aliases: ['Zobowiazania wobec klientow', 'Depozyty', 'Customer deposits'],
    keywords: ['sprawozdanie z sytuacji finansowej', 'zobowiazania wobec klientow'],
  }),
  metric({
    metricKey: 'customer_loans',
    label: 'Kredyty klientow',
    category: METRIC_CATEGORY_BANK,
    valueType: 'money',
    defaultUnit: 'tys. PLN',
    aggregation: 'point_in_time',
    description: 'Naleznosci banku od klientow, zwykle portfel kredytow i pozyczek netto.',
    aliases: ['Naleznosci od klientow', 'Kredyty netto', 'Customer loans'],
    keywords: ['sprawozdanie z sytuacji finansowej', 'naleznosci od klientow'],
  }),
];

export const REPORT_METRIC_CATALOG = [...COMMON_REPORT_METRICS, ...BANK_REPORT_METRICS];

export const normalizeMetricText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[łŁ]/g, (character) => (character === 'Ł' ? 'L' : 'l'))
  .toLowerCase()
  .replace(/[^a-z0-9%]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

export const findReportMetricSpec = (value, catalog = REPORT_METRIC_CATALOG) => {
  const normalized = normalizeMetricText(value);
  if (!normalized) return null;
  return catalog.find((spec) => spec.metricKey === value)
    || catalog.find((spec) => spec.aliases.some((alias) => normalizeMetricText(alias) === normalized))
    || catalog.find((spec) => spec.aliases.some((alias) => {
      const normalizedAlias = normalizeMetricText(alias);
      return normalizedAlias.length >= 5 && normalized.includes(normalizedAlias);
    }))
    || null;
};

export const isBankReportProfile = (profile = {}) => {
  const text = normalizeMetricText([profile.type, profile.name, profile.canonicalId, ...(profile.aliases || [])].join(' '));
  return text.includes('bank') || text.includes('alior') || text.includes('alr');
};

export const getReportMetricsForProfile = (profile = {}) => {
  return isBankReportProfile(profile) ? REPORT_METRIC_CATALOG : COMMON_REPORT_METRICS;
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key); 

const VALID_STRUCTURED_SUMMARY_STANCES = new Set(['pozytywny', 'mieszany', 'ostrozny', 'negatywny']);

const validateStructuredSummaryShape = (summary, errors) => {
  if (summary === undefined || summary === null) return;
  if (!isPlainObject(summary)) {
    errors.push('structuredSummary must be an object when present');
    return;
  }
  if (typeof summary.headline !== 'string' || !summary.headline.trim()) {
    errors.push('structuredSummary.headline must be a non-empty string');
  }
  if (!VALID_STRUCTURED_SUMMARY_STANCES.has(summary.stance)) {
    errors.push('structuredSummary.stance must be one of pozytywny, mieszany, ostrozny, negatywny');
  }
  if (!Array.isArray(summary.sections) || summary.sections.length === 0) {
    errors.push('structuredSummary.sections must be a non-empty array');
    return;
  }
  summary.sections.forEach((section, sectionIndex) => {
    if (!isPlainObject(section)) {
      errors.push(`structuredSummary.sections[${sectionIndex}] must be an object`);
      return;
    }
    if (typeof section.title !== 'string' || !section.title.trim()) {
      errors.push(`structuredSummary.sections[${sectionIndex}].title must be a non-empty string`);
    }
    if (!Array.isArray(section.bullets) || section.bullets.length === 0) {
      errors.push(`structuredSummary.sections[${sectionIndex}].bullets must be a non-empty array`);
      return;
    }
    section.bullets.forEach((bullet, bulletIndex) => {
      if (!isPlainObject(bullet)) {
        errors.push(`structuredSummary.sections[${sectionIndex}].bullets[${bulletIndex}] must be an object`);
        return;
      }
      if (typeof bullet.text !== 'string' || !bullet.text.trim()) {
        errors.push(`structuredSummary.sections[${sectionIndex}].bullets[${bulletIndex}].text must be a non-empty string`);
      }
      if (bullet.metricKeys !== undefined && (!Array.isArray(bullet.metricKeys) || bullet.metricKeys.some((key) => typeof key !== 'string' || !key.trim()))) {
        errors.push(`structuredSummary.sections[${sectionIndex}].bullets[${bulletIndex}].metricKeys must contain strings`);
      }
    });
  });
};

export const validateAnalysisV2Shape = (analysis, catalog = REPORT_METRIC_CATALOG) => { 
  const errors = [];
  if (!isPlainObject(analysis)) {
    return { valid: false, errors: ['analysis must be an object'] };
  }

  ['schemaVersion', 'title', 'summary', 'reportPeriod'].forEach((field) => {
    if (typeof analysis[field] !== 'string' || !analysis[field].trim()) errors.push(`${field} must be a non-empty string`);
  });
  if (analysis.schemaVersion && analysis.schemaVersion !== ANALYSIS_V2_SCHEMA_VERSION) { 
    errors.push(`schemaVersion must be ${ANALYSIS_V2_SCHEMA_VERSION}`); 
  } 
  validateStructuredSummaryShape(analysis.structuredSummary, errors);
 
  ['metricFacts', 'risks', 'conclusions', 'extractionWarnings'].forEach((field) => { 
    if (!Array.isArray(analysis[field])) errors.push(`${field} must be an array`);
  });

  const metricKeys = new Set(catalog.map((spec) => spec.metricKey));
  (Array.isArray(analysis.metricFacts) ? analysis.metricFacts : []).forEach((fact, index) => {
    if (!isPlainObject(fact)) {
      errors.push(`metricFacts[${index}] must be an object`);
      return;
    }
    ['metricKey', 'label', 'unit', 'period', 'section', 'quote'].forEach((field) => {
      if (typeof fact[field] !== 'string' || !fact[field].trim()) errors.push(`metricFacts[${index}].${field} must be a non-empty string`);
    });
    if (!hasOwn(fact, 'value')) errors.push(`metricFacts[${index}].value is required`);
    if (!hasOwn(fact, 'page')) errors.push(`metricFacts[${index}].page is required`);
    if (typeof fact.confidence !== 'number' || fact.confidence < 0 || fact.confidence > 1) {
      errors.push(`metricFacts[${index}].confidence must be a number from 0 to 1`);
    }
    if (fact.metricKey && !metricKeys.has(fact.metricKey)) errors.push(`metricFacts[${index}].metricKey is not in catalog`);
  });

  ['risks', 'conclusions'].forEach((collection) => {
    (Array.isArray(analysis[collection]) ? analysis[collection] : []).forEach((item, index) => {
      if (!isPlainObject(item)) {
        errors.push(`${collection}[${index}] must be an object`);
        return;
      }
      if (typeof item.text !== 'string' || !item.text.trim()) errors.push(`${collection}[${index}].text must be a non-empty string`);
      if (!isPlainObject(item.source)) {
        errors.push(`${collection}[${index}].source must be an object`);
        return;
      }
      ['documentId', 'section', 'evidence'].forEach((field) => {
        if (typeof item.source[field] !== 'string' || !item.source[field].trim()) {
          errors.push(`${collection}[${index}].source.${field} must be a non-empty string`);
        }
      });
      if (!hasOwn(item.source, 'page')) errors.push(`${collection}[${index}].source.page is required`);
    });
  });

  return { valid: errors.length === 0, errors };
};
