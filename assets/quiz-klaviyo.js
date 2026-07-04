/**
 * quiz-klaviyo.js
 * ---------------------------------------------------------------------------
 * Klaviyo **Client API** integration for the quiz funnel.
 *
 * Why the Client API (not the server/private-key API)?
 *   - It is purpose-built to be called from the browser using the PUBLIC key
 *     (a.k.a. company_id / site ID), which is safe to expose. No backend, no
 *     serverless function, no secrets in the theme — a good fit for a Shopify
 *     theme where we have no server of our own.
 *   - Endpoints used:
 *       POST /client/profiles       -> upsert profile + custom properties
 *       POST /client/subscriptions  -> subscribe to a list (with consent)
 *       POST /client/events         -> track a "Completed Quiz" metric
 *
 * Production hardening (documented in docs/SETUP.md): move the subscribe call
 * behind a Shopify App Proxy / serverless function using the PRIVATE key when
 * you need double-opt-in bypass, server-side validation, or bot protection.
 * @module quiz-klaviyo
 */

const CLIENT_BASE = 'https://a.klaviyo.com/client';

/**
 * Normalises a phone number to E.164 (best-effort). Klaviyo rejects non-E.164
 * numbers, so anything we can't confidently format is returned as null and the
 * caller stores it as a plain profile property instead.
 * @param {string} raw
 * @param {string} [defaultCountryCode="1"] - Digits only, no "+".
 * @returns {string|null}
 */
export function toE164(raw, defaultCountryCode = '1') {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed; // already E.164
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7) return null;
  // US/CA default: 10 digits -> prefix country code.
  if (defaultCountryCode === '1' && digits.length === 10) return `+1${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

/**
 * Shared POST helper for Client API endpoints.
 * @param {string} endpoint - e.g. "profiles".
 * @param {object} args
 * @param {string} args.publicKey
 * @param {string} args.revision - Klaviyo API revision (date string).
 * @param {object} args.body - JSON:API payload.
 * @returns {Promise<Response>}
 */
function postClient(endpoint, { publicKey, revision, body }) {
  return fetch(`${CLIENT_BASE}/${endpoint}/?company_id=${encodeURIComponent(publicKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      revision,
    },
    body: JSON.stringify(body),
    // keepalive lets the request survive the page navigation that follows a
    // successful submit (redirect to the product page).
    keepalive: true,
    mode: 'cors',
  });
}

/**
 * Upserts a profile (matched by email) with the quiz answers as custom
 * properties. Custom props are top-level under `properties`.
 * @param {object} args
 * @param {string} args.publicKey
 * @param {string} args.revision
 * @param {string} args.email
 * @param {string} [args.firstName]
 * @param {string} [args.phone] - E.164 or null.
 * @param {Record<string, any>} [args.properties]
 * @returns {Promise<Response>}
 */
export function upsertProfile({ publicKey, revision, email, firstName, phone, properties = {} }) {
  const attributes = { email, properties };
  if (firstName) attributes.first_name = firstName;
  if (phone) attributes.phone_number = phone;

  return postClient('profiles', {
    publicKey,
    revision,
    body: { data: { type: 'profile', attributes } },
  });
}

/**
 * Subscribes the profile to a list with explicit marketing consent. Honors the
 * list's single/double opt-in configuration in Klaviyo.
 * @param {object} args
 * @param {string} args.publicKey
 * @param {string} args.revision
 * @param {string} args.listId
 * @param {string} args.email
 * @param {string} [args.phone] - E.164; enables SMS consent when smsConsent=true.
 * @param {boolean} [args.smsConsent=false]
 * @param {string} [args.customSource="GLP-1 Quiz Funnel"]
 * @returns {Promise<Response>}
 */
export function subscribeToList({
  publicKey,
  revision,
  listId,
  email,
  phone,
  smsConsent = false,
  customSource = 'GLP-1 Quiz Funnel',
}) {
  const subscriptions = { email: { marketing: { consent: 'SUBSCRIBED' } } };
  const profileAttributes = { email, subscriptions };

  if (phone) {
    profileAttributes.phone_number = phone;
    if (smsConsent) subscriptions.sms = { marketing: { consent: 'SUBSCRIBED' } };
  }

  return postClient('subscriptions', {
    publicKey,
    revision,
    body: {
      data: {
        type: 'subscription',
        attributes: {
          custom_source: customSource,
          profile: { data: { type: 'profile', attributes: profileAttributes } },
        },
        relationships: { list: { data: { type: 'list', id: listId } } },
      },
    },
  });
}

/**
 * Tracks a custom metric event (e.g. "Completed GLP-1 Quiz") so the answers are
 * available for Klaviyo flows/segments even beyond profile properties.
 * @param {object} args
 * @param {string} args.publicKey
 * @param {string} args.revision
 * @param {string} args.metricName
 * @param {string} args.email
 * @param {string} [args.firstName]
 * @param {string} [args.phone]
 * @param {Record<string, any>} [args.properties]
 * @param {number} [args.value=0]
 * @returns {Promise<Response>}
 */
export function trackEvent({ publicKey, revision, metricName, email, firstName, phone, properties = {}, value = 0 }) {
  const profileAttributes = { email };
  if (firstName) profileAttributes.first_name = firstName;
  if (phone) profileAttributes.phone_number = phone;

  return postClient('events', {
    publicKey,
    revision,
    body: {
      data: {
        type: 'event',
        attributes: {
          metric: { data: { type: 'metric', attributes: { name: metricName } } },
          properties,
          value,
          time: new Date().toISOString(),
          profile: { data: { type: 'profile', attributes: profileAttributes } },
        },
      },
    },
  });
}
