-- Paiement groupé (Checkout) et panier.
-- Migration non destructive : chaque commande existante reçoit son propre Checkout,
-- et les paiements / événements de paiement sont rattachés à ce Checkout avant
-- la suppression des anciennes colonnes orderId.

-- 1. Nouvelles tables
CREATE TABLE "Checkout" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "paymentExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Checkout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CartItem" (
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "deliveryMode" "DeliveryMode",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("userId","productId")
);

-- 2. Reprise des données existantes : un Checkout par commande
INSERT INTO "Checkout" ("id", "reference", "buyerId", "totalCents", "currency", "paymentExpiresAt", "createdAt", "updatedAt")
SELECT 'chk_' || o."id", 'SC-' || substr(o."reference", 4), o."buyerId", o."totalCents", o."currency",
       o."paymentExpiresAt", o."createdAt", CURRENT_TIMESTAMP
FROM "Order" o;

ALTER TABLE "Order" ADD COLUMN "checkoutId" TEXT;
UPDATE "Order" SET "checkoutId" = 'chk_' || "id";
ALTER TABLE "Order" ALTER COLUMN "checkoutId" SET NOT NULL;

ALTER TABLE "Payment" ADD COLUMN "checkoutId" TEXT;
UPDATE "Payment" SET "checkoutId" = 'chk_' || "orderId";
ALTER TABLE "Payment" ALTER COLUMN "checkoutId" SET NOT NULL;

ALTER TABLE "PaymentEvent" ADD COLUMN "checkoutId" TEXT;
UPDATE "PaymentEvent" SET "checkoutId" = 'chk_' || "orderId" WHERE "orderId" IS NOT NULL;

-- 3. Retrait des anciens liens (les données ont été reportées ci-dessus)
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_orderId_fkey";
ALTER TABLE "PaymentEvent" DROP CONSTRAINT "PaymentEvent_orderId_fkey";
DROP INDEX "Payment_orderId_key";
ALTER TABLE "Payment" DROP COLUMN "orderId";
ALTER TABLE "PaymentEvent" DROP COLUMN "orderId";

-- Une contestation bancaire couvre le paiement entier : plusieurs commandes peuvent la partager.
DROP INDEX "Dispute_providerDisputeId_key";

-- 4. Index et contraintes
CREATE UNIQUE INDEX "Checkout_reference_key" ON "Checkout"("reference");
CREATE INDEX "Checkout_buyerId_createdAt_idx" ON "Checkout"("buyerId", "createdAt");
CREATE INDEX "CartItem_productId_idx" ON "CartItem"("productId");
CREATE INDEX "Dispute_providerDisputeId_idx" ON "Dispute"("providerDisputeId");
CREATE INDEX "Order_checkoutId_idx" ON "Order"("checkoutId");
CREATE UNIQUE INDEX "Payment_checkoutId_key" ON "Payment"("checkoutId");

ALTER TABLE "Order" ADD CONSTRAINT "Order_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "Checkout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Checkout" ADD CONSTRAINT "Checkout_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "Checkout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "Checkout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
