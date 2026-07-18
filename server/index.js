import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  AppError,
  MAX_BACKUP_BYTES,
  contentDispositionAttachment,
  decodeHeaderValue,
  decodePathPart,
  fetchExternalDocument,
  guessMimeType,
  readJsonBody,
  readRequestBody,
  safeFilename,
  sendData,
  sendError,
  stringOrEmpty,
} from './utils.js';
import { createAnalysisStore } from './storage.js';
import {
  analyzeDocumentsWithPerplexity,
  discoverCandidatesWithPerplexity,
} from './perplexity.js';
import {
  validateAnalysisDocumentSelection,
  validateReportDocumentMetadata,
} from '../shared/reportDocuments.js';

const API_PREFIX = '/api/analysis';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4310;
const DISCOVERY_BUDGET_RESERVE_USD = 0.25;
const ANALYSIS_BUDGET_RESERVE_USD = 1.25;
const MAX_ANALYSIS_INPUT_BYTES = 100 * 1024 * 1024;
const MAX_BROWSER_STATE_BYTES = 10 * 1024 * 1024;

const getPort = (value) => {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : DEFAULT_PORT;
};

const readPerplexityApiKey = async (envPath = path.resolve(process.cwd(), '.env.local')) => {
  const fromEnvironment = stringOrEmpty(process.env.PERPLEXITY_API_KEY);
  if (fromEnvironment) return fromEnvironment;
  try {
    const content = await readFile(envPath, 'utf8');
    const line = content.split(/\r?\n/).find((entry) => /^\s*(?:export\s+)?PERPLEXITY_API_KEY\s*=/.test(entry));
    if (!line) return '';
    const value = line.replace(/^\s*(?:export\s+)?PERPLEXITY_API_KEY\s*=\s*/, '').trim();
    if (!value) return '';
    return value.replace(/^(['"])(.*)\1$/, '$2').trim();
  } catch {
    return '';
  }
};

const pathParts = (pathname) => {
  if (pathname === API_PREFIX || pathname === `${API_PREFIX}/`) return [];
  if (!pathname.startsWith(`${API_PREFIX}/`)) return null;
  return pathname.slice(API_PREFIX.length + 1).split('/').filter(Boolean).map(decodePathPart);
};

const sendDocument = async (response, store, documentId) => {
  const document = store.getDocumentRow(documentId);
  let content;
  try {
    content = await readFile(store.getDocumentPath(document));
  } catch {
    throw new AppError('DOCUMENT_FILE_MISSING', 'Zarchiwizowany plik dokumentu nie istnieje na dysku.', 404);
  }
  response.writeHead(200, {
    'Content-Type': document.mime_type || guessMimeType(document.filename),
    'Content-Disposition': contentDispositionAttachment(document.filename),
    'Content-Length': content.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(content);
};

const sendBackup = async (response, store, filename) => {
  const cleanFilename = safeFilename(filename);
  const backupPath = path.join(store.backupsDir, cleanFilename);
  let content;
  try {
    content = await readFile(backupPath);
  } catch {
    throw new AppError('BACKUP_NOT_FOUND', 'Plik backupu nie istnieje.', 404);
  }
  response.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': contentDispositionAttachment(cleanFilename),
    'Content-Length': content.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(content);
};

const toApiProfile = (profile) => ({
  ...profile,
  id: profile.assetId,
});

const requireProfile = (store, assetId) => toApiProfile(store.getProfile(assetId));

const handleRoute = async ({ request, response, store, apiKey, fetchImpl }) => {
  const method = request.method || 'GET';
  const url = new URL(request.url || '/', `http://${request.headers.host || DEFAULT_HOST}`);
  const parts = pathParts(url.pathname);
  if (!parts) throw new AppError('NOT_FOUND', 'Nie znaleziono endpointu helpera.', 404);

  if (method === 'OPTIONS') {
    response.writeHead(204, {
      Allow: 'GET, POST, PATCH, DELETE, OPTIONS',
      'Cache-Control': 'no-store',
    });
    response.end();
    return;
  }

  if (parts.length === 1 && parts[0] === 'health' && method === 'GET') {
    sendData(response, {
      status: 'online',
      version: '1.0',
      dataDirectory: 'data',
      perplexityConfigured: Boolean(apiKey),
    });
    return;
  }

  if (parts[0] === 'state') {
    if (parts.length === 1 && method === 'GET') {
      sendData(response, store.listAppState());
      return;
    }
    if (parts.length === 1 && method === 'PATCH') {
      const body = await readJsonBody(request);
      sendData(response, store.updateAppState(body.state && typeof body.state === 'object' ? body.state : body));
      return;
    }
    if (parts.length === 2 && parts[1] === 'migrate' && method === 'POST') {
      const body = await readJsonBody(request, MAX_BROWSER_STATE_BYTES);
      sendData(response, store.migrateAppState(body.localStorage || body));
      return;
    }
    if (parts.length === 2 && method === 'DELETE') {
      sendData(response, store.deleteAppStateKey(parts[1]));
      return;
    }
  }

  if (parts.length === 1 && parts[0] === 'profiles') {
    if (method === 'GET') {
      sendData(response, { profiles: store.listProfiles().map(toApiProfile) });
      return;
    }
    if (method === 'POST') {
      const profile = store.upsertProfile(await readJsonBody(request));
      sendData(response, { profile: toApiProfile(profile) }, 201);
      return;
    }
  }

  if (parts.length === 2 && parts[0] === 'profiles' && parts[1] === 'sync' && method === 'POST') {
    const body = await readJsonBody(request);
    const profiles = store.syncProfiles(body.positions).map(toApiProfile);
    sendData(response, { profiles });
    return;
  }

  if (parts[0] === 'profiles' && parts.length >= 2) {
    const assetId = parts[1];
    if (parts.length === 2) {
      if (method === 'GET') {
        sendData(response, toApiProfile(store.getProfile(assetId)));
        return;
      }
      if (method === 'PATCH') {
        sendData(response, { profile: toApiProfile(store.updateProfile(assetId, await readJsonBody(request))) });
        return;
      }
    }

    if (parts[2] === 'sources') {
      if (parts.length === 3) {
        if (method === 'GET') {
          sendData(response, { sources: store.listSources(assetId) });
          return;
        }
        if (method === 'POST') {
          sendData(response, { source: store.addSource(assetId, await readJsonBody(request)) }, 201);
          return;
        }
      }
      if (parts.length === 4) {
        const sourceId = parts[3];
        if (method === 'PATCH') {
          sendData(response, { source: store.updateSource(assetId, sourceId, await readJsonBody(request)) });
          return;
        }
        if (method === 'DELETE') {
          sendData(response, store.deleteSource(assetId, sourceId));
          return;
        }
      }
    }

    if (parts[2] === 'documents') {
      if (parts.length === 3 && method === 'GET') {
        sendData(response, { documents: store.listDocuments(assetId) });
        return;
      }
      if (parts.length === 4 && parts[3] === 'download' && method === 'POST') {
        const body = await readJsonBody(request);
        const download = await fetchExternalDocument({ url: body.url, fetchImpl });
        const saved = await store.saveDocument(assetId, {
          buffer: download.buffer,
          filename: body.filename || download.filename,
          title: body.title || download.filename,
          type: body.type || 'report',
          period: body.period || '',
          publishedAt: body.publishedAt || null,
          sourceUrl: download.finalUrl,
          sourceId: body.sourceId || null,
          mimeType: download.mimeType,
        });
        sendData(response, saved, 201);
        return;
      }
      if (parts.length === 4 && parts[3] === 'import' && method === 'POST') {
        const buffer = await readRequestBody(request);
        const filename = decodeHeaderValue(request.headers['x-file-name'] || 'document');
        const title = decodeHeaderValue(request.headers['x-document-title'] || filename);
        const type = decodeHeaderValue(request.headers['x-document-type'] || 'report');
        const period = decodeHeaderValue(request.headers['x-reporting-period'] || '');
        const metadata = validateReportDocumentMetadata({ type, period });
        if (!metadata.valid) throw new AppError(metadata.code, metadata.message, 400);
        const saved = await store.saveDocument(assetId, {
          buffer,
          filename,
          title,
          type: metadata.type,
          period: metadata.period,
          mimeType: String(request.headers['content-type'] || '').split(';')[0],
        });
        sendData(response, saved, 201);
        return;
      }
    }

    if (parts[2] === 'candidates') {
      if (parts.length === 3 && method === 'GET') {
        sendData(response, { candidates: store.listCandidates(assetId) });
        return;
      }
      if (parts.length === 4 && parts[3] === 'discover' && method === 'POST') {
        await readJsonBody(request); // Explicit user action; options are intentionally advisory for now.
        store.assertBudget(DISCOVERY_BUDGET_RESERVE_USD);
        const profile = requireProfile(store, assetId);
        const result = await discoverCandidatesWithPerplexity({
          apiKey,
          profile,
          sources: store.listSources(assetId),
          fetchImpl,
        });
        const candidates = result.candidates.map((candidate) => store.addCandidate(assetId, candidate));
        const budget = store.recordUsage({ action: 'discover', costUsd: result.costUsd, metadata: { model: result.model } });
        sendData(response, { candidates, citations: result.citations, costUsd: result.costUsd, budget });
        return;
      }
      if (parts.length === 5 && parts[4] === 'approve' && method === 'POST') {
        const candidateId = parts[3];
        const body = await readJsonBody(request);
        const candidate = store.getCandidateRow(assetId, candidateId);
        if (body.download === false) {
          sendData(response, { candidate: store.updateCandidateStatus(assetId, candidateId, 'approved') });
          return;
        }
        const download = await fetchExternalDocument({ url: candidate.url, fetchImpl });
        const saved = await store.saveDocument(assetId, {
          buffer: download.buffer,
          filename: download.filename,
          title: candidate.title,
          type: candidate.type,
          period: candidate.reporting_period,
          publishedAt: candidate.published_at,
          sourceUrl: download.finalUrl,
          sourceId: candidate.source_id,
          mimeType: download.mimeType,
        });
        const updated = store.updateCandidateStatus(assetId, candidateId, 'approved');
        sendData(response, { candidate: updated, ...saved }, 201);
        return;
      }
    }

    if (parts[2] === 'report-metrics') {
      if (parts.length === 3 && method === 'GET') {
        sendData(response, { metrics: store.listApprovedReportMetrics(assetId) });
        return;
      }
    }

    if (parts[2] === 'analyses') {
      if (parts.length === 3 && method === 'GET') {
        sendData(response, { analyses: store.listAnalyses(assetId) });
        return;
      }
      if (parts.length === 3 && method === 'POST') {
        const body = await readJsonBody(request);
        const documentIds = Array.isArray(body.documentIds) ? body.documentIds : [];
        const documents = documentIds.map((documentId) => store.getDocumentRow(documentId));
        if (!documents.length || documents.some((document) => document.asset_id !== assetId || !document.analyzable)) {
          throw new AppError('NO_ANALYZABLE_DOCUMENTS', 'Wybierz co najmniej jeden zarchiwizowany dokument w obsługiwanym formacie.', 400);
        }
        const selection = validateAnalysisDocumentSelection(documents);
        if (!selection.valid) throw new AppError(selection.code, selection.message, 400);
        store.assertBudget(ANALYSIS_BUDGET_RESERVE_USD);
        const profile = requireProfile(store, assetId);
        const totalInputBytes = documents.reduce((total, document) => total + Number(document.size_bytes || 0), 0);
        if (totalInputBytes > MAX_ANALYSIS_INPUT_BYTES) {
          throw new AppError('ANALYSIS_INPUT_TOO_LARGE', 'Łączny rozmiar dokumentów do analizy przekracza 100 MB.', 413);
        }
        const buffers = await Promise.all(documents.map(async (document) => {
          try {
            return await readFile(store.getDocumentPath(document));
          } catch {
            throw new AppError('DOCUMENT_FILE_MISSING', `Brakuje pliku „${document.filename}”.`, 404);
          }
        }));
        const result = await analyzeDocumentsWithPerplexity({
          apiKey,
          profile,
          documents: documents.map((document) => ({
            id: document.id,
            filename: document.filename,
            title: document.title,
            type: document.type,
            period: document.reporting_period,
            publishedAt: document.published_at,
            sourceUrl: document.source_url,
            mimeType: document.mime_type,
          })),
          documentBuffers: buffers,
          fetchImpl,
        });
        const analysis = store.createDraftAnalysis(assetId, {
          documentIds,
          content: result.content,
          model: result.model,
          provider: 'perplexity',
          costUsd: result.costUsd,
        });
        const budget = store.recordUsage({ action: 'analysis', costUsd: result.costUsd, metadata: { model: result.model, documentIds } });
        sendData(response, { analysis, budget }, 201);
        return;
      }
    }
  }

  if (parts[0] === 'documents' && parts.length === 2 && method === 'DELETE') {
    sendData(response, await store.deleteDocument(parts[1]));
    return;
  }
  if (parts[0] === 'documents' && parts.length === 3 && parts[2] === 'download' && method === 'GET') {
    await sendDocument(response, store, parts[1]);
    return;
  }

  if (parts[0] === 'analyses' && parts.length === 3 && parts[2] === 'approve' && method === 'POST') {
    await readJsonBody(request);
    sendData(response, { analysis: store.approveAnalysis(parts[1]) });
    return;
  }
  if (parts[0] === 'analyses' && parts.length === 2 && method === 'PATCH') {
    const body = await readJsonBody(request);
    sendData(response, { analysis: store.updateAnalysisTitle(parts[1], body.title) });
    return;
  }
  if (parts[0] === 'analyses' && parts.length === 2 && method === 'DELETE') {
    sendData(response, store.deleteAnalysis(parts[1]));
    return;
  }

  if (parts.length === 1 && parts[0] === 'budget') {
    if (method === 'GET') {
      sendData(response, store.getBudget());
      return;
    }
    if (method === 'PATCH') {
      const body = await readJsonBody(request);
      sendData(response, store.updateBudget(body.monthlyLimitUsd));
      return;
    }
  }

  if (parts.length === 2 && parts[0] === 'backup' && parts[1] === 'export' && method === 'POST') {
    const body = await readJsonBody(request, MAX_BROWSER_STATE_BYTES);
    const backup = await store.createBackup(body.browserState || {});
    sendData(response, {
      filename: backup.filename,
      sizeBytes: backup.sizeBytes,
      createdAt: backup.createdAt,
      downloadUrl: `${API_PREFIX}/backups/${encodeURIComponent(backup.filename)}/download`,
    }, 201);
    return;
  }
  if (parts.length === 2 && parts[0] === 'backup' && parts[1] === 'import' && method === 'POST') {
    const result = await store.importBackup(await readRequestBody(request, MAX_BACKUP_BYTES));
    sendData(response, result);
    return;
  }
  if (parts.length === 3 && parts[0] === 'backups' && parts[2] === 'download' && method === 'GET') {
    await sendBackup(response, store, parts[1]);
    return;
  }

  throw new AppError('NOT_FOUND', 'Nie znaleziono endpointu helpera.', 404);
};

export const createAnalysisServer = ({ store, apiKey = '', fetchImpl = fetch } = {}) => {
  if (!store) throw new Error('createAnalysisServer wymaga magazynu danych.');
  return createHttpServer(async (request, response) => {
    try {
      await handleRoute({ request, response, store, apiKey, fetchImpl });
    } catch (error) {
      sendError(response, error);
    }
  });
};

export const startAnalysisHelper = async ({
  host = DEFAULT_HOST,
  port = getPort(process.env.ANALYSIS_HELPER_PORT),
  dataDir = process.env.ANALYSIS_DATA_DIR || path.resolve(process.cwd(), 'data'),
  apiKey,
} = {}) => {
  if (host !== DEFAULT_HOST) {
    throw new AppError('INVALID_HOST', 'Helper analizy może działać wyłącznie na 127.0.0.1.', 400);
  }
  const store = await createAnalysisStore({ dataDir });
  const resolvedKey = apiKey === undefined ? await readPerplexityApiKey() : apiKey;
  const server = createAnalysisServer({ store, apiKey: resolvedKey });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return { server, store, host, port };
};

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  startAnalysisHelper().then(({ host, port }) => {
    // Never include configuration values or the API key in terminal output.
    process.stdout.write(`Stock Analyzer helper: http://${host}:${port}${API_PREFIX}/health\n`);
  }).catch((error) => {
    process.stderr.write(`Nie udało się uruchomić helpera: ${error.message}\n`);
    process.exitCode = 1;
  });
}
