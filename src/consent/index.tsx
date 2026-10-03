"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";

export interface ConsentPreferences {
  necessary: true;
  analytics: boolean;
  functional: boolean;
  advertising: boolean;
}

export const defaultConsent: ConsentPreferences = {
  necessary: true,
  analytics: false,
  functional: false,
  advertising: false,
};

export function isConsentPreferences(
  value: unknown,
): value is ConsentPreferences {
  if (!value || typeof value !== "object") return false;
  const prefs = value as Record<string, unknown>;
  return (
    prefs.necessary === true &&
    typeof prefs.analytics === "boolean" &&
    typeof prefs.functional === "boolean" &&
    typeof prefs.advertising === "boolean"
  );
}

interface ConsentContextValue {
  consent: ConsentPreferences | null;
  ready: boolean;
  bannerOpen: boolean;
  updateConsent: (preferences: ConsentPreferences) => void;
  openBanner: () => void;
  closeBanner: () => void;
}
const ConsentContext = createContext<ConsentContextValue | null>(null);

export interface ConsentProviderProps {
  children: ReactNode;
  /** Increment the key when users must choose again after a policy change. */
  storageKey?: string;
  onConsentChange?: (preferences: ConsentPreferences) => void;
}

export function ConsentProvider({
  children,
  storageKey = "cookie_consent_v1",
  onConsentChange,
}: ConsentProviderProps) {
  const [consent, setConsent] = useState<ConsentPreferences | null>(null);
  const [ready, setReady] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(false);
  useEffect(() => {
    let stored: ConsentPreferences | null = null;
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (isConsentPreferences(parsed)) stored = parsed;
    } catch {
      /* Storage can be unavailable or contain malformed data. */
    }
    setConsent(stored);
    setReady(true);
    function sync(event: StorageEvent) {
      if (event.key !== storageKey && event.key !== null) return;
      try {
        const parsed: unknown = event.newValue
          ? JSON.parse(event.newValue)
          : null;
        setConsent(isConsentPreferences(parsed) ? parsed : null);
      } catch {
        setConsent(null);
      }
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [storageKey]);

  function updateConsent(preferences: ConsentPreferences) {
    if (!isConsentPreferences(preferences))
      throw new Error("Invalid consent preferences.");
    // Keep only the defined categories; necessary cookies cannot be disabled.
    const next: ConsentPreferences = {
      necessary: true,
      analytics: preferences.analytics,
      functional: preferences.functional,
      advertising: preferences.advertising,
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* Keep the in-memory choice. */
    }
    setConsent(next);
    setBannerOpen(false);
    onConsentChange?.(next);
  }
  return (
    <ConsentContext.Provider
      value={{
        consent,
        ready,
        bannerOpen,
        updateConsent,
        openBanner: () => setBannerOpen(true),
        closeBanner: () => setBannerOpen(false),
      }}
    >
      {children}
    </ConsentContext.Provider>
  );
}

export function useConsent(): ConsentContextValue {
  const value = useContext(ConsentContext);
  if (!value)
    throw new Error("useConsent must be used inside ConsentProvider.");
  return value;
}

export interface PrivacyPolicyPromptProps {
  policyUrl?: string;
  title?: string;
  description?: ReactNode;
  className?: string;
  labels?: Partial<
    Record<
      | "policy"
      | "manage"
      | "save"
      | "accept"
      | "reject"
      | "necessary"
      | "analytics"
      | "functional"
      | "advertising",
      string
    >
  >;
}

export function PrivacyPolicyPrompt({
  policyUrl = "/legal/privacy-policy",
  title = "Cookie Preferences",
  description = "We use cookies and similar technologies for site functionality, analytics, advertising, and third-party services. Choose which optional categories to allow.",
  className = "",
  labels = {},
}: PrivacyPolicyPromptProps) {
  const { consent, ready, bannerOpen, updateConsent } = useConsent();
  const [showPreferences, setShowPreferences] = useState(false);
  const [preferences, setPreferences] =
    useState<ConsentPreferences>(defaultConsent);
  const titleId = useId();
  const text = {
    policy: "Privacy Policy",
    manage: "Manage Preferences",
    save: "Save Preferences",
    accept: "Accept All",
    reject: "Reject Optional",
    necessary: "Necessary",
    analytics: "Analytics",
    functional: "Functional",
    advertising: "Advertising",
    ...labels,
  };
  if (!ready || (consent && !bannerOpen)) return null;
  function save(next: ConsentPreferences) {
    updateConsent(next);
    setShowPreferences(false);
  }
  return (
    <section
      aria-labelledby={titleId}
      className={`next-kit-consent ${className}`}
    >
      <h2 id={titleId}>{title}</h2>
      <p>{description}</p>
      <p>
        <a href={policyUrl}>{text.policy}</a>
      </p>
      {showPreferences && (
        <fieldset>
          <legend>{text.manage}</legend>
          <label>
            <span>{text.necessary}</span>
            <input type="checkbox" checked disabled />
          </label>
          {(["analytics", "functional", "advertising"] as const).map(
            (category) => (
              <label key={category}>
                <span>{text[category]}</span>
                <input
                  type="checkbox"
                  checked={preferences[category]}
                  onChange={(event) =>
                    setPreferences((current) => ({
                      ...current,
                      [category]: event.target.checked,
                    }))
                  }
                />
              </label>
            ),
          )}
          <button type="button" onClick={() => save(preferences)}>
            {text.save}
          </button>
        </fieldset>
      )}
      <div className="next-kit-consent-actions">
        <button
          type="button"
          aria-expanded={showPreferences}
          onClick={() => {
            setPreferences(consent ?? { ...defaultConsent });
            setShowPreferences(!showPreferences);
          }}
        >
          {text.manage}
        </button>
        <button type="button" onClick={() => save({ ...defaultConsent })}>
          {text.reject}
        </button>
        <button
          type="button"
          onClick={() =>
            save({
              necessary: true,
              analytics: true,
              functional: true,
              advertising: true,
            })
          }
        >
          {text.accept}
        </button>
      </div>
    </section>
  );
}
