# Quiz Funnel — Setup, Configuration & Event Reference

An 8-step, accessible, marketing-connected quiz built as a **native Shopify (Horizon)
section**. It fires GTM events per step, a Meta Pixel `Lead` on submit, subscribes the
lead to a Klaviyo list via the **Client API**, and lands the user on the GLP-1 product page.

---

## 1. Files

```
sections/quiz-funnel.liquid     Section: markup + {% stylesheet %} + {% schema %} (8 default questions)
snippets/quiz-question.liquid   Renders one question step (DRY, reusable)
assets/quiz-funnel.js           <quiz-funnel> web component (extends @theme/component)
assets/quiz-analytics.js        GTM dataLayer + Meta Pixel helpers
assets/quiz-klaviyo.js          Klaviyo Client API helpers
templates/page.quiz.json        Page template that renders the quiz with all 8 questions
docs/CKC-KLAVIYO.md             Step 4 (CheckoutChamp → Klaviyo) written explanation
docs/SETUP.md                   This file
```

---

## 2. Install on the dev store

You already have **Shopify CLI 4.x** and this theme locally. From the theme root:

```bash
# 1) Authenticate & preview against your dev store (opens a hot-reload preview)
shopify theme dev --store your-store.myshopify.com

# 2) (Optional) Static analysis — should report 0 offenses
shopify theme check
```

> `shopify theme dev` needs an interactive login. If a command needs you to log in,
> run it yourself in this session by typing `! shopify theme dev --store your-store.myshopify.com`.

Then create the page:

1. Shopify admin → **Online Store → Pages → Add page**. Title it e.g. *GLP-1 Quiz*.
2. In the **Theme template** picker (right sidebar), choose **`quiz`** (that's `templates/page.quiz.json`).
3. Save → visit `/pages/glp-1-quiz`. The quiz renders with all 8 questions.

**Alternative (no template):** in the theme editor, open any page → *Add section* → **Quiz funnel**.
The preset ships the 8 GLP-1 questions; reorder/add/remove them as blocks.

---

## 3. Credentials checklist — what to create & paste

Everything is configured in the **theme editor** (Customize → the Quiz funnel section).
**No code changes, no secrets committed to the repo.** Paste these values:

| Service | What to create | Where it goes (section setting) |
|---|---|---|
| **GTM** | A container → `GTM-XXXXXXX` | *Tracking → GTM container ID* |
| **Meta** | A Pixel → numeric Pixel ID | *Tracking → Meta Pixel ID* |
| **Klaviyo** | **Public API key** (company ID, 6 chars) | *Klaviyo → Public API key* |
| **Klaviyo** | A **List** → List ID | *Klaviyo → List ID* |

Optional but recommended:

- Set the Klaviyo list to the **opt-in** behavior you want (single vs double opt-in) —
  the Client API honors it. For a lead magnet, single opt-in usually converts best.
- **Production tip:** install GTM once, globally, in `layout/theme.liquid` and turn **OFF**
  *"Load GTM from this section"*. The in-section loader exists so a dev store works instantly.

> **Why only public keys live here:** the Klaviyo **public** key is designed to be exposed
> in the browser. We never place a **private** key in the theme. See §6 for the server-side
> upgrade path.

---

## 4. GTM & Meta — event dictionary

All events pass quiz data as parameters so GTM/GA4/Meta can segment without code changes.

### `window.dataLayer` events (GTM)

| Event | When | Key parameters |
|---|---|---|
| `quiz_step_1` … `quiz_step_N` | Each step becomes active (once) | `quiz_id`, `step_number`, `total_steps`, `step_id`, `step_type`, `question`, `answer`, `quiz_answers` |
| `generate_lead` | Final submit | `quiz_id`, `value`, `currency`, `quiz_answers`, `user_data{first_name,email,phone}` |

> PII lives under a namespaced `user_data` object so you can route it to a **server-side
> container / Meta CAPI** tag and deliberately exclude it from client GA4 tags.

**Wiring in GTM:** create *Custom Event* triggers on `quiz_step_.*` (regex) and `generate_lead`,
and Data Layer Variables for `quiz_id`, `answer`, `quiz_answers.*`, etc. Fire GA4 event tags
(and optionally the Meta tag) off them.

### Meta Pixel

| Event | When | Notes |
|---|---|---|
| `PageView` | Pixel init | Standard |
| `Lead` | Final submit | Params: `content_name` (quiz_id), `content_category`, `value`, `currency`. **Advanced Matching** re-inits the pixel with `em`/`ph`/`fn` (raw in → Meta hashes client-side). |

---

## 5. Klaviyo — what gets sent (Client API)

On final submit, three calls fire from the browser (public key, no backend):

1. **`POST /client/profiles`** — upserts the profile by email with `first_name`,
   `phone_number` (E.164), and **all quiz answers as custom properties**
   (`primary_goal`, `weight_goal`, …) plus `quiz_id`, `quiz_source`, `quiz_completed_at`.
2. **`POST /client/subscriptions`** — subscribes to the **List ID** with
   `email.marketing.consent = SUBSCRIBED` (and SMS consent if enabled). Honors the list's
   opt-in setting.
3. **`POST /client/events`** — logs a `Completed GLP-1 Quiz` metric with the answers, so
   Klaviyo **flows** can trigger on the event.

All requests use `keepalive: true` so they survive the redirect to the product page, and the
component caps the wait at ~2s (conversion over blocking).

**Custom property keys** come from each question block's *"Klaviyo / GTM property key"* field
(e.g. `primary_goal`). Keep them `snake_case` for clean segmentation.

---

## 6. Production hardening (documented trade-offs)

The Client-API approach is correct and secure for a themed storefront, but for scale you'd add:

- **Server-side subscribe** via a **Shopify App Proxy** or serverless function using the
  Klaviyo **private** key — enables bot protection, server validation, retries, and bypassing
  double opt-in when appropriate. The `quiz-klaviyo.js` module is already isolated, so swapping
  the transport is a one-file change.
- **Consent & compliance:** the consent checkbox is required by default (`require_consent`).
  For SMS, enable *"collect SMS consent"* only where you have TCPA-compliant language.
- **Rate limiting / abuse:** move submissions behind the proxy and add a honeypot / token.

---

## 7. Accessibility (ADA / WCAG 2.1 AA) notes

- Each question is a `<fieldset>` + `<legend>`; single-choice groups use `role="radiogroup"`
  with native radio inputs (arrow-key navigation for free).
- Focus moves to each step's heading on change; a polite `aria-live` region announces
  "Step X of N". The progress bar is a real `role="progressbar"` with `aria-valuenow/max/text`.
- Visible `:focus-visible` outlines, `aria-invalid` on failed fields, error text tied to steps.
- `prefers-reduced-motion` disables transitions/animations.
- Works without JS (server-rendered steps + `<noscript>` fallback) and without a mouse.

---

## 8. AI usage (for the Loom)

- **Tooling:** built with **Claude (Claude Code)** as an agentic pair-programmer inside the repo.
- **How it sped up the work:**
  - Reverse-engineered the **Horizon** theme conventions (web-component base class, importmap,
    `on:*` bindings, `{% stylesheet %}`/`{% schema %}`, design tokens) by reading the theme,
    so the section is idiomatic instead of bolted-on.
  - Scaffolded the section, snippet, component, and two tracking modules with correct Klaviyo
    **Client API** payload shapes and Meta **Advanced Matching**.
  - Ran **Theme Check** in the loop → iterated to **0 offenses**.
  - Drafted the 8 GLP-1 questions on-brand for Ledisa and this documentation.
- **What I directed / verified myself:** architecture decisions (native section vs. static HTML,
  Client API vs. server-side, section-local blocks for merchant-editable questions), the
  progressive-enhancement + a11y strategy, and reviewing every generated payload against the
  Klaviyo/Meta docs.
