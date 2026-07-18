import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import zlib from 'node:zlib';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createStoredZip, extractZipSafely, inspectZip } from '../server/zip.js';
import { createAnalysisStore } from '../server/storage.js';
import { startAnalysisHelper } from '../server/index.js';
import { extractPdfText } from '../server/pdfText.js';
import {
  analyzeDocumentsWithPerplexity,
  discoverCandidatesWithPerplexity,
} from '../server/perplexity.js';

const withTemporaryDirectory = async (callback) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'stock-analyzer-test-'));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test('secure ZIP extraction retains safe files and rejects a zip-slip entry', async () => {
  await withTemporaryDirectory(async (directory) => {
    const archive = createStoredZip([{ path: 'reports/q1.txt', content: 'wyniki Q1' }]);
    const files = await extractZipSafely(archive, path.join(directory, 'safe'));

    assert.equal(files.length, 1);
    assert.equal(await readFile(files[0].absolutePath, 'utf8'), 'wyniki Q1');

    const malicious = createStoredZip([{ path: 'safe.txt', content: 'x' }]);
    const original = Buffer.from('safe.txt');
    const unsafe = Buffer.from('../a.txt');
    let offset = malicious.indexOf(original);
    while (offset >= 0) {
      unsafe.copy(malicious, offset);
      offset = malicious.indexOf(original, offset + original.length);
    }

    assert.throws(() => inspectZip(malicious), { code: 'UNSAFE_ZIP_ENTRY' });
  });
});

test('analysis store archives an original ZIP, registers extracted files and restores a full backup', async () => {
  await withTemporaryDirectory(async (directory) => {
    const store = await createAnalysisStore({ dataDir: directory });
    try {
      assert.equal(store.listProfiles().length, 2);
      assert.equal(store.listSources('company:WSE:CDR').length, 1);

      const archive = createStoredZip([{ path: 'package/q1.txt', content: 'przychody 100' }]);
      const saved = await store.saveDocument('company:WSE:CDR', {
        buffer: archive,
        filename: 'q1-package.zip',
        title: 'Pakiet Q1',
        type: 'raport kwartalny',
        period: 'Q1 2026',
      });

      assert.equal(saved.extracted.length, 1);
      const documents = store.listDocuments('company:WSE:CDR');
      assert.equal(documents.length, 2);
      const extracted = documents.find((document) => document.parentDocumentId === saved.document.id);
      assert.equal(extracted.analyzable, true);
      assert.equal(extracted.period, 'Q1 2026');

      const draft = store.createDraftAnalysis('company:WSE:CDR', {
        documentIds: [extracted.id],
        content: {
          title: 'Analiza Q1',
          schemaVersion: '1.0',
          summary: 'Wynik testowy.',
          conclusions: [],
          metrics: [],
          risks: [],
        },
      });
      assert.equal(store.approveAnalysis(draft.id).status, 'approved');
      assert.equal(store.listApprovedReportMetrics('company:WSE:CDR').length, 0);
      store.updateAppState({
        fetchedLiveData: { 'Podsumowanie aktywów': [{ Kategoria: 'Gotówka', 'Wartość PLN': 1000 }] },
        portfolioInputText: 'USD 1000,00 zł',
      });

      const backup = await store.createBackup({ localStorage: { portfolioInputText: 'stan przeglądarki' } });
      const backupBuffer = await readFile(backup.absolutePath);
      await store.saveDocument('company:WSE:CDR', {
        buffer: Buffer.from('plik po backupie'),
        filename: 'later.txt',
        title: 'Późniejszy dokument',
      });
      assert.equal(store.listDocuments('company:WSE:CDR').length, 3);

      const imported = await store.importBackup(backupBuffer);
      assert.equal(imported.imported, true);
      assert.equal(imported.browserState.localStorage.portfolioInputText, 'stan przeglądarki');
      assert.equal(store.listDocuments('company:WSE:CDR').length, 2);
      assert.equal(store.listAnalyses('company:WSE:CDR')[0].status, 'approved');
      assert.equal(store.listAppState().state.portfolioInputText, 'USD 1000,00 zł');
      assert.equal(store.listAppState().state.fetchedLiveData['Podsumowanie aktywów'][0].Kategoria, 'Gotówka');
    } finally {
      store.close();
    }
  });
});

test('approved analysis materializes latest report metric facts once per asset, metric and period', async () => {
  await withTemporaryDirectory(async (directory) => {
    const store = await createAnalysisStore({ dataDir: directory });
    try {
      const saved = await store.saveDocument('company:WSE:CDR', {
        buffer: Buffer.from('Zysk netto 100 tys. PLN'),
        filename: 'q1.txt',
        title: 'Raport Q1',
        type: 'raport kwartalny',
        period: 'Q1 2026',
      });

      const draft = store.createDraftAnalysis('company:WSE:CDR', {
        documentIds: [saved.document.id],
        content: {
          title: 'Analiza Q1',
          schemaVersion: '2.0',
          reportPeriod: 'Q1 2026',
          summary: 'Wynik testowy.',
          metricFacts: [
            {
              metricKey: 'net_income',
              label: 'Zysk netto',
              value: 100,
              unit: 'tys. PLN',
              period: 'Q1 2026',
              page: 12,
              section: 'Rachunek wynikow',
              quote: 'Zysk netto 100 tys. PLN',
              confidence: 0.91,
            },
            {
              metricKey: 'roe',
              label: 'ROE',
              value: 8.5,
              unit: '%',
              period: 'Q1 2026',
              page: null,
              section: 'Wskazniki',
              quote: 'ROE 8,5%',
              confidence: 0.82,
            },
            {
              metricKey: 'assets_total',
              label: 'Aktywa ogolem',
              value: 1234,
              unit: 'mln PLN',
              period: '31.03.2025',
              page: 18,
              section: 'Bilans',
              quote: 'Aktywa ogolem 1 234 mln PLN na 31.03.2025',
              confidence: 0.88,
            },
          ],
          risks: [],
          conclusions: [],
          extractionWarnings: [],
        },
      });

      assert.equal(store.listApprovedReportMetrics('company:WSE:CDR').length, 0);

      store.approveAnalysis(draft.id);
      const approvedMetrics = store.listApprovedReportMetrics('company:WSE:CDR');
      assert.equal(approvedMetrics.length, 2);
      const netIncome = approvedMetrics.find((metric) => metric.metricKey === 'net_income');
      assert.equal(netIncome.value, 100);
      assert.equal(netIncome.valueNumeric, 100);
      assert.equal(netIncome.documentId, saved.document.id);
      assert.equal(netIncome.page, 12);
      assert.equal(netIncome.aggregation, 'sum');
      assert.equal(netIncome.source.evidence, 'Zysk netto 100 tys. PLN');
      assert.equal(approvedMetrics.some((metric) => metric.metricKey === 'assets_total'), false);

      store.approveAnalysis(draft.id);
      assert.equal(store.listApprovedReportMetrics('company:WSE:CDR').length, 2);

      const q2Saved = await store.saveDocument('company:WSE:CDR', {
        buffer: Buffer.from('Zysk netto 210 tys. PLN'),
        filename: 'q2.txt',
        title: 'Raport Q2',
        type: 'raport kwartalny',
        period: 'Q2 2026',
      });
      const q2Draft = store.createDraftAnalysis('company:WSE:CDR', {
        documentIds: [q2Saved.document.id],
        content: {
          title: 'Analiza Q2',
          schemaVersion: '2.0',
          reportPeriod: 'Q2 2026',
          summary: 'Wynik testowy.',
          metricFacts: [{
            metricKey: 'net_income',
            label: 'Zysk netto',
            value: 210,
            unit: 'tys. PLN',
            period: '30.06.2026',
            page: 14,
            section: 'Rachunek wynikow',
            quote: 'Zysk netto 210 tys. PLN',
            confidence: 0.92,
          }],
          risks: [],
          conclusions: [],
          extractionWarnings: [],
        },
      });
      store.approveAnalysis(q2Draft.id);
      const afterQ2 = store.listApprovedReportMetrics('company:WSE:CDR');
      assert.equal(afterQ2.length, 3);
      assert.equal(afterQ2.some((metric) => metric.metricKey === 'net_income' && metric.period === 'Q2 2026'), true);

      const updatedDraft = store.createDraftAnalysis('company:WSE:CDR', {
        documentIds: [saved.document.id],
        content: {
          title: 'Analiza Q1 update',
          schemaVersion: '2.0',
          reportPeriod: 'Q1 2026',
          summary: 'Wynik testowy.',
          metricFacts: [{
            metricKey: 'net_income',
            label: 'Zysk netto',
            value: 150,
            unit: 'tys. PLN',
            period: 'Q1 2026',
            page: 13,
            section: 'Rachunek wynikow',
            quote: 'Zysk netto 150 tys. PLN',
            confidence: 0.95,
          }],
          risks: [],
          conclusions: [],
          extractionWarnings: [],
        },
      });

      store.approveAnalysis(updatedDraft.id);
      const afterUpdate = store.listApprovedReportMetrics('company:WSE:CDR');
      assert.equal(afterUpdate.length, 3);
      const updatedNetIncome = afterUpdate.find((metric) => metric.metricKey === 'net_income' && metric.period === 'Q1 2026');
      assert.equal(updatedNetIncome.value, 150);
      assert.equal(updatedNetIncome.page, 13);
      assert.equal(updatedNetIncome.analysisId, updatedDraft.id);

      const renamed = store.updateAnalysisTitle(updatedDraft.id, 'Alior renamed validation');
      assert.equal(renamed.title, 'Alior renamed validation');
      assert.equal(renamed.content.title, 'Alior renamed validation');

      const deleted = store.deleteAnalysis(updatedDraft.id);
      assert.equal(deleted.deleted, true);
      assert.throws(() => store.getAnalysis(updatedDraft.id), { code: 'ANALYSIS_NOT_FOUND' });
      const afterDelete = store.listApprovedReportMetrics('company:WSE:CDR');
      assert.equal(afterDelete.length, 3);
      const restoredNetIncome = afterDelete.find((metric) => metric.metricKey === 'net_income' && metric.period === 'Q1 2026');
      assert.equal(restoredNetIncome.value, 100);
      assert.equal(restoredNetIncome.page, 12);
      assert.equal(restoredNetIncome.analysisId, draft.id);
    } finally {
      store.close();
    }
  });
});

test('approved annual metrics come from annual analyses and are never synthesized from Q1-Q4', async () => {
  await withTemporaryDirectory(async (directory) => {
    let timestamp = Date.UTC(2026, 0, 1);
    const store = await createAnalysisStore({
      dataDir: directory,
      clock: () => new Date(timestamp += 1000),
    });
    try {
      const assetId = 'company:WSE:CDR';
      const annualDocument = await store.saveDocument(assetId, {
        buffer: Buffer.from('Annual report 2025'),
        filename: 'annual-2025.txt',
        title: 'Raport roczny 2025',
        type: 'annual_report',
        period: 'FY 2025',
      });
      assert.equal(annualDocument.document.period, '2025');

      const firstAnnual = store.createDraftAnalysis(assetId, {
        documentIds: [annualDocument.document.id],
        content: {
          title: 'Analiza roczna 2025',
          schemaVersion: '2.0',
          reportPeriod: '2025',
          summary: 'Rok 2025.',
          metricFacts: [
            {
              metricKey: 'net_income', label: 'Zysk netto', value: 100, unit: 'mln PLN', period: '2025',
              page: 10, section: 'Rachunek wynikow', quote: 'Zysk netto 100 mln PLN', confidence: 0.9,
            },
            {
              metricKey: 'total_assets', label: 'Aktywa ogolem', value: 2000, unit: 'mln PLN', period: '31.12.2025',
              page: 20, section: 'Bilans', quote: 'Aktywa razem 2 000 mln PLN', confidence: 0.92,
            },
            {
              metricKey: 'net_income', label: 'Zysk netto', value: 80, unit: 'mln PLN', period: '2024',
              page: 10, section: 'Rachunek wynikow', quote: 'Zysk netto 80 mln PLN', confidence: 0.85,
            },
          ],
          risks: [], conclusions: [], extractionWarnings: [],
        },
      });
      store.approveAnalysis(firstAnnual.id);

      const updatedAnnual = store.createDraftAnalysis(assetId, {
        documentIds: [annualDocument.document.id],
        content: {
          title: 'Analiza roczna 2025 po korekcie',
          schemaVersion: '2.0',
          reportPeriod: '2025',
          summary: 'Rok 2025 po korekcie.',
          metricFacts: [{
            metricKey: 'net_income', label: 'Zysk netto', value: 120, unit: 'mln PLN', period: '2025',
            page: 11, section: 'Rachunek wynikow', quote: 'Zysk netto 120 mln PLN', confidence: 0.95,
          }],
          risks: [], conclusions: [], extractionWarnings: [],
        },
      });
      store.approveAnalysis(updatedAnnual.id);

      for (let quarter = 1; quarter <= 4; quarter += 1) {
        const document = await store.saveDocument(assetId, {
          buffer: Buffer.from(`Quarter ${quarter} report`),
          filename: `q${quarter}-2026.txt`,
          title: `Raport Q${quarter} 2026`,
          type: 'quarterly_report',
          period: `Q${quarter} 2026`,
        });
        const analysis = store.createDraftAnalysis(assetId, {
          documentIds: [document.document.id],
          content: {
            title: `Analiza Q${quarter} 2026`, schemaVersion: '2.0', reportPeriod: `Q${quarter} 2026`, summary: 'Kwartał.',
            metricFacts: [{
              metricKey: 'net_income', label: 'Zysk netto', value: quarter * 10, unit: 'mln PLN', period: `Q${quarter} 2026`,
              page: 1, section: 'Rachunek wynikow', quote: `Zysk netto ${quarter * 10} mln PLN`, confidence: 0.9,
            }],
            risks: [], conclusions: [], extractionWarnings: [],
          },
        });
        store.approveAnalysis(analysis.id);
      }

      const metrics = store.listApprovedReportMetrics(assetId);
      const annualMetrics = metrics.filter((metric) => metric.period === '2025');
      assert.equal(annualMetrics.length, 2);
      assert.equal(annualMetrics.find((metric) => metric.metricKey === 'net_income').value, 120);
      assert.equal(annualMetrics.find((metric) => metric.metricKey === 'net_income').analysisId, updatedAnnual.id);
      assert.equal(annualMetrics.find((metric) => metric.metricKey === 'total_assets').value, 2000);
      assert.equal(metrics.some((metric) => metric.period === '2026'), false);
      assert.deepEqual(
        metrics.filter((metric) => metric.metricKey === 'net_income' && metric.period.includes('2026')).map((metric) => metric.period).sort(),
        ['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026'],
      );
    } finally {
      store.close();
    }
  });
});

test('approved report metrics reject merged integers and monetary CoR duplicates', async () => {
  await withTemporaryDirectory(async (directory) => {
    const store = await createAnalysisStore({ dataDir: directory });
    try {
      const assetId = 'instrument:ALR_3AWSE';
      store.upsertProfile({ assetId, type: 'instrument', name: 'Alior Bank', canonicalId: 'ALR:WSE' });
      const saved = await store.saveDocument(assetId, {
        buffer: Buffer.from('Zysk netto 476 314 PLN. CoR 0,74%.'),
        filename: 'q1.txt',
        title: 'Raport Q1 2025',
        type: 'raport kwartalny',
        period: 'Q1 2025',
      });
      const fact = (metricKey, label, value, unit, confidence) => ({
        metricKey, label, value, unit, confidence,
        period: 'Q1 2025', page: 1, section: 'Tabela', quote: `${label} ${value} ${unit}`,
      });
      const draft = store.createDraftAnalysis(assetId, {
        documentIds: [saved.document.id],
        content: {
          title: 'Analiza Q1 2025', schemaVersion: '2.0', reportPeriod: 'Q1 2025', summary: 'Test.',
          metricFacts: [
            fact('net_income', 'Zysk netto', 476314, 'PLN', 0.9),
            fact('net_income', 'Zysk netto', 4763142445022578000, 'PLN', 0.99),
            fact('cost_of_risk', 'CoR', '0,74', '%', 0.9),
            fact('cost_of_risk', 'Koszty ryzyka prawnego', 1589400, 'PLN', 0.95),
          ],
          risks: [], conclusions: [], extractionWarnings: [],
        },
      });

      store.approveAnalysis(draft.id);
      const metrics = store.listApprovedReportMetrics(assetId);
      assert.deepEqual(
        metrics.map((metric) => [metric.metricKey, metric.valueNumeric, metric.unit]),
        [['cost_of_risk', 0.74, '%'], ['net_income', 476314, 'PLN']],
      );
    } finally {
      store.close();
    }
  });
});

test('approved report metrics merge quarter-end dates and quarter labels into one period', async () => {
  await withTemporaryDirectory(async (directory) => {
    const store = await createAnalysisStore({ dataDir: directory });
    try {
      const saved = await store.saveDocument('company:WSE:CDR', {
        buffer: Buffer.from('Aktywa ogolem Q1 2025'),
        filename: 'q1-2025.txt',
        title: 'Raport Q1 2025',
        type: 'raport kwartalny',
        period: 'Q1 2025',
      });

      const draft = store.createDraftAnalysis('company:WSE:CDR', {
        documentIds: [saved.document.id],
        content: {
          title: 'Analiza Q1 2025',
          schemaVersion: '2.0',
          reportPeriod: 'Q1 2025',
          summary: 'Wynik testowy.',
          metricFacts: [
            {
              metricKey: 'total_assets',
              label: 'Aktywa ogolem',
              value: 100,
              unit: 'mln PLN',
              period: '31.03.2025',
              page: 3,
              section: 'Bilans',
              quote: 'Aktywa ogolem 100 mln PLN na 31.03.2025',
              confidence: 0.9,
            },
            {
              metricKey: 'total_assets',
              label: 'Aktywa ogolem',
              value: 100,
              unit: 'mln PLN',
              period: 'Q1 2025',
              page: 3,
              section: 'Bilans',
              quote: 'Aktywa ogolem 100 mln PLN za Q1 2025',
              confidence: 0.9,
            },
          ],
          risks: [],
          conclusions: [],
          extractionWarnings: [],
        },
      });

      store.approveAnalysis(draft.id);
      const assets = store.listApprovedReportMetrics('company:WSE:CDR')
        .filter((metric) => metric.metricKey === 'total_assets');

      assert.equal(assets.length, 1);
      assert.equal(assets[0].period, 'Q1 2025');
      assert.equal(assets[0].documentId, saved.document.id);
    } finally {
      store.close();
    }
  });
});

test('store startup rebuilds approved report metrics without changing original analysis JSON', async () => {
  await withTemporaryDirectory(async (directory) => {
    let store = await createAnalysisStore({ dataDir: directory });
    try {
      const assetId = 'company:WSE:CDR';
      const saved = await store.saveDocument(assetId, {
        buffer: Buffer.from('Zysk netto Q1 2025 i Q1 2024'),
        filename: 'q1-rebuild.txt',
        title: 'Raport Q1 2025',
        type: 'raport kwartalny',
        period: 'Q1 2025',
      });
      const draft = store.createDraftAnalysis(assetId, {
        documentIds: [saved.document.id],
        content: {
          title: 'Analiza rebuild',
          schemaVersion: '2.0',
          reportPeriod: 'Q1 2025',
          summary: 'Wynik testowy.',
          metricFacts: [
            { metricKey: 'net_income', label: 'Zysk netto', value: 100, unit: 'mln EUR', period: '31.03.2025' },
            { metricKey: 'net_income', label: 'Zysk netto', value: 80, unit: 'mln EUR', period: 'Q1 2024' },
          ],
          risks: [],
          conclusions: [],
          extractionWarnings: [],
        },
      });
      store.approveAnalysis(draft.id);
      store.db.prepare("UPDATE approved_report_metrics SET period = 'Q4 1999' WHERE asset_id = ?").run(assetId);
      store.close();

      store = await createAnalysisStore({ dataDir: directory });
      const rebuilt = store.listApprovedReportMetrics(assetId);
      const analysis = store.listAnalyses(assetId).find((item) => item.id === draft.id);

      assert.equal(rebuilt.length, 1);
      assert.equal(rebuilt[0].period, 'Q1 2025');
      assert.equal(rebuilt[0].value, 100);
      assert.deepEqual(analysis.content.metricFacts.map((fact) => fact.period), ['31.03.2025', 'Q1 2024']);
    } finally {
      store?.close();
    }
  });
});

test('approved analysis derives dividend net profit ratio for matching currencies and rejects mixed or per-share inputs', async () => {
  await withTemporaryDirectory(async (directory) => {
    const store = await createAnalysisStore({ dataDir: directory });
    try {
      const assetId = 'instrument:ALR_3AWSE';
      store.upsertProfile({
        assetId,
        type: 'instrument',
        name: 'Alior Bank',
        canonicalId: 'ALR:WSE',
        aliases: ['ALR', 'Alior'],
      });
      const saved = await store.saveDocument(assetId, {
        buffer: Buffer.from('Zysk netto, dywidenda i EPS'),
        filename: 'annual.txt',
        title: 'Raport roczny',
        type: 'raport roczny',
        period: '2025',
      });

      const draft = store.createDraftAnalysis(assetId, {
        documentIds: [saved.document.id],
        content: {
          title: 'Analiza dywidendy',
          schemaVersion: '2.0',
          reportPeriod: '2025',
          summary: 'Wynik testowy.',
          metricFacts: [
            {
              metricKey: 'net_income',
              label: 'Zysk netto',
              value: 1,
              unit: 'mln EUR',
              period: '2025',
              page: 10,
              section: 'Rachunek wynikow',
              quote: 'Zysk netto 1 mln EUR',
              confidence: 0.91,
            },
            {
              metricKey: 'dividend_amount',
              label: 'Dywidenda',
              value: 250,
              unit: 'tys. EUR',
              period: '2025',
              page: 20,
              section: 'Podzial zysku',
              quote: 'Dywidenda 250 tys. EUR',
              confidence: 0.83,
            },
            {
              metricKey: 'dividend_net_profit_ratio',
              label: 'Dividend/net profit',
              value: 80,
              unit: '%',
              period: '2025',
              page: 21,
              section: 'Podzial zysku',
              quote: 'Payout ratio 80%',
              confidence: 0.95,
            },
            {
              metricKey: 'eps',
              label: 'EPS',
              value: 2.5,
              unit: 'PLN/akcje',
              period: 'Q1 2026',
              page: 12,
              section: 'Akcje',
              quote: 'EPS 2,5 PLN na akcje',
              confidence: 0.8,
            },
            {
              metricKey: 'net_income',
              label: 'Zysk netto',
              value: 100,
              unit: 'tys. PLN',
              period: 'Q1 2026',
              page: 13,
              section: 'Rachunek wynikow',
              quote: 'Zysk netto 100 tys. PLN',
              confidence: 0.8,
            },
            {
              metricKey: 'net_income',
              label: 'Zysk netto',
              value: 100,
              unit: 'USD',
              period: '2024',
              page: 14,
              section: 'Rachunek wynikow',
              quote: 'Net income 100 USD',
              confidence: 0.8,
            },
            {
              metricKey: 'dividend_amount',
              label: 'Dywidenda',
              value: 25,
              unit: 'tys. PLN',
              period: '2024',
              page: 15,
              section: 'Podzial zysku',
              quote: 'Dywidenda 25 tys. PLN',
              confidence: 0.8,
            },
          ],
          risks: [],
          conclusions: [],
          extractionWarnings: [],
        },
      });

      store.approveAnalysis(draft.id);
      const approveInputs = (period, metricFacts) => {
        const inputDraft = store.createDraftAnalysis(assetId, {
          documentIds: [saved.document.id],
          content: {
            title: `Analiza wejsc ${period}`,
            schemaVersion: '2.0',
            reportPeriod: period,
            summary: 'Wynik testowy.',
            metricFacts,
            risks: [],
            conclusions: [],
            extractionWarnings: [],
          },
        });
        store.approveAnalysis(inputDraft.id);
      };
      approveInputs('2024', [
        { metricKey: 'net_income', label: 'Zysk netto', value: 100, unit: 'USD', period: '2024' },
        { metricKey: 'dividend_amount', label: 'Dywidenda', value: 25, unit: 'tys. PLN', period: '2024' },
      ]);
      approveInputs('2023', [
        { metricKey: 'net_income', label: 'Zysk netto', value: 4, unit: 'EUR/akcję', period: '2023' },
        { metricKey: 'dividend_amount', label: 'Dywidenda', value: 1, unit: 'EUR/akcję', period: '2023' },
      ]);
      const approvedMetrics = store.listApprovedReportMetrics(assetId);
      const payoutRatios = approvedMetrics.filter((metric) => metric.metricKey === 'dividend_net_profit_ratio');

      assert.equal(payoutRatios.length, 1);
      assert.equal(payoutRatios[0].period, '2025');
      assert.equal(payoutRatios[0].value, 25);
      assert.equal(payoutRatios[0].valueNumeric, 25);
      assert.equal(payoutRatios[0].unit, '%');
      assert.equal(payoutRatios[0].aggregation, 'derived');
      assert.equal(payoutRatios[0].documentId, saved.document.id);
      assert.equal(payoutRatios[0].source.derived, true);
      assert.equal(payoutRatios[0].source.inputs.length, 2);
      assert.equal(payoutRatios[0].source.inputs.some((input) => input.metricKey === 'dividend_amount'), true);
      assert.equal(payoutRatios[0].source.inputs.some((input) => input.metricKey === 'net_income'), true);
      assert.match(payoutRatios[0].quote, /dywidenda \/ zysk netto/);
      assert.equal(approvedMetrics.some((metric) => metric.metricKey === 'dividend_net_profit_ratio' && metric.valueNumeric === 80), false);
      assert.equal(approvedMetrics.some((metric) => metric.metricKey === 'dividend_net_profit_ratio' && metric.period === 'Q1 2026'), false);
      assert.equal(approvedMetrics.some((metric) => metric.metricKey === 'dividend_net_profit_ratio' && metric.period === '2024'), false);
      assert.equal(approvedMetrics.some((metric) => metric.metricKey === 'dividend_net_profit_ratio' && metric.period === '2023'), false);
    } finally {
      store.close();
    }
  });
});

test('Alior Q1 2026 v2 fixture approves into durable report metrics without warnings as facts', async () => {
  await withTemporaryDirectory(async (directory) => {
    const store = await createAnalysisStore({ dataDir: directory });
    try {
      const assetId = 'instrument:ALR_3AWSE';
      store.upsertProfile({
        assetId,
        type: 'instrument',
        name: 'Alior Bank',
        canonicalId: 'ALR:WSE',
        aliases: ['ALR', 'Alior'],
      });
      const saved = await store.saveDocument(assetId, {
        buffer: Buffer.from('Alior Bank Q1 2026 fixture document'),
        filename: 'alior-q1-2026.pdf',
        title: 'Raport Grupy Kapitalowej Alior Banku S.A. za I kwartal 2026 r.',
        type: 'raport kwartalny',
        period: 'Q1 2026',
      });
      const fixture = JSON.parse(await readFile(path.join(
        process.cwd(),
        'tests',
        'fixtures',
        'analysis',
        'alior-q1-2026.v2.json',
      ), 'utf8'));

      const draft = store.createDraftAnalysis(assetId, {
        documentIds: [saved.document.id],
        content: fixture,
      });
      assert.equal(store.listApprovedReportMetrics(assetId).length, 0);

      store.approveAnalysis(draft.id);
      const approvedMetrics = store.listApprovedReportMetrics(assetId);
      assert.equal(approvedMetrics.length, fixture.metricFacts.length);
      assert.equal(approvedMetrics.some((metric) => metric.metricKey === 'npl_ratio'), false);
      assert.equal(approvedMetrics.some((metric) => metric.metricKey === 'net_income'), true);
      assert.equal(store.getProfile(assetId).reportMetrics.length, fixture.metricFacts.length);
    } finally {
      store.close();
    }
  });
});

test('app state stores allowlisted values and excludes secret localStorage keys during migration', async () => {
  await withTemporaryDirectory(async (directory) => {
    const store = await createAnalysisStore({ dataDir: directory });
    try {
      const saved = store.updateAppState({
        portfolioAssets: [{ label: 'Gotówka', value: 100 }],
        portfolioInputText: 'Gotówka 100,00 zł',
      });
      assert.deepEqual(saved.state.portfolioAssets, [{ label: 'Gotówka', value: 100 }]);
      assert.equal(saved.state.portfolioInputText, 'Gotówka 100,00 zł');

      const migrated = store.migrateAppState({
        localStorage: {
          googleApiKey: 'secret-google-key',
          geminiApiKey: 'secret-gemini-key',
          liveDataConfigs: JSON.stringify([{ id: '1', name: 'Arkusz' }]),
          portfolioHistoryText: '2026-01-01 100',
        },
      });

      assert.deepEqual(migrated.state.liveDataConfigs, [{ id: '1', name: 'Arkusz' }]);
      assert.equal(migrated.state.portfolioHistoryText, '2026-01-01 100');
      assert.equal(Object.hasOwn(migrated.state, 'googleApiKey'), false);
      assert.equal(Object.hasOwn(migrated.state, 'geminiApiKey'), false);
      assert.ok(migrated.ignored.includes('googleApiKey'));
      assert.ok(migrated.ignored.includes('geminiApiKey'));
    } finally {
      store.close();
    }
  });
});

test('helper exposes local profiles and accepts a manual upload without a Perplexity key', async () => {
  await withTemporaryDirectory(async (directory) => {
    const helper = await startAnalysisHelper({ port: 0, dataDir: directory, apiKey: '' });
    try {
      const port = helper.server.address().port;
      const base = `http://127.0.0.1:${port}/api/analysis`;
      const profilesResponse = await fetch(`${base}/profiles`);
      const profilesPayload = await profilesResponse.json();
      assert.equal(profilesResponse.status, 200);
      assert.equal(profilesPayload.data.profiles.length, 2);

      const uploadResponse = await fetch(`${base}/profiles/${encodeURIComponent('company:WSE:CDR')}/documents/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'X-File-Name': encodeURIComponent('manual.txt'),
          'X-Document-Title': encodeURIComponent('Raport ręczny'),
          'X-Document-Type': encodeURIComponent('quarterly_report'),
          'X-Reporting-Period': encodeURIComponent('Q1 2026'),
        },
        body: 'treść ręcznego raportu',
      });
      const uploadPayload = await uploadResponse.json();
      assert.equal(uploadResponse.status, 201);
      assert.equal(uploadPayload.data.document.filename, 'manual.txt');
      assert.equal(uploadPayload.data.document.type, 'quarterly_report');
      assert.equal(uploadPayload.data.document.period, 'Q1 2026');

      const draft = helper.store.createDraftAnalysis('company:WSE:CDR', {
        documentIds: [uploadPayload.data.document.id],
        content: {
          title: 'Analiza do zarzadzania',
          schemaVersion: '2.0',
          reportPeriod: 'Q1 2026',
          summary: 'Test.',
          metricFacts: [],
          risks: [],
          conclusions: [],
          extractionWarnings: [],
        },
      });
      const renameResponse = await fetch(`${base}/analyses/${encodeURIComponent(draft.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Analiza po zmianie nazwy' }),
      });
      const renamePayload = await renameResponse.json();
      assert.equal(renameResponse.status, 200);
      assert.equal(renamePayload.data.analysis.title, 'Analiza po zmianie nazwy');

      const deleteResponse = await fetch(`${base}/analyses/${encodeURIComponent(draft.id)}`, { method: 'DELETE' });
      const deletePayload = await deleteResponse.json();
      assert.equal(deleteResponse.status, 200);
      assert.equal(deletePayload.data.deleted, true);

      const metricsResponse = await fetch(`${base}/profiles/${encodeURIComponent('company:WSE:CDR')}/report-metrics`);
      const metricsPayload = await metricsResponse.json();
      assert.equal(metricsResponse.status, 200);
      assert.deepEqual(metricsPayload.data.metrics, []);

      const migrateResponse = await fetch(`${base}/state/migrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          localStorage: {
            fetchedLiveData: JSON.stringify({ 'Zakres': [{ value: 1 }] }),
            googleApiKey: 'secret',
          },
        }),
      });
      const migratePayload = await migrateResponse.json();
      assert.equal(migrateResponse.status, 200);
      assert.deepEqual(migratePayload.data.state.fetchedLiveData, { 'Zakres': [{ value: 1 }] });
      assert.equal(Object.hasOwn(migratePayload.data.state, 'googleApiKey'), false);

      const stateResponse = await fetch(`${base}/state`);
      const statePayload = await stateResponse.json();
      assert.equal(stateResponse.status, 200);
      assert.equal(statePayload.data.empty, false);
      assert.deepEqual(statePayload.data.state.fetchedLiveData, { 'Zakres': [{ value: 1 }] });

      const discoveryResponse = await fetch(`${base}/profiles/${encodeURIComponent('company:WSE:CDR')}/candidates/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const discoveryPayload = await discoveryResponse.json();
      assert.equal(discoveryResponse.status, 412);
      assert.equal(discoveryPayload.error.code, 'PERPLEXITY_NOT_CONFIGURED');
    } finally {
      await new Promise((resolve) => helper.server.close(resolve));
      helper.store.close();
    }
  });
});

test('helper validates manual report metadata and rejects mixed analysis periods', async () => {
  await withTemporaryDirectory(async (directory) => {
    const helper = await startAnalysisHelper({ port: 0, dataDir: directory, apiKey: '' });
    try {
      const port = helper.server.address().port;
      const base = `http://127.0.0.1:${port}/api/analysis`;
      const assetPath = `${base}/profiles/${encodeURIComponent('company:WSE:CDR')}`;
      const upload = (filename, type, period, content) => fetch(`${assetPath}/documents/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'X-File-Name': encodeURIComponent(filename),
          'X-Document-Title': encodeURIComponent(filename),
          'X-Document-Type': encodeURIComponent(type),
          'X-Reporting-Period': encodeURIComponent(period),
        },
        body: content,
      });

      const invalidAnnualResponse = await upload('annual-invalid.txt', 'annual_report', 'Q4 2025', 'invalid annual');
      const invalidAnnualPayload = await invalidAnnualResponse.json();
      assert.equal(invalidAnnualResponse.status, 400);
      assert.equal(invalidAnnualPayload.error.code, 'ANNUAL_PERIOD_REQUIRED');

      const q1Response = await upload('q1.txt', 'quarterly_report', 'Q1 2025', 'q1 content');
      const q2Response = await upload('q2.txt', 'quarterly_report', 'Q2 2025', 'q2 content');
      const otherResponse = await upload('attachment.txt', 'other', '', 'attachment content');
      const q1 = (await q1Response.json()).data.document;
      const q2 = (await q2Response.json()).data.document;
      const other = (await otherResponse.json()).data.document;

      const mixedResponse = await fetch(`${assetPath}/analyses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds: [q1.id, q2.id], model: 'sonar-pro' }),
      });
      const mixedPayload = await mixedResponse.json();
      assert.equal(mixedResponse.status, 400);
      assert.equal(mixedPayload.error.code, 'MIXED_REPORT_PERIODS');

      const missingPeriodResponse = await fetch(`${assetPath}/analyses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds: [other.id], model: 'sonar-pro' }),
      });
      const missingPeriodPayload = await missingPeriodResponse.json();
      assert.equal(missingPeriodResponse.status, 400);
      assert.equal(missingPeriodPayload.error.code, 'DOCUMENT_PERIOD_REQUIRED');
    } finally {
      await new Promise((resolve) => helper.server.close(resolve));
      helper.store.close();
    }
  });
});

test('Perplexity adapter sends structured discovery and file-analysis requests without exposing a key', async () => {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ headers: options.headers, body });
    const content = body.model === 'sonar'
      ? JSON.stringify({ candidates: [{ title: 'Raport Q1', url: 'https://issuer.example/q1.pdf', type: 'raport kwartalny', period: 'Q1 2026', publishedAt: '2026-05-28', rationale: 'Oficjalny raport.' }] })
      : JSON.stringify({
        schemaVersion: '1.0',
        title: 'Analiza Q1', 
        reportPeriod: '',
        summary: 'Podsumowanie.', 
        structuredSummary: {
          headline: 'Wynik netto wzrosl, ale jakosc wyniku wymaga sprawdzenia kosztow ryzyka.',
          stance: 'mieszany',
          sections: [
            {
              title: 'Najważniejsze fakty',
              bullets: [{
                text: 'Zysk netto wyniosl 100 mln PLN i jest glownym punktem zaczepienia analizy.',
                metricKeys: ['net_income'],
                source: { documentId: 'doc_1', page: 2, section: 'Rachunek zyskow i strat', evidence: 'Zysk netto 100 mln PLN' },
              }],
            },
            {
              title: 'Zmiana vs rok temu',
              bullets: [{ text: 'Raport wymaga porownania z analogicznym okresem, gdy metryki za rok poprzedni sa widoczne.' }],
            },
            {
              title: 'Jakość wyniku',
              bullets: [{ text: 'Jakość wyniku należy oceniać razem z powtarzalnością przychodów i kosztami ryzyka.' }],
            },
            {
              title: 'Ryzyka i kapital',
              bullets: [{ text: 'Ryzyka bankowe wymagaja osobnej kontroli kapitalu, NPL i kosztu ryzyka.' }],
            },
            {
              title: 'Co sprawdzić dalej',
              bullets: [{ text: 'W kolejnym kroku warto sprawdzić pełne noty do wyniku i kapitału.' }],
            },
          ],
        },
        metricFacts: [
          {
            metricKey: 'net_income',
            label: 'Zysk netto',
            value: 100,
            unit: 'mln PLN',
            period: 'Q1 2026',
            page: 2,
            section: 'Rachunek zyskow i strat',
            quote: 'Zysk netto 100 mln PLN',
            confidence: 0.95,
          },
          {
            metricKey: 'net_income',
            label: 'Zysk netto',
            value: 80,
            unit: 'mln PLN',
            period: 'Q1 2025',
            page: 2,
            section: 'Rachunek zyskow i strat',
            quote: 'Zysk netto Q1 2025 80 mln PLN',
            confidence: 0.9,
          },
        ],
        conclusions: [{
          text: 'Wniosek.',
          source: { documentId: 'doc_1', page: 2, section: 'Rachunek zyskow i strat', evidence: 'Zysk netto 100 mln PLN' },
        }],
        risks: [{
          text: 'Ryzyko.',
          source: { documentId: 'doc_1', page: null, section: 'Ryzyka', evidence: 'Opis ryzyka.' },
        }],
        extractionWarnings: [{
          metricKey: 'roe',
          label: 'ROE',
          reason: 'Brak pewnego źródła.',
          evidence: 'Nie znaleziono w raporcie.',
        }],
      });
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
      citations: ['https://issuer.example/q1.pdf'],
      usage: { cost: { total_cost: 0.12 } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const profile = { assetId: 'instrument:ALR_3AWSE', type: 'instrument', name: 'Alior Bank', canonicalId: 'ALR:WSE' };

  const discovery = await discoverCandidatesWithPerplexity({
    apiKey: 'test-key',
    profile,
    sources: [{ title: 'IR', url: 'https://issuer.example/reports', role: 'official' }],
    fetchImpl,
  });
  assert.equal(discovery.candidates[0].url, 'https://issuer.example/q1.pdf');
  assert.equal(discovery.costUsd, 0.12);
  assert.equal(requests[0].body.model, 'sonar');
  assert.equal(requests[0].body.response_format.type, 'json_schema');
  assert.equal(requests[0].headers.Authorization, 'Bearer test-key');

  const pdfStream = zlib.deflateSync(Buffer.from('BT (Zysk netto 100 mln PLN) Tj [(ROE) 12 (,5%)] TJ ET', 'latin1'));
  const pdfBuffer = Buffer.concat([
    Buffer.from('%PDF-1.4\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'),
    pdfStream,
    Buffer.from('\nendstream\n%%EOF', 'latin1'),
  ]);
  const analysis = await analyzeDocumentsWithPerplexity({
    apiKey: 'test-key',
    profile,
    documents: [{ id: 'doc_1', filename: 'alior-q1-2026.pdf', title: 'Raport za I kwartal 2026', type: 'raport kwartalny', period: '', sourceUrl: 'https://issuer.example/q1.pdf', mimeType: 'application/pdf' }],
    documentBuffers: [pdfBuffer],
    fetchImpl,
  });
  assert.equal(analysis.model, 'sonar-pro');
  assert.equal(analysis.content.schemaVersion, '2.0'); 
  assert.equal(analysis.content.reportPeriod, 'Q1 2026');
  assert.equal(analysis.content.summary, 'Podsumowanie.'); 
  assert.equal(analysis.content.structuredSummary.headline, 'Wynik netto wzrosl, ale jakosc wyniku wymaga sprawdzenia kosztow ryzyka.'); 
  assert.equal(analysis.content.structuredSummary.sections[0].bullets[0].metricKeys[0], 'net_income'); 
  assert.equal(analysis.content.metricFacts[0].metricKey, 'net_income'); 
  assert.equal(analysis.content.metricFacts.length, 1);
  assert.equal(analysis.content.metricFacts[0].period, 'Q1 2026');
  assert.equal(analysis.content.metrics[0].label, 'Zysk netto');
  assert.equal(analysis.content.extractionWarnings[0].metricKey, 'roe');
  assert.equal(analysis.content.citations[0].url, 'https://issuer.example/q1.pdf');
  assert.equal(requests[1].body.model, 'sonar-pro'); 
  assert.equal(requests[1].body.response_format.json_schema.schema.required.includes('structuredSummary'), true); 
  assert.equal(requests[1].body.response_format.json_schema.schema.required.includes('metricFacts'), true); 
  assert.deepEqual(requests[1].body.response_format.json_schema.schema.properties.schemaVersion.enum, ['2.0']); 
  assert.match(requests[1].body.messages[1].content[0].text, /structuredSummary/); 
  assert.match(requests[1].body.messages[1].content[0].text, /analityk dla człowieka/);
  assert.match(requests[1].body.messages[1].content[0].text, /Najważniejsze fakty/);
  assert.match(requests[1].body.messages[1].content[0].text, /Zmiana vs rok temu/); 
  assert.match(requests[1].body.messages[1].content[0].text, /bez rekomendacji inwestycyjnej/); 
  assert.match(requests[1].body.messages[1].content[0].text, /Katalog metryk do ekstrakcji/); 
  assert.match(requests[1].body.messages[1].content[0].text, /extractionWarnings/);
  assert.match(requests[1].body.messages[1].content[0].text, /PDF\/OCR/);
  assert.match(requests[1].body.messages[1].content[0].text, /niższą confidence/);
  assert.match(requests[1].body.messages[1].content[0].text, /tylko z kolumny okresu głównego raportu/);
  assert.match(requests[1].body.messages[1].content[0].text, /kolumnę Q1 2024 pomiń jako metricFacts/);
  assert.match(requests[1].body.messages[1].content[0].text, /"period":"Q1 2026"/);
  assert.match(requests[1].body.messages[1].content[0].text, /31\.03\.YYYY/);
  assert.match(requests[1].body.messages[1].content[0].text, /tier primary/);
  assert.match(requests[1].body.messages[1].content[0].text, /tier secondary/);
  assert.match(requests[1].body.messages[1].content[0].text, /przez każdy wpis katalogu/);
  assert.match(requests[1].body.messages[1].content[0].text, /shortName, namePl, nameEn, aliases, keywords, description, valueType i aggregation/);
  assert.match(requests[1].body.messages[1].content[0].text, /Nie wymagaj dosłownego wystąpienia samego tekstu metricKey/);
  assert.match(requests[1].body.messages[1].content[0].text, /Metryk z tier secondary również aktywnie szukaj/);
  assert.match(requests[1].body.messages[1].content[0].text, /Return on Equity/);
  assert.match(requests[1].body.messages[1].content[0].text, /mln EUR/);
  assert.match(requests[1].body.messages[1].content[0].text, /Nie przeliczaj walut i nie preferuj PLN/);
  assert.match(requests[1].body.messages[1].content[0].text, /01\.04\.YYYY-30\.06\.YYYY/);
  assert.match(requests[1].body.messages[1].content[0].text, /01\.01\.YYYY-30\.09\.YYYY/);
  assert.match(requests[1].body.messages[1].content[0].text, /jednorazowe lub powtarzalne/);
  assert.match(requests[1].body.messages[1].content[0].text, /"metricKey": "cost_income_ratio"/);
  assert.match(requests[1].body.messages[1].content[0].text, /"metricKey": "loan_deposit_ratio"/);
  assert.match(requests[1].body.messages[1].content[0].text, /"tier": "primary"/);
  assert.match(requests[1].body.messages[1].content[0].text, /"tier": "secondary"/);
  assert.equal((requests[1].body.messages[1].content[0].text.match(/Katalog metryk do ekstrakcji:/g) || []).length, 1);
  assert.equal(requests[1].body.messages[1].content[0].text.includes('Priorytetowa checklista metryk bankowych'), false);
  assert.equal(requests[1].body.messages[1].content[0].text.includes('"defaultUnit"'), false);
  assert.equal(requests[1].body.messages[1].content[1].type, 'text');
  assert.match(requests[1].body.messages[1].content[1].text, /tekst wyodrebniony lokalnie z PDF/);
  assert.match(requests[1].body.messages[1].content[1].text, /Zysk netto 100 mln PLN/);
  assert.equal(JSON.stringify(requests[1].body.messages[1].content).includes('file_url'), false);
});

test('Perplexity adapter treats an annual report as a full year and keeps comparison columns out of metric facts', async () => {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const content = JSON.stringify({
      schemaVersion: '2.0',
      title: 'Analiza roczna 2025',
      reportPeriod: 'Q4 2025',
      summary: 'Pełny rok 2025 zakończył się zyskiem.',
      structuredSummary: {
        headline: 'Rok 2025 zakończył się zyskiem i wzrostem aktywów.',
        stance: 'pozytywny',
        sections: [{
          title: 'Najważniejsze fakty',
          bullets: [{ text: 'Zysk netto wyniósł 100 mln PLN.', metricKeys: ['net_income'] }],
        }],
      },
      metricFacts: [
        {
          metricKey: 'net_income', label: 'Zysk netto', value: 100, unit: 'mln PLN', period: '2025',
          page: 10, section: 'Rachunek wyników', quote: 'Zysk netto 100 mln PLN', confidence: 0.95,
        },
        {
          metricKey: 'total_assets', label: 'Aktywa ogółem', value: 2000, unit: 'mln PLN', period: '31.12.2025',
          page: 20, section: 'Bilans', quote: 'Aktywa razem 2 000 mln PLN', confidence: 0.92,
        },
        {
          metricKey: 'net_income', label: 'Zysk netto', value: 80, unit: 'mln PLN', period: '2024',
          page: 10, section: 'Rachunek wyników', quote: 'Zysk netto 80 mln PLN', confidence: 0.9,
        },
        {
          metricKey: 'total_liabilities', label: 'Zobowiązania ogółem', value: 1500, unit: 'mln PLN', period: 'Q4 2025',
          page: 20, section: 'Bilans', quote: 'Zobowiązania 1 500 mln PLN', confidence: 0.9,
        },
      ],
      risks: [{
        text: 'Ryzyko testowe.',
        source: { documentId: 'annual_doc', page: 30, section: 'Ryzyka', evidence: 'Opis ryzyka.' },
      }],
      conclusions: [{
        text: 'Wniosek testowy.',
        source: { documentId: 'annual_doc', page: 10, section: 'Rachunek wyników', evidence: 'Zysk netto 100 mln PLN.' },
      }],
      extractionWarnings: [],
    });
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
      citations: [],
      usage: { cost: { total_cost: 0.1 } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const analysis = await analyzeDocumentsWithPerplexity({
    apiKey: 'test-key',
    profile: { assetId: 'company:WSE:CDR', type: 'company', name: 'CD Projekt', canonicalId: 'CDR:WSE' },
    documents: [{
      id: 'annual_doc',
      filename: 'annual-2025.txt',
      title: 'Raport roczny 2025',
      type: 'annual_report',
      period: 'FY 2025',
      mimeType: 'text/plain',
    }, {
      id: 'annual_notes',
      filename: 'annual-notes-2025.txt',
      title: 'Noty do raportu rocznego 2025',
      type: 'annual_report',
      period: '2025',
      mimeType: 'text/plain',
    }],
    documentBuffers: [
      Buffer.from('Rok 2025. Zysk netto 100 mln PLN. Aktywa na 31.12.2025: 2 000 mln PLN.'),
      Buffer.from('Noty do raportu rocznego 2025.'),
    ],
    fetchImpl,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, 'sonar-pro');
  assert.equal(analysis.content.reportPeriod, '2025');
  assert.deepEqual(analysis.content.metricFacts.map((fact) => fact.metricKey), ['net_income', 'total_assets']);
  assert.equal(analysis.content.metricFacts.every((fact) => fact.period === '2025'), true);
  const prompt = requests[0].messages[1].content[0].text;
  assert.match(prompt, /To jest analiza pełnego roku 2025, a nie analiza Q4 2025/);
  assert.match(prompt, /aggregation sum/);
  assert.match(prompt, /aggregation point_in_time/);
  assert.match(prompt, /data 31\.12\.2025 oznacza koniec roku, nie Q4/);
  assert.match(prompt, /Kolumny za 2024 i inne okresy porównawcze/);
  assert.match(prompt, /Nie sumuj kwartałów i nie twórz syntetycznej wartości rocznej z Q1-Q4/);
  assert.doesNotMatch(prompt, /Reguły okresu dla raportu kwartalnego/);
});

test('analysis normalization rejects merged columns and monetary values mislabeled as CoR', async () => {
  let requestBody;
  const content = {
    schemaVersion: '2.0',
    title: 'Analiza Q1 2025',
    reportPeriod: 'Q1 2025',
    summary: 'Podsumowanie.',
    metricFacts: [
      { metricKey: 'net_income', label: 'Zysk netto', value: 476314, unit: 'PLN', period: 'Q1 2025', page: 6, section: 'RZiS', quote: 'Zysk netto 476 314 PLN', confidence: 0.9 },
      { metricKey: 'net_income', label: 'Zysk netto', value: 4763142445022578000, unit: 'PLN', period: 'Q1 2025', page: 6, section: 'RZiS', quote: 'Zysk netto 4763142445022578125 - 17,6%', confidence: 0.99 },
      { metricKey: 'cost_of_risk', label: 'CoR', value: '0,74', unit: '%', period: 'Q1 2025', page: 7, section: 'Wskaźniki', quote: 'CoR 0,74%', confidence: 0.9 },
      { metricKey: 'cost_of_risk', label: 'Koszty ryzyka prawnego', value: 1589400, unit: 'PLN', period: 'Q1 2025', page: 12, section: 'Ryzyko prawne', quote: 'Koszty ryzyka prawnego 1 589 400 PLN', confidence: 0.95 },
    ],
    risks: [],
    conclusions: [],
    extractionWarnings: [],
  };
  const analysis = await analyzeDocumentsWithPerplexity({
    apiKey: 'test-key',
    profile: { assetId: 'instrument:ALR_3AWSE', type: 'instrument', name: 'Alior Bank', canonicalId: 'ALR:WSE' },
    documents: [{ id: 'doc_1', filename: 'q1.txt', title: 'Raport Q1 2025', type: 'raport kwartalny', period: 'Q1 2025', mimeType: 'text/plain' }],
    documentBuffers: [Buffer.from('Zysk netto 476 314 PLN. CoR 0,74%.')],
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(content) } }],
        usage: { cost: { total_cost: 0.01 } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  assert.deepEqual(
    analysis.content.metricFacts.map((fact) => [fact.metricKey, fact.value, fact.unit]),
    [['net_income', 476314, 'PLN'], ['cost_of_risk', 0.74, '%']],
  );
  assert.equal(analysis.content.extractionWarnings.some((warning) => warning.reason.includes('kilku kolumn')), true);
  assert.equal(analysis.content.extractionWarnings.some((warning) => warning.reason.includes('niezgodną z typem')), true);
  const prompt = requestBody.messages[1].content[0].text;
  assert.match(prompt, /Nigdy nie sklejaj cyfr z sąsiednich kolumn/);
  assert.match(prompt, /podziały linii odzwierciedlają wiersze PDF/);
  assert.match(prompt, /dopasuj każdą komórkę do jej nagłówka/);
  assert.equal(prompt.includes('Wybrane dane finansowe dotyczące sprawozdania finansowego'), false);
  assert.equal(prompt.includes('"Wynik z tytułu odsetek" jest wierszem 2'), false);
  assert.equal(prompt.includes('"Zysk netto" wierszem 8'), false);
  assert.equal(prompt.includes('476 314 | 244 502'), false);
  assert.match(prompt, /cost_of_risk oznacza wyłącznie wskaźnik CoR/);
  assert.match(prompt, /nie są CoR/);
});

test('PDF text extractor reads compressed text streams for analysis prompts', () => {
  const stream = zlib.deflateSync(Buffer.from('BT (Zysk netto) Tj [(4) 12 (0) 12 (3) 12 (186)] TJ ET', 'latin1'));
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'),
    stream,
    Buffer.from('\nendstream\n%%EOF', 'latin1'),
  ]);

  const text = extractPdfText(pdf);

  assert.match(text, /Zysk netto/);
  assert.match(text, /403186/);
});

test('PDF text extractor applies embedded ToUnicode maps and reconstructs table rows', () => {
  const cmap = `/CIDInit /ProcSet findresource begin
begincmap
1 beginbfchar
<0001> <0057>
endbfchar
1 beginbfrange
<0002> <0005> [<0079> <006E> <0069> <006B>]
endbfrange
endcmap`;
  const content = Buffer.concat([
    Buffer.from('BT /F4 10 Tf 1 0 0 1 20 700 Tm [('),
    Buffer.from([0, 1, 0, 2, 0, 3, 0, 4, 0, 5]),
    Buffer.from(')] TJ ET\nBT /F2 10 Tf 1 0 0 1 200 700 Tm (1 284 780) Tj ET'),
  ]);
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<</Type/Font/Subtype/Type0/ToUnicode 2 0 R>>\nendobj\n'),
    Buffer.from('2 0 obj\n<</Filter/FlateDecode>>\nstream\n'),
    zlib.deflateSync(Buffer.from(cmap, 'latin1')),
    Buffer.from('\nendstream\nendobj\n3 0 obj\n<</Font<</F4 1 0 R>>>>\nendobj\n'),
    Buffer.from('4 0 obj\n<</Filter/FlateDecode>>\nstream\n'),
    zlib.deflateSync(content),
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);

  const text = extractPdfText(pdf);

  assert.match(text, /Wynik 1 284 780/);
});

test('PDF text extractor keeps adjacent numeric table cells separated', () => {
  const stream = zlib.deflateSync(Buffer.from(
    'BT [(476) 12 (314)] TJ [(244) 12 (502)] TJ [(257) 12 (812)] TJ (5) Tj (-17,6%) Tj ET',
    'latin1',
  ));
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'),
    stream,
    Buffer.from('\nendstream\n%%EOF', 'latin1'),
  ]);

  const text = extractPdfText(pdf);

  assert.match(text, /476314\s+244502\s+257812\s+5\s+-17,6%/);
  assert.equal(text.includes('4763142445022578125'), false);
});

test('Perplexity adapter retries transient socket failures', async () => {
  let calls = 0;
  const socketError = new TypeError('fetch failed');
  socketError.cause = { code: 'UND_ERR_SOCKET' };

  const analysis = await analyzeDocumentsWithPerplexity({
    apiKey: 'test-key',
    profile: { assetId: 'instrument:ALR_3AWSE', type: 'instrument', name: 'Alior Bank', canonicalId: 'ALR:WSE' },
    documents: [{ id: 'doc_1', filename: 'q1.txt', title: 'Raport Q1', type: 'raport kwartalny', period: 'Q1 2026', sourceUrl: 'https://issuer.example/q1.txt', mimeType: 'text/plain' }],
    documentBuffers: [Buffer.from('Zysk netto 100 mln PLN')],
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw socketError;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          schemaVersion: '2.0',
          title: 'Analiza po retry',
          reportPeriod: 'Q1 2026',
          summary: 'Retry zadzialal.',
          structuredSummary: {
            headline: 'Retry zadzialal.',
            stance: 'mieszany',
            sections: [{ title: 'Najważniejsze fakty', bullets: [{ text: 'Test.' }] }],
          },
          metricFacts: [],
          risks: [],
          conclusions: [],
          extractionWarnings: [],
        }) } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  assert.equal(calls, 2);
  assert.equal(analysis.content.title, 'Analiza po retry');
});

test('Perplexity adapter explains TLS certificate failures from local Node fetch', async () => {
  const tlsError = new TypeError('fetch failed');
  tlsError.cause = { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' };

  await assert.rejects(
    () => analyzeDocumentsWithPerplexity({
      apiKey: 'test-key',
      profile: { assetId: 'instrument:ALR_3AWSE', type: 'instrument', name: 'Alior Bank', canonicalId: 'ALR:WSE' },
      documents: [{ id: 'doc_1', filename: 'q1.pdf', title: 'Raport Q1', type: 'raport kwartalny', period: 'Q1 2026', sourceUrl: 'https://issuer.example/q1.pdf', mimeType: 'application/pdf' }],
      documentBuffers: [Buffer.from('%PDF-test')],
      fetchImpl: async () => {
        throw tlsError;
      },
    }),
    (error) => {
      assert.equal(error.code, 'PERPLEXITY_UNAVAILABLE');
      assert.equal(error.status, 502);
      assert.match(error.message, /UNABLE_TO_VERIFY_LEAF_SIGNATURE/);
      assert.match(error.message, /--use-system-ca/);
      return true;
    },
  );
});
