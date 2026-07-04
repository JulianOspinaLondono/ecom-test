/**
 * quiz-analytics.js
 * ---------------------------------------------------------------------------
 * Framework-free tracking helpers for the GLP-1 quiz funnel.
 *
 * Two concerns live here, both intentionally decoupled from the UI component:
 *   1. Google Tag Manager  -> pushes semantic events onto `window.dataLayer`.
 *   2. Meta (Facebook) Pixel -> fires a `Lead` event with Advanced Matching.
 *
 * The component (quiz-funnel.js) owns the funnel state; this module only knows
 * how to translate that state into marketing events. Keeping it pure and
 * side-effect-light makes it trivial to unit test and reuse in other funnels.
 * @module quiz-analytics
 */

/**
 * Ensures `window.dataLayer` exists so events queued before GTM finishes
 * loading are not lost. Safe to call repeatedly.
 * @returns {any[]} The shared dataLayer array.
 */
export function ensureDataLayer() {
  window.dataLayer = window.dataLayer || [];
  return window.dataLayer;
}

/**
 * Injects the GTM container once. No-op if a container is already present
 * (e.g. installed globally in theme.liquid), which is the recommended setup
 * for production — the section-level loader is a convenience for quick tests.
 * @param {string} containerId - e.g. "GTM-XXXXXXX".
 */
export function loadGtm(containerId) {
  if (!containerId) return;
  ensureDataLayer();

  // Respect an existing container to avoid double-tracking.
  if (window.google_tag_manager || document.getElementById('quiz-gtm-script')) return;

  window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });

  const script = document.createElement('script');
  script.id = 'quiz-gtm-script';
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`;
  document.head.appendChild(script);
}

/**
 * Bootstraps the Meta Pixel base code once, then initialises the given pixel.
 * `userData` enables Advanced Matching: Meta hashes email/phone/first name in
 * the browser (SHA-256) before sending — we never transmit raw PII ourselves.
 * @param {string} pixelId - Numeric Meta Pixel ID.
 * @param {Record<string, string>} [userData] - { em, ph, fn } (raw values, auto-hashed by Meta).
 */
export function loadMetaPixel(pixelId, userData) {
  if (!pixelId) return;

  if (typeof window.fbq !== 'function') {
    /* Standard Meta Pixel bootstrap (verbatim from Meta's install snippet). */
    (function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = '2.0';
      n.queue = [];
      t = b.createElement(e);
      t.async = true;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  }

  window.fbq('init', pixelId, userData || {});
  window.fbq('track', 'PageView');
}

/**
 * Low-level dataLayer push. Every event is timestamped for downstream tags.
 * @param {string} event - Event name (e.g. "quiz_step_1").
 * @param {Record<string, any>} [payload] - Extra params merged into the event.
 */
export function pushEvent(event, payload = {}) {
  ensureDataLayer().push({ event, timestamp: new Date().toISOString(), ...payload });
}

/**
 * Fires a per-step GTM event. Passes the full answer context so GTM/GA4 can
 * segment on any question without republishing the container.
 * @param {object} args
 * @param {string} args.quizId
 * @param {number} args.stepNumber - 1-based.
 * @param {number} args.totalSteps
 * @param {string} args.stepId
 * @param {string} [args.stepType] - "question" | "contact".
 * @param {string} [args.question]
 * @param {string|null} [args.answer] - Answer for this step, if any.
 * @param {Record<string, any>} args.answers - All answers collected so far.
 */
export function trackStep({ quizId, stepNumber, totalSteps, stepId, stepType, question, answer, answers }) {
  pushEvent(`quiz_step_${stepNumber}`, {
    quiz_id: quizId,
    step_number: stepNumber,
    total_steps: totalSteps,
    step_id: stepId,
    step_type: stepType || 'question',
    question: question || null,
    answer: answer ?? null,
    // Snapshot of answers keyed by question -> useful for GA4 user properties.
    quiz_answers: { ...answers },
  });
}

/**
 * Fires the lead conversion on final submission:
 *   - GTM: a `generate_lead` event (GA4 recommended name) with all quiz data.
 *   - Meta Pixel: re-inits with Advanced Matching, then a `Lead` event.
 * @param {object} args
 * @param {string} args.quizId
 * @param {string} [args.pixelId]
 * @param {number} [args.value]
 * @param {string} [args.currency]
 * @param {{ firstName?: string, email?: string, phone?: string }} args.contact
 * @param {Record<string, any>} args.answers
 */
export function trackLead({ quizId, pixelId, value = 0, currency = 'USD', contact, answers }) {
  // --- GTM / GA4 ---
  pushEvent('generate_lead', {
    quiz_id: quizId,
    value,
    currency,
    quiz_answers: { ...answers },
    // PII kept in a namespaced object so it can be routed to a server-side
    // container / CAPI tag and deliberately excluded from client-side GA4 tags.
    user_data: {
      first_name: contact.firstName || '',
      email: contact.email || '',
      phone: contact.phone || '',
    },
  });

  // --- Meta Pixel ---
  if (typeof window.fbq === 'function' && pixelId) {
    // Advanced Matching: raw values in, Meta hashes them client-side.
    window.fbq('init', pixelId, {
      em: (contact.email || '').trim().toLowerCase(),
      ph: (contact.phone || '').replace(/[^\d+]/g, ''),
      fn: (contact.firstName || '').trim().toLowerCase(),
    });
    window.fbq('track', 'Lead', {
      content_name: quizId,
      content_category: 'quiz_funnel',
      value,
      currency,
    });
  }
}
