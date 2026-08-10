/**
 * Site interactions: mobile nav, Cloudflare Turnstile newsletter, scroll reveals.
 */

/**
 * Reads runtime config injected by the build.
 * @returns {{ apiUrl: string, turnstileSiteKey: string, ga4Id: string }}
 */
function getConfig() {
  const config = window.__FN_CONFIG__ || {};
  return {
    apiUrl: config.apiUrl || "https://app.frontiernews.tech",
    turnstileSiteKey: config.turnstileSiteKey || "",
    ga4Id: config.ga4Id || "",
  };
}

/**
 * Initializes site interactions.
 * @returns {void}
 */
function initSite() {
  initMobileNav();
  initNewsletterForms();
  initHeroEnter();
  initReveal();
  initLanguageSelect();
  initConsent();
  initPromoSticky();
}

/**
 * Wires the floating nav menu toggle and closes on link click / Escape.
 * @returns {void}
 */
function initMobileNav() {
  const header = document.querySelector("[data-site-header]");
  const toggle = document.querySelector("[data-menu-toggle]");
  const panel = document.querySelector("[data-mobile-nav]");
  if (!header || !toggle || !panel) return;

  /**
   * @param {boolean} open
   * @returns {void}
   */
  const setOpen = (open) => {
    header.classList.toggle("nav-open", open);
    document.body.style.overflow = open ? "hidden" : "";
    toggle.setAttribute("aria-expanded", String(open));
  };

  toggle.addEventListener("click", () => {
    setOpen(!header.classList.contains("nav-open"));
  });

  panel.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
}

/**
 * Loads the Cloudflare Turnstile script once.
 * @returns {Promise<void>}
 */
function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (window.__FN_TURNSTILE_LOADING__) return window.__FN_TURNSTILE_LOADING__;

  window.__FN_TURNSTILE_LOADING__ = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Turnstile"));
    document.head.appendChild(script);
  });

  return window.__FN_TURNSTILE_LOADING__;
}

/**
 * Loads the GA4 gtag.js script once. Only ever called after consent is
 * granted — this is the "lazy transport" half of the Consent Mode setup.
 * @param {string} id GA4 measurement ID
 * @returns {Promise<void>}
 */
function loadGtagScript(id) {
  if (window.__FN_GTAG_LOADED__) return Promise.resolve();
  if (window.__FN_GTAG_LOADING__) return window.__FN_GTAG_LOADING__;

  window.__FN_GTAG_LOADING__ = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    script.async = true;
    script.onload = () => {
      window.__FN_GTAG_LOADED__ = true;
      resolve();
    };
    script.onerror = () => {
      window.__FN_GTAG_LOADING__ = null;
      reject(new Error("Failed to load gtag.js"));
    };
    document.head.appendChild(script);
  });

  return window.__FN_GTAG_LOADING__;
}

/**
 * Renders Turnstile widgets and handles subscribe POSTs to Frontier Notes API.
 * @returns {void}
 */
function initNewsletterForms() {
  const { apiUrl, turnstileSiteKey } = getConfig();
  const forms = Array.from(document.querySelectorAll("[data-newsletter-form]"));
  if (!forms.length) return;

  forms.forEach((form) => {
    /** @type {string|null} */
    let captchaToken = null;
    /** @type {string|null} */
    let widgetId = null;
    const message = form.querySelector("[data-form-message]");
    const submit = /** @type {HTMLButtonElement|null} */ (
      form.querySelector('[type="submit"]')
    );
    const captchaHost = form.querySelector("[data-turnstile]");
    const defaultLabel = submit?.textContent?.trim() || "Subscribe";
    const strings = {
      errorEmail:
        form.getAttribute("data-error-email") || "Enter a valid email address.",
      error:
        form.getAttribute("data-error") ||
        "Something went wrong. Please try again.",
      success:
        form.getAttribute("data-success") ||
        "Almost there! Check your inbox to confirm your subscription.",
      captchaError:
        form.getAttribute("data-captcha-error") ||
        "Please complete the CAPTCHA verification.",
      submitting: form.getAttribute("data-submitting") || "Subscribing…",
    };

    /**
     * @param {string} text
     * @param {"success"|"error"|""} state
     * @returns {void}
     */
    const show = (text, state) => {
      if (!message) return;
      message.textContent = text;
      if (state) message.setAttribute("data-state", state);
      else message.removeAttribute("data-state");
    };

    /**
     * @returns {void}
     */
    const syncSubmitEnabled = () => {
      if (!submit) return;
      const disabled =
        submit.dataset.loading === "true" ||
        submit.dataset.success === "true" ||
        !captchaToken;
      submit.disabled = disabled;
    };

    /**
     * @returns {void}
     */
    const resetCaptcha = () => {
      captchaToken = null;
      if (widgetId != null && window.turnstile) {
        window.turnstile.reset(widgetId);
      }
      syncSubmitEnabled();
    };

    if (captchaHost && turnstileSiteKey) {
      loadTurnstileScript()
        .then(() => {
          widgetId = window.turnstile.render(captchaHost, {
            sitekey: turnstileSiteKey,
            theme: "light",
            callback: (token) => {
              captchaToken = token;
              syncSubmitEnabled();
            },
            "expired-callback": () => {
              captchaToken = null;
              syncSubmitEnabled();
            },
            "error-callback": () => {
              captchaToken = null;
              syncSubmitEnabled();
            },
          });
          syncSubmitEnabled();
        })
        .catch(() => {
          show(strings.error, "error");
        });
    }

    syncSubmitEnabled();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = /** @type {HTMLInputElement|null} */ (
        form.querySelector('[name="email"]')
      );
      const language = /** @type {HTMLSelectElement|null} */ (
        form.querySelector('[name="language"]')
      );
      const trimmed = email?.value.trim() || "";

      if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        show(strings.errorEmail, "error");
        email?.focus();
        return;
      }

      if (!captchaToken) {
        show(strings.captchaError, "error");
        return;
      }

      if (submit) {
        submit.dataset.loading = "true";
        submit.textContent = strings.submitting;
        syncSubmitEnabled();
      }
      show("", "");

      try {
        const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/subscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: trimmed,
            language: language?.value || "en",
            turnstileToken: captchaToken,
          }),
        });

        if (res.ok) {
          show(strings.success, "success");
          form.reset();
          if (submit) {
            submit.dataset.success = "true";
            submit.textContent = defaultLabel;
          }
        } else {
          show(strings.error, "error");
          if (submit) submit.textContent = defaultLabel;
        }
      } catch {
        show(strings.error, "error");
        if (submit) submit.textContent = defaultLabel;
      } finally {
        if (submit) submit.dataset.loading = "false";
        resetCaptcha();
      }
    });
  });
}

/**
 * Staggers hero entrance once the page is ready.
 * @returns {void}
 */
function initHeroEnter() {
  const hero = document.querySelector("[data-hero]");
  if (!hero) return;

  const reveal = () => {
    hero.classList.add("is-ready");
  };

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    reveal();
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(reveal);
  });
}

/**
 * Reveals elements with [data-reveal] as they enter the viewport.
 * @returns {void}
 */
function initReveal() {
  const nodes = Array.from(document.querySelectorAll("[data-reveal]"));
  if (!nodes.length) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    nodes.forEach((node) => node.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
  );

  nodes.forEach((node) => {
    node.classList.add("reveal");
    observer.observe(node);
  });
}

/**
 * Navigates to the selected language homepage path on change.
 * @returns {void}
 */
function initLanguageSelect() {
  document.querySelectorAll("[data-lang-select]").forEach((select) => {
    select.addEventListener("change", () => {
      const value = /** @type {HTMLSelectElement} */ (select).value;
      const map = JSON.parse(select.getAttribute("data-lang-map") || "{}");
      if (map[value]) {
        window.location.href = map[value];
      }
    });
  });
}

/** localStorage key for the consent record. */
const CONSENT_KEY = "fn_consent";
/** Bump to invalidate all stored consent decisions (re-prompts everyone). */
const CONSENT_VERSION = 1;
/** Days after which a "denied" decision expires and the banner reappears. */
const REJECT_TTL_DAYS = 180;

/**
 * Reads the stored consent record. Returns null when absent, invalid,
 * wrong version, or expired (denied only — granted never expires).
 * @returns {{ v: number, analytics: "granted"|"denied", ts: number }|null}
 */
function readConsent() {
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== CONSENT_VERSION) return null;
    if (parsed.analytics !== "granted" && parsed.analytics !== "denied") return null;
    if (parsed.analytics === "denied") {
      const ageDays = (Date.now() - Number(parsed.ts || 0)) / 86400000;
      if (!(ageDays <= REJECT_TTL_DAYS)) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persists a consent decision. Failures (Safari private mode, ITP) are
 * swallowed — callers should still act on the in-memory decision.
 * @param {"granted"|"denied"} analytics
 * @returns {void}
 */
function writeConsent(analytics) {
  try {
    window.localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({ v: CONSENT_VERSION, analytics, ts: Date.now() }),
    );
  } catch {
    // Storage unavailable — decision still applied in-memory for this page view.
  }
}

/**
 * Wires the GDPR/§25 TDDDG consent banner and the /preferences toggle.
 * Defaults to denied; only an explicit Accept loads gtag.js.
 * @returns {void}
 */
function initConsent() {
  const { ga4Id } = getConfig();
  if (!ga4Id || typeof window.gtag !== "function") return;

  const banner = document.querySelector("[data-consent-banner]");
  const settings = document.querySelector("[data-consent-settings]");
  const statusEl = document.querySelector("[data-consent-status]");
  const toggleBtn = document.querySelector("[data-consent-toggle]");

  /** @type {"granted"|"denied"|null} In-memory fallback when storage fails. */
  let memoryDecision = null;

  const currentDecision = () => (readConsent() || {}).analytics || memoryDecision || null;

  /**
   * @param {"granted"|"denied"} analytics
   * @returns {void}
   */
  const applyDecision = (analytics) => {
    window.gtag("consent", "update", { analytics_storage: analytics });
    if (analytics === "granted") {
      loadGtagScript(ga4Id).catch(() => {});
      window[`ga-disable-${ga4Id}`] = false;
    } else {
      window[`ga-disable-${ga4Id}`] = true;
    }
  };

  /**
   * @param {"granted"|"denied"} analytics
   * @returns {void}
   */
  const decide = (analytics) => {
    memoryDecision = analytics;
    writeConsent(analytics);
    applyDecision(analytics);
    if (banner) banner.hidden = true;
    syncSettingsUi();
  };

  const syncSettingsUi = () => {
    if (!settings || !statusEl || !toggleBtn) return;
    const decision = currentDecision();
    if (decision === "granted") {
      statusEl.textContent = settings.getAttribute("data-status-granted") || "";
      toggleBtn.textContent = settings.getAttribute("data-opt-out") || "";
    } else if (decision === "denied") {
      statusEl.textContent = settings.getAttribute("data-status-denied") || "";
      toggleBtn.textContent = settings.getAttribute("data-opt-in") || "";
    } else {
      statusEl.textContent = settings.getAttribute("data-status-undecided") || "";
      toggleBtn.textContent = settings.getAttribute("data-opt-in") || "";
    }
  };

  const stored = readConsent();
  if (stored) {
    applyDecision(stored.analytics);
    if (banner) banner.hidden = true;
  } else if (banner) {
    banner.hidden = false;
  }
  syncSettingsUi();

  document.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (target.closest("[data-consent-accept]")) {
      decide("granted");
    } else if (target.closest("[data-consent-reject]")) {
      decide("denied");
    } else if (target.closest("[data-consent-toggle]")) {
      const decision = currentDecision();
      decide(decision === "granted" ? "denied" : "granted");
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== CONSENT_KEY) return;
    if (banner) banner.hidden = Boolean(readConsent());
    syncSettingsUi();
  });
}

/**
 * Toggles .is-sticky on the promo bar when it becomes position:fixed.
 * @returns {void}
 */
function initPromoSticky() {
  const promo = document.querySelector(".promo");
  if (!promo) return;

  const headerH = parseInt(
    getComputedStyle(document.documentElement).getPropertyValue("--header-h") ||
      "68",
    10
  );

  const observer = new IntersectionObserver(
    ([entry]) => {
      promo.classList.toggle("is-sticky", entry.intersectionRatio < 1);
    },
    { threshold: [1], rootMargin: `-${headerH}px 0px 0px 0px` }
  );

  observer.observe(promo);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSite);
} else {
  initSite();
}
