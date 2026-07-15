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

test('approved analysis persists report metric facts once per asset, metric, period and document', async () => {
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
      assert.equal(approvedMetrics.length, 3);
      const netIncome = approvedMetrics.find((metric) => metric.metricKey === 'net_income');
      assert.equal(netIncome.value, 100);
      assert.equal(netIncome.valueNumeric, 100);
      assert.equal(netIncome.documentId, saved.document.id);
      assert.equal(netIncome.page, 12);
      assert.equal(netIncome.aggregation, 'sum');
      assert.equal(netIncome.source.evidence, 'Zysk netto 100 tys. PLN');
      const comparativeAssets = approvedMetrics.find((metric) => metric.metricKey === 'assets_total');
      assert.equal(comparativeAssets.period, 'Q1 2025');

      store.approveAnalysis(draft.id);
      assert.equal(store.listApprovedReportMetrics('company:WSE:CDR').length, 3);

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
      const updatedNetIncome = afterUpdate.find((metric) => metric.metricKey === 'net_income');
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
      assert.equal(afterDelete.length, 2);
      assert.equal(afterDelete.some((metric) => metric.metricKey === 'net_income'), false);
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

test('approved analysis derives dividend net profit ratio only from matching PLN source facts', async () => {
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
              value: 1000,
              unit: 'tys. PLN',
              period: '2025',
              page: 10,
              section: 'Rachunek wynikow',
              quote: 'Zysk netto 1 000 tys. PLN',
              confidence: 0.91,
            },
            {
              metricKey: 'dividend_amount',
              label: 'Dywidenda',
              value: 250,
              unit: 'tys. PLN',
              period: '2025',
              page: 20,
              section: 'Podzial zysku',
              quote: 'Dywidenda 250 tys. PLN',
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
          'X-Document-Type': encodeURIComponent('raport kwartalny'),
          'X-Reporting-Period': encodeURIComponent('Q1 2026'),
        },
        body: 'treść ręcznego raportu',
      });
      const uploadPayload = await uploadResponse.json();
      assert.equal(uploadResponse.status, 201);
      assert.equal(uploadPayload.data.document.filename, 'manual.txt');

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
        reportPeriod: 'Q1 2026', 
        summary: 'Podsumowanie.', 
        structuredSummary: {
          headline: 'Wynik netto wzrosl, ale jakosc wyniku wymaga sprawdzenia kosztow ryzyka.',
          stance: 'mieszany',
          sections: [
            {
              title: 'Najwazniejsze fakty',
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
              title: 'Jakosc wyniku',
              bullets: [{ text: 'Jakosc wyniku nalezy oceniac razem z powtarzalnoscia przychodow i kosztami ryzyka.' }],
            },
            {
              title: 'Ryzyka i kapital',
              bullets: [{ text: 'Ryzyka bankowe wymagaja osobnej kontroli kapitalu, NPL i kosztu ryzyka.' }],
            },
            {
              title: 'Co sprawdzic dalej',
              bullets: [{ text: 'W kolejnym kroku warto sprawdzic pelne noty do wyniku i kapitalu.' }],
            },
          ],
        },
        metricFacts: [{ 
          metricKey: 'net_income', 
          label: 'Zysk netto',
          value: 100,
          unit: 'mln PLN',
          period: 'Q1 2026',
          page: 2,
          section: 'Rachunek zyskow i strat',
          quote: 'Zysk netto 100 mln PLN',
          confidence: 0.95,
        }],
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
          reason: 'Brak pewnego zrodla.',
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
    documents: [{ id: 'doc_1', filename: 'q1.pdf', title: 'Raport Q1', type: 'raport kwartalny', period: 'Q1 2026', sourceUrl: 'https://issuer.example/q1.pdf', mimeType: 'application/pdf' }],
    documentBuffers: [pdfBuffer],
    fetchImpl,
  });
  assert.equal(analysis.model, 'sonar-pro');
  assert.equal(analysis.content.schemaVersion, '2.0'); 
  assert.equal(analysis.content.summary, 'Podsumowanie.'); 
  assert.equal(analysis.content.structuredSummary.headline, 'Wynik netto wzrosl, ale jakosc wyniku wymaga sprawdzenia kosztow ryzyka.'); 
  assert.equal(analysis.content.structuredSummary.sections[0].bullets[0].metricKeys[0], 'net_income'); 
  assert.equal(analysis.content.metricFacts[0].metricKey, 'net_income'); 
  assert.equal(analysis.content.metrics[0].label, 'Zysk netto');
  assert.equal(analysis.content.extractionWarnings[0].metricKey, 'roe');
  assert.equal(analysis.content.citations[0].url, 'https://issuer.example/q1.pdf');
  assert.equal(requests[1].body.model, 'sonar-pro'); 
  assert.equal(requests[1].body.response_format.json_schema.schema.required.includes('structuredSummary'), true); 
  assert.equal(requests[1].body.response_format.json_schema.schema.required.includes('metricFacts'), true); 
  assert.deepEqual(requests[1].body.response_format.json_schema.schema.properties.schemaVersion.enum, ['2.0']); 
  assert.match(requests[1].body.messages[1].content[0].text, /structuredSummary/); 
  assert.match(requests[1].body.messages[1].content[0].text, /analityk dla czlowieka/); 
  assert.match(requests[1].body.messages[1].content[0].text, /Najwazniejsze fakty/); 
  assert.match(requests[1].body.messages[1].content[0].text, /Zmiana vs rok temu/); 
  assert.match(requests[1].body.messages[1].content[0].text, /bez rekomendacji inwestycyjnej/); 
  assert.match(requests[1].body.messages[1].content[0].text, /Katalog metryk do ekstrakcji/); 
  assert.match(requests[1].body.messages[1].content[0].text, /extractionWarnings/);
  assert.match(requests[1].body.messages[1].content[0].text, /kolumny porownawcze/);
  assert.match(requests[1].body.messages[1].content[0].text, /31\.03\.YYYY/);
  assert.match(requests[1].body.messages[1].content[0].text, /Reguly profilu bankowego/);
  assert.match(requests[1].body.messages[1].content[0].text, /priorytetem jest bankowy katalog metryk/);
  assert.match(requests[1].body.messages[1].content[0].text, /nazwach polskich, nazwach angielskich oraz skrotach/);
  assert.match(requests[1].body.messages[1].content[0].text, /Return on Equity/);
  assert.match(requests[1].body.messages[1].content[0].text, /PLN \/ tys\. PLN \/ mln PLN/);
  assert.match(requests[1].body.messages[1].content[0].text, /wszystkie wiarygodne okresy widoczne w tabeli/);
  assert.match(requests[1].body.messages[1].content[0].text, /"metricKey": "cost_income_ratio"/);
  assert.match(requests[1].body.messages[1].content[0].text, /"metricKey": "loan_deposit_ratio"/);
  assert.equal(requests[1].body.messages[1].content[1].type, 'text');
  assert.match(requests[1].body.messages[1].content[1].text, /tekst wyodrebniony lokalnie z PDF/);
  assert.match(requests[1].body.messages[1].content[1].text, /Zysk netto 100 mln PLN/);
  assert.equal(JSON.stringify(requests[1].body.messages[1].content).includes('file_url'), false);
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
