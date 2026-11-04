/*
 * Talks to the BioAudit backend about the organisation's yearly subscription.
 *
 * It mirrors the desktop app (bioaudit/api/client.py), so both clients use the same
 * rules. One subscription covers the whole organisation. It renews and is charged
 * automatically each year until the admin cancels. Cancelling keeps everyone's access
 * until the end of the paid year; after that the admin and every member are suspended
 * until the subscription is renewed. Only an admin can cancel. The server enforces
 * that; the buttons on the dashboard are only hidden from members for convenience.
 *
 * Requests carry the signed-in user's Firebase ID token, which is what the backend
 * checks.
 */

export class BillingError extends Error {}

function apiBase() {
  const base = (window.bioauditApi && window.bioauditApi.base || "").trim().replace(/\/+$/, "");
  if (!base) {
    throw new BillingError("Managing the subscription from the website isn't set up yet. Use the BioAudit app for now.");
  }
  return base;
}

async function call(user, method, path, body) {
  const base = apiBase();
  let response;
  try {
    response = await fetch(base + path, {
      method,
      headers: {
        "Accept": "application/json",
        "Authorization": "Bearer " + (await user.getIdToken()),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    console.error("BioAudit server unreachable:", err);
    throw new BillingError("Couldn't reach the BioAudit server. Please try again shortly.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new BillingError((data.error && data.error.message) || "Something went wrong. Please try again.");
  }
  return data;
}

/*
 * The caller's own organisation, or null if they have none:
 *   { id, name, memberCount, isOwner, yourRole: "admin" | "member",
 *     subscription: { state, active, periodEnd } }
 * state is one of: none, unpaid, active, cancelling, ended.
 * Every member can read this; it stays available while the organisation is suspended.
 */
export async function loadMyOrganisation(user) {
  const data = await call(user, "GET", "/organisations/mine");
  return data.organisation || null;
}

/* Admin only. Stops the yearly renewal; access continues to the end of the paid year. */
export async function cancelSubscription(user, orgId, reason) {
  const body = { confirm: "CANCEL" };
  if (reason) body.reason = reason;
  return call(user, "POST", "/organisations/" + encodeURIComponent(orgId) + "/subscription/cancel", body);
}

/* Admin only. Undoes a cancellation before the paid year ends. */
export async function resumeSubscription(user, orgId) {
  return call(user, "POST", "/organisations/" + encodeURIComponent(orgId) + "/subscription/resume", {});
}

/* Admin only. Stripe's billing page, where the card can be changed. */
export async function billingPortalUrl(user, orgId) {
  return (await call(user, "POST", "/organisations/" + encodeURIComponent(orgId) + "/subscription/portal", {})).url;
}

/* Admin only. A Stripe checkout link to pay for a new year (or the first payment). */
export async function renewalUrl(user, orgId) {
  return (await call(user, "POST", "/organisations/" + encodeURIComponent(orgId) + "/subscription/renew", {})).url;
}