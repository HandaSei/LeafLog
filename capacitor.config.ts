import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.leaflog.app",
  appName: "LeafLog",
  webDir: "dist/public",
  server: {
    androidScheme: "https",
  },
};

export default config;
