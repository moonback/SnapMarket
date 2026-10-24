import type { ReactNode } from 'react';

// Le PaymentSheet n'existe pas sur le web : les écrans affichent cette erreur via leur gestion existante.
const unavailable = {
  error: { code: 'Failed', message: 'Le paiement est disponible uniquement dans l’application mobile.' },
} as const;

export const StripeProvider = ({ children }: { children: ReactNode; [key: string]: unknown }) => children;
export const initPaymentSheet = async (_params: unknown) => unavailable;
export const presentPaymentSheet = async () => unavailable;
