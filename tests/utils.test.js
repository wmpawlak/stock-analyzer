import assert from 'node:assert/strict';
import test from 'node:test';
import { csvToObjects, parseCsv } from '../src/utils/csv.js';
import { getLiveAssetsFromLiveData } from '../src/utils/liveData.js';
import { normalizeText, parseNumericValue } from '../src/utils/number.js';

test('parseNumericValue handles Polish and US number formats', () => {
  assert.equal(parseNumericValue('17 600,60 zł'), 17600.6);
  assert.equal(parseNumericValue('1.234,56'), 1234.56);
  assert.equal(parseNumericValue('1,234.56'), 1234.56);
  assert.equal(parseNumericValue('-2 000,00 zł'), -2000);
});

test('normalizeText removes accents and punctuation for alias matching', () => {
  assert.equal(normalizeText('Wartość PLN'), 'wartoscpln');
  assert.equal(normalizeText('Podsumowanie aktywów'), 'podsumowanieaktywow');
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

test('getLiveAssetsFromLiveData extracts portfolio summary assets', () => {
  const liveData = {
    'Podsumowanie aktywów': [
      { Kategoria: 'Gotówka', 'Wartość PLN': '1 500,50 zł' },
      { Kategoria: 'Akcje', 'Wartość PLN': '2.000,00 zł' },
      { Kategoria: '', 'Wartość PLN': '100 zł' },
    ],
  };

  assert.deepEqual(getLiveAssetsFromLiveData(liveData), [
    { id: 'live-0-Gotówka', label: 'Gotówka', value: 1500.5 },
    { id: 'live-1-Akcje', label: 'Akcje', value: 2000 },
  ]);
});
