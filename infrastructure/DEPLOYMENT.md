# Déploiement de SnapMarket

Ce document décrit une cible de production. Les Dockerfiles fournis n'ont **pas** pu être construits
dans l'environnement de développement initial (pas de démon Docker) : les valider en CI ou en préproduction
avant tout usage.

## Composants

| Composant            | Image / commande                                                        | Mise à l'échelle                                               |
| -------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| API HTTP + WebSocket | `apps/api/Dockerfile` → `node dist/main.js` (port 3000)                 | horizontale (adaptateur Socket.IO Redis, sessions sans état)   |
| Worker               | même image → `node dist/worker.js`                                      | horizontale (BullMQ), tâches planifiées dédupliquées par Redis |
| Administration       | `apps/admin/Dockerfile` → `next start -p 3001`                          | horizontale                                                    |
| PostgreSQL 16        | service managé recommandé (sauvegardes, PITR)                           | —                                                              |
| Redis 7              | service managé (persistance AOF conseillée pour BullMQ)                 | —                                                              |
| Stockage objet       | S3, Cloudflare R2, Scaleway Object Storage, OVH… + CDN devant `public/` | —                                                              |
| Mobile               | EAS Build / EAS Submit (stores)                                         | —                                                              |

Hébergement suggéré pour le lancement en France : région UE (données personnelles, RGPD).

## Construction des images

```bash
docker build -f apps/api/Dockerfile -t snapmarket-api .
docker build -f apps/admin/Dockerfile -t snapmarket-admin .
```

## Ordre de mise en production

1. Provisionner PostgreSQL, Redis, le bucket S3 (CORS : `PUT` depuis les applications, `GET` public via CDN
   pour `public/*` uniquement) et le SMTP transactionnel (Brevo, Mailjet, SES…).
2. Configurer les variables (voir `.env.example`) dans le gestionnaire de secrets. Points clés :
   `NODE_ENV=production`, `JWT_ACCESS_SECRET` aléatoire, `CORS_ORIGINS`, `API_PUBLIC_URL`, `APP_PUBLIC_URL`,
   `TRUST_PROXY`, `MEDIA_CDN_URL`, clés Stripe, `ADMIN_COOKIE_SECURE=true`.
3. Appliquer les migrations (non destructives) : `npx prisma migrate deploy` (job unique avant le déploiement).
4. Seed des catégories : `npx prisma db seed` (en production, seules les catégories sont créées).
5. Créer le premier administrateur depuis un poste opérateur ayant accès à la base :
   `ADMIN_INITIAL_PASSWORD=… npm run admin:create -- --email … --username …` (ou saisie masquée).
6. Déployer API, worker, admin. Vérifier `GET /api/v1/health` et `GET /api/v1/status`.
7. Configurer les webhooks Stripe (voir README) puis effectuer une transaction de bout en bout en mode test.
8. Mobile : `eas build` avec `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_WS_URL`, `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
   `EXPO_PUBLIC_EAS_PROJECT_ID` ; configurer les identifiants push (APNs / FCM) dans EAS.

## Exploitation

- **Santé** : `/api/v1/health` (PostgreSQL + Redis). Le worker journalise les tâches en échec (reprises
  exponentielles, 5 tentatives).
- **Supervision métier** : tableau de bord admin (transferts en échec, webhooks en erreur, litiges ouverts).
- **Reverse proxy** : activer le support WebSocket (`Upgrade`) vers l'API ; limiter la taille des corps
  (les fichiers ne transitent pas par l'API).
- **Swagger** : désactivé en production sauf `ENABLE_SWAGGER=true`.
- **Sauvegardes** : PostgreSQL quotidienne + PITR ; versionnement ou réplication du bucket.
- **Rétention** : les commandes et écritures financières sont conservées à des fins comptables ; définir avec
  le conseil juridique la durée de conservation des messages, journaux d'audit et données de modération.
