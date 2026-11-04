import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { openDatabase } from './db.js';

if (process.env.NODE_ENV === 'production') throw new Error('Les comptes de démonstration sont interdits en production.');
const db = await openDatabase();
try {
  const password = await bcrypt.hash('DemoQuiz2026!', 12);
  await db.transaction(async tx => {
    for (const [email, pseudo, role] of [
      ['alex@demo.fr', 'Alex', 'player'], ['camille@demo.fr', 'Camille', 'creator'], ['admin@demo.fr', 'Admin', 'admin']
    ]) {
      if (!(await tx.query('SELECT id FROM users WHERE email=?', [email])).length)
        await tx.query('INSERT INTO users (id,email,password_hash,pseudo,role,verified,avatar,created_at) VALUES (?,?,?,?,?,1,?,?)',
          [randomUUID(), email, password, pseudo, role, role === 'creator' ? 'pink' : 'indigo', Date.now()]);
    }
    const [owner] = await tx.query('SELECT id FROM users WHERE email=?', ['camille@demo.fr']);
    const examples = [
      { title: 'Le grand quiz de culture générale', description: 'Un peu de tout, beaucoup de découvertes. Prêt à tester votre curiosité ?', category: 'Culture générale', cover: 'violet',
        questions: [
          ['Quelle planète est surnommée la planète rouge ?', ['Vénus', 'Mars', 'Jupiter', 'Mercure'], 1, 'L’oxyde de fer présent à sa surface donne à Mars sa couleur rouge.'],
          ['Combien de cordes possède une guitare classique ?', ['4', '5', '6', '8'], 2, 'Une guitare classique possède six cordes.'],
          ['Quel est le plus grand océan du monde ?', ['Atlantique', 'Indien', 'Arctique', 'Pacifique'], 3, 'Le Pacifique couvre environ un tiers de la surface terrestre.'],
          ['Qui a peint La Nuit étoilée ?', ['Claude Monet', 'Vincent van Gogh', 'Pablo Picasso', 'Henri Matisse'], 1, 'Vincent van Gogh a peint ce tableau en 1889.'],
          ['Dans quel pays se trouve le Machu Picchu ?', ['Mexique', 'Chili', 'Pérou', 'Bolivie'], 2, 'Cette ancienne cité inca se situe dans les Andes péruviennes.']
        ] },
      { title: 'Aux frontières de la science', description: 'De l’infiniment petit à l’immensité de l’espace : partez à la découverte des sciences.', category: 'Sciences', cover: 'blue',
        questions: [
          ['Quelle est la formule chimique de l’eau ?', ['CO₂', 'H₂O', 'O₂', 'NaCl'], 1, 'Une molécule d’eau contient deux atomes d’hydrogène et un atome d’oxygène.'],
          ['Quelle force nous maintient au sol ?', ['Le magnétisme', 'La gravitation', 'La friction', 'La tension'], 1, 'La gravitation est une attraction entre les objets qui ont une masse.'],
          ['Quel organe pompe le sang ?', ['Le foie', 'Le poumon', 'Le cœur', 'Le rein'], 2, 'Le cœur propulse le sang à travers le système circulatoire.'],
          ['Quelle unité mesure la résistance électrique ?', ['Le volt', 'L’ampère', 'Le watt', 'L’ohm'], 3, 'L’ohm, symbole Ω, est l’unité de résistance électrique.']
        ] },
      { title: 'Un tour du monde en questions', description: 'Capitales, paysages et merveilles : votre prochain voyage commence ici.', category: 'Géographie', cover: 'green',
        questions: [
          ['Quelle est la capitale de la République démocratique du Congo ?', ['Lubumbashi', 'Kinshasa', 'Goma', 'Kisangani'], 1, 'Kinshasa est la capitale et la plus grande ville de la RDC.'],
          ['Sur quel continent se trouve le désert du Sahara ?', ['Asie', 'Amérique', 'Afrique', 'Europe'], 2, 'Le Sahara s’étend sur l’Afrique du Nord.'],
          ['Quelle est la capitale du Japon ?', ['Séoul', 'Pékin', 'Kyoto', 'Tokyo'], 3, 'Tokyo est la capitale du Japon.'],
          ['Quel pays a la forme d’une botte ?', ['Grèce', 'Italie', 'Espagne', 'Portugal'], 1, 'La péninsule italienne évoque la forme d’une botte.']
        ] },
      { title: 'Les grandes pages de l’histoire', description: 'Remontez le temps et redécouvrez les événements qui ont changé le monde.', category: 'Histoire', cover: 'orange',
        questions: [
          ['En quelle année le premier humain a-t-il marché sur la Lune ?', ['1959', '1969', '1979', '1989'], 1, 'Neil Armstrong a marché sur la Lune le 21 juillet 1969 (UTC).'],
          ['Quelle civilisation a construit les pyramides de Gizeh ?', ['Les Romains', 'Les Mayas', 'Les Égyptiens', 'Les Grecs'], 2, 'Les pyramides de Gizeh ont été construites dans l’Égypte antique.'],
          ['En quelle année le mur de Berlin est-il tombé ?', ['1979', '1989', '1999', '2009'], 1, 'Le mur de Berlin a été ouvert le 9 novembre 1989.']
        ] },
      { title: 'La tech, vous maîtrisez ?', description: 'Internet, code et innovations : mettez vos connaissances numériques à l’épreuve.', category: 'Technologie', cover: 'navy',
        questions: [
          ['Que signifie HTML ?', ['HyperText Markup Language', 'High Tech Modern Logic', 'Hyperlink Text Machine Learning', 'Home Tool Markup Language'], 0, 'HTML décrit la structure des pages web.'],
          ['Quel langage est exécuté nativement dans un navigateur ?', ['Python', 'JavaScript', 'C++', 'Ruby'], 1, 'JavaScript rend les pages web interactives.'],
          ['Quel protocole sécurise les échanges sur le web ?', ['FTP', 'HTTP', 'HTTPS', 'SMTP'], 2, 'HTTPS utilise TLS pour chiffrer la communication.']
        ] },
      { title: 'À vous de jouer, les sportifs !', description: 'Des stades aux podiums, un défi pour les passionnés de sport.', category: 'Sport', cover: 'pink',
        questions: [
          ['Combien de joueurs compte une équipe de football sur le terrain ?', ['9', '10', '11', '12'], 2, 'Une équipe de football joue avec onze joueurs, gardien inclus.'],
          ['Combien d’anneaux figurent sur le drapeau olympique ?', ['4', '5', '6', '7'], 1, 'Les cinq anneaux représentent l’union des cinq continents.'],
          ['Quel sport se joue à Roland-Garros ?', ['Le golf', 'Le tennis', 'Le rugby', 'Le basket'], 1, 'Roland-Garros est un tournoi de tennis sur terre battue.']
        ] }
    ];
    for (const quiz of examples) {
      if ((await tx.query('SELECT id FROM quizzes WHERE title=? AND owner_id=?', [quiz.title, owner.id])).length) continue;
      const id = randomUUID();
      await tx.query('INSERT INTO quizzes (id,owner_id,title,description,category,cover,visibility,invitation_code,published,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)',
        [id, owner.id, quiz.title, quiz.description, quiz.category, quiz.cover, 'public', 'DEMO', Date.now()]);
      const order = [];
      for (const [position, [text, answers, correct, explanation]] of quiz.questions.entries()) {
        const qid = randomUUID(); order.push(qid);
        await tx.query('INSERT INTO questions (id,quiz_id,text,explanation,duration,position) VALUES (?,?,?,?,?,?)', [qid, id, text, explanation, 20, position]);
        for (const [i, answer] of answers.entries()) await tx.query('INSERT INTO answers (id,question_id,text,correct) VALUES (?,?,?,?)', [randomUUID(), qid, answer, Number(i === correct)]);
      }
      const now = Date.now();
      for (const mode of ['async', 'live']) await tx.query('INSERT INTO sessions (id,quiz_id,mode,opens_at,closes_at,question_order,created_at) VALUES (?,?,?,?,?,?,?)',
        [randomUUID(), id, mode, now - 60000, now + 30 * 86400000, JSON.stringify(order), now]);
    }
  });
  console.info('Démonstration prête. Mot de passe : DemoQuiz2026!\nJoueur : alex@demo.fr\nCréatrice : camille@demo.fr\nAdmin : admin@demo.fr');
} finally { await db.close(); }