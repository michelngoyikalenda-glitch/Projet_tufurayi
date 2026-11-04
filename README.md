# Tufurayi

Application de quiz en français : comptes personnels, création de quiz, sessions en direct synchronisées et sessions en différé, correction, scores et historique persistant.

## Démarrage sur Windows

```powershell
.\start.ps1 -Demo
```

Le script installe Node.js localement dans `.tools` si nécessaire, vérifie le téléchargement officiel, installe les dépendances manquantes et initialise la démonstration. Si PowerShell bloque le script, utilisez `powershell -ExecutionPolicy Bypass -File .\start.ps1 -Demo`.

Ouvrez **http://localhost:5173**. Sans `-Demo`, aucun compte de démonstration n’est créé. Les données sont sauvegardées dans `data/tufurayi.sqlite` ; ne supprimez pas ce dossier pour conserver les comptes et les résultats.

Avec Node.js 22.13 ou plus récent déjà installé :

```powershell
npm install
npm run seed
npm run dev
```

### Comptes de démonstration (local uniquement)

| Rôle | Email | Mot de passe |
|---|---|---|
| Joueur | alex@demo.fr | DemoQuiz2026! |
| Créatrice | camille@demo.fr | DemoQuiz2026! |
| Administrateur | admin@demo.fr | DemoQuiz2026! |

La page de connexion peut préremplir ces identifiants. Pour tester le direct, connectez la créatrice dans un navigateur et un joueur dans un autre navigateur/profil privé. La créatrice ouvre une salle depuis **Mes quiz → Mes sessions** ; le joueur la rejoint depuis **Quiz en direct**. La créatrice lance la partie et passe à la question suivante après le timer.

Sur un autre appareil du même réseau, remplacez `localhost` par l’IP du PC et configurez `APP_URL=http://IP_DU_PC:5173` dans `.env`. Autorisez uniquement les ports nécessaires dans le pare-feu. Le mode HTTP local est réservé au développement.

## Fonctionnalités

- Textes de l’interface et validations en français, y compris les libellés accessibles. Les erreurs techniques sont journalisées et présentées avec un message français.
- Interface claire avec fonds crème, pêche et lavande, cartes pastel et textes secondaires noirs (y compris les indications des champs). Les alertes conservent leurs couleurs.
- Bannière Challenge Tufurayi animée sur l’accueil, le tableau de bord et les fenêtres d’authentification, avec relance et respect de la réduction des animations. Les boutons du Hero restent accessibles.
- Vitrine animée de 22 idées de cadeaux sous la bannière d’accueil et du tableau de bord, avec pause et respect de la réduction des animations. Les images sont illustratives : aucune attribution de cadeaux n’est actuellement gérée.
- Logo Tufurayi bleu et orange partagé par le menu, l’écran de chargement et les bannières.
- Pied de page commun avec les icônes et liens WhatsApp et Gmail, suivis d’une mention des droits d’auteur actualisée chaque année. Les coordonnées sont modifiables dans `Footer` de `src/components.tsx`.
- Déconnexion depuis **Mon compte → Se déconnecter** ; sur mobile, ouvrir d’abord le menu. Le menu latéral peut défiler sur les petits écrans.
- Inscription email/mot de passe (10 caractères minimum, 72 octets UTF-8 maximum pour bcrypt), email vérifié obligatoire, renvoi du lien et réinitialisation du mot de passe.
- Bouton œil pour afficher ou masquer le mot de passe à la connexion, à l’inscription et à la réinitialisation ; le mot de passe est masqué par défaut.
- Access JWT de 15 minutes, refresh token de 7 jours dans un cookie HttpOnly, rotation des refresh tokens, révocation après changement du mot de passe ou des accès.
- Tableau de bord personnel, recherche/catégories, invitations, reprise et historique.
- Éditeur de 1 à 50 questions, 2 à 6 réponses, une seule bonne réponse, 5 à 120 secondes par question ; publication/brouillon, duplication.
- Avant l’enregistrement, toutes les questions sont vérifiées, y compris les onglets masqués. Les champs à compléter sont listés avec leur numéro de question/réponse, les onglets concernés sont signalés et le premier champ invalide reçoit le focus.
- Quiz publics, privés sur liste d’emails, ou accessibles par code/liste d’emails. Le lien identifie la session, le code autorise les quiz avec code.
- **Mes quiz → Mes sessions** affiche le lien d’invitation sélectionnable et un bouton de copie. Pour les quiz de visibilité **Code ou invitation**, le code est aussi affiché et copiable ; un quiz public ne nécessite pas de code, un quiz privé reste réservé aux emails invités. Les codes ne sont pas exposés aux autres joueurs.
- Le lien d’invitation (qui contient déjà le code si nécessaire) se partage en un clic vers WhatsApp, Telegram, Gmail, email, SMS ou toute autre application du téléphone (« Autres applications »), depuis **Mes sessions** ou le bouton **Inviter un ami** de la salle. En cliquant sur le lien, un joueur connecté entre directement dans la salle ; un visiteur sans compte est invité à s’inscrire (ou à se connecter), puis, après la vérification de son email, il arrive automatiquement dans la salle. L’invitation est mémorisée 7 jours dans le navigateur et transportée dans le lien de vérification envoyé par email.
- Pour que le lien fonctionne chez les autres, l’application doit être ouverte via une adresse accessible par eux (domaine public ou IP du réseau, voir `APP_URL`) : un lien `localhost` ne fonctionne que sur votre propre ordinateur.
- **Gérer les joueurs**, dans **Mes sessions** ou dans la salle de l’animateur, permet à l’animateur ou à un administrateur d’exclure un participant avec confirmation, même après la fin du quiz. L’exclusion est permanente pour cette session seulement : retour, questions, réponses et connexion à la salle sont bloqués. Les réponses et scores acquis sont conservés dans l’historique, les statistiques, les classements et le PDF (avec mention de l’exclusion dans le relevé). Une partie en cours est arrêtée pour ce joueur. Son compte et ses autres sessions ne sont pas suspendus.
- Direct : salle d’attente, lancement et questions synchronisés, classement après chaque timer, correction finale.
- Différé : plage d’ouverture, ordre des questions mélangé par joueur, sauvegarde de progression et correction après chaque réponse.
- Une participation par utilisateur/session, une réponse par question ; reconnexion au même état. Le timer continue pendant la déconnexion.
- Chaque quiz est noté sur **1 000 points au total**, quel que soit le nombre de questions. Le serveur divise le total brut des réponses par le nombre de questions, puis arrondit à l’entier. Une réponse correcte dans le temps rapporte de 500 à 1 000 points bruts selon la rapidité ; réponse erronée ou hors délai : 0. Les points affichés par question sont les contributions au total sur 1 000, avec répartition des arrondis. En direct, ils ne sont exposés qu’après le timer. Les anciens résultats sont convertis à la lecture sans modifier les données enregistrées. Le classement général et les badges utilisent le cumul de ces notes, qui peut dépasser 1 000 pour plusieurs quiz.
- Statistiques par question et par joueur ; badges personnels calculés à partir des résultats.
- Classement général des scores cumulés des sessions terminées.
- Relevé collectif des résultats téléchargeable en PDF depuis la fin du quiz, l’historique et l’administration : classement, ID permanent de chaque joueur, scores sur 1 000, bonnes réponses, réponses enregistrées et dates de fin. Les longs classements sont répartis sur plusieurs pages. En différé, le relevé est provisoire tant que la session reste ouverte.
- Administration : rôles, suspension/réactivation, signalements et modération. Masquer un quiz clôture ses sessions.
- Administration → **Résultats collectifs → Gérer les joueurs** donne à l’administrateur l’accès aux joueurs de n’importe quelle session. En plus de l’exclusion, il peut **supprimer** un joueur non autorisé (action réservée aux administrateurs, avec confirmation) : sa participation, ses réponses et son score sont effacés définitivement (il disparaît du classement, de l’historique et du PDF de cette session) et son retour dans la session reste bloqué. Son compte et ses autres sessions ne sont pas touchés.

Un quiz ayant déjà des sessions ne peut plus être modifié : sa duplication préserve les questions liées aux résultats existants. Les nouveaux joueurs ne peuvent plus rejoindre un direct commencé ; les participants déjà inscrits peuvent revenir.

## Stockage et architecture

React + TypeScript + Vite, Express + Socket.IO, tables relationnelles `users`, `auth_tokens`, `quizzes`, `questions`, `answers`, `sessions`, `participations`, `participation_answers`, `session_exclusions`, `invitations`, `reports`.

Sans `DATABASE_URL`, SQLite local (WAL et transactions sérialisées). Avec `DATABASE_URL`, PostgreSQL et verrouillage des sessions pour sérialiser les réponses/avancements concurrents. Les tables sont créées au démarrage. SQLite et PostgreSQL sont des stockages distincts ; changer de moteur ne migre pas automatiquement les données.

Redis est optionnel : adaptateur de diffusion Socket.IO multi-serveurs et cache d’état des directs. **La base relationnelle reste la source de vérité**, y compris les délais, ce qui permet une reprise après redémarrage sans dépendre d’un cache Redis périssable. Pour plusieurs instances, utiliser PostgreSQL, Redis et un proxy avec sessions affinitaires pour le transport polling Socket.IO.

```powershell
Copy-Item .env.example .env
$env:POSTGRES_PASSWORD = 'votre-mot-de-passe-local'
docker compose up -d
```

Configurez ensuite `.env` :

```dotenv
DATABASE_URL=postgresql://tufurayi:votre-mot-de-passe-local@localhost:5432/tufurayi
REDIS_URL=redis://localhost:6379
```

Ne réutilisez pas les mots de passe d’exemple. Encodez les caractères spéciaux du mot de passe dans l’URL.

## Emails et production

En local, les liens de vérification/réinitialisation sont affichés **dans le terminal du serveur**, pas dans la réponse API. Configurez `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` et `MAIL_FROM` pour envoyer de vrais emails. Les invitations sont affichées dans l’application, sans notification email dédiée.

En production :

1. Définir `NODE_ENV=production`, `APP_URL=https://votre-domaine`, `JWT_SECRET` aléatoire (au moins 32 caractères), SMTP et `DATABASE_URL`.
2. Exécuter `npm run build`, puis `npm start` : Express sert l’interface compilée et l’API sur le même domaine.
3. Placer un reverse proxy HTTPS devant le serveur, avec support WebSocket. Les cookies sont `Secure` en production.
4. Ne pas initialiser les comptes de démonstration. Créer un compte vérifié et lui attribuer le rôle administrateur par une opération contrôlée en base.
5. Sauvegarder PostgreSQL, limiter l’exposition réseau et ajouter une politique de rétention/supervision adaptée. Adapter explicitement `trust proxy` au proxy réel avant d’utiliser une limitation par IP derrière celui-ci.

Sans secret configuré en développement, le serveur génère un secret dans `data/auth-secret`. Ne jamais publier ce fichier, `.env` ou les données de comptes.

OAuth Google/Microsoft, avatars téléversés vers S3/Cloudinary, équipes/groupes et notifications email d’invitation ne sont **pas implémentés**. Le MVP fixe une tentative par session. Les badges sont calculés, sans table de récompenses indépendante. Cette base nécessite une qualification de déploiement avant une utilisation publique.

## Vérifications

```powershell
npm test
npm run build
```

Les tests REST utilisent une base SQLite isolée, une horloge contrôlée et un transport email de test. Un test supplémentaire lance un vrai serveur et deux clients WebSocket indépendants pour vérifier la synchronisation, la non-divulgation des réponses et la reconnexion. Pour exécuter les tests REST contre PostgreSQL, définissez `TEST_DATABASE_URL` vers **une base exclusivement réservée aux tests**.

## API et temps réel

Préfixe `/api`. Toutes les routes hors `/auth/*` et `/health` exigent `Authorization: Bearer <access-token>`. Les erreurs retournent `{ "error": "message" }` avec un statut HTTP approprié.

| Routes principales | Usage |
|---|---|
| POST `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` | Comptes et tokens |
| POST `/auth/verify`, `/auth/resend`, `/auth/forgot`, `/auth/reset` | Vérification et récupération |
| GET/PUT `/me`, GET `/me/history` | Profil et résultats |
| GET/POST `/quizzes`, GET/PUT `/quizzes/:id` | Catalogue et éditeur |
| GET/POST `/sessions`, POST `/sessions/:id/join` | Planification et participation |
| GET `/sessions/:id` | État personnel et correction |
| POST `/sessions/:id/answer`, `/next`, `/control` | Jeu et pilotage |
| GET `/leaderboard`, `/quizzes/:id/stats` | Classements et statistiques |
| POST `/quizzes/:id/report`, GET `/admin` | Signalements et administration |

Socket.IO s’authentifie avec `{ auth: { token } }`. Entrants : `session:join` (`id`, `code` optionnel), `session:start` (`id`), `player:answer` (`id`, `questionId`, `answerId`). Sortants : `session:join`, `game:question`, `game:question_end`, `game:end`, `game:error`. Les états sont personnalisés par joueur ; les bonnes réponses ne sont pas envoyées pendant une question live. Un polling REST toutes les 3 secondes assure la reprise si le WebSocket est indisponible.