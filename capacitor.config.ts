import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pulse.chat',
  appName: 'Flux',
  webDir: 'out',
  android: {
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
    cleartext: true,
    allowNavigation: [
      'flux-chat.duckdns.org',
      '*.duckdns.org',
      '54.253.245.248',
      '54.253.245.248:7860',
      '*.supabase.co',
      '*.firebaseapp.com',
      '*.googleapis.com',
      '*',
    ],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 300,
      launchAutoHide: true,
      backgroundColor: '#050606',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon',
      iconColor: '#25d366',
      sound: 'notification.mp3',
    },
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
      backgroundColor: '#050606',
    },
  },
};

export default config;
