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
    webContentsDebuggingEnabled: process.env.NODE_ENV !== "production",
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
