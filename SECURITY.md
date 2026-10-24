# Sécurité de SnapMarket

## Signaler une vulnérabilité

Merci de ne pas ouvrir de ticket public. Contactez les mainteneurs du dépôt en privé (fonction
« Report a vulnerability » de GitHub) avec une description, les étapes de reproduction et l'impact estimé.

## Mesures en place

### Authentification et sessions

- Mots de passe hachés en **Argon2id** (m = 19 Mio, t = 2, p = 1), jamais stockés ni journalisés en clair.
- Politique de mot de passe : 10 caractères minimum, minuscule, majuscule, chiffre (14 + symbole pour l'administrateur initial).
- Jeton d'accès JWT HS256 de 15 minutes (émetteur et algorithme vérifiés) ; **refresh token opaque** (384 bits)
  stocké uniquement sous forme de hachage SHA-256, avec **rotation** à chaque usage et **détection de réutilisation**
  (révocation de toute la famille).
- Verrouillage du compte après 5 échecs pendant 15 minutes (paramétrable) ; temps de réponse homogène
  pour les comptes inexistants ; réponses identiques pour la réinitialisation (pas d'énumération).
- Jetons d'email (vérification 24 h, réinitialisation 1 h) à usage unique, hachés en base ; la réinitialisation
  et le changement de mot de passe révoquent toutes les sessions.
- Mobile : refresh token dans le trousseau système (expo-secure-store), jeton d'accès en mémoire uniquement.
- Administration : jetons en cookies `httpOnly`, `SameSite=Strict`, `Secure` en production ; aucun jeton côté navigateur.

### Autorisations

- Garde globale : toute route est authentifiée sauf déclaration explicite `@Public()`.
- L'utilisateur et son rôle sont **rechargés depuis la base à chaque requête** : une suspension ou un
  changement de rôle prend effet immédiatement. Le rôle n'est jamais lu depuis la requête.
- Contrôle de propriété sur chaque modification (annonces, médias, stories, offres, commandes).
- Rôle `ADMIN` attribuable uniquement par la procédure CLI ; un modérateur ne peut pas agir sur un administrateur.
- WebSocket : authentification à la connexion **et** autorisation à chaque adhésion/envoi ; statut et
  vérification email de l'expéditeur rechargés à chaque message.

### Validation et limitation

- DTO validés par `class-validator` avec `whitelist` + `forbidNonWhitelisted` : tout champ inattendu
  (ex. `role`, `priceCents` d'une commande) est rejeté.
- Limitation de débit globale (Redis) et renforcée sur l'authentification, les uploads, les annonces,
  les commandes, les offres, les signalements ; limite de messages par minute (HTTP et WebSocket).
- Requêtes SQL brutes uniquement paramétrées (`$queryRaw` / `$executeRaw` tagués).
- En-têtes de sécurité (helmet côté API, en-têtes stricts côté admin), CORS restreint aux origines configurées.

### Paiements

- Aucune donnée de carte ne transite par SnapMarket (Stripe PaymentSheet côté mobile).
- Prix, frais, commission et vendeur déterminés côté serveur ; montants entiers en centimes.
- Webhooks : vérification de signature sur le corps brut, tolérance de 5 minutes (anti-rejeu),
  **idempotence** par identifiant d'événement, contrôle du montant et de la devise reçus.
- Clés d'idempotence Stripe pour PaymentIntent, remboursement, transfert et annulation de transfert.
- Réservation atomique du stock (UPDATE conditionnel) : pas de double vente concurrente ; verrou optimiste
  sur chaque transition de commande.
- Journal financier (`LedgerEntry`, `PaymentEvent`) et journal d'audit des actions sensibles.

### Médias et vie privée

- Upload direct vers S3 par URL présignée de courte durée avec type et taille signés ; revérification
  de la taille et du type réels, puis du contenu (décodage d'image / signature vidéo) par le worker.
- Suppression des métadonnées EXIF (dont GPS) des images ; médias de messagerie privés (URL signées).
- Aucune géolocalisation collectée ; adresse de livraison visible uniquement des parties à la commande.
- Suppression de compte : anonymisation des données personnelles, conservation des commandes et écritures
  financières (obligations légales).

### Modération

- Règles anti-spam explicables (moyens de paiement frauduleux, contacts hors plateforme, liens raccourcis,
  contenus dupliqués) ; refus ou signalement selon un score.
- Masquage automatique d'un contenu au-delà d'un seuil de signalements distincts ; aucune sanction
  automatique d'un compte. Décisions humaines historisées (`ModerationAction`) et auditées.

## Points d'attention pour la production

- Générer `JWT_ACCESS_SECRET` aléatoire (≥ 48 octets) et le stocker dans un gestionnaire de secrets.
- Définir `TRUST_PROXY` derrière un reverse proxy pour que la limitation de débit voie l'IP réelle.
- Activer TLS de bout en bout, `ADMIN_COOKIE_SECURE=true`, sauvegardes chiffrées de PostgreSQL.
- Restreindre le bucket S3 : préfixe `public/` lisible via CDN uniquement, `uploads/` et `private/` non publics.
- Surveiller `/api/v1/health`, les transferts en échec et les webhooks en erreur (tableau de bord admin).
