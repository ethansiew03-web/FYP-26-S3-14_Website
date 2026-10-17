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
    let organisationId = profile.organisationId ?? null;
    let role = profile.role || "member";

    if (PAID.includes(status)) {
      const start = after.current_period_start instanceof Timestamp
        ? after.current_period_start
        : FieldValue.serverTimestamp();

      // Upgrade, and give a first-time Organisation customer their organisation,
      // the same way the backend's register-admin does: an organisations document
      // with them as owner, admin and member, linked from their user record.
      // Runs in a transaction so a repeated Stripe event can't create two.
      const result = await db.runTransaction(async (tx) => {
        const fresh = (await tx.get(userRef)).data();
        const update = {
          tier: "premium",
          subscription: { status: "active", startedAt: start, cancelledAt: null },
          updatedAt: FieldValue.serverTimestamp()
        };
        let orgId = fresh.organisationId ?? null;
        let newRole = fresh.role || "member";

        if (!orgId) {
          const orgRef = db.collection("organisations").doc();
          const name = (fresh.organisationName || "").trim() ||
            ((fresh.displayName || "My") + "'s organisation");
          tx.set(orgRef, {
            name: name.slice(0, 120),
            ownerId: uid,
            adminIds: [uid],
            memberIds: [uid],
            createdAt: FieldValue.serverTimestamp()
          });
          orgId = orgRef.id;
          newRole = "admin";
          update.organisationId = orgId;
          update.role = newRole;
        }

        tx.update(userRef, update);
        return { orgId, newRole };
      });

      tier = "premium";
      organisationId = result.orgId;
      role = result.newRole;
    } else if (ENDED.includes(status)) {
      // Ending the plan drops the tier only. The organisation and its members
      // are left alone, as the backend does when a subscription is cancelled.
      if (profile.tier === "free" && profile.subscription && profile.subscription.status === "cancelled") return;
      tier = "free";
      await userRef.update({
        tier,
        subscription: {
          status: "cancelled",
          startedAt: (profile.subscription && profile.subscription.startedAt) || null,
          cancelledAt: FieldValue.serverTimestamp()
        },
        updatedAt: FieldValue.serverTimestamp()
      });
    } else {
      // trialing, incomplete, past_due, paused: leave the account as it is
      logger.info(`Subscription for ${uid} is "${status}"; no change`);
      return;
    }

    // Keep the login's custom claims in step, as the backend's setClaims() does
    await getAuth().setCustomUserClaims(uid, { tier, role, organisationId });

    logger.info(`Set ${uid} to ${tier}, role ${role}, organisation ${organisationId} (Stripe status "${status}")`);
  }
);