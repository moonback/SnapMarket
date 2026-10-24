# SnapMarket — Plan d'implémentation

Ce document suit l'avancement réel du projet. Une case cochée signifie que le code
existe **et** a été vérifié (compilation + tests indiqués). Une case non cochée
signifie « non fait » ou « partiellement fait » (détail précisé).

## Décisions techniques

| Sujet | Choix | Justification |
|---|---|---|
| Monorepo | npm workspaces (`apps/*`, `packages/*`) | Natif npm, pas d'outil supplémentaire |
| Backend | NestJS 11, Prisma 6, PostgreSQL 16, Redis 7, BullMQ 5 | Versions stables, API maîtrisées. Nest 12 / Prisma 8 (RC) évalués plus tard |
| Admin | Next.js 15 (App Router), jetons stockés en cookies httpOnly côté serveur Next | Aucun jeton accessible au JavaScript du navigateur |
| Mobile | Expo SDK 54, Expo Router 6, TanStack Query, Zustand, RHF + Zod, SecureStore | Combinaison officiellement compatible (`npx expo install --check`) |
| Validation partagée | Zod dans `packages/shared` (mobile/admin) ; `class-validator` côté API | Le serveur reste l'unique source d'autorité |
| Paiement | Stripe Connect, comptes **Express**, modèle **separate charges and transfers** | Supporté en France ; permet de conserver les fonds jusqu'à la confirmation de réception, puis transfert vers le vendeur avec `source_transaction` |
| Médias | S3 compatible (MinIO en local), URL présignées PUT/GET, traitement `sharp` dans un worker BullMQ | Rien de durable sur le disque de l'API |
| Temps réel | Socket.IO authentifié par JWT, autorisation vérifiée à chaque `join`/`send` | |
| Mots de passe | Argon2id | |
| Sessions | JWT d'accès court (15 min) + refresh token opaque haché en base, rotation et détection de réutilisation | |

## Lots

### Lot 0 — Socle
- [x] Workspaces npm, TypeScript strict, ESLint, Prettier
- [x] `docker-compose.yml` (PostgreSQL, Redis, MinIO, Mailpit)
- [x] `.env.example` documenté
- [x] `packages/shared` : énumérations, constantes, schémas Zod, types de contrats

### Lot 1 — Données
- [x] Schéma Prisma complet (utilisateurs, vendeurs, annonces, médias, stories, favoris,
      conversations, messages, commandes, paiements, journal financier, livraisons,
      rendez-vous, avis, signalements, blocages, notifications, audit, paramètres)
- [x] Migration initiale
- [x] Seed de démonstration (données marquées `[DEMO]`)
- [x] Script sécurisé de création du premier administrateur

### Lot 2 — API cœur
- [x] Auth : inscription, connexion, déconnexion, refresh avec rotation, vérification email,
      réinitialisation du mot de passe, verrouillage anti-force brute, limitation de débit
- [x] Utilisateurs : profil, modification, suppression (anonymisation), profil public
- [x] Comptes professionnels : demande + vérification manuelle par l'administration
- [x] Catégories administrables
- [x] Annonces : CRUD, brouillons, archivage, contrôle de propriété, recherche, filtres, tri, pagination curseur
- [x] Favoris
- [x] Médias : URL présignées, validation type/taille, finalisation, miniatures (worker)
- [x] Stories : création, expiration vérifiée côté serveur, vues, suppression, nettoyage planifié
- [x] Flux : classement déterministe documenté

### Lot 3 — Messagerie
- [x] Conversations acheteur/vendeur (référence produit facultative)
- [x] Messages texte/photo, idempotence (`clientMessageId`), pagination, accusés de lecture, non-lus
- [x] Gateway Socket.IO authentifiée, autorisation par conversation, limitation de débit
- [x] Blocage (empêche la messagerie) et signalement

### Lot 4 — Commandes & paiements
- [x] Machine à états explicite (testée)
- [x] Calcul serveur en centimes (prix, livraison, commission 5 % configurable) — testé
- [x] Réservation transactionnelle du stock (pas d'achat concurrent) — testé
- [x] Intégration Stripe Connect (PaymentIntent, onboarding Express, transferts, remboursements)
- [x] Webhooks signés, idempotence par `event.id`, journal financier
- [x] Paiement indisponible tant que Stripe n'est pas configuré (erreur 503 explicite)
- [x] Offres (négociation de prix)

### Lot 5 — Livraison & remise en main propre
- [x] Adresse, frais, préparation, expédition avec numéro de suivi saisi par le vendeur
      (aucun transporteur intégré : l'API l'indique explicitement, aucune étiquette générée)
- [x] Rendez-vous : proposition, acceptation, refus, annulation, confirmation de remise par l'acheteur
- [x] Incidents → litiges

### Lot 6 — Confiance & modération
- [x] Avis liés à une commande terminée, un seul avis par participant et commande
- [x] Signalements (utilisateur, annonce, message, story)
- [x] Détection simple de spam (règles extensibles)
- [x] Décisions de modération + journal d'audit

### Lot 7 — Notifications
- [x] Notifications en base, enregistrement des jetons Expo, envoi push via worker
- [x] Emails via SMTP (Mailpit en local)

### Lot 8 — Administration web
- [x] Connexion admin/modérateur, cookies httpOnly
- [x] Tableau de bord, utilisateurs, vendeurs pro, annonces, catégories, commandes/paiements,
      signalements, audit, paramètres métier

### Lot 9 — Mobile
- [x] Design system (couleurs, espacements, rayons, typographie, composants)
- [x] Bienvenue, inscription, connexion, mot de passe oublié
- [x] Onglets : Découvrir, Favoris, Vendre, Messages, Profil
- [x] Produit, profil public, chat, checkout, commande, notifications, paramètres, aide/litiges

### Lot 10 — Qualité & livraison
- [x] Tests unitaires et e2e de l'API (base PostgreSQL réelle)
- [x] CI GitHub Actions
- [x] README, SECURITY.md, documentation de déploiement

## Restant / hors MVP (non implémenté)
- Authentification sociale (Apple/Google) : interface prévue (`AuthProvider` en base), non activée.
- Intégration transporteur (Colissimo, Mondial Relay, Boxtal…) : interface `CarrierProvider`
  présente, aucune implémentation — saisie manuelle du suivi par le vendeur.
- Transcodage vidéo serveur (stories/annonces vidéo) : upload et validation présents,
  pas de transcodage (les vidéos sont servies telles quelles, limitées en taille et durée déclarée).
- Classement personnalisé du flux.
- Paiement réel : nécessite des clés Stripe, l'activation de Connect sur le compte
  de la plateforme et la configuration du webhook (voir README).
- Tests sur appareil mobile réel : le mobile est vérifié par `tsc` et les tests unitaires uniquement.
