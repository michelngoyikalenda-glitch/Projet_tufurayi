import { api } from './api';
import type { CollectiveReport } from './types';

export async function createReportPdf(report: CollectiveReport) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape' });
  const sessionStatus: Record<string, string> = {
    waiting: 'En attente', question: 'Question en cours', review: 'Correction', ended: 'Terminée'
  };
  const playerStatus: Record<string, string> = {
    playing: 'En cours', review: 'Correction', finished: 'Terminé'
  };
  const formatDate = (value: number) => new Date(Number(value)).toLocaleString('fr-FR');
  doc.setProperties({ title: `Relevé des résultats - ${report.title}`, author: 'Tufurayi' });
  doc.setFontSize(18);
  doc.text('Tufurayi - Relevé des résultats', 14, 18);
  autoTable(doc, {
    startY: 24,
    theme: 'plain',
    body: [
      ['Quiz', report.title],
      ['Catégorie', report.category],
      ['Mode', report.mode === 'live' ? 'En direct' : 'À votre rythme'],
      ['État de la session', sessionStatus[report.status] || report.status],
      ['Créée le', formatDate(report.created_at)],
      ['Session', report.id],
      ['Questions / score maximal', `${report.question_count} / 1000 points`],
      ['Joueurs', `${report.players.filter(player => player.status === 'finished').length} terminé(s) sur ${report.players.length}`],
      ...(report.status !== 'ended' ? [['Remarque', 'Relevé provisoire : la session est encore ouverte, le classement peut évoluer.']] : [])
    ],
    columnStyles: { 0: { cellWidth: 55, fontStyle: 'bold' } },
    styles: { fontSize: 10, overflow: 'linebreak' }
  });
  autoTable(doc, {
    theme: 'striped',
    head: [['Rang', 'ID du joueur', 'Joueur', 'Score / 1000', 'Bonnes réponses', 'Réponses données', 'État', 'Date de fin']],
    body: report.players.map((player, index) => [
      index + 1, player.id, player.pseudo, player.score, `${player.correct} / ${report.question_count}`,
      `${player.responses} / ${report.question_count}`, player.excluded ? 'Exclu (résultats conservés)' : playerStatus[player.status] || player.status,
      player.finished_at === null ? 'Non terminée' : formatDate(player.finished_at)
    ]),
    headStyles: { fillColor: [54, 65, 140] },
    styles: { fontSize: 9, overflow: 'linebreak', cellPadding: 3 },
    columnStyles: { 1: { cellWidth: 54, fontSize: 7 }, 2: { cellWidth: 40 } },
    margin: { bottom: 20 },
    rowPageBreak: 'avoid',
    showHead: 'everyPage'
  });
  if (!report.players.length) {
    doc.setFontSize(10);
    doc.text('Aucun joueur dans cette session.', 14, doc.internal.pageSize.getHeight() - 23);
  }
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFontSize(9);
    doc.text(`Tufurayi - Page ${page} / ${pages}`, 14, doc.internal.pageSize.getHeight() - 10);
  }
  return doc;
}

export async function downloadReport(sessionId: string) {
  const report = await api<CollectiveReport>(`/sessions/${sessionId}/report`);
  const doc = await createReportPdf(report);
  const title = report.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  await doc.save(`releve-${title || report.id}.pdf`, { returnPromise: true });
}
