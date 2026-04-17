// OAuth credentials extracted from the official Frigidaire mobile app.
// Identifies us as the app, not the user. If Electrolux rotates these,
// the plugin breaks until we extract new values from an updated app.

// Routes to the Frigidaire backend (Electrolux hosts multiple brands).
export const FRIGIDAIRE_API_KEY = '3BAfxFtCTdGbJ74udWvSe6ZdPugP8GcKz3nSJVfg';

// client_credentials grant — step 1 of auth, yields a short-lived app token.
export const FRIGIDAIRE_CLIENT_ID = 'FrigidaireOneApp';
// eslint-disable-next-line max-len
export const FRIGIDAIRE_CLIENT_SECRET = '26SGRupOJaxv4Y1npjBsScjJPuj7f8YTdGxJak3nhAnowCStsBAEzKtrEHsgbqUyh90KFsoty7xXwMNuLYiSEcLqhGQryBM26i435hncaLqj5AuSvWaGNRTACi7ba5yu';

// Global entry point. Regional base URL is returned after identity-providers discovery.
export const BASE_API_URL = 'https://api.ocp.electrolux.one';
