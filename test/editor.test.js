import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('éditeur : toutes les questions sont validées, même les onglets masqués', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  try {
    const { validateQuiz } = await vite.ssrLoadModule('/src/quizValidation.ts');
    const valid = () => ({
      text: 'Quelle est la bonne réponse ?', explanation: '', duration: 20,
      answers: [{ text: 'Oui', correct: true }, { text: 'Non', correct: false }]
    });
    const questions = Array.from({ length: 5 }, valid);
    questions[1].text = '  ';
    questions[1].answers[0].text = '';
    questions[1].answers[1].text = '   ';
    const issues = validateQuiz('Quiz de test', questions);
    assert.equal(issues.length, 3);
    assert.ok(issues.every(issue => issue.question === 1));
    assert.equal(issues[0].field, 'question-text');
    assert.match(issues[0].message, /Question 2/);
    assert.match(issues[1].message, /réponse 1/);
    assert.match(issues[2].message, /réponse 2/);
    assert.deepEqual(validateQuiz('Quiz de test', Array.from({ length: 5 }, valid)), []);
    assert.match(validateQuiz('  ', [valid()])[0].message, /titre/);
    const invalid = valid();
    invalid.duration = 5.5;
    invalid.answers[1].correct = true;
    assert.ok(validateQuiz('Quiz', [invalid]).some(issue => issue.field === 'question-duration'));
    assert.ok(validateQuiz('Quiz', [invalid]).some(issue => /une seule bonne réponse/.test(issue.message)));
  } finally {
    await vite.close();
  }
});
