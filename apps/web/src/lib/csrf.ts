/**
 * Reads the nuoma_csrf cookie set by the API and returns its value, if present.
 * The cookie is non-httpOnly by design (CSRF double-submit pattern), so the JS
 * runtime can pick it up here and send it back as the x-csrf-token header on mutations.
 */
const COOKIE_NAME = "nuoma_csrf";

export function csrfFromCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]!) : null;
}
