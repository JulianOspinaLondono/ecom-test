# Step 4 — CheckoutChamp (CKC) → Klaviyo List Activation

> **Goal:** when a customer **completes a purchase** in CheckoutChamp, automatically
> add them to a **specific Klaviyo list** (e.g. *GLP-1 Buyers*), so post-purchase
> flows (onboarding, replenishment, upsell) can fire in Klaviyo.

This is the written portion — no CKC access required. Below is exactly how I would
configure it end-to-end, the decisions behind each step, and how I'd scale it to
**multiple products/brands**.

---

## 0. Mental model — how CKC talks to Klaviyo

CheckoutChamp (Konnektive) pushes customer + order data outbound in three possible ways.
In order of preference:

| Method | When to use | Notes |
|---|---|---|
| **Native Klaviyo integration / plugin** (Integrations → CRM/ESP) | First choice if your CKC plan exposes it | Cleanest; maps fields for you |
| **Webhook / Postback** (event-driven POST on order events) | Most reliable & universal | Point it at a small endpoint that calls the Klaviyo API |
| **Zapier / Make middleware** | Fastest to stand up, no code | Adds cost + a moving part |

The plugin approach is what the task asks about, so that's the primary path; I include
the webhook path because in practice CKC's Klaviyo mapping is thin and a webhook gives
you full control over **which list** and **which products**.

---

## 1. Prep in Klaviyo (do this first)

1. **Create the destination list(s).** Klaviyo → *Audience → Lists & Segments → Create List*.
   - Name it clearly per intent, e.g. `GLP-1 — Purchasers`.
   - Copy each **List ID** (e.g. `WxYz12`). You'll map products → these IDs.
2. **Decide opt-in.** For **buyers**, single opt-in is appropriate (they transacted and
   consented at checkout). List settings → *Opt-in process → Single opt-in* so they land
   on the list immediately without a confirmation email.
3. **Create a Private API key** scoped to the integration. Klaviyo → *Settings → API keys →
   Create Private API Key*, grant **Lists: Full** and **Profiles: Full**. Store it as a
   secret in whatever runs the CKC → Klaviyo call (the plugin config or your webhook host).
4. **(Recommended) Define a custom metric** you can key flows off, e.g. `Placed Order (CKC)`,
   so Klaviyo flows are decoupled from list membership.

---

## 2. Campaign routing setup in CheckoutChamp

CKC organizes offers under **Campaigns**; each campaign contains **Products** and the
**checkout** that sells them. Routing is about making sure the *right purchase* triggers the
*right outbound event with the right list mapping*.

1. **Map the funnel.** In CKC → *Campaigns*, identify the campaign(s) that sell the GLP-1
   product. Note the **Campaign ID** and each **Product ID / SKU** in it (main offer,
   upsells, downsells).
2. **Set the integration at the campaign level, not globally.** CKC lets you attach CRM/ESP
   integrations per campaign. Attach the Klaviyo integration (or webhook) to the specific
   GLP-1 campaign so unrelated brands don't leak into this list.
3. **Choose the trigger scope.** Route on the **initial/main product** purchase, not on every
   upsell line, to avoid duplicate events. If upsells matter for segmentation, send them too
   but tag them (see §5).

---

## 3. Event type selection (the trigger)

CKC can emit on several lifecycle events. Pick the one that means "money captured":

| CKC event | Fire? | Why |
|---|---|---|
| **Order — SALE / Approved** | ✅ **Yes** | The purchase actually completed & was captured. This is the trigger. |
| Order — Decline / Failed | ❌ No | No purchase; would pollute a "buyers" list. |
| Order — Refund / Chargeback | ⚠️ Optional | Route to a *suppression* flow, not the buyers list. |
| Partial / Pending / Fraud-hold | ❌ No | Not a completed purchase yet. |

**Selection:** trigger on **`SALE` (Approved/Captured)** order status. In a webhook setup,
filter server-side: `if (payload.orderStatus === 'COMPLETE' or responseType === 'SUCCESS')`.

---

## 4. The mapping (fields CKC → Klaviyo)

Whether via the native plugin's field mapper or your webhook body, map:

| CKC field | Klaviyo profile attribute |
|---|---|
| `emailAddress` | `email` (primary identifier) |
| `firstName` | `first_name` |
| `lastName` | `last_name` |
| `phoneNumber` | `phone_number` (format to **E.164**) |
| `campaignId` / `productId` / `productName` | custom properties (`ckc_campaign_id`, etc.) |
| `orderId`, `orderTotal`, `currency` | custom props / event value |

Then **subscribe + add to list**. Using the Klaviyo API from a webhook, the robust modern
call is **Bulk Subscribe Profiles to a list** (creates the profile if new, sets consent, and
adds to the list in one shot):

```http
POST https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/
Authorization: Klaviyo-API-Key <PRIVATE_KEY>
revision: 2026-04-15
Content-Type: application/json

{
  "data": {
    "type": "profile-subscription-bulk-create-job",
    "attributes": {
      "custom_source": "CheckoutChamp — GLP-1 purchase",
      "profiles": {
        "data": [{
          "type": "profile",
          "attributes": {
            "email": "{{ckc.emailAddress}}",
            "phone_number": "{{ckc.e164Phone}}",
            "first_name": "{{ckc.firstName}}",
            "subscriptions": { "email": { "marketing": { "consent": "SUBSCRIBED" } } },
            "properties": {
              "ckc_campaign_id": "{{ckc.campaignId}}",
              "ckc_product": "{{ckc.productName}}",
              "ckc_order_id": "{{ckc.orderId}}"
            }
          }
        }]
      }
    },
    "relationships": { "list": { "data": { "type": "list", "id": "{{KLAVIYO_LIST_ID}}" } } }
  }
}
```

Also send a **`Placed Order (CKC)`** event (Create Event API) so flows can trigger on the
*purchase* rather than list membership — cleaner and idempotent.

---

## 5. Handling multiple products (the scaling question)

The naive approach — "one webhook, one hardcoded list" — breaks the moment you sell a second
product or run a second brand. Here's how I'd keep it scalable:

**Strategy: a product/campaign → list lookup table, not per-product integrations.**

1. **Single routing map.** Maintain one config that maps **Campaign/Product ID → Klaviyo List ID**:

   | CKC Campaign / Product | Klaviyo List |
   |---|---|
   | GLP-1 main (camp 101) | `GLP-1 — Purchasers` |
   | Sleep patches (camp 102) | `Sleep — Purchasers` |
   | Any (all buyers) | `All Customers` (always add) |

2. **One endpoint, dynamic list.** The webhook reads `campaignId`/`productId` from the payload,
   looks up the target list(s), and subscribes to **both** the product-specific list *and* a
   catch-all `All Customers` list. This means adding a product = one row in the map, zero new
   code or integrations.
3. **Tag, don't fragment.** Push `ckc_product`, `ckc_campaign_id`, `brand`, and `order_total`
   as **profile properties + event properties**. Now Klaviyo **segments** can slice buyers by
   product dynamically — you often don't even need a separate list per product, just per
   *marketing intent*.
4. **Bundles / multi-item orders.** If an order contains several products, iterate the order's
   line items and subscribe to each mapped list (dedupe list IDs so you don't double-call).
5. **Idempotency & suppression.** Key on `orderId` to avoid duplicate events on webhook
   retries. Route **refund/chargeback** events to remove from the buyers list or add to a
   suppression segment.

---

## 6. Verify & monitor

1. Place a **$0.01 / test SALE** in CKC (or use its test mode).
2. Confirm in Klaviyo: profile exists, is **on the correct list**, has the custom props, and
   the `Placed Order (CKC)` event shows on the profile timeline.
3. Add basic observability: log webhook responses, alert on non-2xx from Klaviyo, and watch
   Klaviyo's *List growth* + *API* dashboards for anomalies.

---

### TL;DR
Trigger on **CKC `SALE`/Approved**, mapped **per-campaign** (not globally), sending a
**Bulk Subscribe** call to a **product→list lookup table** plus a catch-all list, with product
metadata pushed as properties so Klaviyo **segments** do the heavy lifting. That keeps it
correct for one product today and trivially scalable to many products/brands tomorrow.
