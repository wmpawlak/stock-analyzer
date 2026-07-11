import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANALYSIS_ASSET_IDS,
  getPortfolioAnalysisAssets,
  mergeAnalysisProfiles,
  resolveAnalysisIdentity,
} from '../src/utils/analysisAssets.js';

test('resolveAnalysisIdentity recognises the CD Projekt portfolio alias in a Markdown link', () => {
  const profile = resolveAnalysisIdentity({
    value: '[CDR:WSE CDPROJEKT](https://strefainwestorow.pl/notowania/gpw/cdprojekt-cdr)',
  });

  assert.equal(profile.assetId, ANALYSIS_ASSET_IDS.CDR);
  assert.equal(profile.type, 'company');
  assert.equal(profile.ticker, 'CDR');
  assert.equal(profile.exchange, 'WSE');
});

test('resolveAnalysisIdentity maps EIMI to its canonical ISIN profile', () => {
  const profile = resolveAnalysisIdentity({ value: 'EIMI:LON ETF MSCI RM IMI' });

  assert.equal(profile.assetId, ANALYSIS_ASSET_IDS.EIMI);
  assert.equal(profile.type, 'etf');
  assert.equal(profile.isin, 'IE00BKM4GZ66');
});

test('getPortfolioAnalysisAssets keeps one research profile with separate positions per portfolio', () => {
  const assets = getPortfolioAnalysisAssets({
    'Portfel Makler': [{ 'Akcje i inne instrumenty': 'CDR:WSE CDPROJEKT', Ilość: '10' }],
    'Portfel IKZE': [{ 'Akcje i inne instrumenty': 'CDR:WSE CDPROJEKT', Ilość: '5' }],
  });

  assert.equal(assets.length, 1);
  assert.equal(assets[0].assetId, ANALYSIS_ASSET_IDS.CDR);
  assert.deepEqual(assets[0].portfolios, ['Portfel Makler', 'Portfel IKZE']);
  assert.equal(assets[0].positions.length, 2);
  assert.equal(assets[0].positions[0].row.Ilość, '10');
  assert.equal(assets[0].positions[1].row.Ilość, '5');
});

test('mergeAnalysisProfiles preserves pilot sources when the helper only returns analysis metadata', () => {
  const profiles = mergeAnalysisProfiles([], [{
    assetId: ANALYSIS_ASSET_IDS.EIMI,
    name: 'EIMI',
    latestAnalysis: { id: 'analysis-1', status: 'approved' },
  }]);
  const eimi = profiles.find((profile) => profile.assetId === ANALYSIS_ASSET_IDS.EIMI);

  assert.ok(eimi);
  assert.ok(eimi.sources.length >= 3);
  assert.equal(eimi.latestAnalysis.id, 'analysis-1');
});
