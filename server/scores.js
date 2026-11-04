// Keep the original question points in storage so existing results need no migration.
export function quizScore(points, questionCount) {
  if (!Number.isInteger(Number(questionCount)) || Number(questionCount) < 1) {
    throw new Error('Le calcul du score nécessite au moins une question.');
  }
  return Math.round(Number(points) / Number(questionCount));
}

export function questionPoints(totalPoints, points, questionCount) {
  return quizScore(totalPoints, questionCount) - quizScore(totalPoints - points, questionCount);
}
