/*
 * Sends a signed-in user to Stripe Checkout for the Organisation plan.
 *
 * How it works (Run Payments with Stripe extension):
 *  1. We add a "checkout session" request under customers/{uid}/checkout_sessions.
 *  2. The extension (on the server) asks Stripe for a checkout page and writes
 *     its link back onto that same document.
 *  3. We wait for the link, then send the browser to Stripe.
 *
 * The browser never decides whether someone has paid. After payment, the server
 * function in functions/index.js upgrades the account.
 */
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* Finds the active yearly price of the Organisation product (synced from Stripe). */
async function findOrganisationPrice(db) {
  const products = await getDocs(query(collection(db, "products"), where("active", "==", true)));
  for (const product of products.docs) {
    const prices = await getDocs(query(collection(product.ref, "prices"), where("active", "==", true)));
    const recurring = prices.docs.find((p) => p.data().type === "recurring");
    if (recurring) return recurring.id;
  }
  throw new Error("The Organisation plan isn't available right now. Please try again later.");
}

/*
 * db:  the Firestore instance
 * uid: the signed-in user's id
 * Returns a promise that only rejects on error; on success the page navigates to Stripe.
 */
export async function startCheckout(db, uid) {
  const price = await findOrganisationPrice(db);
  const base = window.location.origin;

  const sessionRef = await addDoc(collection(db, "customers", uid, "checkout_sessions"), {
    price,
    mode: "subscription",
    success_url: new URL("dashboard.html?checkout=success", window.location.href).href,
    cancel_url: new URL("dashboard.html?checkout=cancelled", window.location.href).href
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error("Stripe took too long to respond. Please try again."));
    }, 30000);

    const stop = onSnapshot(sessionRef, (snap) => {
      const data = snap.data() || {};
      if (data.error) {
        clearTimeout(timer);
        stop();
        reject(new Error(data.error.message || "Couldn't start checkout."));
      } else if (data.url) {
        clearTimeout(timer);
        stop();
        window.location.assign(data.url);
        resolve();
      }
    }, (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}