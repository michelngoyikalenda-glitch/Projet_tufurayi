import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('la vitrine présente les 22 images et permet de mettre le défilement en pause', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  try {
    const { PrizeShowcase, prizeResumeDelay } = await vite.ssrLoadModule('/src/PrizeShowcase.tsx');
    const html = renderToStaticMarkup(createElement(PrizeShowcase, { onPlay() {} }));
    const images = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]);
    const descriptions = [...html.matchAll(/<img\b[^>]*\balt="([^"]+)"/g)].map(match => match[1]);

    assert.equal(images.length, 44);
    assert.equal(new Set(images).size, 22);
    assert.equal(new Set(descriptions).size, 22);
    assert.equal((html.match(/<ul\b[^>]*aria-hidden="true"/g) || []).length, 2);
    assert.match(html, /tentez de gagner des cadeaux et des surprises/);
    assert.match(html, /Mettre l’animation en pause/);
    assert.match(html, /Explorer les quiz/);
    assert.match(html, /cadeaux éventuels dépendent des conditions des défis/);
    assert.equal(prizeResumeDelay(25, 100, 60, false), -15);
    assert.equal(prizeResumeDelay(125, 100, 60, false), -15);
    assert.equal(prizeResumeDelay(25, 100, 60, true), -45);
  } finally {
    await vite.close();
  }
});
