/**
 * NetKeep Café — API Configuration & URL Normalization
 * 
 * Safely resolves API endpoints for production (Vercel + Render)
 * and local development without duplicating `/api/v1` or hardcoding localhost in production.
 */

export const PRODUCTION_CLOUD_API_URL = "https://netkeep.onrender.com";

/**
 * Checks whether the code is executing in a browser on a localhost interface.
 */
export function isLocalhost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * Strips trailing slashes from any URL.
 */
export function cleanTrailingSlashes(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * Normalizes a base URL by removing any trailing `/api/v1` and trailing slashes.
 * Example: "https://netkeep.onrender.com/api/v1/" -> "https://netkeep.onrender.com"
 * Example: "https://netkeep.onrender.com/" -> "https://netkeep.onrender.com"
 */
export function getCleanRootUrl(rawUrl?: string | null): string {
  if (!rawUrl) return "";
  let cleaned = cleanTrailingSlashes(rawUrl);
  if (cleaned.endsWith("/api/v1")) {
    cleaned = cleaned.slice(0, -"/api/v1".length);
    cleaned = cleanTrailingSlashes(cleaned);
  }
  return cleaned;
}

/**
 * Ensures a single `/api/v1` prefix is attached to the base URL.
 * Never produces duplicated paths like `/api/v1/api/v1`.
 * Example: "https://netkeep.onrender.com" -> "https://netkeep.onrender.com/api/v1"
 * Example: "https://netkeep.onrender.com/api/v1" -> "https://netkeep.onrender.com/api/v1"
 */
export function ensureApiV1Path(rawUrl?: string | null): string {
  if (!rawUrl) return "";
  const root = getCleanRootUrl(rawUrl);
  return root ? `${root}/api/v1` : "";
}

/**
 * Resolves the primary Cloud Central API URL (pointing to Render).
 * Priority:
 * 1. NEXT_PUBLIC_API_BASE_URL (standard production deployment variable)
 * 2. NEXT_PUBLIC_CLOUD_API_URL (backward-compatible cloud central variable)
 * 3. Localhost fallback (if developing locally)
 * 4. Production fallback (https://netkeep.onrender.com/api/v1)
 */
export function getCloudApiUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_CLOUD_API_URL;
  if (envUrl && envUrl.trim().length > 0) {
    return ensureApiV1Path(envUrl);
  }

  // Safe developer default exclusively for localhost development
  if (isLocalhost()) {
    return "http://localhost:8001/api/v1";
  }

  // Production default pointing to live Render backend
  return `${PRODUCTION_CLOUD_API_URL}/api/v1`;
}

/**
 * Resolves the Local LAN Edge Server URL (optional, for in-store physical terminals).
 * If unconfigured in production, returns empty string so the POS operates in Cloud-Direct mode.
 */
export function getLocalApiUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_LOCAL_API_URL;
  if (envUrl && envUrl.trim().length > 0) {
    return ensureApiV1Path(envUrl);
  }

  // Safe developer default exclusively for localhost development
  if (isLocalhost()) {
    return "http://localhost:8000/api/v1";
  }

  return "";
}

/**
 * Resolves the active target API endpoint for POS operations.
 * If a LAN Edge server is explicitly configured and present, it is preferred for LAN latency.
 * Otherwise, routes directly to the Cloud Central API on Render.
 */
export function getActiveApiUrl(): string {
  const local = getLocalApiUrl();
  return local || getCloudApiUrl();
}

/**
 * Resolves the health check endpoint URL for a given API base or v1 URL.
 * Example: "https://netkeep.onrender.com/api/v1" -> "https://netkeep.onrender.com/health"
 * Example: "http://localhost:8000/api/v1" -> "http://localhost:8000/health"
 */
export function getHealthCheckUrl(apiOrBaseUrl?: string | null): string {
  if (!apiOrBaseUrl) return "";
  const root = getCleanRootUrl(apiOrBaseUrl);
  return `${root}/health`;
}
