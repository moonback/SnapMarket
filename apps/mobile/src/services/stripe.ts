// Point d'entrée unique pour Stripe : Metro charge stripe.web.ts sur le web, où le SDK natif ne compile pas.
export { initPaymentSheet, presentPaymentSheet, StripeProvider } from '@stripe/stripe-react-native';
