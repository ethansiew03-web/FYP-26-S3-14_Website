/**
 * Switches a BioAudit account to the paid tier when its Stripe subscription becomes active.
 *
 * The "Run Payments with Stripe" extension saves each subscription under
 * customers/{uid}/subscriptions/{id}. This function watches those records and
 * updates users/{uid} the same way the backend's own setTier() does: the tier and
 * subscription fields on the user record, plus the tier claim on their sign-in
 * account, which the desktop app's backend also checks.
 *
 * Only Stripe (through the extension) can write subscription records, so the
 * browser can never upgrade an account by itself.
 */
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

initializeApp();
const db = getFirestore();

// Only "active" counts as paid. Other Stripe statuses (past_due, canceled...) don't unlock the plan.
const PAID_STATUS = "active";

exports.syncSubscriptionTier = onDocumentWritten(
  {
    document: "customers/{uid}/subscriptions/{subscriptionId}",
    region: "asia-southeast1" // same region as the Firestore database
  },
  async (event) => {
    const uid = event.params.uid;
    const after = event.data && event.data.after.exists ? event.data.after.data() : null;
    const status = after ? after.status : "canceled"; // a deleted record counts as ended

    // An account also keeps its tier after the paid year is over.
    if (status !== PAID_STATUS) {
      logger.info(`Subscription for ${uid} is "${status}"; no change`);
      return;
    }

    const userRef = db.collection("users").doc(uid);
    const start = after.current_period_start instanceof Timestamp
      ? after.current_period_start
      : FieldValue.serverTimestamp();

    // Upgrade the account. A first-time Organisation customer also gets their organisation,
    // the same way the backend's register-admin does: an organisations document with them
    // as owner, admin and member, linked from their user record.
    // This runs in a transaction so a repeated Stripe event is unable to create two.
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) return null;
      const user = snap.data();

      const update = {
        tier: "premium",
        subscription: { status: "active", startedAt: start, cancelledAt: null },
        updatedAt: FieldValue.serverTimestamp()
      };
      let orgId = user.organisationId ?? null;
      let role = user.role || "member";

      if (!orgId) {
        const orgRef = db.collection("organisations").doc();
        const name = (user.organisationName || "").trim() ||
          ((user.displayName || "My") + "'s organisation");
        tx.set(orgRef, {
          name: name.slice(0, 120),
          ownerId: uid,
          adminIds: [uid],
          memberIds: [uid],
          createdAt: FieldValue.serverTimestamp()
        });
        orgId = orgRef.id;
        role = "admin";
        update.organisationId = orgId;
        update.role = role;
      }

      tx.update(userRef, update);
      return { orgId, role };
    });

    if (!result) {
      logger.warn(`No users/${uid} record; skipping subscription ${event.params.subscriptionId}`);
      return;
    }

    // Update the sign-in claims to match, as the backend's setClaims() does
    await getAuth().setCustomUserClaims(uid, { tier: "premium", role: result.role, organisationId: result.orgId });

    logger.info(`Set ${uid} to premium, role ${result.role}, organisation ${result.orgId}`);
  }
);