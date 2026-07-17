import assert from 'node:assert/strict';
import test from 'node:test';
import { csvToObjects, parseCsv } from '../src/utils/csv.js';
import {
  getAssetCategoryHistoryFromLiveData,
  getLiveAssetsFromLiveData,
  getNetWorthHistoryFromLiveData,
  getPortfolioHistoryFromLiveData,
  mergeLiveDataWithFallback,
} from '../src/utils/liveData.js';
import { normalizeText, parseNumericValue } from '../src/utils/number.js';
import {
  getPositionMetrics,
  mapAlphaVantageOverview,
  resolveInstrument,
} from '../src/utils/investmentDetails.js';
import {
  filterReportMetricFactsForPeriod,
  formatReportMetricValue,
  getReportMetricDefinition,
  sortReportMetricFacts,
} from '../src/utils/reportMetricDefinitions.js';
import {
  formatCompactAxisValue,
  formatPercentValue,
  getAdaptiveDateTicks,
  getRoundedAxisTicks,
  parseChartDate,
} from '../src/components/portfolio/chartConfig.js';

test('parseNumericValue handles Polish and US number formats', () => {
  assert.equal(parseNumericValue('17 600,60 z\u0142'), 17600.6);
  assert.equal(parseNumericValue('1.234,56'), 1234.56);
  assert.equal(parseNumericValue('1,234.56'), 1234.56);
  assert.equal(parseNumericValue('-2 000,00 z\u0142'), -2000);
});

test('normalizeText removes accents and punctuation for alias matching', () => {
  assert.equal(normalizeText('Warto\u015b\u0107 PLN'), 'wartoscpln');
  assert.equal(normalizeText('Podsumowanie aktyw\u00f3w'), 'podsumowanieaktywow');
  assert.equal(normalizeText(String.raw`Warto\u015b\u0107 netto`), 'wartoscnetto');
  assert.equal(normalizeText('Warto\u0139\u203a\u00c4\u2021 netto'), 'wartoscnetto');
});

test('resolveInstrument extracts display label and Alpha Vantage symbol', () => {
  const row = {
    'Akcje i inne instrumenty': 'NASDAQ:AAPL Apple Inc',
    'Alpha Vantage Symbol': 'AAPL',
  };

  assert.deepEqual(resolveInstrument(row), {
    label: 'Apple Inc',
    quote: 'NASDAQ:AAPL',
    symbol: 'AAPL',
    url: 'https://www.google.com/finance/beta/quote/NASDAQ:AAPL',
  });
});

test('report metric definitions expose catalog tooltip copy for keys and aliases', () => {
  const costToIncome = getReportMetricDefinition('cost_income_ratio');
  assert.equal(costToIncome.label, 'C/I');
  assert.match(costToIncome.description, /Cost to Income/);

  const loanDeposit = getReportMetricDefinition('Loan to Deposit');
  assert.equal(loanDeposit.metricKey, 'loan_deposit_ratio');
  assert.match(loanDeposit.description, /depozytów/);
});

test('report metric view logic filters comparison periods and orders primary before secondary', () => {
  const facts = [
    { metricKey: 'free_cash_flow', label: 'FCF', value: 12.5, unit: 'mln EUR', period: '31.03.2025' },
    { metricKey: 'roe', label: 'ROE', value: 14, unit: '%', period: 'Q1 2024' },
    { metricKey: 'net_income', label: 'Zysk netto', value: 30, unit: 'mln EUR', period: 'Q1 2025' },
  ];

  const visible = sortReportMetricFacts(filterReportMetricFactsForPeriod(facts, 'Q1 2025'));
  assert.deepEqual(visible.map((fact) => fact.metricKey), ['net_income', 'free_cash_flow']);
  assert.deepEqual(visible.map((fact) => fact.period), ['Q1 2025', 'Q1 2025']);
  assert.equal(getReportMetricDefinition('net_income').tier, 'primary');
  assert.equal(getReportMetricDefinition('free_cash_flow').tier, 'secondary');
});

test('report metric values preserve the unit and currency found in the report', () => {
  assert.equal(formatReportMetricValue({ value: 12.5, unit: 'mln EUR' }), '12,5 mln EUR');
  assert.equal(formatReportMetricValue({ value: 1.2, unit: 'EUR/akcję' }), '1,2 EUR/akcję');
  assert.equal(formatReportMetricValue({ value: null, unit: 'USD' }), '—');
});

test('getPositionMetrics calculates portfolio and result metrics', () => {
  const row = {
    'Akcje i inne instrumenty': 'NYSE:IBM IBM',
    'Ilo\u015b\u0107': '10',
    'Kurs kupna': '100,00',
    'Koszt ca\u0142kowity': '1 000,00',
    'Aktualny kurs': '120,00',
    'Cena sprzeda\u017cy brutto': '1 200,00',
    'Zysk/Strata': '200,00',
    'Dywidenda netto': '50,00',
    'Zysk/Strata %': '20,00%',
  };
  const portfolioRows = [
    row,
    { 'Cena sprzeda\u017cy brutto': '800,00' },
  ];

  assert.deepEqual(getPositionMetrics(row, portfolioRows), {
    quantity: 10,
    buyPrice: 100,
    totalCost: 1000,
    currentPrice: 120,
    marketValue: 1200,
    profitLoss: 200,
    profitPercent: 20,
    dividendNet: 50,
    netProfit: null,
    totalResult: 250,
    portfolioShare: 60,
    breakEvenPrice: 95,
    positionAgeDays: null,
    purchaseDate: '',
  });
});

test('mapAlphaVantageOverview normalizes company overview fields', () => {
  assert.deepEqual(mapAlphaVantageOverview({
    Symbol: 'IBM',
    Name: 'International Business Machines',
    Description: 'A company description.',
    Sector: 'Technology',
    Industry: 'Information Technology Services',
    MarketCapitalization: '200000000000',
    PERatio: '22.5',
    EPS: '8.11',
    DividendYield: '0.031',
    Beta: '0.7',
    '52WeekHigh': '220.00',
    '52WeekLow': '150.00',
    PriceToBookRatio: '7.2',
    PriceToSalesRatioTTM: '3.1',
    ProfitMargin: '0.14',
    ReturnOnEquityTTM: '0.31',
    PayoutRatio: '0.62',
  }), {
    symbol: 'IBM',
    name: 'International Business Machines',
    description: 'A company description.',
    sector: 'Technology',
    industry: 'Information Technology Services',
    marketCapitalization: '200000000000',
    peRatio: '22.5',
    eps: '8.11',
    dividendYield: '0.031',
    beta: '0.7',
    fiftyTwoWeekHigh: '220.00',
    fiftyTwoWeekLow: '150.00',
    priceToBook: '7.2',
    priceToSales: '3.1',
    profitMargin: '0.14',
    roe: '0.31',
    payoutRatio: '0.62',
  });
});

test('parseCsv handles quoted commas, escaped quotes and multiline cells', () => {
  const csv = 'Name,Value,Note\n"ACME, Inc.","1 234,56","said ""hello"""\nCash,100,"line one\nline two"';

  assert.deepEqual(parseCsv(csv), [
    ['Name', 'Value', 'Note'],
    ['ACME, Inc.', '1 234,56', 'said "hello"'],
    ['Cash', '100', 'line one\nline two'],
  ]);
});

test('csvToObjects makes duplicate and empty headers safe', () => {
  const csv = 'Name,,Name\nCash,100,PLN\nStocks,200,USD';

  assert.deepEqual(csvToObjects(csv), [
    { Name: 'Cash', Kolumna_2: '100', Name_2: 'PLN' },
    { Name: 'Stocks', Kolumna_2: '200', Name_2: 'USD' },
  ]);
});

test('parseChartDate handles common chart date formats', () => {
  const dateInput = new Date(2024, 0, 2);
  const timestampInput = new Date(2024, 2, 3).getTime();
  const isoDate = parseChartDate('2024-01-02');
  const polishDate = parseChartDate('15.02.2024');
  const polishMonth = parseChartDate('03.2024');

  assert.equal(parseChartDate(dateInput), dateInput);
  assert.equal(parseChartDate(timestampInput).getTime(), timestampInput);
  assert.equal(isoDate.getFullYear(), 2024);
  assert.equal(isoDate.getMonth(), 0);
  assert.equal(isoDate.getDate(), 2);
  assert.equal(polishDate.getFullYear(), 2024);
  assert.equal(polishDate.getMonth(), 1);
  assert.equal(polishDate.getDate(), 15);
  assert.equal(polishMonth.getFullYear(), 2024);
  assert.equal(polishMonth.getMonth(), 2);
  assert.equal(polishMonth.getDate(), 1);
});

test('getAdaptiveDateTicks keeps first and last tick without duplicates', () => {
  const makeData = (count) => Array.from({ length: count }, (_, xIndex) => ({ xIndex }));

  assert.deepEqual(getAdaptiveDateTicks(makeData(0)), []);
  assert.deepEqual(getAdaptiveDateTicks(makeData(1)), [0]);
  assert.deepEqual(getAdaptiveDateTicks(makeData(2)), [0, 1]);
  assert.deepEqual(getAdaptiveDateTicks(makeData(5)), [0, 1, 2, 3, 4]);
  assert.deepEqual(getAdaptiveDateTicks(makeData(12)), [0, 2, 4, 7, 9, 11]);
  assert.deepEqual(getAdaptiveDateTicks(makeData(60)), [0, 12, 24, 35, 47, 59]);
});

test('chart axis formatters use compact PLN and percent labels', () => {
  assert.equal(formatCompactAxisValue(999), 999);
  assert.equal(formatCompactAxisValue(1_000), '1k');
  assert.equal(formatCompactAxisValue(1_250_000), '1.3M');
  assert.equal(formatCompactAxisValue(-12_000), '-12k');
  assert.equal(formatPercentValue(4.25), '4.3%');
  assert.equal(formatPercentValue(10), '10%');
});

test('getRoundedAxisTicks rounds positive and negative domains', () => {
  assert.deepEqual(getRoundedAxisTicks([51_000, 120_000]), {
    min: 0,
    max: 150_000,
    ticks: [0, 50_000, 100_000, 150_000],
  });

  assert.deepEqual(getRoundedAxisTicks([-12_000, 81_000], { step: 10_000 }), {
    min: -20_000,
    max: 90_000,
    ticks: [-20_000, -10_000, 0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000],
  });
});

test('getLiveAssetsFromLiveData extracts portfolio summary assets', () => {
  const liveData = {
    'Podsumowanie aktyw\u00f3w': [
      { Kategoria: 'Got\u00f3wka', 'Warto\u015b\u0107 PLN': '1 500,50 z\u0142' },
      { Kategoria: 'Akcje', 'Warto\u015b\u0107 PLN': '2.000,00 z\u0142' },
      { Kategoria: '', 'Warto\u015b\u0107 PLN': '100 z\u0142' },
    ],
  };

  assert.deepEqual(getLiveAssetsFromLiveData(liveData), [
    { id: 'live-0-Got\u00f3wka', label: 'Got\u00f3wka', value: 1500.5 },
    { id: 'live-1-Akcje', label: 'Akcje', value: 2000 },
  ]);
});

test('mergeLiveDataWithFallback uses live rows before dummy rows for the same range', () => {
  const liveData = {
    'Podsumowanie aktyw\u00f3w': [{ Kategoria: 'Live', 'Warto\u015b\u0107 PLN': '200' }],
  };
  const dummyData = {
    'Podsumowanie aktyw\u00f3w': [{ Kategoria: 'Dummy', 'Warto\u015b\u0107 PLN': '100' }],
  };

  assert.deepEqual(mergeLiveDataWithFallback(liveData, dummyData), liveData);
});

test('mergeLiveDataWithFallback fills missing live ranges with dummy ranges', () => {
  const liveData = {
    'Podsumowanie aktyw\u00f3w': [{ Kategoria: 'Live', 'Warto\u015b\u0107 PLN': '200' }],
  };
  const dummyData = {
    'Historia wyceny portfela': [{ Data: '2024-01-01', 'Warto\u015b\u0107': '100' }],
  };

  assert.deepEqual(mergeLiveDataWithFallback(liveData, dummyData), {
    ...dummyData,
    ...liveData,
  });
});

test('mergeLiveDataWithFallback keeps dummy when matching live range has no rows', () => {
  const liveData = {
    'Podsumowanie aktyw\u00f3w': [],
  };
  const dummyData = {
    'Podsumowanie aktyw\u00f3w': [{ Kategoria: 'Dummy', 'Warto\u015b\u0107 PLN': '100' }],
  };

  assert.deepEqual(mergeLiveDataWithFallback(liveData, dummyData), dummyData);
});

test('mergeLiveDataWithFallback matches range names after normalization', () => {
  const liveData = {
    'Podsumowanie_aktywow': [{ Kategoria: 'Live', 'Warto\u015b\u0107 PLN': '200' }],
  };
  const dummyData = {
    'Podsumowanie aktyw\u00f3w': [{ Kategoria: 'Dummy', 'Warto\u015b\u0107 PLN': '100' }],
  };

  assert.deepEqual(mergeLiveDataWithFallback(liveData, dummyData), liveData);
});

test('getAssetCategoryHistoryFromLiveData extracts stacked category history', () => {
  const liveData = {
    'Historia kategorii aktyw\u00f3w': [
      { Data: '2024-02-01', Got\u00f3wka: '1 000,00 z\u0142', Akcje: '2 500,50 z\u0142' },
      { Data: '2024-01-01', Got\u00f3wka: '900,00 z\u0142', Akcje: '2 000,00 z\u0142', Obligacje: '300,00 z\u0142' },
      { Data: '', Got\u00f3wka: '123,00 z\u0142' },
    ],
  };

  assert.deepEqual(getAssetCategoryHistoryFromLiveData(liveData), {
    categories: ['Got\u00f3wka', 'Akcje', 'Obligacje'],
    data: [
      { date: '2024-01-01', Got\u00f3wka: 900, Akcje: 2000, Obligacje: 300 },
      { date: '2024-02-01', Got\u00f3wka: 1000, Akcje: 2500.5, Obligacje: 0 },
    ],
  });
});

test('getAssetCategoryHistoryFromLiveData sorts Polish month-year dates', () => {
  const liveData = {
    'Historia kategorii aktyw\u00f3w': [
      { Data: '02.2024', Got\u00f3wka: '2 000,00 z\u0142' },
      { Data: '12.2023', Got\u00f3wka: '1 000,00 z\u0142' },
      { Data: '01.2024', Got\u00f3wka: '1 500,00 z\u0142' },
    ],
  };

  assert.deepEqual(getAssetCategoryHistoryFromLiveData(liveData), {
    categories: ['Got\u00f3wka'],
    data: [
      { date: '12.2023', Got\u00f3wka: 1000 },
      { date: '01.2024', Got\u00f3wka: 1500 },
      { date: '02.2024', Got\u00f3wka: 2000 },
    ],
  });
});

test('getPortfolioHistoryFromLiveData extracts and sorts portfolio valuation history', () => {
  const liveData = {
    'Historia wyceny portfela': [
      {
        Data: '2024-03-01',
        'Warto\u015b\u0107': '123 456,78 z\u0142',
        'Wp\u0142acone \u0142\u0105cz.': '120 000,00 z\u0142',
        'R\u00f3\u017cnica': '3 456,78 z\u0142',
      },
      {
        Data: '2024-01-01',
        'Warto\u015b\u0107': '100 000,00 z\u0142',
        'Wp\u0142acone \u0142\u0105cz.': '101 000,00 z\u0142',
        'R\u00f3\u017cnica': '-1 000,00 z\u0142',
      },
      {
        Data: '',
        'Warto\u015b\u0107': '999 999,99 z\u0142',
        'Wp\u0142acone \u0142\u0105cz.': '999 999,99 z\u0142',
        'R\u00f3\u017cnica': '0,00 z\u0142',
      },
      {
        Data: '2024-04-01',
        'Warto\u015b\u0107': '',
        'Wp\u0142acone \u0142\u0105cz.': '',
        'R\u00f3\u017cnica': '',
      },
      {
        Data: '2024-02-01',
        'Warto\u015b\u0107': '111,234.56',
        'Wp\u0142acone \u0142\u0105cz.': '110 000,00 z\u0142',
        'R\u00f3\u017cnica': 'niepoprawne',
      },
    ],
  };

  const result = getPortfolioHistoryFromLiveData(liveData);

  assert.equal(result.found, true);
  assert.deepEqual(result.data, [
    { date: '2024-01-01', wartosc: 100000, wplacone: 101000, roznica: -1000 },
    { date: '2024-02-01', wartosc: 111234.56, wplacone: 110000, roznica: 0 },
    { date: '2024-03-01', wartosc: 123456.78, wplacone: 120000, roznica: 3456.78 },
  ]);
});

test('getPortfolioHistoryFromLiveData matches normalized range and escaped columns', () => {
  const liveData = {
    'Historia_wyceny portfela': [
      {
        Data: '02.2024',
        [String.raw`Warto\u015b\u0107`]: '21 500,00 z\u0142',
        [String.raw`Wp\u0142acone \u0142\u0105cz.`]: '20 000,00 z\u0142',
        [String.raw`R\u00f3\u017cnica`]: '1 500,00 z\u0142',
      },
      {
        Data: '01.2024',
        [String.raw`Warto\u015b\u0107`]: '20 000,00 z\u0142',
        [String.raw`Wp\u0142acone \u0142\u0105cz.`]: '20 000,00 z\u0142',
        [String.raw`R\u00f3\u017cnica`]: '0,00 z\u0142',
      },
    ],
  };

  const result = getPortfolioHistoryFromLiveData(liveData);

  assert.equal(result.found, true);
  assert.deepEqual(result.data, [
    { date: '01.2024', wartosc: 20000, wplacone: 20000, roznica: 0 },
    { date: '02.2024', wartosc: 21500, wplacone: 20000, roznica: 1500 },
  ]);
});

test('getNetWorthHistoryFromLiveData extracts and sorts net worth history', () => {
  const liveData = {
    'Warto\u015b\u0107 netto': [
      { Data: '2024-03-01', 'Warto\u015b\u0107 netto': '123 456,78 z\u0142', Wzrost: '' },
      { Data: '2024-01-01', 'Warto\u015b\u0107 netto': '100 000,00 z\u0142', Wzrost: '1 234,50 z\u0142' },
      { Data: '', 'Warto\u015b\u0107 netto': '999 999,99 z\u0142', Wzrost: '500,00 z\u0142' },
      { Data: '2024-02-01', 'Warto\u015b\u0107 netto': '111,234.56', Wzrost: 'niepoprawne' },
    ],
  };

  const result = getNetWorthHistoryFromLiveData(liveData);

  assert.equal(result.found, true);
  assert.deepEqual(result.data, [
    { date: '2024-01-01', value: 100000, growth: 1234.5 },
    { date: '2024-02-01', value: 111234.56, growth: 0 },
    { date: '2024-03-01', value: 123456.78, growth: 0 },
  ]);
});

test('getNetWorthHistoryFromLiveData sorts Polish month-year dates', () => {
  const liveData = {
    'Warto\u015b\u0107 netto': [
      { Data: '02.2024', 'Warto\u015b\u0107 netto': '21 500,00 z\u0142', Wzrost: '1 500,00 z\u0142' },
      { Data: '01.2024', 'Warto\u015b\u0107 netto': '20 000,00 z\u0142', Wzrost: '0,00 z\u0142' },
    ],
  };

  const result = getNetWorthHistoryFromLiveData(liveData);

  assert.equal(result.found, true);
  assert.deepEqual(result.data, [
    { date: '01.2024', value: 20000, growth: 0 },
    { date: '02.2024', value: 21500, growth: 1500 },
  ]);
});

test('getNetWorthHistoryFromLiveData matches escaped net worth range names', () => {
  const liveData = {
    [String.raw`Warto\u015b\u0107 netto`]: [
      { Data: '2024-01-01', [String.raw`Warto\u015b\u0107 netto`]: '20 000,00 z\u0142', Wzrost: '0,00 z\u0142' },
    ],
  };

  const result = getNetWorthHistoryFromLiveData(liveData);

  assert.equal(result.found, true);
  assert.deepEqual(result.data, [
    { date: '2024-01-01', value: 20000, growth: 0 },
  ]);
});

test('getNetWorthHistoryFromLiveData falls back to first date-like column and numeric value', () => {
  const liveData = {
    'Warto\u015b\u0107 netto': [
      { Okres: '02.2024', Netto: '21 500,00 z\u0142', Przyrost: '1 500,00 z\u0142' },
      { Okres: '01.2024', Netto: '20 000,00 z\u0142', Przyrost: '0,00 z\u0142' },
    ],
  };

  const result = getNetWorthHistoryFromLiveData(liveData);

  assert.equal(result.found, true);
  assert.deepEqual(result.data, [
    { date: '01.2024', value: 20000, growth: 0 },
    { date: '02.2024', value: 21500, growth: 1500 },
  ]);
});
