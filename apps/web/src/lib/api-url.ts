const configuredApiUrl = import.meta.env.VITE_API_URL as string | undefined;

function resolveDefaultApiUrl(): string {
  if (typeof window === "undefined") {
    return "http://127.0.0.1:3001";
  }

  const origin = window.location.origin;
  if (origin.includes(":3002")) {
    // Keep the API on the same host as the page (localhost vs 127.0.0.1) so the
    // dev session cookie stays first-party.
    return `${window.location.protocol}//${window.location.hostname}:3001`;
  }

  return origin;
}

export const API_URL = configuredApiUrl ?? resolveDefaultApiUrl();
