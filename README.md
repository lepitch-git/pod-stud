# Pod Stud

Studio d'enregistrement de podcast à distance pour le collectif : chaque participant est enregistré
sur sa propre machine en pleine qualité, et son enregistrement est envoyé au fil de l'eau pour
qu'aucune coupure réseau ne fasse perdre de son.

- Spécifications : [Plateforme d'enregistrement podcast à distance](https://claude.ai/artifact/8GMKJ5eKzBa3KTcJaQZQZX)
  (exigences ENR-xx pour l'enregistrement, STU-xx pour le studio)
- Cahier de recette : [Cahier de recette — Pod Stud](https://claude.ai/artifact/5WLUHrMvcATprRDLiHntvU)

## Comment on avance

On construit fonction par fonction. Chaque étape :

1. est développée sur sa propre branche, avec une demande de fusion (pull request) ;
2. est testée automatiquement à chaque modification sur les moteurs de Chrome, Firefox et Safari,
   ordinateur et mobile simulés (onglet « Actions » de GitHub) ;
3. ajoute ses cas de test au cahier de recette, que vous déroulez sur une version en ligne ;
4. n'est fusionnée sur la branche principale qu'après votre accord.

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
apps/web        Interface (Next.js + React) : accueil, diagnostic navigateur ; plus tard salle, studio
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
