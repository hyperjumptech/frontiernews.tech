/**
 * Site interactions: mobile nav, Cloudflare Turnstile newsletter, scroll reveals.
 */

/**
 * Reads runtime config injected by the build.
 * @returns {{ apiUrl: string, turnstileSiteKey: string }}
 */
function getConfig() {
  const config = window.__FN_CONFIG__ || {};
  return {
    apiUrl: config.apiUrl || 'https://app.frontiernews.tech',
    turnstileSiteKey: config.turnstileSiteKey || '',
  };
}

/**
 * Initializes site interactions.
 * @returns {void}
 */
function initSite() {
  initMobileNav();
  initNewsletterForms();
  initReveal();
  initLanguageSelect();
}

/**
 * Wires the floating nav menu toggle and closes on link click / Escape.
 * @returns {void}
 */
function initMobileNav() {
  const header = document.querySelector('[data-site-header]');
  const toggle = document.querySelector('[data-menu-toggle]');
  const panel = document.querySelector('[data-mobile-nav]');
  if (!header || !toggle || !panel) return;

  /**
   * @param {boolean} open
   * @returns {void}
   */
  const setOpen = (open) => {
    header.classList.toggle('nav-open', open);
    document.body.style.overflow = open ? 'hidden' : '';
    toggle.setAttribute('aria-expanded', String(open));
  };

  toggle.addEventListener('click', () => {
    setOpen(!header.classList.contains('nav-open'));
  });

  panel.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => setOpen(false));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
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
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Turnstile'));
    document.head.appendChild(script);
  });

  return window.__FN_TURNSTILE_LOADING__;
}

/**
 * Renders Turnstile widgets and handles subscribe POSTs to Frontier Notes API.
 * @returns {void}
 */
function initNewsletterForms() {
  const { apiUrl, turnstileSiteKey } = getConfig();
  const forms = Array.from(document.querySelectorAll('[data-newsletter-form]'));
  if (!forms.length) return;

  forms.forEach((form) => {
    /** @type {string|null} */
    let captchaToken = null;
    /** @type {string|null} */
    let widgetId = null;
    const message = form.querySelector('[data-form-message]');
    const submit = /** @type {HTMLButtonElement|null} */ (form.querySelector('[type="submit"]'));
    const captchaHost = form.querySelector('[data-turnstile]');
    const defaultLabel = submit?.textContent?.trim() || 'Subscribe';
    const strings = {
      errorEmail: form.getAttribute('data-error-email') || 'Enter a valid email address.',
      error: form.getAttribute('data-error') || 'Something went wrong. Please try again.',
      success: form.getAttribute('data-success') || 'Almost there! Check your inbox to confirm your subscription.',
      captchaError: form.getAttribute('data-captcha-error') || 'Please complete the CAPTCHA verification.',
      submitting: form.getAttribute('data-submitting') || 'Subscribing…',
    };

    /**
     * @param {string} text
     * @param {"success"|"error"|""} state
     * @returns {void}
     */
    const show = (text, state) => {
      if (!message) return;
      message.textContent = text;
      if (state) message.setAttribute('data-state', state);
      else message.removeAttribute('data-state');
    };

    /**
     * @returns {void}
     */
    const syncSubmitEnabled = () => {
      if (!submit) return;
      const disabled = submit.dataset.loading === 'true' || submit.dataset.success === 'true' || !captchaToken;
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
            theme: 'light',
            callback: (token) => {
              captchaToken = token;
              syncSubmitEnabled();
            },
            'expired-callback': () => {
              captchaToken = null;
              syncSubmitEnabled();
            },
            'error-callback': () => {
              captchaToken = null;
              syncSubmitEnabled();
            },
          });
          syncSubmitEnabled();
        })
        .catch(() => {
          show(strings.error, 'error');
        });
    }

    syncSubmitEnabled();

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = /** @type {HTMLInputElement|null} */ (form.querySelector('[name="email"]'));
      const language = /** @type {HTMLSelectElement|null} */ (form.querySelector('[name="language"]'));
      const trimmed = email?.value.trim() || '';

      if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        show(strings.errorEmail, 'error');
        email?.focus();
        return;
      }

      if (!captchaToken) {
        show(strings.captchaError, 'error');
        return;
      }

      if (submit) {
        submit.dataset.loading = 'true';
        submit.textContent = strings.submitting;
        syncSubmitEnabled();
      }
      show('', '');

      try {
        const res = await fetch(`${apiUrl.replace(/\/$/, '')}/api/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: trimmed,
            language: language?.value || 'en',
            turnstileToken: captchaToken,
          }),
        });

        if (res.ok) {
          show(strings.success, 'success');
          form.reset();
          if (submit) {
            submit.dataset.success = 'true';
            submit.textContent = defaultLabel;
          }
        } else {
          show(strings.error, 'error');
          if (submit) submit.textContent = defaultLabel;
        }
      } catch {
        show(strings.error, 'error');
        if (submit) submit.textContent = defaultLabel;
      } finally {
        if (submit) submit.dataset.loading = 'false';
        resetCaptcha();
      }
    });
  });
}

/**
 * Reveals elements with [data-reveal] as they enter the viewport.
 * @returns {void}
 */
function initReveal() {
  const nodes = Array.from(document.querySelectorAll('[data-reveal]'));
  if (!nodes.length) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    nodes.forEach((node) => node.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  );

  nodes.forEach((node) => {
    node.classList.add('reveal');
    observer.observe(node);
  });
}

/**
 * Navigates to the selected language homepage path on change.
 * @returns {void}
 */
function initLanguageSelect() {
  document.querySelectorAll('[data-lang-select]').forEach((select) => {
    select.addEventListener('change', () => {
      const value = /** @type {HTMLSelectElement} */ (select).value;
      const map = JSON.parse(select.getAttribute('data-lang-map') || '{}');
      if (map[value]) {
        window.location.href = map[value];
      }
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSite);
} else {
  initSite();
}
