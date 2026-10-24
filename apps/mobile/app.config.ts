import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'SnapMarket',
  slug: 'snapmarket',
  scheme: 'snapmarket',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  backgroundColor: '#0B0B12',
  ios: {
    bundleIdentifier: 'fr.snapmarket.app',
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription:
        'SnapMarket utilise l’appareil photo pour photographier vos articles.',
      NSPhotoLibraryUsageDescription:
        'SnapMarket accède à vos photos pour illustrer vos annonces et messages.',
    },
  },
  android: {
    package: 'fr.snapmarket.app',
    backgroundColor: '#0B0B12',
    edgeToEdgeEnabled: true,
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-web-browser',
    'expo-font',
    [
      'expo-image-picker',
      {
        photosPermission: 'SnapMarket accède à vos photos pour illustrer vos annonces et messages.',
        cameraPermission: 'SnapMarket utilise l’appareil photo pour photographier vos articles.',
        microphonePermission: false,
      },
    ],
    ['expo-notifications', { color: '#7857FF' }],
    // merchantIdentifier n'est requis que pour Apple Pay (non activé au MVP).
    ['@stripe/stripe-react-native', { enableGooglePay: false }],
  ],
  experiments: { typedRoutes: false },
};

export default config;
