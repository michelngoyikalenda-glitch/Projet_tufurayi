import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('relevé PDF : contenu français, pagination et téléchargement dans l’historique', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  try {
    const { createReportPdf } = await vite.ssrLoadModule('/src/report.ts');
    const report = {
      id: 'session-test', title: 'Défi de géographie', category: 'Géographie',
      mode: 'live', status: 'ended', created_at: 1800000000000, question_count: 2,
      players: [
        { id: '550e8400-e29b-41d4-a716-446655440000', pseudo: 'Élodie', score: 950, status: 'finished', finished_at: 1800000010000, responses: 2, correct: 2 },
        { id: '550e8400-e29b-41d4-a716-446655440001', pseudo: 'François', score: 0, status: 'finished', finished_at: 1800000020000, responses: 1, correct: 0 }
      ]
    };
    const doc = await createReportPdf(report);
    const pdf = doc.output();
    assert.match(pdf, /^%PDF-/);
    for (const text of ['Relevé des résultats', 'Défi de géographie', 'Élodie', 'François', '950', '1000 points', 'ID du joueur', ...report.players.map(player => player.id), '2 / 2', '1 / 2', 'Page 1 / 1']) {
      assert.ok(pdf.includes(text), `Texte absent du PDF : ${text}`);
    }
    assert.equal(doc.getNumberOfPages(), 1);
    assert.ok(!pdf.includes('Relevé provisoire'));
    assert.ok(!pdf.includes('Non terminée'));

    const manyPlayers = Array.from({ length: 150 }, (_, index) => ({
      ...report.players[0], id: `550e8400-e29b-41d4-a716-${String(index).padStart(12, '0')}`, pseudo: `Participant ${index + 1} au défi`, score: 950 - index
    }));
    const longDoc = await createReportPdf({ ...report, players: manyPlayers });
    const longPdf = longDoc.output();
    assert.ok(longDoc.getNumberOfPages() > 1);
    assert.ok(longPdf.includes('Participant 150 au défi'));
    assert.equal((longPdf.match(/\(Rang\)/g) || []).length, longDoc.getNumberOfPages());
    assert.ok(longPdf.includes(`Page ${longDoc.getNumberOfPages()} / ${longDoc.getNumberOfPages()}`));

    const provisional = await createReportPdf({
      ...report, mode: 'async', status: 'waiting',
      players: [{ ...report.players[0], status: 'playing', finished_at: null }]
    });
    assert.ok(provisional.output().includes('Relevé provisoire'));
    assert.ok(provisional.output().includes('Non terminée'));
    const empty = await createReportPdf({ ...report, players: [] });
    assert.ok(empty.output().includes('Aucun joueur dans cette session.'));
    const excluded = await createReportPdf({ ...report, players: [{ ...report.players[0], excluded: true }] });
    assert.ok(excluded.output().includes('Exclu'));
    assert.ok(excluded.output().includes('950'));

    const { HistoryPage } = await vite.ssrLoadModule('/src/Account.tsx');
    const historyEntry = {
      id: 'participation-test', session_id: report.id, title: report.title, category: report.category,
      mode: report.mode, score: 950, status: 'finished', finished_at: 1800000010000, question_count: 2
    };
    const renderHistory = status => renderToStaticMarkup(createElement(HistoryPage, {
      history: [{ ...historyEntry, status }], open() {}
    }));
    assert.match(renderHistory('finished'), /Télécharger le PDF/);
    assert.doesNotMatch(renderHistory('playing'), /Télécharger le PDF/);
    const excludedHistory = renderToStaticMarkup(createElement(HistoryPage, {
      history: [{ ...historyEntry, excluded: true }], open() {}
    }));
    assert.match(excludedHistory, /Exclu — résultats conservés/);
    assert.doesNotMatch(excludedHistory, /Télécharger le PDF/);
  } finally {
    await vite.close();
  }
});
