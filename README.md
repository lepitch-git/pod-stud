# Pod Stud

Studio d'enregistrement de podcast à distance pour le collectif : chaque participant est enregistré
sur sa propre machine en pleine qualité, et son enregistrement est envoyé au fil de l'eau pour
qu'aucune coupure réseau ne fasse perdre de son.

- Spécifications : [Plateforme d'enregistrement podcast à distance](https://claude.ai/artifact/8GMKJ5eKzBa3KTcJaQZQZX)
  (exigences ENR-xx pour l'enregistrement, STU-xx pour le studio)
- Cahier de recette : [Cahier de recette — Pod Stud](https://claude.ai/artifact/5WLUHrMvcATprRDLiHntvU)

## Comment on avance

On construit fonction par fonction, avec trois environnements :

| Branche           | Environnement                                         | Rôle                                                           |
| ----------------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| `fonction/NN-nom` | Test de fonction (lien propre à la demande de fusion) | Tester une fonction isolément                                  |
| `preprod`         | Préprod (lien fixe)                                   | Recette globale : on rejoue les cas des fonctions déjà livrées |
| `main`            | Prod                                                  | Version utilisée par le collectif                              |

1. Chaque fonction est développée sur sa branche `fonction/NN-nom`, avec une demande de fusion vers
   `preprod`, testée automatiquement (Chrome, Firefox, Safari, ordinateur et mobile simulés).
2. Ses cas de test sont ajoutés au cahier de recette et déroulés sur son lien de test.
3. Après validation, elle est fusionnée dans `preprod`, où l'on refait la recette globale.
4. `preprod` n'est fusionnée dans `main` (mise en prod) qu'avec l'accord explicite du collectif.

Préprod et prod ont chacune leur base de données, leur stockage et leurs clés : un essai en préprod
ne touche jamais les enregistrements réels.

| Étape | Contenu                                                       | Exigences                       |
| ----- | ------------------------------------------------------------- | ------------------------------- |
| 1     | Socle du projet, diagnostic navigateur, cahier de recette     | ENR-08, ENR-15 (en partie)      |
| 2     | Salle d'attente et test micro / vidéo                         | ENR-15, ENR-17, ENR-18          |
| 3     | Enregistrement local résistant aux coupures, envoi progressif | ENR-03 à ENR-06, ENR-09, ENR-10 |
| 4     | Démarrage simultané et alignement sans clap                   | ENR-07                          |
| 5     | Collectif, émissions, épisodes, sessions, invitations         | ENR-16 à ENR-21                 |
| 6     | Studio : traitements, presets, transcription, montage         | STU-01 et suivantes             |

## Architecture

Stack TypeScript retenue dans les spécifications :

```
apps/web        Interface (Next.js + React) : test d'équipement, enregistrement local, envoi des morceaux
apps/api        API (Fastify) : état de santé ; plus tard envoi des morceaux, comptes, sessions
packages/shared Code partagé et testé sans navigateur (détection du navigateur, évaluation des capacités)
```

Viendront aux étapes suivantes : LiveKit (conversation en direct), PostgreSQL, Redis + BullMQ,
stockage objet compatible S3 hébergé en France, workers ffmpeg. `docker-compose.yml` fournit déjà
PostgreSQL, Redis et un stockage S3 local (MinIO) pour le développement.

## Pour les développeurs

Prérequis : Node.js 22 et pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev                 # web sur http://localhost:3000, API sur http://localhost:4000
pnpm test                # tests unitaires
pnpm typecheck           # vérification des types
pnpm build               # build de production
pnpm test:e2e            # tests de bout en bout (Playwright) après pnpm build
PW_PROJECTS=chromium pnpm test:e2e   # un seul navigateur
```

Les tests de bout en bout portent les numéros du cahier de recette (par exemple `SOC-02`).

## Déploiement

Vercel héberge l'interface web (`apps/web`, réglage « Root Directory ») :

- chaque demande de fusion reçoit automatiquement un lien de test, publié en commentaire de la PR ;
- la branche `preprod` a un lien fixe pour la recette globale ;
- la branche `main` est la production (« Production Branch » dans Settings › Git).

Les réglages secrets sont saisis séparément pour « Preview » (fonctions et préprod) et « Production ».

## Stockage des enregistrements

Les morceaux d'enregistrement (5 secondes de PCM 24 bits chacun) arrivent sur `PUT /api/prises/<id>/morceaux/<n>`
avec leur empreinte SHA-256, vérifiée avant stockage. La prise est clôturée par `POST /api/prises/<id>/fin`,
et la piste WAV assemblée est servie par `GET /api/prises/<id>/piste.wav`.

Où sont rangés les fichiers :

| Situation                               | Stockage                                                 |
| --------------------------------------- | -------------------------------------------------------- |
| Variables `S3_*` définies               | Stockage objet compatible S3 (cible : hébergé en France) |
| Développement local, tests automatiques | Dossier `apps/web/.data` (ou `PODSTUD_DATA_DIR`)         |
| Vercel sans variables `S3_*`            | `/tmp` : temporaire, la page affiche un avertissement    |

Variables à saisir dans Vercel (Settings › Environment Variables), séparément pour Preview et Production,
jamais dans le dépôt : `S3_ENDPOINT` (par exemple `https://s3.fr-par.scw.cloud`), `S3_REGION` (`fr-par`),
`S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.

## Séances à plusieurs et conversation en direct

Une séance (`/seance/<id>`, l'hôte ouvre `?hote=1`) réunit plusieurs participants : salle d'attente,
départ et arrêt communs à l'heure du serveur, pistes alignées sans clap
(`GET /api/seances/<id>/alignee/<prise>.wav`).

- Avec LiveKit : conversation en direct et messages de la séance passent par LiveKit. Variables à
  saisir dans Vercel : `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
- Sans LiveKit : relais de messages en mémoire du serveur, fiable seulement en local et pendant
  les tests automatiques ; la page l'indique.

## Collectif, émissions, sessions et invitations (étape 5)

- **Membres** : connexion par lien magique e-mail (pas de mot de passe), rôles Propriétaire,
  Administrateur, Animateur (ses émissions), Monteur (pistes et montage, sans lancer
  d'enregistrement). Règles dans `packages/shared/src/collectif.ts`.
- **Organisation** : Collectif → Émission (visuel, réglages) → Épisode → Sessions → Prises. Une
  session de collectif est une séance de l'étape 4 : `/seance/<id>` vérifie le rôle du membre ou le
  lien de l'invité.
- **Invités** : un lien par invité (`/invitation/<collectif>.<jeton>`), sans compte, révocable, avec
  date d'expiration ; aucun accès aux fichiers.
- **Fichiers** : piste alignée nommée `Emission_Episode_Prise2_Lola.wav` (nom corrigible par
  l'hôte), ZIP d'une prise, d'une session, d'un épisode ou d'une émission, réservés aux rôles
  autorisés ; corbeille de 30 jours, quota, archivage des sessions, journal des actions sensibles.
- **Données** : documents JSON dans le même stockage que les enregistrements (`db/`), donc
  temporaires tant que le stockage S3 n'est pas branché.

Réglages à saisir dans Vercel (aucun n'est obligatoire pour le lien de test) :

| Variable        | Rôle                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`   | Longue suite de caractères au hasard qui signe les liens de connexion (obligatoire en prod) |
| `BREVO_API_KEY` | Envoi réel des e-mails (connexion, invitations) par Brevo                                   |
| `MAIL_FROM`     | Adresse d'expédition validée dans Brevo                                                     |

Sans `BREVO_API_KEY`, hors production, l'application est en **mode test** : les liens de connexion
et d'invitation s'affichent à l'écran au lieu de partir par e-mail.

## Studio : traitement de la voix (étape 6a)

- Onglet **Postproductions** d'une session : pour chaque piste, un preset (Naturel, Radio
  chaleureuse, Clarté, Diffusion radio à -23 LUFS, Brut), trois curseurs (Voix, Bruit de fond,
  Ambiance), l'anti-bruits de bouche (léger, moyen, fort) et l'atténuation des respirations.
  Réglage par piste, pour toute la prise, ou par défaut pour l'émission.
- Chaîne (`packages/shared/src/dsp`) : anti-bruits de bouche → passe-haut → réduction de bruit
  (soustraction spectrale, bruit estimé en continu) → égalisation → dé-esseur → compression douce →
  respirations ; puis mise au volume (BS.1770) et limiteur à -1 dBTP. Aucun étage ne retire ni
  n'ajoute d'échantillon : une piste traitée a exactement la durée de l'originale.
- Le calcul se fait **dans le navigateur** de la personne qui lance le traitement (Web Worker) :
  aucune limite de durée côté serveur, aucun service extérieur. Le résultat est rangé sur le serveur
  par morceaux de 10 s (12 dB sous le niveau final) ; la mise au volume et le limiteur s'appliquent
  au téléchargement (`/api/collectifs/<cid>/pistes/<piste>?traitee=1`).
- Écoute avant / après sur un extrait de 20 s, les deux au même volume.
- Limites connues : les versions traitées ne comptent pas encore dans le quota ; sans stockage
  définitif (S3), elles sont temporaires comme les enregistrements.
