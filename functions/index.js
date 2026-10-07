/**
 * Upgrades or downgrades a BioAudit account when its Stripe subscription changes.
 *
 * The "Run Payments with Stripe" extension records each subscription under
 * customers/{uid}/subscriptions/{id}. This function watches those records and
 * updates users/{uid} the same way the backend's own setTier() does: the tier
 * and subscription fields on the user record, plus the tier custom claim on
 * the login, which the desktop app's backend also checks.
 *
 * Only Stripe (through the extension) can write subscription records, so the
 * browser can never trigger an upgrade by itself.
 */
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

initializeApp();
const db = getFirestore();

// Statuses that mean the customer has actually paid. "trialing" is deliberately
// NOT included: a free trial must not unlock the paid plan.
const PAID = ["active"];
// Statuses that mean the plan has ended.
const ENDED = ["canceled", "unpaid", "incomplete_expired"];

exports.syncSubscriptionTier = onDocumentWritten(
  {
    document: "customers/{uid}/subscriptions/{subscriptionId}",
    region: "asia-southeast1" // same region as the Firestore database
  },
  async (event) => {
    const uid = event.params.uid;
    const after = event.data && event.data.after.exists ? event.data.after.data() : null;
    const status = after ? after.status : "canceled"; // a deleted record counts as ended

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      logger.warn(`No users/${uid} record; skipping subscription ${event.params.subscriptionId}`);
      return;
    }
    const profile = userSnap.data();

    let tier;
    let subscription;

    if (PAID.includes(status)) {
      tier = "premium";
      const start = after.current_period_start instanceof Timestamp
        ? after.current_period_start
        : FieldValue.serverTimestamp();
      subscription = { status: "active", startedAt: start, cancelledAt: null };
    } else if (ENDED.includes(status)) {
      tier = "free";
      subscription = {
        status: "cancelled",
        startedAt: (profile.subscription && profile.subscription.startedAt) || null,
        cancelledAt: FieldValue.serverTimestamp()
      };
    } else {
      // trialing, incomplete, past_due, paused: leave the account as it is
      logger.info(`Subscription for ${uid} is "${status}"; no change`);
      return;
    }

    if (profile.tier === tier && profile.subscription && profile.subscription.status === subscription.status) {
      return; // already up to date
    }

    await userRef.update({ tier, subscription, updatedAt: FieldValue.serverTimestamp() });

    // Keep the login's custom claims in step, preserving role and organisation
    const user = await getAuth().getUser(uid);
    const claims = user.customClaims || {};
    await getAuth().setCustomUserClaims(uid, {
      ...claims,
      tier,
      role: profile.role || claims.role || "member",
      organisationId: profile.organisationId ?? claims.organisationId ?? null
    });

    logger.info(`Set ${uid} to ${tier} (Stripe status "${status}")`);
  }
);