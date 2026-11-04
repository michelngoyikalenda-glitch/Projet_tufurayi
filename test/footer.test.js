import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('le pied de page affiche les liens WhatsApp et Gmail', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  try {
    const { Footer } = await vite.ssrLoadModule('/src/components.tsx');
    const html = renderToStaticMarkup(createElement(Footer));

    assert.match(html, /href="https:\/\/wa\.me\/243854256490"/);
    assert.match(html, /target="_blank" rel="noopener noreferrer"/);
    assert.match(html, /href="mailto:jeanpytufurayi9@gmail\.com"/);
    assert.match(html, /<img[^>]*src="[^"]*contact-whatsapp\.jpg"[^>]*alt=""/);
    assert.match(html, /<img[^>]*src="[^"]*contact-gmail\.jpg"[^>]*alt=""/);
    assert.match(html, /WhatsApp/);
    assert.match(html, /Gmail/);
    assert.match(html, /role="contentinfo"/);
    assert.ok(html.indexOf(`© ${new Date().getFullYear()} Tufurayi. Tous droits réservés.`) > html.indexOf('Fait pour apprendre.'));
  } finally {
    await vite.close();
  }
});
