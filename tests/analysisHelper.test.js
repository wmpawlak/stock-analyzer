import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createStoredZip, extractZipSafely, inspectZip } from '../server/zip.js';
import { createAnalysisStore } from '../server/storage.js';
import { startAnalysisHelper } from '../server/index.js';
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
      : JSON.stringify({ schemaVersion: '1.0', title: 'Analiza Q1', reportPeriod: 'Q1 2026', summary: 'Podsumowanie.', conclusions: [{ text: 'Wniosek.' }], metrics: [{ label: 'Przychody', value: 100, unit: 'mln PLN', period: 'Q1 2026', trend: 'wzrost', yearOverYear: 10, source: 'strona 2' }], risks: [{ text: 'Ryzyko.' }] });
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
      citations: ['https://issuer.example/q1.pdf'],
      usage: { cost: { total_cost: 0.12 } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const profile = { assetId: 'company:WSE:CDR', type: 'company', name: 'CD PROJEKT', canonicalId: 'WSE:CDR' };

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

  const analysis = await analyzeDocumentsWithPerplexity({
    apiKey: 'test-key',
    profile,
    documents: [{ id: 'doc_1', filename: 'q1.pdf', title: 'Raport Q1', type: 'raport kwartalny', period: 'Q1 2026', sourceUrl: 'https://issuer.example/q1.pdf' }],
    documentBuffers: [Buffer.from('%PDF-test')],
    fetchImpl,
  });
  assert.equal(analysis.model, 'sonar-pro');
  assert.equal(analysis.content.summary, 'Podsumowanie.');
  assert.equal(analysis.content.citations[0].url, 'https://issuer.example/q1.pdf');
  assert.equal(requests[1].body.model, 'sonar-pro');
  assert.equal(requests[1].body.messages[1].content[1].type, 'file_url');
});
