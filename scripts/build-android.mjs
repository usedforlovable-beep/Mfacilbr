import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const target = process.argv[2];
const release = process.argv.includes("--release");

if (target !== "development" && target !== "production") {
  throw new Error("Choose the Android build target: development or production.");
}
if (release && !existsSync(resolve("android", "keystore.properties"))) {
  throw new Error(
    "Signed release builds require android/keystore.properties. Create and back up your upload keystore first.",
  );
}

const environmentFile = resolve(
  process.cwd(),
  target === "development" ? ".env.android.development" : ".env.android.production",
);
if (!existsSync(environmentFile)) {
  throw new Error(
    `Missing ${environmentFile}. Copy .env.android.example for development or .env.android.production.example for release builds, then configure the URLs.`,
  );
}

process.loadEnvFile(environmentFile);

const apiUrl = new URL(process.env["VITE_API_BASE_URL"] ?? "");
if (!apiUrl.pathname.replace(/\/+$/, "").endsWith("/api")) {
  throw new Error(
    "VITE_API_BASE_URL must include the API base path, for example https://host/api.",
  );
}
if (target === "production") {
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
  const apiHost = apiUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    apiUrl.protocol !== "https:" ||
    loopbackHosts.has(apiHost) ||
    apiHost.startsWith("127.") ||
    apiHost.endsWith(".localhost") ||
    apiHost === "example.com" ||
    apiHost.endsWith(".example.com") ||
    apiHost.endsWith(".invalid") ||
    apiUrl.username ||
    apiUrl.password ||
    apiUrl.search ||
    apiUrl.hash
  ) {
    throw new Error("Production Android builds require a public HTTPS API URL, never localhost.");
  }
  delete process.env["CAPACITOR_DEV_SERVER_URL"];
} else {
  const devServerUrl = new URL(process.env["CAPACITOR_DEV_SERVER_URL"] ?? "");
  if (apiUrl.hostname !== devServerUrl.hostname) {
    throw new Error(
      "The Android development API and live-reload server must use the same host for session cookies.",
    );
  }
  if (apiUrl.protocol !== devServerUrl.protocol) {
    throw new Error(
      "The Android development API and live-reload server must use the same protocol for session cookies.",
    );
  }
}

const buildTarget = target === "production" ? "android" : "android-development";
const env = { ...process.env, BUILD_TARGET: buildTarget };
const viteCli = resolve("node_modules", "vite", "bin", "vite.js");
const capacitorCli = resolve("node_modules", "@capacitor", "cli", "bin", "capacitor");

execFileSync(process.execPath, [viteCli, "build"], { env, stdio: "inherit" });
execFileSync(process.execPath, [capacitorCli, "sync", "android"], {
  env,
  stdio: "inherit",
});

writeFileSync(
  resolve("android", "app", "src", "main", "assets", "mercado-facil-build.json"),
  `${JSON.stringify({ target, apiBaseUrl: apiUrl.toString().replace(/\/+$/, "") }, null, 2)}\n`,
);

if (release) {
  const androidDirectory = resolve("android");
  const gradleCommand = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  execFileSync(gradleCommand, ["bundleRelease"], {
    cwd: androidDirectory,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}
