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
import { api } from "./api.js";

const call = (user, method, path, body) => api(method, path, body, user);

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

/* Admin only. Everyone in the organisation: { id, displayName, email, role, scanCount, ... } */
export async function listMembers(user, orgId) {
  return (await call(user, "GET", "/organisations/" + encodeURIComponent(orgId) + "/members")).members || [];
}

/* Admin only. One member's scans, as summaries without the findings. The server records each read. */
export async function listMemberScans(user, orgId, memberId, limit = 50) {
  const path = "/organisations/" + encodeURIComponent(orgId) + "/members/" + encodeURIComponent(memberId) + "/scans?limit=" + limit;
  return (await call(user, "GET", path)).scans || [];
}

/* One full scan with its findings. An admin may open a member's scan; the server records that read. */
export async function getScan(user, scanId) {
  return (await call(user, "GET", "/scans/" + encodeURIComponent(scanId))).scan;
}
