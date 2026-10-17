import type { CapacitorConfig } from "@capacitor/cli";

const developmentServer = process.env["CAPACITOR_DEV_SERVER_URL"];
const development = process.env["BUILD_TARGET"] === "android-development";

if (development && !developmentServer) {
  throw new Error("CAPACITOR_DEV_SERVER_URL is required for the Android development build.");
}

const config: CapacitorConfig = {
  appId: "br.com.mercadofacil.app",
  appName: "Mercado Fácil",
  webDir: "dist/client",
  android: {
    allowMixedContent: development,
    webContentsDebuggingEnabled: development,
  },
  ...(developmentServer &&
    development && {
      server: {
        url: developmentServer,
        cleartext: developmentServer.startsWith("http://"),
      },
    }),
};

export default config;
