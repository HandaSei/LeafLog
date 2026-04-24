import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.leaflog.app",
  appName: "LeafLog",
  webDir: "dist/public",
  server: {
    androidScheme: "https",
    allowNavigation: [
      "leaflog.org",
      "www.leaflog.org",
      "shift-master-fanecchyy.replit.app",
      "*.replit.app",
      "*.replit.dev",
      "*.picard.replit.dev",
    ],
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
  plugins: {
    CapacitorCookies: {
      enabled: true,
    },
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
