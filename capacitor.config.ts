import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.example.app",
  appName: "Flux",
  webDir: "out",

  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    LocalNotifications: {
      smallIcon: "ic_stat_icon_config_sample",
      iconColor: "#488AFF",
      sound: "notification.wav",
    },
    CapacitorUpdater: {
      autoUpdate: false,             // we control timing manually in updater.ts
      updateUrl: `${process.env.NEXT_PUBLIC_API_URL}/updates/latest`,
      directUpdate: false,
      resetWhenUpdate: false,
    },
  },

  android: {
    allowMixedContent: true,
  },

  server: {
    androidScheme: "https",
  },
};

export default config;