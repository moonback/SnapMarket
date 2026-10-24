import { StripeProvider } from '@stripe/stripe-react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ReactNode, useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LoadingView } from '../src/components/ui';
import { STRIPE_PUBLISHABLE_KEY } from '../src/config';
import { queryClient } from '../src/hooks/queries';
import { useRealtime } from '../src/hooks/useRealtime';
import { registerPushToken } from '../src/services/push';
import { useAuth } from '../src/stores/auth';
import { colors } from '../src/theme/tokens';

function Payments({ children }: { children: ReactNode }) {
  // Sans clé publique, le paiement est désactivé et l'écran de paiement l'indique.
  if (!STRIPE_PUBLISHABLE_KEY) return <>{children}</>;
  return (
    <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY} urlScheme="snapmarket">
      <>{children}</>
    </StripeProvider>
  );
}

function SignedInEffects() {
  useRealtime();
  useEffect(() => {
    registerPushToken().catch(() => undefined);
  }, []);
  return null;
}

export default function RootLayout() {
  const status = useAuth((s) => s.status);
  const bootstrap = useAuth((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <SafeAreaProvider style={{ backgroundColor: colors.background }}>
      <QueryClientProvider client={queryClient}>
        <Payments>
          <StatusBar style="light" />
          {status === 'loading' ? (
            <LoadingView />
          ) : (
            <>
              {status === 'signedIn' && <SignedInEffects />}
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.background },
                  animation: 'fade_from_bottom',
                }}
              >
                <Stack.Protected guard={status === 'signedIn'}>
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="product/[id]" />
                  <Stack.Screen name="user/[id]" />
                  <Stack.Screen name="chat/[id]" />
                  <Stack.Screen name="checkout/[id]" />
                  <Stack.Screen name="order/[id]" />
                  <Stack.Screen
                    name="story/[userId]"
                    options={{ animation: 'fade', presentation: 'fullScreenModal' }}
                  />
                  <Stack.Screen name="orders" />
                  <Stack.Screen name="cart" />
                  <Stack.Screen name="checkout-done/[id]" />
                  <Stack.Screen name="notifications" />
                  <Stack.Screen name="settings" />
                  <Stack.Screen name="seller" />
                  <Stack.Screen name="help" />
                  <Stack.Screen name="edit-product/[id]" />
                </Stack.Protected>
                <Stack.Protected guard={status === 'signedOut'}>
                  <Stack.Screen name="(auth)" />
                </Stack.Protected>
              </Stack>
            </>
          )}
        </Payments>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
