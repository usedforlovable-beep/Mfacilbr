# Mercado Fácil

Mercado Fácil is a self-hosted shopping assistant. The web application reads shelf labels, keeps a persistent shopping cart, and stores scan results in a PostgreSQL database that you control.

## Stack

- React, TanStack Start, and Vite for the web application
- Node.js, TypeScript, and Express for the REST API
- PostgreSQL with Drizzle ORM and SQL migrations
- Signed, HttpOnly anonymous sessions to keep carts and scan history separate between browsers

The app does not include user accounts or rely on a hosted application backend.

## Requirements

- Node.js 22 or later
- npm
- Docker Desktop with Docker Compose, or a PostgreSQL 13+ database you manage

## Local setup

1. Install and start Docker Desktop if it is not already available. Check that `docker --version` and `docker compose version` work in a new terminal, and wait for Docker Desktop to report that its engine is running.
2. Copy `.env.example` to `.env`. Set a private local `POSTGRES_PASSWORD`, make its value match the password in `DATABASE_URL`, and replace the example `SESSION_SECRET` with a unique random value.
3. Start the Compose database and wait until its PostgreSQL health check passes:

   ```sh
   npm run db:up
   ```

   `docker compose up -d --wait database` is also available directly. The service is named `database`, creates the `mercado_facil` database and user by default, maps PostgreSQL to `localhost:5432`, and uses `pg_isready` with those same configured credentials for its health check. Its data is stored in the named `mercado_facil_postgres` volume; do not run `docker compose down -v` if you want to keep that data. If you already manage a local PostgreSQL server, skip this step and make sure its database, user, password, and port match `DATABASE_URL`.

4. Install dependencies:

   ```sh
   npm install
   ```

5. Start the API and web application together:

   ```sh
   npm run dev
   ```

   Open http://localhost:8080. The Express API runs on port 3001 and Vite proxies `/api` requests to it. The API waits for PostgreSQL to accept connections before running pending migrations and listening for requests. It retries transient startup connection errors for up to 15 attempts; authentication, invalid configuration, and migration errors fail immediately with a diagnostic instead of being retried.

   To apply pending migrations separately, run `npm run db:migrate`; this command also waits for PostgreSQL readiness. The API runs the same migration runner automatically at startup, so a separate migration command is optional.

## Environment variables

Required:

- `DATABASE_URL`: PostgreSQL connection string. The local `.env.example` points to the Compose database on `localhost:5432`; production must use the remote database URL supplied by your host.
- `SESSION_SECRET`: random secret of at least 32 characters, used to sign anonymous session cookies.

Optional:

- `PORT`: Express API port (default `3001`).
- `CORS_ORIGIN`: comma-separated, exact web origins allowed to call the API. Defaults to local development origins.
- `OPENAI_API_KEY`: enables actual photo recognition and shelf-label reading. Without it, those endpoints return an explicit unavailable error. `OPENAI_MODEL` defaults to `gpt-4.1-mini`.
- `FIRECRAWL_API_KEY`: enables Camilo catalog lookups.
- `CRON_SECRET`: Bearer token protecting `POST /api/public/jobs/sync-prices`.

Provider keys are used only by the server and must never have a `VITE_` prefix. They are not needed to start the backend. Open Food Facts and Open Prices are queried directly for catalog and contributed-price data; results are stored in your PostgreSQL database where applicable.

## API

- `GET /api/health` — API and database health
- `GET /api/cart`, `PUT /api/cart` — session-owned, database-persisted shopping cart
- `POST /api/tickets/scan` — read a shelf-label image and persist readable results
- `POST /api/products/recognize` — recognize and persist a product scan
- `GET /api/scans` — current session's saved scans
- `GET /api/products/:code` — product lookup by barcode
- `GET /api/prices?code=:barcode` — stored contributed prices
- `GET /api/catalog/camilo?q=:query` — Camilo catalog lookup
- `POST /api/public/jobs/sync-prices` — authenticated Open Prices synchronization

The current browser's old `mf-cart` value is imported into PostgreSQL once if the new database has no cart for that session. The legacy browser value is retained as a recovery copy and is not used as the active cart store.

## Render PostgreSQL

For a Render deployment, create a managed PostgreSQL database and a Node web service in the same Render region. In the web service's **Environment** settings, add `DATABASE_URL` using the database's **Internal Database URL** (or use Render's “Add from database” option). Keep this URL in Render's environment-variable settings; do not commit it to `.env`, source code, or build configuration. Internal database URLs are preferred for services in the same region. Use Render's External Database URL only when the application connects from outside Render and Render networking/firewall access is configured.

Also configure `NODE_ENV=production`, `SESSION_SECRET`, and `CORS_ORIGIN` as service environment variables. Add provider keys only if those features are enabled. The backend validates that production `DATABASE_URL` is a PostgreSQL URL and rejects localhost/loopback hosts. It runs pending SQL migrations before serving requests. Do not use the local Compose URL or `localhost` in Render.

## Android app

The Android app packages the existing React/TanStack UI in Capacitor; it is not a replacement demo. Android loads the statically prerendered root route from `dist/client`, while its cart, scans, and product APIs remain on your Express/PostgreSQL backend.

The web favicon, Home Page brand image, Android launcher icon, and launch splash use the supplied `public/favicon.png` brand artwork. If launcher icon assets are regenerated, replace the density-specific resources under `android/app/src/main/res/mipmap-*` and sync Capacitor to refresh its packaged web assets.

### Requirements

- Android Studio with the Android SDK Platform 36 and Android Build Tools installed.
- JDK 21 (Capacitor 8/Android Gradle Plugin requirement); Android Studio's bundled JBR 21 can be selected as the Gradle JDK.
- A reachable PostgreSQL database for the API. For local work, use Docker Compose as described above.
- For production, an HTTPS API host and DNS/TLS certificate that you control.

### Run on an Android emulator

1. Start PostgreSQL, then start the API and Vite in separate terminals. Bind Vite to all interfaces:

   ```powershell
   npm run dev:api
   npm run dev:web -- --host 0.0.0.0
   ```

2. Copy `.env.android.example` to `.env.android.development`. Keep its `localhost` origins so Android WebView treats the development page as a secure context for camera access. With an emulator or USB-connected phone and Android Platform Tools installed, forward the web and API ports:

   ```powershell
   adb reverse tcp:8080 tcp:8080
   adb reverse tcp:3001 tcp:3001
   ```

   For Wi-Fi devices, use a trusted HTTPS development host and update both URLs; plain HTTP LAN addresses may not expose `getUserMedia` camera APIs.

3. Build/sync the Android project and launch it on a running emulator or USB-debugging-enabled phone:

   ```powershell
   npm run build:android:dev
   npm run android:run
   ```

   `npm run android:open` opens the native project in Android Studio. Development mode enables live reload and cleartext HTTP only for the local development server. Do not use these settings for a release.

The shelf-label camera displays an in-app rear-camera preview and automatically sends a frame to the existing OCR API every seven seconds until it recognizes a readable label or the user stops scanning with the scan button. Readable scan results are saved by the API; unreadable frames are not persisted. Android prompts for camera permission on first use; the manifest declares camera access and treats camera hardware as optional. Camera denial or unsupported hardware is reported in the app, and no gallery or file picker is opened. OCR requires `OPENAI_API_KEY` on the backend; without a configured OCR provider the API reports that scanning is unavailable. With OpenAI configured, each submitted camera frame is sent from your API server to OpenAI for processing—disclose this in your privacy policy and Play Data safety form. The project does not use a third-party backend platform.

### Production API and signed Play bundle

1. Deploy the Express API and PostgreSQL on infrastructure you control. Terminate TLS at a trusted reverse proxy, configure backups and rate limits, and set `DATABASE_URL`, a unique `SESSION_SECRET`, `NODE_ENV=production`, `CORS_ORIGIN`, and any provider keys on the server. The API must be reachable over HTTPS from users' devices. Include `https://localhost` in the API CORS allowlist for the packaged Capacitor WebView, plus any website origins you operate. Production session cookies are Secure and cross-origin compatible for the native app.
2. Copy `.env.android.production.example` to `.env.android.production` and replace its example URL with your real HTTPS API URL ending in `/api`. `npm run build:android` rejects localhost, loopback, non-HTTPS, and malformed API base paths. This value is compiled into the Android app; never put provider credentials in it.
3. Before the first store upload, confirm `br.com.mercadofacil.app` is the permanent, globally unique Play application ID. If it must change, update `appId` in `capacitor.config.ts` and both `namespace` and `applicationId` in `android/app/build.gradle` before publishing. Set `versionCode` (always increase it for each upload) and `versionName` in that Gradle file.
4. Create an upload key once and keep a secure offline backup. From the project root, with JDK 21 installed:

   ```powershell
   keytool -genkeypair -v -keystore android/app/upload-key.jks -storetype JKS -keyalg RSA -keysize 2048 -validity 10000 -alias mercadofacil-upload
   Copy-Item android/keystore.properties.example android/keystore.properties
   ```

   Edit the ignored `android/keystore.properties` with the actual passwords and alias. Neither this file nor the `.jks` file may be committed or shared. Google Play App Signing and the Play Console account are required for distribution.

5. Build the signed Android App Bundle:

   ```powershell
   npm run android:bundle
   ```

   The bundle is written to `android/app/build/outputs/bundle/release/app-release.aab`. This command refuses to start if the production URL or upload-key properties are missing.

6. In Play Console, create the app, enroll in Play App Signing, upload the AAB, and complete the store listing, screenshots, 512×512 store icon, content rating, target-audience declarations, privacy-policy URL, and Data safety questionnaire. Verify the current Play target-API and policy requirements when submitting; those can change independently of this project. Test camera permission/denial, OCR, persistence, and API TLS on physical Android devices before production rollout.

Camera images and shopping data are sent to the API host you configure. The backend also sends label images to OpenAI only if you configure `OPENAI_API_KEY`. Configure your privacy policy and Play declarations for the actual data flows and retention you choose.

## Build and deploy

```sh
npm run build
npm run start:api
```

Serve the built TanStack web app with your chosen Node-compatible web deployment and reverse-proxy `/api` to the Express API on the same origin. Set production `DATABASE_URL`, a unique `SESSION_SECRET`, `NODE_ENV=production`, and `CORS_ORIGIN` in your deployment environment. Production session cookies are `Secure`, `HttpOnly`, and `SameSite=None` so Android WebView can use the separately hosted HTTPS API; allow only the app and website origins you control in `CORS_ORIGIN`. TLS must terminate at your trusted reverse proxy.

The API runs database migrations at startup. You can also apply them explicitly with `npm run db:migrate`. Back up PostgreSQL regularly; the application does not send your stored cart or scan data to a hosted database.
#   M f a c i l b r 
 
 
