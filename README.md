# SnapMarket

Marketplace sociale mobile (France) : découverte visuelle et stories, messagerie temps réel,
négociation, paiement intégré, livraison ou remise en main propre, avis et modération.

| Application                                                          | Technologie                                                      | Dossier           |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------- |
| API REST `/api/v1` + WebSocket                                       | NestJS 11, Prisma 6, PostgreSQL 16, Redis 7, BullMQ 5, Socket.IO | `apps/api`        |
| Worker (médias, push, emails, transferts, tâches planifiées)         | même code que l'API, `dist/worker.js`                            | `apps/api`        |
| Administration web                                                   | Next.js 15 (App Router)                                          | `apps/admin`      |
| Application mobile iOS / Android                                     | Expo SDK 54, Expo Router 6                                       | `apps/mobile`     |
| Contrats partagés (enums, machine à états, schémas Zod, types d'API) | TypeScript                                                       | `packages/shared` |
| Schéma, migrations, seed, création d'administrateur                  | Prisma                                                           | `prisma/`         |

Le plan de développement et l'état réel de chaque fonctionnalité sont suivis dans
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md). Les mesures de sécurité sont décrites dans
[`SECURITY.md`](SECURITY.md) et le déploiement dans [`infrastructure/DEPLOYMENT.md`](infrastructure/DEPLOYMENT.md).

## Démarrage rapide

Prérequis : Node.js ≥ 20.19 (22 recommandé), npm 10, Docker (PostgreSQL, Redis, MinIO, Mailpit).

```bash
cp .env.example .env                       # puis générer JWT_ACCESS_SECRET : openssl rand -base64 48
docker compose up -d                       # PostgreSQL, Redis, MinIO (S3), Mailpit (emails)
npm install                                # génère aussi le client Prisma et compile packages/shared
npm run db:deploy                          # applique les migrations
npm run db:seed                            # catégories + données de démonstration « [DEMO] »
npm run admin:create -- --email admin@exemple.fr --username admin   # mot de passe demandé (masqué)

npm run dev:api                            # API : http://localhost:3000/api/v1 — Swagger : /api/docs
npm run build -w @snapmarket/api && npm run dev:worker   # worker (après un build)
cp apps/admin/.env.example apps/admin/.env.local && npm run dev:admin   # http://localhost:3001
cp apps/mobile/.env.example apps/mobile/.env && npm run dev:mobile      # Expo
```

Interfaces locales : Mailpit http://localhost:8025, console MinIO http://localhost:9001.

### Application mobile

- Renseigner `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_WS_URL` avec l'adresse IP de la machine
  (le téléphone doit pouvoir joindre l'API).
- Le paiement utilise `@stripe/stripe-react-native` (module natif) : utiliser un _development build_
  (`npx expo run:android` / `npx expo run:ios` ou EAS Build). Sans `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
  l'écran de paiement indique explicitement que le paiement est indisponible.
- Les notifications push nécessitent un projet EAS (`EXPO_PUBLIC_EAS_PROJECT_ID`) et un appareil physique.
- Liens profonds : schéma `snapmarket://` (ex. `snapmarket://reset-password?token=…`).

## Scripts

| Commande                                | Rôle                                                                 |
| --------------------------------------- | -------------------------------------------------------------------- |
| `npm run lint` / `npm run format:check` | ESLint / Prettier sur tout le dépôt                                  |
| `npm run typecheck`                     | TypeScript strict sur tous les workspaces                            |
| `npm test`                              | tous les tests (unitaires + e2e API — nécessite PostgreSQL et Redis) |
| `npm run test:e2e -w @snapmarket/api`   | tests e2e de l'API sur la base `snapmarket_test`                     |
| `npm run db:migrate`                    | créer une migration en développement                                 |
| `npm run db:seed`                       | seed (idempotent ; aucune donnée de démo en production)              |
| `npm run admin:create`                  | créer / promouvoir un administrateur (procédure CLI)                 |

Les tests e2e utilisent `TEST_DATABASE_URL` (défaut : `postgresql://snapmarket:snapmarket@localhost:5432/snapmarket_test`)
et `TEST_REDIS_URL` (défaut : base Redis 15). Ils **vident entièrement** la base de test : ne jamais les pointer
vers une base contenant des données réelles.

## Architecture

```
mobile (Expo) ──HTTPS──▶ API NestJS ──▶ PostgreSQL (Prisma)
admin (Next.js, serveur) ─┘    │  ├──▶ Redis (limitation de débit, BullMQ, adaptateur Socket.IO)
mobile ◀──WebSocket (Socket.IO)┘  ├──▶ Stockage S3 (URL présignées) ◀── PUT direct du mobile
                                  └──▶ Stripe (PaymentIntents, Connect Express, webhooks signés)
worker (BullMQ) : traitement d'images (sharp), push Expo, emails SMTP, transferts vendeurs, tâches planifiées
```

### Modules de l'API

`auth`, `users`, `sellers`, `categories`, `products`, `media`, `stories`, `feed`, `favorites`,
`conversations` (messages + gateway temps réel), `offers`, `orders` (machine à états, tarification),
`payments` (Stripe, webhooks, journal financier), `meetups`, `reviews`, `reports`, `moderation`
(règles anti-spam, décisions), `notifications` (base + push), `admin`, `settings`, `audit`, `health`.

Documentation interactive : `GET /api/docs` (désactivée en production sauf `ENABLE_SWAGGER=true`).
État des intégrations : `GET /api/v1/status` (utilisé par les clients pour désactiver honnêtement
les fonctions non configurées).

### Classement du flux « Découvrir » (v1, déterministe)

1. Annonces publiquement visibles uniquement (actives ou réservées, non modérées, vendeur actif).
2. Exclusion de ses propres annonces et des comptes bloqués (dans les deux sens).
3. Application des filtres explicites : texte (titre, marque — index trigramme), catégorie, prix, état,
   mode de remise, département, vendeur.
4. Tri par date de publication décroissante puis identifiant (pagination par curseur stable), ou par prix.

Aucun profilage comportemental n'est utilisé.

## Commandes, paiements et commission

**Prestataire** : Stripe Connect, comptes **Express** des vendeurs, modèle _separate charges and transfers_
(disponible en France). L'acheteur paie la plateforme ; les fonds sont transférés au vendeur seulement
lorsque la transaction est terminée (réception confirmée par l'acheteur ou litige résolu en faveur du vendeur),
via un _Transfer_ lié à la charge (`source_transaction`).

**Machine à états** (`packages/shared/src/order-state-machine.ts`, revalidée par le serveur avec verrou optimiste) :

```
PENDING_PAYMENT ─(webhook)─▶ PAID ─▶ PREPARING ─▶ SHIPPED ─(acheteur)─▶ COMPLETED   [livraison]
                              └──(rendez-vous accepté)─▶ READY_FOR_HANDOFF ─(acheteur)─▶ COMPLETED [main propre]
PENDING_PAYMENT ─▶ CANCELLED (acheteur, vendeur, expiration 30 min)
PAID / PREPARING / READY_FOR_HANDOFF ─(vendeur ou admin)─▶ REFUNDED
PAID / PREPARING / SHIPPED / READY_FOR_HANDOFF ─(acheteur ou contestation bancaire)─▶ DISPUTED ─(admin)─▶ COMPLETED | REFUNDED
```

Aucune commande n'est terminée automatiquement : ni à l'heure d'un rendez-vous, ni après un délai d'expédition.
Le client ne peut jamais déclarer une commande payée : seul le webhook `payment_intent.succeeded` signé,
dont le montant et la devise sont contrôlés, déclenche `PAID`.

**Calcul (serveur, centimes, `apps/api/src/orders/pricing.ts`, testé)** :

| Élément                                       | Règle                                                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Base de commission                            | prix des articles (prix unitaire figé × quantité), **hors** frais de livraison                                              |
| Taux                                          | paramètre `commissionBps` (500 = 5 %, valeur provisoire), modifiable en administration ; figé sur la commande à sa création |
| Arrondi                                       | au centime le plus proche, demi-centime arrondi au supérieur : `floor((base × bps + 5000) / 10000)`                         |
| Total acheteur                                | articles + livraison (aucun frais acheteur au MVP)                                                                          |
| Versement vendeur                             | total − commission (les frais de livraison reviennent au vendeur qui expédie)                                               |
| Frais Stripe                                  | supportés par la plateforme                                                                                                 |
| Annulation avant paiement                     | aucun mouvement                                                                                                             |
| Remboursement avant transfert                 | remboursement intégral de l'acheteur, aucune commission                                                                     |
| Litige résolu pour l'acheteur après transfert | annulation du transfert puis remboursement intégral                                                                         |
| Contestation bancaire                         | la commande passe en litige ; la plateforme répond à Stripe (responsabilité plateforme)                                     |

La commission n'est **comptabilisée comme perçue** (écriture `COMMISSION` du journal) qu'après un transfert
réussi au vendeur. Les écritures `CHARGE`, `REFUND`, `TRANSFER`, `TRANSFER_REVERSAL`, `DISPUTE` et le journal
des événements Stripe (`PaymentEvent`, idempotent par identifiant d'événement) permettent le rapprochement.

### Activer le paiement réel (action externe requise)

Le dépôt ne contient **aucune clé**. Tant que `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` sont vides,
toute création de commande renvoie `503 PAYMENTS_UNAVAILABLE` et les clients l'affichent.

1. Créer le compte Stripe de la plateforme (entité française), activer **Connect** (comptes Express) et
   compléter le profil de plateforme (vérifications exigées par Stripe pour une marketplace).
2. Renseigner `STRIPE_SECRET_KEY` (API) et `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` (mobile).
3. Créer deux endpoints webhook :
   - plateforme → `https://<api>/api/v1/payments/webhooks/stripe` : `payment_intent.succeeded`,
     `payment_intent.processing`, `payment_intent.payment_failed`, `payment_intent.canceled`,
     `charge.refunded`, `charge.dispute.created` → secret dans `STRIPE_WEBHOOK_SECRET` ;
   - Connect → `https://<api>/api/v1/payments/webhooks/stripe-connect` : `account.updated`
     → secret dans `STRIPE_CONNECT_WEBHOOK_SECRET`.
4. En local : `stripe listen --forward-to localhost:3000/api/v1/payments/webhooks/stripe`.
5. Vérifier les conditions actuelles de Stripe (délai maximal de conservation des fonds avant transfert,
   pays des comptes connectés, obligations KYC) avant le lancement.

Les tests automatisés utilisent un double de test du client Stripe et des webhooks signés avec un secret
factice clairement identifié ; la vérification de signature y est réelle.

## Livraison et remise en main propre

- **Livraison** : adresse validée (France), frais fixés par le vendeur sur l'annonce, statuts préparation /
  expédition, numéro de suivi **saisi par le vendeur**. Aucun transporteur n'est intégré : l'API l'indique
  (`/status` → `shippingCarrierConfigured: false`) et aucune étiquette n'est générée.
- **Main propre** : proposition de rendez-vous (date, lieu public choisi par les participants, aucune
  géolocalisation), acceptation, refus, annulation, rappel 2 h avant, confirmation de la remise par l'acheteur.
- Incidents : l'acheteur ouvre un litige depuis la commande ; résolution par un administrateur.

## Médias

Téléversement direct vers le stockage S3 via URL PUT présignée (type et taille signés, 5 min), finalisation
par l'API (vérification de la taille et du type réels), puis traitement asynchrone : vérification du contenu,
réorientation, redimensionnement (2048 px), **suppression des métadonnées EXIF dont la position GPS**,
miniature WebP. Les vidéos (stories/annonces, ≤ 50 Mo, ≤ 60 s déclarées) sont vérifiées (signature MP4/MOV)
mais **non transcodées**. Les médias de messagerie restent privés (URL signées) ; les médias publics peuvent
être servis par un CDN (`MEDIA_CDN_URL`). Suppression des objets à la suppression des contenus, des stories
expirées et des téléversements abandonnés.

## Administration

Accès réservé aux rôles `ADMIN` et `MODERATOR` (vérifié par l'API à chaque requête). Session en cookies
`httpOnly` / `SameSite=Strict`, jetons jamais exposés au JavaScript du navigateur. Les modérateurs traitent
signalements, contenus, comptes et vérifications de vendeurs ; les administrateurs gèrent en plus rôles,
catégories, remboursements, litiges, journal d'audit et paramètres métier. Le rôle `ADMIN` ne s'attribue
jamais par l'API : uniquement par `npm run admin:create` (accès direct à la base requis).

## Données de démonstration

`npm run db:seed` crée, hors production uniquement, 3 comptes `demo_*@demo.snapmarket.invalid` et
8 annonces préfixées `[DEMO]`, sans photo et sans mot de passe (sauf `SEED_DEMO_PASSWORD`).

## Limites connues

Voir la section « Restant » de [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) : authentification sociale,
intégration transporteur, transcodage vidéo, classement personnalisé et paiement réel (clés Stripe) ne sont
pas actifs ; l'application mobile n'a pas été testée sur appareil dans ce dépôt.
