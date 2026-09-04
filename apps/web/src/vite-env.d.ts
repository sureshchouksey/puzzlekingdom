/// <reference types="vite/client" />

interface ImportMetaEnv {
  // The deployed API's base URL (e.g. "https://puzzlekingdom-api.onrender.com"),
  // set at build time on Vercel. Unset in local/LAN dev, where requests
  // instead go through vite's /api dev-server proxy - see api.ts.
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
