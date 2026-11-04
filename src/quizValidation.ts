import type { QuestionInput } from './types';

export type QuizIssue = { question?: number; field: string; message: string };

export function validateQuiz(title: string, questions: QuestionInput[]): QuizIssue[] {
  const issues: QuizIssue[] = [];
  if (title.trim().length < 3 || title.trim().length > 100) {
    issues.push({ field: 'quiz-title', message: 'Le titre du quiz doit contenir entre 3 et 100 caractères.' });
  }
  if (questions.length < 1 || questions.length > 50) {
    issues.push({ field: 'quiz-title', message: 'Le quiz doit contenir entre 1 et 50 questions.' });
  }
  questions.forEach((question, index) => {
    const add = (field: string, message: string) => issues.push({
      question: index, field, message: `Question ${index + 1} : ${message}`
    });
    if (question.text.trim().length < 3 || question.text.trim().length > 1000) {
      add('question-text', 'saisissez un énoncé de 3 à 1 000 caractères.');
    }
    if (question.answers.length < 2 || question.answers.length > 6) {
      add('question-text', 'ajoutez entre 2 et 6 réponses.');
    }
    question.answers.forEach((answer, answerIndex) => {
      if (!answer.text.trim() || answer.text.trim().length > 500) {
        add(`answer-${answerIndex}`, `la réponse ${answerIndex + 1} doit contenir entre 1 et 500 caractères.`);
      }
    });
    if (question.answers.filter(answer => answer.correct).length !== 1) {
      add('question-text', 'sélectionnez une seule bonne réponse avec la coche.');
    }
    if (!Number.isInteger(question.duration) || question.duration < 5 || question.duration > 120) {
      add('question-duration', 'le temps de réponse doit être un entier entre 5 et 120 secondes.');
    }
    if (question.explanation.length > 2000) {
      add('question-explanation', 'l’explication ne doit pas dépasser 2 000 caractères.');
    }
  });
  return issues;
}
