# GLP-1 Quiz Funnel — Shopify (Horizon) Technical Test

An **8-step quiz funnel** built as a **native Shopify section** on the **Horizon** theme,
connected to the marketing stack: **GTM**, **Meta Pixel**, and **Klaviyo**. On completion it
subscribes the lead to a Klaviyo list and lands them on
[`ledisa.com/products/glp-1`](https://ledisa.com/products/glp-1).

> Built the Shopify way (sections + blocks + web components) rather than as a standalone
> HTML/JS page — the merchant configures everything (questions, tracking IDs, Klaviyo keys,
> copy, colors) from the **theme editor** with zero code changes.

## What's included

| Requirement | Where |
|---|---|
| **Step 1** — 8-step quiz, mobile-first, progress bar, ADA-friendly | `sections/quiz-funnel.liquid`, `snippets/quiz-question.liquid`, `assets/quiz-funnel.js` |
| **Step 2** — GTM event per step + Meta `Lead` on submit, with quiz params | `assets/quiz-analytics.js` |
| **Step 3** — Klaviyo (email/name/phone + answers as custom props + list subscribe) | `assets/quiz-klaviyo.js` |
| **Step 4** — CheckoutChamp → Klaviyo list activation (written) | [`docs/CKC-KLAVIYO.md`](docs/CKC-KLAVIYO.md) |
| Setup, credentials, event dictionary, AI usage | [`docs/SETUP.md`](docs/SETUP.md) |

## Quick start

```bash
shopify theme dev --store your-store.myshopify.com   # preview
shopify theme check                                  # static analysis → 0 offenses
```

Then: **Admin → Pages → Add page → Template: `quiz`**, or add the **Quiz funnel** section in
the theme editor. Paste your **GTM / Meta / Klaviyo** IDs into the section settings. Full guide
in [`docs/SETUP.md`](docs/SETUP.md).

## Highlights (why it's senior-grade)

- **Idiomatic Horizon:** `<quiz-funnel>` extends the theme's `@theme/component` base class and
  uses its declarative `on:*` / `ref` system; CSS via `{% stylesheet %}`, config via `{% schema %}`.
- **Merchant-editable:** each question is a **block** (reorder/add/remove in the editor). Every
  credential and label is a setting — no redeploys to go live.
- **Accessible (WCAG 2.1 AA):** fieldset/legend, `role="radiogroup"`/`progressbar`, focus
  management, `aria-live`, `aria-invalid`, `prefers-reduced-motion`.
- **Performance & SEO:** server-rendered steps (crawlable + no-JS fallback), bundled CSS,
  deferred ES-module JS, **no external libraries**.
- **Secure by design:** only Klaviyo's **public** key touches the browser; the server-side
  (private key) upgrade path is documented and isolated to one module.

See [`docs/SETUP.md`](docs/SETUP.md) for the GTM/Meta event dictionary, the Klaviyo payloads,
and notes on how AI (Claude Code) was used.
