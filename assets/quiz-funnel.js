/**
 * quiz-funnel.js
 * ---------------------------------------------------------------------------
 * <quiz-funnel> — an accessible, progressively-enhanced multi-step quiz.
 *
 * Extends Horizon's base `Component` so it plugs into the theme's declarative
 * event system (`on:change="/onSelect"`, `on:click="/back"`, `on:submit`) and
 * `ref` wiring. Marketing side-effects live in sibling modules so this file
 * stays focused on UX + state:
 *   - quiz-analytics.js -> GTM dataLayer + Meta Pixel
 *   - quiz-klaviyo.js   -> Klaviyo Client API
 *
 * Progressive enhancement: the section server-renders every step (crawlable,
 * usable without JS). On connect we add `is-enhanced`, collapse to one step at
 * a time, and drive the wizard. If JS never runs, the user sees a plain,
 * scrollable form instead of a broken page.
 * @module quiz-funnel
 */

import { Component } from '@theme/component';
import { loadGtm, loadMetaPixel, trackStep, trackLead, pushEvent } from './quiz-analytics.js';
import { upsertProfile, subscribeToList, trackEvent, toE164 } from './quiz-klaviyo.js';

/**
 * @typedef {object} QuizConfig
 * @property {string} quizId
 * @property {string} landingUrl
 * @property {boolean} autoAdvance
 * @property {boolean} appendUtms
 * @property {string} utmSource
 * @property {string} utmMedium
 * @property {string} utmCampaign
 * @property {number} leadValue
 * @property {string} gtmId
 * @property {boolean} loadGtm
 * @property {string} metaPixelId
 * @property {boolean} loadMetaPixel
 * @property {string} klaviyoPublicKey
 * @property {string} klaviyoListId
 * @property {string} klaviyoRevision
 * @property {string} klaviyoMetric
 * @property {boolean} enableSms
 * @property {string} defaultCountryCode
 * @property {boolean} requirePhone
 * @property {boolean} requireConsent
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class QuizFunnel extends Component {
  /** @type {QuizConfig} */
  config;
  /** @type {HTMLElement[]} */
  steps = [];
  /** Answers keyed by property key -> string | string[]. @type {Record<string, any>} */
  answers = {};
  /** Question text keyed by property key (for readable payloads). @type {Record<string, string>} */
  questions = {};
  currentIndex = 0;
  /** 1-based tracked step number per DOM index (0 for the non-tracked loading step). @type {number[]} */
  stepTrackedNumber = [];
  trackedTotal = 0;
  #firedSteps = new Set();
  #advanceTimer = 0;
  #submitting = false;

  // Progress refs are intentionally NOT required — the progress bar is an
  // optional section setting, so the component must work without them.
  requiredRefs = ['continueButton', 'backButton', 'live'];

  connectedCallback() {
    super.connectedCallback();

    this.config = this.#readConfig();
    this.steps = /** @type {HTMLElement[]} */ ([...this.querySelectorAll('[data-quiz-step]')]);
    if (this.steps.length === 0) return;

    // Precompute tracked step numbers: "Step X of N" and quiz_step_N count only
    // questions + contact, not the interstitial calculating screen.
    let tracked = 0;
    this.stepTrackedNumber = this.steps.map((step) => {
      if (step.dataset.stepType === 'loading') return 0;
      tracked += 1;
      return tracked;
    });
    this.trackedTotal = tracked;

    // Enhance: switch from "all steps visible" (no-JS) to a one-at-a-time wizard.
    this.classList.add('is-enhanced');

    // Fire-and-forget tag loaders. In production, GTM lives in theme.liquid and
    // these no-op; here they make the section self-contained for a dev store.
    if (this.config.loadGtm) loadGtm(this.config.gtmId);
    if (this.config.loadMetaPixel) loadMetaPixel(this.config.metaPixelId);

    this.showStep(0);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this.#advanceTimer);
  }

  /* ------------------------------------------------------------------ *
   * Config
   * ------------------------------------------------------------------ */

  /** @returns {QuizConfig} */
  #readConfig() {
    const node = this.querySelector('[data-quiz-config]');
    try {
      return JSON.parse(node?.textContent || '{}');
    } catch (error) {
      console.error('[quiz-funnel] Invalid config JSON', error);
      return /** @type {QuizConfig} */ ({});
    }
  }

  /* ------------------------------------------------------------------ *
   * Declarative event handlers (wired via on:* attributes)
   * ------------------------------------------------------------------ */

  /** @param {Event} event */
  onSelect(event) {
    const step = this.currentStepEl;
    if (!step) return;
    this.#clearError(step);

    const isMultiple = step.dataset.stepMultiple === 'true';
    // Auto-advance only makes sense for single-choice questions.
    if (this.config.autoAdvance && !isMultiple && step.dataset.stepType === 'question') {
      clearTimeout(this.#advanceTimer);
      this.#advanceTimer = window.setTimeout(() => this.advance(), 320);
    }
  }

  /** @param {SubmitEvent} event */
  onSubmit(event) {
    event.preventDefault();
    this.advance();
  }

  back() {
    clearTimeout(this.#advanceTimer);
    let target = this.currentIndex - 1;
    // Skip the auto-advancing calculating screen when navigating back.
    while (target > 0 && this.steps[target]?.dataset.stepType === 'loading') target -= 1;
    if (target >= 0) this.showStep(target);
  }

  /* ------------------------------------------------------------------ *
   * Navigation
   * ------------------------------------------------------------------ */

  /** Validate the current step, persist its answer, then advance or submit. */
  advance() {
    clearTimeout(this.#advanceTimer);
    const step = this.currentStepEl;
    if (!step || !this.#validateStep(step)) return;

    this.#collectAnswer(step);

    if (this.currentIndex >= this.steps.length - 1) {
      this.#submitLead();
      return;
    }
    this.showStep(this.currentIndex + 1);
  }

  /** @param {number} index */
  showStep(index) {
    clearTimeout(this.#advanceTimer);
    this.currentIndex = Math.max(0, Math.min(index, this.steps.length - 1));
    const current = this.currentStepEl;
    const isLoading = current?.dataset.stepType === 'loading';

    this.steps.forEach((step, i) => {
      const active = i === this.currentIndex;
      step.hidden = !active;
      step.classList.toggle('is-active', active);
    });

    this.classList.toggle('is-loading', isLoading);

    this.#updateProgress();
    this.#updateNav();
    this.#focusStep();
    this.#fireStepEvent();

    // The calculating screen auto-advances to the contact step.
    if (isLoading) {
      const duration = parseInt(current?.dataset.loadingDuration || '2500', 10);
      this.#advanceTimer = window.setTimeout(() => this.showStep(this.currentIndex + 1), duration);
    }
  }

  get currentStepEl() {
    return this.steps[this.currentIndex] ?? null;
  }

  #updateProgress() {
    // The progress bar is optional; bail out cleanly when it isn't rendered.
    if (!this.refs.progressFill) return;

    const total = this.trackedTotal || this.steps.length;
    const step = this.currentStepEl;
    const isLoading = step?.dataset.stepType === 'loading';
    // Hold the bar at 100% during the calculating screen.
    const current = isLoading ? total : this.stepTrackedNumber[this.currentIndex] || 1;
    const percent = Math.round((current / total) * 100);

    this.refs.progressFill.style.inlineSize = `${percent}%`;
    this.refs.progressBar?.setAttribute('aria-valuenow', String(current));
    this.refs.progressBar?.setAttribute('aria-valuemax', String(total));
    this.refs.progressBar?.setAttribute('aria-valuetext', `Step ${current} of ${total}`);
    if (this.refs.progressLabel) this.refs.progressLabel.textContent = `Step ${current} of ${total}`;
  }

  #updateNav() {
    const isFirst = this.currentIndex === 0;
    const isLast = this.currentIndex === this.steps.length - 1;

    this.refs.backButton.hidden = isFirst;
    this.refs.continueButton.textContent = isLast
      ? this.dataset.submitLabel || 'Get my results'
      : this.dataset.continueLabel || 'Continue';
  }

  /** Move focus to the step so screen-reader + keyboard users follow along. */
  #focusStep() {
    const step = this.currentStepEl;
    if (!step) return;
    const heading = step.querySelector('.quiz-step__question, .quiz-step__title, .quiz-loader__title');
    const target = /** @type {HTMLElement | null} */ (heading) ?? step;
    target.setAttribute('tabindex', '-1');
    // Defer so the browser paints the newly-shown step before focusing.
    requestAnimationFrame(() => target.focus({ preventScroll: false }));

    if (step.dataset.stepType === 'loading') {
      this.refs.live.textContent = heading?.textContent?.trim() || 'Analyzing your answers';
    } else {
      const total = this.trackedTotal || this.steps.length;
      const current = this.stepTrackedNumber[this.currentIndex] || 1;
      this.refs.live.textContent = `Step ${current} of ${total}`;
    }
  }

  /* ------------------------------------------------------------------ *
   * Validation + answer collection
   * ------------------------------------------------------------------ */

  /**
   * @param {HTMLElement} step
   * @returns {boolean}
   */
  #validateStep(step) {
    if (step.dataset.stepType === 'loading') return true;
    if (step.dataset.stepType === 'contact') return this.#validateContact(step);

    if (step.dataset.stepOptional === 'true') return true;
    const checked = step.querySelectorAll('input:checked').length > 0;
    if (!checked) this.#showError(step, 'Please select an option to continue.');
    return checked;
  }

  /**
   * @param {HTMLElement} step
   * @returns {boolean}
   */
  #validateContact(step) {
    /** @param {string} name */
    const field = (name) => /** @type {HTMLInputElement|null} */ (step.querySelector(`[name="${name}"]`));

    const first = field('first_name');
    const email = field('email');
    const phone = field('phone');
    const consent = field('consent');

    const problems = [];
    this.#markField(first, Boolean(first?.value.trim()));
    if (!first?.value.trim()) problems.push('your first name');

    const emailOk = Boolean(email && EMAIL_RE.test(email.value.trim()));
    this.#markField(email, emailOk);
    if (!emailOk) problems.push('a valid email');

    if (this.config.requirePhone) {
      const digits = (phone?.value || '').replace(/\D/g, '');
      const phoneOk = digits.length >= 7;
      this.#markField(phone, phoneOk);
      if (!phoneOk) problems.push('a valid phone number');
    }

    let consentOk = true;
    if (this.config.requireConsent && consent) {
      consentOk = consent.checked;
      this.#markField(consent, consentOk);
    }

    if (problems.length || !consentOk) {
      const msg = problems.length
        ? `Please enter ${problems.join(', ')}.`
        : 'Please agree to continue.';
      this.#showError(step, msg);
      // Focus the first offending field for keyboard/AT users.
      step.querySelector('[aria-invalid="true"]')?.focus?.();
      return false;
    }
    this.#clearError(step);
    return true;
  }

  /**
   * @param {HTMLElement} step
   */
  #collectAnswer(step) {
    // Only question steps carry answers (skip contact + loading steps).
    if (step.dataset.stepType !== 'question') return;

    const key = step.dataset.stepKey || step.dataset.stepId || '';
    const isMultiple = step.dataset.stepMultiple === 'true';
    const checked = /** @type {HTMLInputElement[]} */ ([...step.querySelectorAll('input:checked')]);
    const values = checked.map((input) => input.value);

    this.answers[key] = isMultiple ? values : values[0] ?? '';
    this.questions[key] = step.dataset.question || key;
  }

  /* ------------------------------------------------------------------ *
   * Tracking
   * ------------------------------------------------------------------ */

  #fireStepEvent() {
    const step = this.currentStepEl;
    if (!step) return;

    // Dedupe by DOM index so each step fires once, even if revisited.
    if (this.#firedSteps.has(this.currentIndex)) return;
    this.#firedSteps.add(this.currentIndex);

    if (step.dataset.stepType === 'loading') {
      pushEvent('quiz_calculating', { quiz_id: this.config.quizId, quiz_answers: { ...this.answers } });
      return;
    }

    const stepNumber = this.stepTrackedNumber[this.currentIndex] || this.currentIndex + 1;
    const key = step.dataset.stepKey || '';
    trackStep({
      quizId: this.config.quizId,
      stepNumber,
      totalSteps: this.trackedTotal || this.steps.length,
      stepId: step.dataset.stepId || `step-${stepNumber}`,
      stepType: step.dataset.stepType,
      question: step.dataset.question || undefined,
      answer: key ? this.answers[key] ?? null : null,
      answers: this.answers,
    });
  }

  /* ------------------------------------------------------------------ *
   * Submission
   * ------------------------------------------------------------------ */

  async #submitLead() {
    if (this.#submitting) return;
    this.#submitting = true;

    const step = this.currentStepEl;
    const contact = this.#getContact(step);
    this.#setLoading(true);

    const properties = this.#buildProperties();

    // 1) Marketing pixels — synchronous, never block the redirect.
    try {
      trackLead({
        quizId: this.config.quizId,
        pixelId: this.config.metaPixelId,
        value: this.config.leadValue,
        currency: 'USD',
        contact,
        answers: this.answers,
      });
    } catch (error) {
      console.error('[quiz-funnel] trackLead failed', error);
    }

    // 2) Klaviyo Client API — profile + list subscription + event.
    const tasks = [];
    if (this.config.klaviyoPublicKey) {
      const revision = this.config.klaviyoRevision;
      const publicKey = this.config.klaviyoPublicKey;
      const phone = toE164(contact.phone, this.config.defaultCountryCode);

      // Keep the raw phone as a property when it isn't valid E.164.
      if (contact.phone && !phone) properties.phone_raw = contact.phone;

      tasks.push(
        upsertProfile({ publicKey, revision, email: contact.email, firstName: contact.firstName, phone, properties })
      );
      if (this.config.klaviyoListId) {
        tasks.push(
          subscribeToList({
            publicKey,
            revision,
            listId: this.config.klaviyoListId,
            email: contact.email,
            phone,
            smsConsent: this.config.enableSms,
          })
        );
      }
      if (this.config.klaviyoMetric) {
        tasks.push(
          trackEvent({
            publicKey,
            revision,
            metricName: this.config.klaviyoMetric,
            email: contact.email,
            firstName: contact.firstName,
            phone,
            properties,
            value: this.config.leadValue,
          })
        );
      }
    }

    // Cap the wait: a lead should never be trapped by a slow network. We favour
    // conversion (redirect) over guaranteed delivery — keepalive lets the
    // requests finish after navigation anyway.
    const timeout = new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      await Promise.race([Promise.allSettled(tasks), timeout]);
    } catch (error) {
      console.error('[quiz-funnel] Klaviyo submit error', error);
    }

    this.#redirect();
  }

  /**
   * @param {HTMLElement|null} step
   * @returns {{ firstName: string, email: string, phone: string }}
   */
  #getContact(step) {
    /** @param {string} name */
    const val = (name) => {
      const el = /** @type {HTMLInputElement|null} */ (step?.querySelector(`[name="${name}"]`));
      return (el?.value || '').trim();
    };
    return { firstName: val('first_name'), email: val('email').toLowerCase(), phone: val('phone') };
  }

  /** @returns {Record<string, any>} */
  #buildProperties() {
    return {
      ...this.answers,
      quiz_id: this.config.quizId,
      quiz_source: 'GLP-1 Quiz Funnel',
      quiz_completed_at: new Date().toISOString(),
      quiz_landing_url: this.config.landingUrl,
    };
  }

  /** @param {boolean} loading */
  #setLoading(loading) {
    const btn = /** @type {HTMLButtonElement} */ (this.refs.continueButton);
    btn.disabled = loading;
    btn.setAttribute('aria-busy', String(loading));
    this.classList.toggle('is-submitting', loading);
    if (loading) {
      this.refs.live.textContent = 'Submitting your results…';
      btn.textContent = this.dataset.loadingLabel || 'Submitting…';
    }
  }

  #redirect() {
    let url = this.config.landingUrl || 'https://ledisa.com/products/glp-1';
    try {
      if (this.config.appendUtms) {
        const parsed = new URL(url);
        if (this.config.utmSource) parsed.searchParams.set('utm_source', this.config.utmSource);
        if (this.config.utmMedium) parsed.searchParams.set('utm_medium', this.config.utmMedium);
        if (this.config.utmCampaign) parsed.searchParams.set('utm_campaign', this.config.utmCampaign);
        url = parsed.toString();
      }
    } catch (error) {
      console.error('[quiz-funnel] Invalid landing URL', error);
    }
    window.location.assign(url);
  }

  /* ------------------------------------------------------------------ *
   * Error helpers
   * ------------------------------------------------------------------ */

  /**
   * @param {HTMLElement} step
   * @param {string} message
   */
  #showError(step, message) {
    const error = step.querySelector('[data-quiz-error]');
    if (error instanceof HTMLElement) {
      error.textContent = message;
      error.hidden = false;
    }
  }

  /** @param {HTMLElement} step */
  #clearError(step) {
    const error = step.querySelector('[data-quiz-error]');
    if (error instanceof HTMLElement) error.hidden = true;
  }

  /**
   * @param {HTMLElement|null} field
   * @param {boolean} valid
   */
  #markField(field, valid) {
    if (!field) return;
    field.setAttribute('aria-invalid', String(!valid));
  }
}

// Named with the `-component` suffix to match Horizon's convention and to
// benefit from the base event system's upgrade-race fallback.
if (!customElements.get('quiz-funnel-component')) {
  customElements.define('quiz-funnel-component', QuizFunnel);
}
