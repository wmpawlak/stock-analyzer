const METRIC_CATEGORY_COMMON = 'common';
const METRIC_CATEGORY_BANK = 'bank';

export const ANALYSIS_V2_SCHEMA_VERSION = '2.0';

export const PRIORITY_BANK_REPORT_METRIC_KEYS = [
  'net_income',
  'net_interest_income',
  'net_fee_commission_income',
  'roe',
  'roa',
  'cost_income_ratio',
  'npl_ratio',
  'cost_of_risk',
  'tcr',
  'loan_deposit_ratio',
  'eps',
  'dividend_net_profit_ratio',
];

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

const COMMON_REPORT_METRIC_BASE = [
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
  metric({
    metricKey: 'roic',
    label: 'ROIC',
    category: METRIC_CATEGORY_COMMON,
    valueType: 'percent',
    defaultUnit: '%',
    aggregation: 'point_in_time',
    description: 'Return on Invested Capital: rentownosc kapitalu zaangazowanego w dzialalnosc operacyjna.',
    aliases: ['Rentownosc zainwestowanego kapitalu', 'Return on Invested Capital'],
    keywords: ['rentownosc kapitalu', 'kapital zainwestowany', 'invested capital'],
  }),
  metric({
    metricKey: 'gross_margin',
    label: 'Marża brutto',
    category: METRIC_CATEGORY_COMMON,
    valueType: 'percent',
    defaultUnit: '%',
    aggregation: 'point_in_time',
    description: 'Marza brutto pokazujaca relacje zysku brutto ze sprzedazy do przychodow ze sprzedazy.',
    aliases: ['Marza brutto na sprzedazy', 'Gross margin', 'Gross profit margin'],
    keywords: ['rentownosc sprzedazy', 'zysk brutto ze sprzedazy'],
  }),
  metric({
    metricKey: 'operating_margin',
    label: 'Marża operacyjna',
    category: METRIC_CATEGORY_COMMON,
    valueType: 'percent',
    defaultUnit: '%',
    aggregation: 'point_in_time',
    description: 'Marza operacyjna pokazujaca udzial wyniku operacyjnego w przychodach ze sprzedazy.',
    aliases: ['Marza EBIT', 'Operating margin', 'EBIT margin'],
    keywords: ['wynik operacyjny', 'rentownosc operacyjna', 'EBIT'],
  }),
  metric({
    metricKey: 'net_margin',
    label: 'Marża netto',
    category: METRIC_CATEGORY_COMMON,
    valueType: 'percent',
    defaultUnit: '%',
    aggregation: 'point_in_time',
    description: 'Marza netto pokazujaca jaka czesc przychodow pozostaje jako wynik netto po wszystkich kosztach i podatkach.',
    aliases: ['Rentownosc netto sprzedazy', 'Net margin', 'Net profit margin'],
    keywords: ['wynik netto', 'rentownosc sprzedazy'],
  }),
  metric({
    metricKey: 'net_debt_ebitda',
    label: 'Net Debt / EBITDA',
    category: METRIC_CATEGORY_COMMON,
    valueType: 'ratio',
    defaultUnit: 'x',
    aggregation: 'point_in_time',
    description: 'Relacja dlugu netto do EBITDA, uzywana do oceny poziomu zadluzenia wzgledem wyniku operacyjnego.',
    aliases: ['Dlug netto / EBITDA', 'Dług netto do EBITDA', 'Net debt to EBITDA'],
    keywords: ['zadluzenie', 'dlug netto', 'EBITDA'],
  }),
  metric({
    metricKey: 'current_ratio',
    label: 'Current Ratio',
    category: METRIC_CATEGORY_COMMON,
    valueType: 'ratio',
    defaultUnit: 'x',
    aggregation: 'point_in_time',
    description: 'Wskaznik plynnosci biezacej porownujacy aktywa obrotowe ze zobowiazaniami krotkoterminowymi.',
    aliases: ['Wskaznik plynnosci biezacej', 'Wskaźnik płynności bieżącej', 'Current liquidity ratio'],
    keywords: ['plynnosc', 'aktywa obrotowe', 'zobowiazania krotkoterminowe'],
  }),
  metric({
    metricKey: 'quick_ratio',
    label: 'Quick Ratio',
    category: METRIC_CATEGORY_COMMON,
    valueType: 'ratio',
    defaultUnit: 'x',
    aggregation: 'point_in_time',
    description: 'Wskaznik plynnosci szybkiej mierzacy zdolnosc do pokrycia zobowiazan bez sprzedazy zapasow.',
    aliases: ['Wskaznik plynnosci szybkiej', 'Wskaźnik płynności szybkiej', 'Acid-test ratio'],
    keywords: ['plynnosc szybka', 'aktywa plynne', 'zobowiazania krotkoterminowe'],
  }),
  metric({
    metricKey: 'free_cash_flow',
    label: 'FCF',
    category: METRIC_CATEGORY_COMMON,
    valueType: 'money',
    defaultUnit: 'tys. PLN',
    aggregation: 'sum',
    description: 'Free Cash Flow: srodki pieniezne pozostajace po wydatkach operacyjnych i nakladach inwestycyjnych.',
    aliases: ['Wolne przeplywy pieniezne', 'Wolne przepływy pieniężne', 'Free Cash Flow'],
    keywords: ['przeplywy operacyjne', 'naklady inwestycyjne', 'capex'],
  }),
  metric({
    metricKey: 'dividend_per_share',
    label: 'DPS',
    category: METRIC_CATEGORY_COMMON,
    valueType: 'money_per_share',
    defaultUnit: 'PLN/akcje',
    aggregation: 'sum',
    description: 'Dividend per Share: kwota dywidendy przypadajaca na jedna akcje za wskazany okres lub rok.',
    aliases: ['Dywidenda na akcje', 'Dywidenda na akcję', 'Dividend per Share'],
    keywords: ['dywidenda', 'akcja', 'dividend per share'],
  }),
];

const BANK_REPORT_METRIC_BASE = [
  metric({
    metricKey: 'net_interest_income',
    label: 'Wynik z tytułu odsetek',
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
    label: 'Wynik z opłat i prowizji',
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
    valueType: 'percent',
    defaultUnit: '%',
    aggregation: 'point_in_time',
    description: 'Cost of Risk: procentowy wskaznik kosztu ryzyka kredytowego w relacji do portfela kredytowego. Nie jest kwota odpisow ani kosztow ryzyka prawnego.',
    aliases: ['Koszt ryzyka', 'Cost of risk', 'Cost of Risk ratio', 'COR', 'Wskaznik kosztu ryzyka'],
    keywords: ['wybrane wskazniki finansowe', 'wskaznik kosztu ryzyka', 'cost of risk ratio'],
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
  metric({
    metricKey: 'nim',
    label: 'NIM',
    category: METRIC_CATEGORY_BANK,
    valueType: 'percent',
    defaultUnit: '%',
    aggregation: 'point_in_time',
    description: 'Net Interest Margin: marza odsetkowa netto pokazujaca wynik odsetkowy wzgledem aktywow odsetkowych.',
    aliases: ['Marza odsetkowa netto', 'Marża odsetkowa netto', 'Net Interest Margin'],
    keywords: ['wynik odsetkowy', 'aktywa odsetkowe', 'rentownosc odsetkowa'],
  }),
  metric({
    metricKey: 'mrel',
    label: 'MREL',
    category: METRIC_CATEGORY_BANK,
    valueType: 'percent',
    defaultUnit: '%',
    aggregation: 'point_in_time',
    description: 'Minimum Requirement for own funds and Eligible Liabilities: wymog funduszy wlasnych i zobowiazan kwalifikowalnych.',
    aliases: ['Wymog MREL', 'Wymóg MREL', 'Minimum Requirement for own funds and Eligible Liabilities'],
    keywords: ['resolution', 'zobowiazania kwalifikowalne', 'fundusze wlasne'],
  }),
  metric({
    metricKey: 'lcr',
    label: 'LCR',
    category: METRIC_CATEGORY_BANK,
    valueType: 'percent',
    defaultUnit: '%',
    aggregation: 'point_in_time',
    description: 'Liquidity Coverage Ratio: wskaznik pokrycia plynnosci mierzacy bufor aktywow plynnych banku.',
    aliases: ['Wskaznik pokrycia plynnosci', 'Wskaźnik pokrycia płynności', 'Liquidity Coverage Ratio'],
    keywords: ['plynnosc', 'aktywa plynne', 'bufor plynnosciowy'],
  }),
];

const METRIC_NAMES = {
  net_income: { shortName: 'Zysk netto', namePl: 'Zysk netto', nameEn: 'Net Income' },
  total_assets: { shortName: 'Aktywa', namePl: 'Aktywa ogółem', nameEn: 'Total Assets' },
  total_liabilities: { shortName: 'Zobowiązania', namePl: 'Zobowiązania ogółem', nameEn: 'Total Liabilities' },
  equity: { shortName: 'Kapitał własny', namePl: 'Kapitał własny', nameEn: 'Equity' },
  cash_flow_total: { shortName: 'Cash flow netto', namePl: 'Przepływy pieniężne razem', nameEn: 'Net Cash Flow' },
  roe: { shortName: 'ROE', namePl: 'Rentowność kapitału własnego', nameEn: 'Return on Equity' },
  roa: { shortName: 'ROA', namePl: 'Rentowność aktywów', nameEn: 'Return on Assets' },
  roic: { shortName: 'ROIC', namePl: 'Rentowność zainwestowanego kapitału', nameEn: 'Return on Invested Capital' },
  gross_margin: { shortName: 'Marża brutto', namePl: 'Marża brutto', nameEn: 'Gross Margin' },
  operating_margin: { shortName: 'Marża operacyjna', namePl: 'Marża operacyjna', nameEn: 'Operating Margin' },
  net_margin: { shortName: 'Marża netto', namePl: 'Marża netto', nameEn: 'Net Margin' },
  net_debt_ebitda: { shortName: 'Net Debt / EBITDA', namePl: 'Dług netto / EBITDA', nameEn: 'Net Debt / EBITDA' },
  current_ratio: { shortName: 'Current Ratio', namePl: 'Wskaźnik płynności bieżącej', nameEn: 'Current Ratio' },
  quick_ratio: { shortName: 'Quick Ratio', namePl: 'Wskaźnik płynności szybkiej', nameEn: 'Quick Ratio' },
  free_cash_flow: { shortName: 'FCF', namePl: 'Wolne przepływy pieniężne', nameEn: 'Free Cash Flow' },
  dividend_per_share: { shortName: 'DPS', namePl: 'Dywidenda na akcję', nameEn: 'Dividend per Share' },
  net_interest_income: { shortName: 'Wynik odsetkowy', namePl: 'Wynik z tytułu odsetek', nameEn: 'Net Interest Income' },
  net_fee_commission_income: { shortName: 'Wynik prowizyjny', namePl: 'Wynik z opłat i prowizji', nameEn: 'Net Fee and Commission Income' },
  cost_income_ratio: { shortName: 'C/I', namePl: 'Wskaźnik kosztów do dochodów', nameEn: 'Cost to Income Ratio' },
  cost_of_risk: { shortName: 'CoR', namePl: 'Koszt ryzyka', nameEn: 'Cost of Risk' },
  cet1: { shortName: 'CET1', namePl: 'Współczynnik CET1', nameEn: 'Common Equity Tier 1 Ratio' },
  tcr: { shortName: 'TCR', namePl: 'Łączny współczynnik kapitałowy', nameEn: 'Total Capital Ratio' },
  npl_ratio: { shortName: 'NPL', namePl: 'Wskaźnik kredytów niepracujących', nameEn: 'Non-Performing Loans Ratio' },
  loan_deposit_ratio: { shortName: 'L/D', namePl: 'Wskaźnik kredytów do depozytów', nameEn: 'Loan to Deposit Ratio' },
  eps: { shortName: 'EPS', namePl: 'Zysk na akcję', nameEn: 'Earnings per Share' },
  dividend_amount: { shortName: 'Dywidenda', namePl: 'Kwota dywidendy', nameEn: 'Dividend Amount' },
  dividend_net_profit_ratio: { shortName: 'Payout Ratio', namePl: 'Dywidenda / zysk netto', nameEn: 'Dividend Payout Ratio' },
  customer_deposits: { shortName: 'Depozyty klientów', namePl: 'Depozyty klientów', nameEn: 'Customer Deposits' },
  customer_loans: { shortName: 'Kredyty klientów', namePl: 'Kredyty klientów', nameEn: 'Customer Loans' },
  nim: { shortName: 'NIM', namePl: 'Marża odsetkowa netto', nameEn: 'Net Interest Margin' },
  mrel: { shortName: 'MREL', namePl: 'Wymóg MREL', nameEn: 'Minimum Requirement for own funds and Eligible Liabilities' },
  lcr: { shortName: 'LCR', namePl: 'Wskaźnik pokrycia płynności', nameEn: 'Liquidity Coverage Ratio' },
};

const METRIC_COPY_OVERRIDES = {
  net_income: {
    description: 'Wynik finansowy po podatku za dany okres, pokazujący ile zysku zostaje dla akcjonariuszy.',
    aliases: ['Zysk netto', 'Strata netto', 'Wynik netto', 'Zysk netto przypadający akcjonariuszom', 'Net profit', 'Net income', 'Profit for the period', 'Net profit attributable to shareholders'],
    keywords: ['rachunek zysków i strat', 'wynik finansowy', 'net profit'],
  },
  total_assets: {
    label: 'Aktywa ogółem',
    description: 'Suma majątku kontrolowanego przez spółkę lub bank na koniec okresu.',
    aliases: ['Aktywa ogółem', 'Aktywa razem', 'Suma aktywów', 'Total assets'],
  },
  total_liabilities: {
    label: 'Zobowiązania ogółem',
    description: 'Suma zobowiązań jednostki wobec finansujących, klientów, dostawców i innych stron.',
    aliases: ['Zobowiązania ogółem', 'Zobowiązania razem', 'Suma zobowiązań', 'Total liabilities'],
  },
  equity: {
    label: 'Kapitał własny',
    description: 'Wartość kapitału przypadająca właścicielom po odjęciu zobowiązań od aktywów.',
    aliases: ['Kapitał własny', 'Kapitał własny razem', 'Equity', 'Total equity', 'Shareholders equity'],
    keywords: ['sprawozdanie z sytuacji finansowej', 'kapitał'],
  },
  cash_flow_total: {
    label: 'Przepływy pieniężne razem',
    description: 'Łączna zmiana stanu środków pieniężnych wynikająca z przepływów operacyjnych, inwestycyjnych i finansowych.',
    aliases: ['Przepływy pieniężne razem', 'Przepływy pieniężne netto', 'Zmiana stanu środków pieniężnych', 'Cash flow razem', 'Net cash flow'],
    keywords: ['sprawozdanie z przepływów pieniężnych', 'cash flow'],
  },
  roe: {
    description: 'Return on Equity: rentowność kapitału własnego, czyli relacja zysku netto do kapitałów własnych.',
    aliases: ['ROE', 'Rentowność kapitału własnego', 'Return on equity', 'ROE ratio'],
    keywords: ['wybrane wskaźniki finansowe', 'rentowność'],
  },
  roa: {
    description: 'Return on Assets: rentowność aktywów, czyli relacja zysku netto do aktywów.',
    aliases: ['ROA', 'Rentowność aktywów', 'Return on assets', 'ROA ratio'],
    keywords: ['wybrane wskaźniki finansowe', 'rentowność'],
  },
  net_interest_income: {
    label: 'Wynik z tytułu odsetek',
    description: 'Net interest income: różnica między przychodami odsetkowymi a kosztami odsetkowymi banku.',
    aliases: ['Wynik z tytułu odsetek', 'Wynik odsetkowy', 'Dochody odsetkowe netto', 'Przychody odsetkowe netto', 'Net interest income', 'Interest income net'],
    keywords: ['rachunek zysków i strat', 'odsetki'],
  },
  net_fee_commission_income: {
    label: 'Wynik z opłat i prowizji',
    description: 'Net fee and commission income: wynik netto na opłatach i prowizjach pobieranych za usługi bankowe.',
    aliases: ['Wynik z opłat i prowizji', 'Wynik prowizyjny', 'Wynik z tytułu prowizji i opłat', 'Wynik z tytułu opłat i prowizji', 'Net fee and commission income', 'Fee and commission income net'],
    keywords: ['rachunek zysków i strat', 'prowizje', 'opłaty'],
  },
  cost_income_ratio: {
    description: 'Cost to Income: relacja kosztów działania do dochodów banku, pokazująca efektywność kosztową.',
    aliases: ['C/I', 'Cost to Income', 'Cost income ratio', 'CIR', 'Wskaźnik kosztów do dochodów', 'Koszty do dochodów'],
    keywords: ['wybrane wskaźniki finansowe', 'efektywność kosztowa', 'cost income'],
  },
  cost_of_risk: {
    description: 'Cost of Risk: procentowy wskaźnik kosztu ryzyka kredytowego w relacji do portfela kredytowego. Nie jest kwotą odpisów ani kosztów ryzyka prawnego.',
    aliases: ['CoR', 'Koszt ryzyka', 'Cost of risk', 'Cost of Risk ratio', 'COR', 'Wskaźnik kosztu ryzyka'],
    keywords: ['wybrane wskaźniki finansowe', 'wskaźnik kosztu ryzyka', 'cost of risk ratio'],
  },
  cet1: {
    description: 'Common Equity Tier 1: podstawowy współczynnik kapitałowy oparty na najwyższej jakości kapitałach banku.',
    aliases: ['CET1', 'Common Equity Tier 1', 'Współczynnik CET1', 'Tier 1', 'CET 1 ratio'],
    keywords: ['adekwatność kapitałowa', 'zarządzanie kapitałem', 'fundusze własne'],
  },
  tcr: {
    description: 'Total Capital Ratio: łączny współczynnik kapitałowy pokazujący relację funduszy własnych do aktywów ważonych ryzykiem.',
    aliases: ['TCR', 'Łączny współczynnik kapitałowy', 'Współczynnik wypłacalności', 'Total capital ratio', 'CAR', 'Total capital adequacy ratio'],
    keywords: ['adekwatność kapitałowa', 'zarządzanie kapitałem', 'fundusze własne'],
  },
  npl_ratio: {
    description: 'Non-Performing Loans: udział kredytów niepracujących lub zagrożonych w portfelu kredytowym.',
    aliases: ['NPL', 'NPL ratio', 'Non-Performing Loans', 'Non performing loans', 'Udział kredytów niepracujących', 'Kredyty niepracujące'],
    keywords: ['jakość portfela', 'ryzyko kredytowe', 'non-performing loans'],
  },
  loan_deposit_ratio: {
    description: 'Loan to Deposit: relacja kredytów klientów do depozytów klientów, przybliżająca poziom finansowania akcji kredytowej depozytami.',
    aliases: ['L/D', 'Loan to Deposit', 'Loan deposit ratio', 'LDR', 'Wskaźnik kredytów do depozytów', 'Kredyty do depozytów'],
  },
  eps: {
    defaultUnit: 'PLN/akcję',
    description: 'Earnings per Share: zysk netto przypadający na jedną akcję.',
    aliases: ['EPS', 'Zysk na jedną akcję', 'Zysk na akcję', 'Earnings per share', 'Basic EPS', 'Diluted EPS'],
  },
  dividend_amount: {
    description: 'Łączna kwota dywidendy przeznaczona do wypłaty akcjonariuszom za dany okres lub rok.',
    aliases: ['Dywidenda', 'Kwota dywidendy', 'Dywidenda wypłacona', 'Dywidenda za rok', 'Dividend amount', 'Total dividend', 'Dividend paid'],
    keywords: ['dywidenda', 'podział zysku', 'dividend'],
  },
  dividend_net_profit_ratio: {
    description: 'Udział łącznej dywidendy w zysku netto za ten sam okres lub rok; metryka powinna być liczona z dywidendy i zysku netto.',
    aliases: ['Dividend/net profit', 'Dividend net profit', 'Dividend to net profit', 'Dividend payout ratio', 'Payout ratio', 'Stopa wypłaty dywidendy', 'Dywidenda do zysku netto'],
  },
  customer_deposits: {
    label: 'Depozyty klientów',
    description: 'Zobowiązania banku wobec klientów z tytułu zdeponowanych środków.',
    aliases: ['Depozyty klientów', 'Zobowiązania wobec klientów', 'Depozyty', 'Customer deposits'],
    keywords: ['sprawozdanie z sytuacji finansowej', 'zobowiązania wobec klientów'],
  },
  customer_loans: {
    label: 'Kredyty klientów',
    description: 'Należności banku od klientów, zwykle portfel kredytów i pożyczek netto.',
    aliases: ['Kredyty klientów', 'Należności od klientów', 'Kredyty netto', 'Customer loans'],
    keywords: ['sprawozdanie z sytuacji finansowej', 'należności od klientów'],
  },
};

const applyMetricCopyOverrides = (spec) => ({
  ...spec,
  ...(METRIC_COPY_OVERRIDES[spec.metricKey] || {}),
});

const applyMetricMetadata = (spec) => {
  const names = METRIC_NAMES[spec.metricKey];
  const tier = PRIORITY_BANK_REPORT_METRIC_KEYS.includes(spec.metricKey) ? 'primary' : 'secondary';
  return {
    ...spec,
    ...names,
    tier,
    aliases: [...new Set([names.shortName, names.namePl, names.nameEn, ...spec.aliases].filter(Boolean))],
  };
};

const buildMetricSpec = (spec) => applyMetricMetadata(applyMetricCopyOverrides(spec));
const metricTierOrder = (spec) => (
  spec.tier === 'primary'
    ? PRIORITY_BANK_REPORT_METRIC_KEYS.indexOf(spec.metricKey)
    : PRIORITY_BANK_REPORT_METRIC_KEYS.length
);
const sortMetricSpecs = (left, right) => metricTierOrder(left) - metricTierOrder(right);

export const COMMON_REPORT_METRICS = COMMON_REPORT_METRIC_BASE.map(buildMetricSpec).sort(sortMetricSpecs);
export const BANK_REPORT_METRICS = BANK_REPORT_METRIC_BASE.map(buildMetricSpec).sort(sortMetricSpecs);
export const REPORT_METRIC_CATALOG = [...COMMON_REPORT_METRICS, ...BANK_REPORT_METRICS].sort(sortMetricSpecs);

export const PRIORITY_BANK_REPORT_METRICS = PRIORITY_BANK_REPORT_METRIC_KEYS
  .map((key) => REPORT_METRIC_CATALOG.find((metricSpec) => metricSpec.metricKey === key))
  .filter(Boolean);

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
  return isBankReportProfile(profile)
    ? REPORT_METRIC_CATALOG
    : REPORT_METRIC_CATALOG.filter((metricSpec) => metricSpec.category === METRIC_CATEGORY_COMMON);
};

export const metricUnitMatchesValueType = (unit, valueType) => {
  const normalized = String(unit || '').trim().toLowerCase();
  const isPercent = /%|procent|proc\.?|\bbps?\b|p\.?p\.?/.test(normalized);
  const isMoney = /\b(?:pln|eur|usd|gbp|chf|czk|sek|nok|dkk|jpy|cny|hkd|cad|aud)\b|[€$£¥]/i.test(normalized);
  const isPerShare = /akcj|share/.test(normalized);
  if (valueType === 'percent') return isPercent && !isMoney;
  if (valueType === 'money') return isMoney && !isPercent && !isPerShare;
  if (valueType === 'money_per_share') return isMoney && isPerShare && !isPercent;
  if (valueType === 'ratio') return !isMoney && !isPercent && /(?:^|\s)x(?:$|\s)|razy|ratio/.test(normalized);
  return true;
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
