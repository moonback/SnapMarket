# SnapMarket — Plan d'implémentation

Ce document suit l'avancement **réel**. Légende :

- ✅ implémenté **et** vérifié (tests automatisés ou exécution réelle indiquée) ;
- 🟡 implémenté mais non vérifié de bout en bout (raison indiquée) ;
- ⬜ non implémenté.

## Décisions techniques

| Sujet                    | Choix                                                                              | Justification                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Monorepo                 | npm workspaces (`apps/*`, `packages/*`)                                            | Natif npm, aucun outil supplémentaire                                                |
| Backend                  | NestJS 11, Prisma 6, PostgreSQL 16, Redis 7, BullMQ 5                              | Versions stables aux API maîtrisées (Nest 12 / Prisma 8 RC à évaluer ultérieurement) |
| Admin                    | Next.js 15 (App Router), jetons en cookies httpOnly côté serveur Next              | Aucun jeton accessible au JavaScript du navigateur                                   |
| Mobile                   | Expo SDK 54, Expo Router 6, TanStack Query, Zustand, RHF + Zod, SecureStore        | Versions installées par `npx expo install` (compatibles SDK)                         |
| React                    | 19.1.0 imposé dans tout le monorepo (`overrides`)                                  | Évite deux copies de React sous Metro                                                |
| Validation               | Zod partagé (`packages/shared`) côté clients ; `class-validator` côté API          | Le serveur reste l'unique autorité                                                   |
| Paiement                 | Stripe Connect, comptes Express, _separate charges and transfers_                  | Supporté en France ; fonds conservés jusqu'à la fin de la transaction                |
| Médias                   | S3 compatible, URL présignées, traitement `sharp` dans le worker                   | Aucun fichier durable sur le disque de l'API                                         |
| Temps réel               | Socket.IO + adaptateur Redis, autorisation à chaque `join`/`send`                  |                                                                                      |
| Mots de passe / sessions | Argon2id ; JWT 15 min + refresh opaque haché, rotation, détection de réutilisation |                                                                                      |

## Lots

### Lot 0 — Socle

- ✅ Workspaces npm, TypeScript strict, ESLint (+ react-hooks), Prettier
- 🟡 `docker-compose.yml` (PostgreSQL, Redis, MinIO, Mailpit) — rédigé, non exécuté (pas de démon Docker dans l'environnement de développement ; PostgreSQL et Redis locaux utilisés à la place)
- ✅ `.env.example` documentés (racine, admin, mobile)
- ✅ `packages/shared` : enums (parité Prisma testée), machine à états, schémas Zod, contrats d'API, formatage des montants

### Lot 1 — Données

- ✅ Schéma Prisma complet + 2 migrations appliquées
- ✅ Seed (catégories + démo `[DEMO]`, rien en production) — exécuté
- ✅ Création sécurisée du premier administrateur (CLI, mot de passe masqué ou variable) — exécutée, refus d'un mot de passe faible vérifié

### Lot 2 — API cœur

- ✅ Auth : inscription, connexion, déconnexion, refresh avec rotation et détection de réutilisation, vérification email, réinitialisation, changement de mot de passe, verrouillage, limitation de débit (e2e)
- ✅ Utilisateurs : profil, modification, suppression par anonymisation, profil public, blocage (e2e)
- ✅ Comptes professionnels : demande (SIRET contrôlé par Luhn) + vérification manuelle, badge seulement après validation (e2e)
- ✅ Catégories administrables (e2e)
- ✅ Annonces : CRUD, brouillons, publication, archivage, suppression logique, propriété, recherche trigramme, filtres combinables, tri, pagination par curseur, catégories soumises à validation (e2e)
- ✅ Favoris privés avec compteur (e2e)
- ✅ Médias : URL présignées (type et taille signés), finalisation avec revérification, traitement worker (redimensionnement, suppression EXIF/GPS, miniature), vérification vidéo, nettoyage — e2e avec double de stockage + test unitaire sharp réel + **parcours réel contre un serveur S3 local (s3rver) avec l'API et le worker lancés**
- ✅ Stories : création, expiration vérifiée à la lecture, vues (compteur réservé à l'auteur), suppression, lien vers annonce (e2e) ; nettoyage planifié implémenté
- ✅ Flux : classement déterministe documenté, exclusion des comptes bloqués (e2e)

### Lot 3 — Messagerie

- ✅ Conversations (déduplication par paire et annonce), messages texte/photo, idempotence `clientMessageId` (y compris envois concurrents), pagination, lus/non-lus, notifications (e2e)
- ✅ Gateway Socket.IO : refus sans jeton, refus d'adhésion hors conversation, diffusion temps réel, rejeu idempotent (e2e avec client Socket.IO réel)
- ✅ Blocage et signalement, règles anti-spam (e2e + unitaires)

### Lot 4 — Commandes & paiements

- ✅ Machine à états partagée, revalidée côté serveur, verrou optimiste (unitaires + e2e)
- ✅ Tarification en centimes, commission configurable, arrondi documenté (unitaires)
- ✅ Réservation atomique du stock : 4 achats concurrents → 1 seul accepté (e2e)
- ✅ Webhooks signés (refus si signature invalide), idempotence, contrôle de montant, remboursement d'un paiement tardif, journal financier (e2e)
- ✅ Remboursement vendeur/admin, transferts avec clé d'idempotence, commission comptabilisée seulement après transfert (e2e)
- ✅ Paiement indisponible (503) sans configuration Stripe, sans réservation (e2e)
- ✅ Offres : création, acceptation, refus, annulation, application unique du prix (e2e)
- 🟡 Intégration Stripe réelle (PaymentIntent, Connect Express onboarding, transferts, refunds) — testée uniquement avec un double du client Stripe ; **nécessite des clés et la configuration Connect** pour être vérifiée

### Lot 5 — Livraison & remise en main propre

- ✅ Adresse validée, préparation, expédition avec suivi saisi par le vendeur, confirmation de réception (e2e) ; aucun transporteur intégré, signalé par `/status`
- ✅ Rendez-vous : proposition, acceptation par l'autre partie, annulation (retour à PAID), confirmation explicite (jamais automatique) (e2e)
- 🟡 Rappels de rendez-vous (tâche planifiée) — implémentés, non couverts par un test
- ✅ Litiges : ouverture par l'acheteur, résolution par un administrateur (e2e)

### Lot 6 — Confiance & modération

- ✅ Avis : commande terminée, un par participant, agrégats de notes (e2e)
- ✅ Signalements (utilisateur, annonce, message, story, avis), doublons refusés, masquage automatique au seuil (e2e)
- ✅ Décisions de modération historisées + audit ; suspension effective immédiatement (e2e)

### Lot 7 — Notifications

- ✅ Notifications en base + émission temps réel (e2e)
- 🟡 Push Expo (worker, suppression des jetons invalides) — implémenté, non vérifié (nécessite un projet EAS et un appareil)
- 🟡 Emails SMTP via le worker — implémentés, envoi réel non vérifié (Mailpit non disponible ici) ; capture vérifiée en e2e

### Lot 8 — Administration web

- ✅ Connexion (rôles ADMIN/MODERATOR), cookies httpOnly/SameSite=Strict, renouvellement par middleware — vérifié dans Chromium (Playwright) contre l'API réelle
- ✅ Tableau de bord, utilisateurs, vendeurs pro, annonces, messages signalés, commandes (journal financier), litiges, signalements, catégories, audit, paramètres — build Next.js OK ; pages tableau de bord, annonces, catégories et paramètres vérifiées en navigateur

### Lot 9 — Mobile

- ✅ Design system centralisé, composants accessibles (rôles, libellés, zones tactiles ≥ 44 pt)
- ✅ Client API (refresh unique sur 401, erreurs réseau) — tests unitaires
- 🟡 Écrans : bienvenue, inscription, connexion, mot de passe oublié/réinitialisation ; onglets Découvrir, Favoris, Vendre (annonce/story), Messages, Profil ; produit, profil public, chat temps réel, paiement (PaymentSheet), commande, historique, notifications, paramètres/confidentialité, espace vendeur, aide/litiges, lecteur de stories — **TypeScript strict, ESLint et bundle Android (`expo export`) OK, mais non exécutés sur appareil ou simulateur**

### Lot 10 — Qualité & livraison

- ✅ 98 tests API (unitaires + e2e sur PostgreSQL et Redis réels), 5 tests shared, 7 tests mobile, 1 test admin
- 🟡 CI GitHub Actions (lint, format, types, tests unitaires, e2e avec services, builds, bundle Expo) — rédigée, pas encore exécutée sur GitHub
- 🟡 Dockerfiles API/worker et admin — rédigés, non construits (pas de démon Docker)
- ✅ README, SECURITY.md, `infrastructure/DEPLOYMENT.md`

## Restant / hors MVP

- ⬜ Authentification sociale (Apple/Google) : table `AuthIdentity` prête, aucun flux actif.
- ⬜ Intégration transporteur (Colissimo, Mondial Relay, Boxtal…) : saisie manuelle du suivi uniquement.
- ⬜ Transcodage vidéo serveur et lecture de la durée réelle des vidéos (durée déclarée par le client).
- ⬜ Classement personnalisé du flux.
- ⬜ Panier multi-articles (le modèle retenu est une commande par annonce).
- ⬜ Apple Pay / Google Pay (désactivés dans le plugin Stripe).
- ⬜ Interface d'administration pour ajuster des listes de mots interdits (règles anti-spam codées et testées).
- Actions externes nécessaires : compte Stripe + Connect + webhooks, bucket S3/CDN, SMTP, projet EAS
  (push, builds), comptes développeur Apple/Google, CGU et politique de confidentialité validées juridiquement.
