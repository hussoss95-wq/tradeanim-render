/**
 * Public runtime configuration. NEXT_PUBLIC_* values are inlined at build time
 * (see .env.development / .env.production; real environment variables win).
 */

export const APP_NAME = "AlgoLiquid Studio";
export const APP_DOMAIN = "studio.algo-liquid.com";

/** Canonical URL of the editor itself. */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || `https://${APP_DOMAIN}`).replace(/\/+$/, "");

/**
 * Base URL of the render API (FastAPI). Empty string = same origin, for
 * deployments that reverse-proxy /api to the backend under the app's domain.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

/** Absolute URL for an API path such as "/api/render" or a returned "/api/renders/x.mp4". */
export function apiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
