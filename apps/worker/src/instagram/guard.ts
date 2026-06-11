import type { Page } from "playwright";

export type InstagramBlockReason = "login_required" | "challenge" | "suspicious_activity";

export interface InstagramPageSnapshot {
  href: string;
  body: string;
  loginInput: boolean;
}

export interface InstagramGuardResult {
  blocked: boolean;
  reason: InstagramBlockReason | null;
  message: string | null;
  href: string;
  bodySnippet: string;
}

export async function detectInstagramGuard(page: Page): Promise<InstagramGuardResult> {
  const snapshot = await page.evaluate<InstagramPageSnapshot>(
    `(() => ({
      href: location.href,
      loginInput: Boolean(document.querySelector("input[name='username']")),
      body: String(document.body?.innerText ?? "").replace(/\\s+/g, " ").slice(0, 900),
    }))()`,
  );
  return classifyInstagramGuard(snapshot);
}

export function classifyInstagramGuard(snapshot: InstagramPageSnapshot): InstagramGuardResult {
  const href = snapshot.href;
  const bodySnippet = snapshot.body.trim();
  const lowerHref = href.toLowerCase();
  const lowerBody = bodySnippet.toLowerCase();

  if (snapshot.loginInput || lowerHref.includes("/accounts/login")) {
    return blocked("login_required", href, bodySnippet, "Instagram login is required");
  }

  if (
    lowerHref.includes("/challenge/") ||
    lowerHref.includes("/checkpoint/") ||
    lowerBody.includes("challenge required") ||
    lowerBody.includes("security code") ||
    lowerBody.includes("enter the code") ||
    lowerBody.includes("confirme que") ||
    lowerBody.includes("confirme sua identidade") ||
    lowerBody.includes("confirm your identity")
  ) {
    return blocked("challenge", href, bodySnippet, "Instagram challenge is blocking automation");
  }

  if (
    lowerBody.includes("suspicious activity") ||
    lowerBody.includes("atividade suspeita") ||
    lowerBody.includes("temporarily blocked") ||
    lowerBody.includes("temporariamente bloquead") ||
    lowerBody.includes("try again later") ||
    lowerBody.includes("tente novamente mais tarde")
  ) {
    return blocked(
      "suspicious_activity",
      href,
      bodySnippet,
      "Instagram suspicious-activity guard is blocking automation",
    );
  }

  return {
    blocked: false,
    reason: null,
    message: null,
    href,
    bodySnippet,
  };
}

export async function assertInstagramUsable(page: Page): Promise<void> {
  const guard = await detectInstagramGuard(page);
  if (!guard.blocked) {
    return;
  }
  throw new Error(
    `${guard.message}; reason=${guard.reason}; href=${guard.href}; body=${guard.bodySnippet.slice(0, 180)}`,
  );
}

function blocked(
  reason: InstagramBlockReason,
  href: string,
  bodySnippet: string,
  message: string,
): InstagramGuardResult {
  return {
    blocked: true,
    reason,
    message,
    href,
    bodySnippet,
  };
}
