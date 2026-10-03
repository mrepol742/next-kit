const DEFAULT_BLOCKLIST =
  "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/refs/heads/main/disposable_email_blocklist.conf";

/** Basic format validation; does not verify ownership or deliverability. */
export function validateEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export interface EmailCheckerOptions {
  blocklistUrl?: string;
  cacheTtlMs?: number;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  onFetchError?: "throw" | "allow" | "block";
  blockedDomains?: Iterable<string>;
}

export function createEmailChecker(options: EmailCheckerOptions = {}) {
  const ttl = options.cacheTtlMs ?? 86_400_000;
  const timeout = options.timeoutMs ?? 5_000;
  if (
    !Number.isFinite(ttl) ||
    ttl <= 0 ||
    !Number.isFinite(timeout) ||
    timeout <= 0
  ) {
    throw new Error("Email cache duration and timeout must be positive.");
  }
  const extra = new Set(
    Array.from(options.blockedDomains ?? [], (d) => d.trim().toLowerCase()),
  );
  let domains: Set<string> | undefined;
  let expires = 0;
  let pending: Promise<void> | undefined;
  async function refresh() {
    if (domains && Date.now() < expires) return;
    if (!pending) {
      pending = (async () => {
        const response = await (options.fetch ?? globalThis.fetch)(
          options.blocklistUrl ?? DEFAULT_BLOCKLIST,
          {
            signal: AbortSignal.timeout(timeout),
          },
        );
        if (!response.ok)
          throw new Error(`Email blocklist request failed: ${response.status}`);
        const text = await response.text();
        domains = new Set(
          text
            .split("\n")
            .map((d) => d.trim().toLowerCase())
            .filter((d) => d && !d.startsWith("#")),
        );
        expires = Date.now() + ttl;
      })().finally(() => {
        pending = undefined;
      });
    }
    await pending;
  }
  return {
    validateEmail,
    async isDisposableEmail(email: string): Promise<boolean> {
      if (!validateEmail(email)) return true;
      const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
      if (extra.has(domain)) return true;
      try {
        await refresh();
      } catch (error) {
        if (options.onFetchError === "allow") return false;
        if (options.onFetchError === "block") return true;
        throw error;
      }
      return domains!.has(domain);
    },
  };
}
