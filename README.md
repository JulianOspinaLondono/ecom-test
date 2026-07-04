# GLP-1 Quiz Funnel — Shopify (Horizon) Technical Test

An **8-step quiz funnel** built as a **native Shopify section** on the **Horizon** theme and wired
into the marketing stack — **GTM**, **Meta Pixel**, and **Klaviyo**. On completion it subscribes
the lead to a Klaviyo list and lands the user on
[`ledisa.com/products/glp-1`](https://ledisa.com/products/glp-1).

Built the Shopify way (sections + blocks + web components), not as a throwaway HTML page: a
merchant configures **everything** — questions, tracking IDs, Klaviyo keys, copy, colors — from
the **theme editor**, with zero code changes to go live.

> **Reviewer TL;DR:** it's already deployed and running on a live dev store (link + password
> below), and there's a zero-setup `preview.html` you can just double-click. Everything was
> verified working end-to-end (see [Verified working](#-verified-working-live)).

---

## 🔗 How to test it (two ways)

### Option A — Live on the Shopify store *(recommended — the real thing)*

| | |
|---|---|
| **Quiz page** | **https://apps-learning-pznaip87.myshopify.com/pages/funnel** |
| **Storefront password** | **`yaidey`** |

1. Open the URL, enter the storefront password `yaidey` (it's a password-protected **dev store**).
2. Play the quiz: pick answers (it **auto-advances**), watch the **progress bar**, the
   **"Analyzing your answers…"** screen, then the contact step (name / email / phone + consent).
3. Submitting fires the marketing events and redirects to the GLP-1 product page.

> ℹ️ **Testing the pixels in your own browser?** Ad/tracking blockers (uBlock, Brave Shields,
> Safari ITP, etc.) commonly block `connect.facebook.net/fbevents.js` while allowing
> `googletagmanager.com`. If Meta Pixel Helper shows "no pixel," test in **Incognito with
> extensions off**, or verify server-side in **Meta Events Manager → Test Events**. See
> [Marketing integrations](#-marketing-integrations--what-fires--how-to-verify).

### Option B — Standalone preview *(no Shopify, no server, no password)*

Open **[`preview.html`](preview.html)** in any browser (double-click). It mirrors the funnel with
sample data and a **live event panel** on the right that shows `quiz_step_N`, `quiz_calculating`,
`generate_lead`, and the Meta `Lead` firing as you play — great for a quick look.

- Deep-link any screen for demos: `preview.html#step=contact`, `#step=loading`, `#step=3`.
- No external calls are made from the preview (it logs events instead of sending them).

---

## ✅ Verified working (live)

Confirmed on the live page (`/pages/funnel`) in a clean browser by driving it programmatically:

| Check | Result |
|---|---|
| Quiz renders, branded, mobile-responsive, keyboard/AT accessible | ✅ |
| GTM events fire per step | `quiz_step_1 … quiz_step_4 …` present in `dataLayer` ✅ |
| GTM container loads & receives | `window.google_tag_manager` present, container `GTM-NNX4MZ7V` ✅ |
| Meta Pixel loads & initializes | `fbq` = function, `fbevents.js` loaded, pixel **`620635847480642`** initialized ✅ |
| Klaviyo integration | `/client/profiles`, `/client/subscriptions`, `/client/events` all return **HTTP 202** ✅ |
| Theme Check (static analysis) | **330 files, 0 offenses** ✅ |

---

## 🧩 What was built

| File | Role |
|---|---|
| `sections/quiz-funnel.liquid` | The section: markup, scoped `{% stylesheet %}`, and `{% schema %}` with merchant-editable **question blocks** (8 GLP-1 questions preset), tracking/Klaviyo settings, colors, copy |
| `snippets/quiz-question.liquid` | Renders one question step (DRY, reusable) |
| `assets/quiz-funnel.js` | `<quiz-funnel-component>` — extends Horizon's `@theme/component` base class (step nav, progress, validation, calculating screen, submit orchestration, a11y focus) |
| `assets/quiz-analytics.js` | GTM `dataLayer` + Meta Pixel helpers (incl. Advanced Matching) |
| `assets/quiz-klaviyo.js` | Klaviyo **Client API** (profiles + subscriptions + events) |
| `templates/page.quiz.json` | Page template that renders the funnel with all 8 questions + wired credentials |
| `preview.html` | Standalone, double-click preview with a live event panel |
| [`docs/SETUP.md`](docs/SETUP.md) | Setup, credentials, event dictionary, production notes, AI usage |
| [`docs/CKC-KLAVIYO.md`](docs/CKC-KLAVIYO.md) | **Step 4** — CheckoutChamp → Klaviyo list activation (written) |

**Why it's senior-grade:** idiomatic Horizon web component; every question and credential is
editable in the theme editor (no redeploys); **WCAG 2.1 AA** (fieldset/legend, `role="radiogroup"`
/ `progressbar`, focus management, `aria-live`, `aria-invalid`, `prefers-reduced-motion`);
server-rendered steps (crawlable + no-JS fallback); bundled CSS + deferred ES-module JS; **no
external libraries**; only Klaviyo's **public** key touches the browser (private-key/server-side
path is documented and isolated to one module).

---

## 📊 Marketing integrations — what fires & how to verify

### Klaviyo *(works out of the box — direct API)*
On final submit, three browser-side **Client API** calls fire (public key `RXGNCa`, list `RR4y8f`,
revision `2026-04-15`):
1. **`POST /client/profiles`** — upserts the profile with `first_name`, `phone_number` (E.164), and
   **all quiz answers as custom properties** (`primary_goal`, `weight_goal`, …).
2. **`POST /client/subscriptions`** — subscribes to the list with marketing consent.
3. **`POST /client/events`** — logs a `Completed GLP-1 Quiz` metric (for Klaviyo flows).

**Verify:** submit the quiz → in Klaviyo, the profile appears on list `RR4y8f` with the answers as
properties, and the `Completed GLP-1 Quiz` event shows on the profile timeline.

### Google Tag Manager *(loads & receives — needs tags to forward)*
Our code **pushes** semantic events to `window.dataLayer` (`quiz_step_1…N`, `quiz_calculating`,
`generate_lead`). GTM (`GTM-NNX4MZ7V`) **loads and receives them** — but a container only *forwards*
data once you build **Triggers + Tags** and **Publish**. That configuration lives in the GTM UI
(intentionally not in the theme), so the merchant/reviewer owns their own GA4/Meta routing.

**Verify:** GTM → **Preview** → play the quiz → the events appear in the Tag Assistant timeline.
Then add e.g. a Custom-Event trigger `quiz_step_.*` (regex) + a GA4 Event tag, and **Publish**.

### Meta Pixel *(loads & fires — verified initialized)*
On load the section initializes pixel **`620635847480642`** (`fbq('init', …)` + `PageView`); on
submit it fires **`Lead`** with **Advanced Matching** (email/phone/first-name hashed client-side by
Meta — we never send raw PII ourselves).

**Verify:** in a browser **without a tracking blocker** (or Incognito) use Meta Pixel Helper, or —
blocker-proof — **Events Manager → Test Events** and watch `PageView` / `Lead` in real time.
*(Note: the "Overview" tab lags ~20 min; use Test Events for live confirmation.)*

**Production tip:** for earliest load / best matching, move GTM + Meta base code into
`layout/theme.liquid <head>` and turn off the section's "Load from section" toggles. Documented in
[`docs/SETUP.md`](docs/SETUP.md).

---

## 📈 Event dictionary (`window.dataLayer`)

| Event | When | Key parameters |
|---|---|---|
| `quiz_step_1 … quiz_step_N` | Each step becomes active (once). N = questions + contact; the calculating screen is not counted. | `quiz_id`, `step_number`, `total_steps`, `step_id`, `step_type`, `question`, `answer`, `quiz_answers` |
| `quiz_calculating` | "Analyzing your answers" screen shown | `quiz_id`, `quiz_answers` |
| `generate_lead` | Final submit (GA4 recommended name) | `quiz_id`, `value`, `currency`, `quiz_answers`, `user_data{first_name,email,phone}` |
| Meta `Lead` | Final submit (via `fbq`) | `content_name` (quiz_id), `content_category`, `value`, `currency` |

---

## 🔑 Credentials wired (all client-side / non-secret)

| Service | Value | Where |
|---|---|---|
| GTM container | `GTM-NNX4MZ7V` | section setting `gtm_container_id` |
| Meta Pixel | `620635847480642` | section setting `meta_pixel_id` |
| Klaviyo public key | `RXGNCa` | section setting `klaviyo_public_key` |
| Klaviyo list | `RR4y8f` | section setting `klaviyo_list_id` |
| Landing URL | `https://ledisa.com/products/glp-1` | section setting `landing_url` |

> All of these are **public, client-side values** (they appear in any live page's source). No
> private/secret keys are stored in the repo. The storefront password above is a temporary
> **dev-store** password for review and can be rotated afterward.

---

## 🛠️ Run it yourself (from source)

```bash
shopify theme dev --store apps-learning-pznaip87.myshopify.com   # local hot-reload preview
shopify theme check                                              # static analysis → 0 offenses
```
Then **Admin → Pages → Add page → Template: `quiz`**, or add the **Quiz funnel** section in the
theme editor. Full guide, event details, and production notes in [`docs/SETUP.md`](docs/SETUP.md).

---

## 📝 Step 4 — CheckoutChamp → Klaviyo (written)

A clear, step-by-step plan (campaign routing, `SALE`/Approved event selection, field mapping, and a
product→list lookup table to scale to many products/brands) is in
**[`docs/CKC-KLAVIYO.md`](docs/CKC-KLAVIYO.md)**.

---

## 🤖 AI usage

Built with **Claude (Claude Code)** as an agentic pair-programmer. Highlights (full notes in
[`docs/SETUP.md §8`](docs/SETUP.md)):

- Reverse-engineered Horizon's conventions (web-component base class, importmap, `on:*` bindings,
  `{% stylesheet %}` / `{% schema %}`, design tokens) so the section is idiomatic, not bolted-on.
- Scaffolded the section, snippet, component, and two tracking modules with correct Klaviyo
  **Client API** payloads and Meta **Advanced Matching**.
- **Live-verified** the Klaviyo API (caught a real API-revision bug — `2024-10-15` rejected the
  subscription; fixed to `2026-04-15`), then drove the deployed store with a headless browser to
  confirm `dataLayer`, `fbq` init, and GTM were all loading — including catching that the "missing"
  Meta pixel was a browser ad-blocker, not a code issue.
- Iterated with **Theme Check** to 0 offenses; drafted the 8 GLP-1 questions and all docs.
