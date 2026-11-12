import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
    getFirestore,
    doc,
    getDoc,
    onSnapshot,
    collection,
    query,
    where,
    limit,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { startCheckout } from "./checkout.js";
import {
    loadMyOrganisation,
    cancelSubscription,
    resumeSubscription,
    billingPortalUrl,
    renewalUrl,
    listMembers,
    listMemberScans,
    getScan
} from "./billing.js";

const app = initializeApp(window.firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ===== Settings ===== */
const STUDENT_LENGTH_MONTHS = 36; // students get 3 years free, count starting from their signup date
const PLAN_LENGTH_MONTHS = 12;   // organisation plan lasts for a year before auto renewal
const WARN_DAYS = 30;            // start warning this many days before the end
const PLANS = {
    student: { name: "Student", price: "$0, valid for 3 years" },
    organisation: { name: "Organisation", price: "$34.99/year" }
};
const FEATURES = [
    "Black-box scanning of any Android app, no source code or root access needed",
    "Authentication bypass detection",
    "Side-channel leak detection",
    "Plain-language explanations with a concrete fix for every finding",
    "Export scan reports as HTML or PDF",
    "Compare two scans side by side",
    "Scan history saved to your account",
    "Team management for organisations"
];
const SEVERITIES = ["critical", "high", "medium", "low", "info"];

/* ===== Small helpers ===== */
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const toDate = (v) => {
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate();      // from Firestore in the browser
    const secs = v._seconds ?? v.seconds;                        // from the BioAudit server
    return secs != null ? new Date(secs * 1000) : new Date(v);
};
const fmtDate = (d) => d ? d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "–";
const fmtDateTime = (d) => d ? d.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "–";
const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : "";

let currentUser = null;
let profile = {};
let scans = [];
let memberScans = [];             // admins only: the scans of every member, newest first
let memberReportsState = "idle";  // idle, loading, done or failed

/* ===== Tabs ===== */
const tabs = ["overview", "reports", "account", "subscription"];
function showTab(name) {
    tabs.forEach((t) => {
    const selected = t === name;
    $("tab-" + t).setAttribute("aria-selected", String(selected));
    $("sec-" + t).hidden = !selected;
    });
    history.replaceState(null, "", "#" + name);
    // Admins: load the members' reports the first time Reports is opened
    if (name === "reports" && isOrgAdmin() && memberReportsState === "idle") loadMemberReports();
}
tabs.forEach((t) => $("tab-" + t).addEventListener("click", () => showTab(t)));

/* ===== Plan and time left ===== */
function planKey() {
    const tier = (profile.tier || "").toLowerCase();
    return (tier === "organisation" || tier === "premium") ? "organisation" : "student";
}
// Chose Organisation at sign-up but hasn't paid yet
function isPending() {
    return planKey() === "student" && profile.requestedPlan === "organisation";
}

/* ===== Stripe checkout ===== */
let checkingOut = false;
async function goToCheckout(btn) {
    if (checkingOut) return;
    checkingOut = true;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Opening checkout…";
    $("sub-error").textContent = "";
    try {
    await startCheckout(db, currentUser.uid);
    } catch (err) {
    console.error(err);
    $("sub-error").textContent = err.message || "Couldn't open checkout. Please try again.";
    if (btn.id === "banner-action") $("expiry-banner-text").textContent = err.message || "Couldn't open checkout.";
    btn.disabled = false;
    btn.textContent = label;
    checkingOut = false;
    }
}
function planDates() {
    const start =
    toDate(profile.subscription && profile.subscription.startedAt) ||
    toDate(profile.createdAt) ||
    (currentUser.metadata.creationTime ? new Date(currentUser.metadata.creationTime) : new Date());
    const end = new Date(start);
    end.setMonth(end.getMonth() + (planKey() === "student" ? STUDENT_LENGTH_MONTHS : PLAN_LENGTH_MONTHS));
    const daysLeft = Math.ceil((end - new Date()) / 86400000);
    const total = (end - start) / 86400000;
    const usedPct = Math.min(100, Math.max(0, ((total - Math.max(daysLeft, 0)) / total) * 100));
    return { start, end, daysLeft, usedPct };
}
function daysText(n) {
    if (n <= 0) return "Expired";
    if (n === 1) return "1 day";
    if (n < 60) return n + " days";
    return Math.floor(n / 30) + " months";
}

function renderPlan() {
    if (renderOrganisationView()) return;
    if (isPending()) { renderPending(); return; }
    const key = planKey();
    const plan = PLANS[key];
    const { start, end, daysLeft, usedPct } = planDates();
    const expired = daysLeft <= 0;
    const soon = !expired && daysLeft <= WARN_DAYS;

    // Overview cards
    $("ov-plan").textContent = plan.name;
    $("ov-plan-note").textContent = plan.price;
    $("ov-days").textContent = daysText(daysLeft);
    $("ov-days-note").textContent = expired
    ? (key === "student" ? "Ended " : "Expired ") + fmtDate(end)
    : (key === "student" ? "Free access ends " : "Renews ") + fmtDate(end);

    // Warning banner
    const banner = $("expiry-banner");
    if (expired || soon) {
    banner.hidden = false;
    banner.className = "banner " + (expired ? "bad" : "warn");
    if (key === "student") {
        $("expiry-banner-text").textContent = expired
        ? "Your free student access ended on " + fmtDate(end) + ". Your account has been suspended in the app."
        : "Your free student access ends in " + daysText(daysLeft) + ", on " + fmtDate(end) + ".";
    } else {
        $("expiry-banner-text").textContent = expired
        ? "Your Organisation plan expired on " + fmtDate(end) + ". Renew to keep using BioAudit."
        : "Your Organisation plan is due for renewal in " + daysText(daysLeft) + ", on " + fmtDate(end) + ".";
    }
    } else {
    banner.hidden = true;
    }
    const bannerBtn = $("banner-action");
    bannerBtn.hidden = key === "student";     // student not allowed to upgrade or join an organisation
    bannerBtn.textContent = key === "View plans";
    bannerBtn.onclick = key = () => { location.href = "plans.html"; };

    // Subscription tab
    $("sub-name").textContent = plan.name;
    $("sub-price").textContent = plan.price;
    const badge = $("sub-badge");
    badge.textContent = expired ? "Expired" : soon ? "Ending soon" : "Active";
    badge.className = "badge " + (expired ? "bad" : soon ? "warn" : "good");
    $("sub-bar").style.width = usedPct + "%";
    $("sub-start").textContent = "Started " + fmtDate(start);
    $("sub-end").textContent = (key === "student" ? "Ends " : "Renews ") + fmtDate(end);

    let msg;
    if (key === "student") {
        msg = "";
    } else {
        msg = expired
            ? "Your plan expired on " + fmtDate(end) + ". Renew it to keep using BioAudit."
            : "Your plan is paid up for another " + daysLeft + " day" + (daysLeft === 1 ? "" : "s") + ". It renews automatically on " + fmtDate(end) + ".";
    }
    $("sub-action").hidden = true;       // no upgrade button for students
    $("sub-message").textContent = msg;

    const studentNote = $("sub-note");
    studentNote.hidden = key !== "student";
    if (key === "student") {
        $("sub-note-text").textContent = "*Student email is verified only once, when you sign up. " +
            "The student plan is free for 3 years from sign-up. After that, the account is suspended in the BioAudit app, " +
            "but you can still log in to this dashboard.";
    }

    const tick = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 L6.5 12 L13 4.5"/></svg>';
    $("sub-features").innerHTML = FEATURES.map((f) => "<li>" + tick + "<span>" + esc(f) + "</span></li>").join("");
}

function renderPending() {
    const plan = PLANS.organisation;
    $("ov-plan").textContent = plan.name;
    $("ov-plan-note").textContent = "Payment pending";
    $("ov-days").textContent = "–";
    $("ov-days-note").textContent = "Starts once payment is complete";

    const banner = $("expiry-banner");
    // Just back from paying: the "activating" notice covers it, so don't also ask them to pay
    banner.hidden = checkoutResult === "success";
    banner.className = "banner warn";
    $("expiry-banner-text").textContent = "Your Organisation plan isn't active yet. Complete your payment to activate it.";
    const bannerBtn = $("banner-action");
    bannerBtn.textContent = "Complete payment";
    bannerBtn.onclick = () => goToCheckout(bannerBtn);

    $("sub-name").textContent = plan.name;
    $("sub-price").textContent = plan.price;
    const badge = $("sub-badge");
    badge.textContent = "Payment pending";
    badge.className = "badge warn";
    $("sub-bar").style.width = "0%";
    $("sub-start").textContent = "";
    $("sub-end").textContent = "";
    $("sub-message").textContent = "You chose the Organisation plan when you signed up. Complete your payment to activate it. Until then, your account works like a Student account.";
    const action = $("sub-action");
    action.hidden = false;
    action.textContent = "Complete payment";
    action.onclick = () => goToCheckout(action);

    const tick = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 L6.5 12 L13 4.5"/></svg>';
    $("sub-features").innerHTML = FEATURES.map((f) => "<li>" + tick + "<span>" + esc(f) + "</span></li>").join("");
}

/* ===== Organisation subscription: cancel, keep and renew (same rules as the BioAudit app) =====
    *
    * One yearly subscription covers the whole organisation, and the BioAudit server (the
    * same one the desktop app uses) decides its state:
    *   active     paid and set to renew automatically each year
    *   cancelling cancelled; everyone keeps access until the end of the paid year
    *   ended      the paid year is over; the admin and every member are suspended
    *   unpaid     signed up in the app but not paid yet
    *   none       not billed (an organisation from before billing)
    *
    * This only adds to the plan view above. renderPlan() hands over to renderOrganisation()
    * when the server reports one of the first four states; in every other case the original
    * code below runs exactly as before.
    */
let org = null;            // the user's organisation from the BioAudit server, with its subscription state
let orgFor = null;         // which organisation id `org` was loaded for
let orgLoadFailed = false; // the server couldn't be reached, so the page falls back to the account record
let busy = false;

function orgSub() { return org && org.subscription ? org.subscription : null; }
function isOrgAdmin() { return !!org && org.yourRole === "admin"; }
function orgBilled() {
    const s = orgSub();
    return !!s && ["unpaid", "active", "cancelling", "ended"].includes(s.state);
}

/* Called first by renderPlan(). Returns true when it has drawn the organisation view. */
function renderOrganisationView() {
    // Put back what the organisation view may have hidden or restyled
    $("banner-action").hidden = false;
    $("sub-action").className = "btn";
    $("sub-portal").hidden = true;
    $("sub-note").hidden = true;
    if (orgLoadFailed && !org && profile.organisationId) {
    $("sub-error").textContent = "Couldn't load your organisation's subscription from the BioAudit server, so this page may be out of date.";
    }
    if (!orgBilled()) return false;
    renderOrganisation();
    return true;
}

function renderOrganisation() {
    const s = orgSub();
    const admin = isOrgAdmin();
    const plan = PLANS.organisation;
    const end = toDate(s.periodEnd);
    const when = end ? fmtDate(end) : "the end of the paid year";
    const daysLeft = end ? Math.ceil((end - new Date()) / 86400000) : 0;
    const live = s.state === "active" || s.state === "cancelling";
    // Stripe can leave the old period end on a subscription that was ended early, so
    // only call it "Ended on <date>" when that date has actually passed
    const endPassed = !!end && end <= new Date();

    // Account tab (renderProfile() ran just before this and wrote the plain plan name)
    const label = { active: "active", cancelling: "cancelled, ends " + when, ended: "suspended", unpaid: "payment needed" }[s.state];
    $("ac-plan").textContent = "Organisation (" + label + ")";
    if (org.yourRole) {
    $("ac-role-wrap").hidden = false;
    $("ac-role").textContent = cap(org.yourRole);
    }

    // Overview cards
    $("ov-plan").textContent = plan.name;
    $("ov-plan-note").textContent = {
    active: "Renews automatically each year",
    cancelling: "Will not renew",
    ended: "Suspended",
    unpaid: "Payment needed"
    }[s.state];
    $("ov-days").textContent = live && daysLeft > 0 ? daysText(daysLeft) : (s.state === "ended" ? "Ended" : "–");
    $("ov-days-note").textContent = {
    active: "Renews " + when,
    cancelling: "Access ends " + when,
    ended: endPassed ? "Ended " + when : "Subscription ended",
    unpaid: "Starts once payment is complete"
    }[s.state];

    // Banner
    const banner = $("expiry-banner");
    const bannerBtn = $("banner-action");
    bannerBtn.hidden = !admin;
    if (s.state === "active") {
    banner.hidden = true;
    } else {
    banner.hidden = false;
    banner.className = "banner " + (s.state === "ended" ? "bad" : "warn");
    if (s.state === "cancelling") {
        $("expiry-banner-text").textContent = "Your subscription has been cancelled. You and every member keep access until " + when +
        ". After that, all accounts in the organisation are suspended until it is renewed.";
        bannerBtn.textContent = "Keep subscription";
        bannerBtn.onclick = () => runAction(bannerBtn, doResume);
    } else if (s.state === "ended") {
        $("expiry-banner-text").textContent = "Your subscription has ended. You and every member of the organisation are suspended in the BioAudit app until it is renewed." +
        (admin ? "" : " Ask your organisation's admin to renew it.");
        bannerBtn.textContent = "Renew subscription";
        bannerBtn.onclick = () => runAction(bannerBtn, doRenew);
    } else {
        $("expiry-banner-text").textContent = "Your organisation's yearly subscription has not been paid yet. " +
        (admin ? "Pay for it to start using BioAudit and invite your team." : "Ask your organisation's admin to pay for it.");
        bannerBtn.textContent = "Pay for subscription";
        bannerBtn.onclick = () => runAction(bannerBtn, doRenew);
    }
    }

    // Subscription tab
    $("sub-name").textContent = plan.name;
    $("sub-price").textContent = plan.price;
    const badge = $("sub-badge");
    badge.textContent = { active: "Active", cancelling: "Cancelled", ended: "Suspended", unpaid: "Payment needed" }[s.state];
    badge.className = "badge " + ({ active: "good", cancelling: "warn", ended: "bad", unpaid: "warn" }[s.state]);

    // The server gives only the end of the paid year, so the year is counted back from it
    let pct = s.state === "ended" ? 100 : 0;
    let startText = "";
    if (live && end) {
    const start = new Date(end);
    start.setFullYear(start.getFullYear() - 1);
    pct = Math.min(100, Math.max(0, ((new Date() - start) / (end - start)) * 100));
    startText = "Started " + fmtDate(start);
    }
    $("sub-bar").style.width = pct + "%";
    $("sub-start").textContent = startText;
    $("sub-end").textContent = live && end ? (s.state === "cancelling" ? "Ends " : "Renews ") + when
    : s.state === "ended" && endPassed ? "Ended " + when : "";

    $("sub-message").textContent = {
    cancelling: "Your subscription has been cancelled. You and every member keep access until " + when +
        ". After that, all accounts in the organisation are suspended until the subscription is renewed." +
        (admin ? " You can undo this any time before then." : ""),
    ended: "Your subscription has ended. You and every member are suspended in the BioAudit app until it is renewed." +
        (admin ? "" : " Ask your organisation's admin."),
    unpaid: "Your organisation's yearly subscription has not been paid yet." +
        (admin ? " Pay for it to start using BioAudit and invite your team." : " It needs to be paid by your organisation's admin.")
    }[s.state];

    // Buttons: only available for admins
    const action = $("sub-action");
    action.hidden = !admin;
    action.disabled = false;
    if (s.state === "active") {
    action.textContent = "Cancel subscription";
    action.className = "btn btn-ghost";
    action.onclick = openCancelDialog;
    } else if (s.state === "cancelling") {
    action.textContent = "Keep subscription";
    action.onclick = () => runAction(action, doResume);
    } else {
    action.textContent = s.state === "unpaid" ? "Pay for subscription" : "Renew subscription";
    action.onclick = () => runAction(action, doRenew);
    }
    const portal = $("sub-portal");
    portal.hidden = !(admin && s.state !== "unpaid");
    portal.onclick = () => runAction(portal, doPortal);

    const note = $("sub-note");
    note.hidden = false;
    $("sub-note-text").textContent = "*One subscription covers the whole organisation: the admin and every member share the same paid year. " +
    "It renews and is charged automatically each year until it is cancelled. Cancelling keeps everyone's access until the end of the " +
    "paid year; after that, all accounts in the organisation are suspended until the subscription is renewed. Only admins can cancel.";

    const tick = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 L6.5 12 L13 4.5"/></svg>';
    $("sub-features").innerHTML = FEATURES.map((f) => "<li>" + tick + "<span>" + esc(f) + "</span></li>").join("");
}

/* ----- Actions (calling the BioAudit server, like the app does) ----- */
function showNotice(text, kind) {
    const box = $("notice");
    box.hidden = false;
    box.className = "banner " + kind;
    $("notice-text").textContent = text;
}
async function runAction(btn, work) {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    $("sub-error").textContent = "";
    try {
    await work();
    } catch (err) {
    console.error(err);
    const message = err.message || "Something went wrong. Please try again.";
    $("sub-error").textContent = message;
    showNotice(message, "warn");
    } finally {
    btn.disabled = false;
    busy = false;
    }
}
async function doResume() {
    const result = await resumeSubscription(currentUser, org.id);
    await refreshOrg();
    showNotice(result.message || "The subscription will renew automatically at the end of the paid year.", "good");
}
async function doRenew() {
    window.location.assign(await renewalUrl(currentUser, org.id));
}
async function doPortal() {
    window.location.assign(await billingPortalUrl(currentUser, org.id));
}

/* Cancel: confirm first, because it affects every member of the organisation */
function openCancelDialog() {
    const end = toDate(orgSub().periodEnd);
    const when = end ? fmtDate(end) : "the end of the paid year";
    $("cancel-text").textContent = "It will not renew, and you will not be charged again. You and every member keep access until " + when +
    ". After that, all accounts in the organisation are suspended until the subscription is renewed. You can undo this any time before " + when + ".";
    $("cancel-reason").value = "";
    $("cancel-error").textContent = "";
    $("cancel-dialog").showModal();
}
$("cancel-back").addEventListener("click", () => $("cancel-dialog").close());
$("cancel-form").addEventListener("submit", async (e) => {
    e.preventDefault(); // keep the dialog open until the server answers, so an error can be shown
    if (busy || !org) return;
    busy = true;
    const confirmBtn = $("cancel-confirm");
    confirmBtn.disabled = true;
    $("cancel-error").textContent = "";
    try {
    const result = await cancelSubscription(currentUser, org.id, $("cancel-reason").value.trim());
    $("cancel-dialog").close();
    await refreshOrg();
    showNotice(result.message || "The subscription will not renew.", "warn");
    } catch (err) {
    console.error(err);
    $("cancel-error").textContent = err.message || "Couldn't cancel the subscription. Please try again.";
    } finally {
    confirmBtn.disabled = false;
    busy = false;
    }
});

/* ----- Loading the organisation from the BioAudit server ----- */
async function refreshOrg() {
    if (!currentUser || !profile.organisationId) {
    org = null;
    orgLoadFailed = false;
    return;
    }
    try {
    org = await loadMyOrganisation(currentUser);
    orgLoadFailed = false;
    } catch (err) {
    console.error("Could not load the organisation:", err);
    orgLoadFailed = true; // keep whatever was loaded before
    }
    if (started) {
    renderProfile();
    renderPlan();
    }
}
// Once, when the page first loads: the page waits for this, so it doesn't flash the wrong plan first
function startOrganisation() {
    orgFor = profile.organisationId || null;
    return refreshOrg();
}
// On every profile update: notice an organisation joined or created while the page is open
function syncOrganisation() {
    if (!started || (profile.organisationId || null) === orgFor) return;
    orgFor = profile.organisationId || null;
    refreshOrg();
}
// Pick up a cancel or renewal made in the app when the person comes back to this tab
document.addEventListener("visibilitychange", () => {
    if (!document.hidden && started) refreshOrg();
});

/* ===== Account details (read-only) ===== */
function renderProfile() {
    const name = profile.displayName || currentUser.displayName || "";
    $("welcome").textContent = name ? "Welcome back, " + name.split(" ")[0] : "Welcome back";
    $("who").textContent = currentUser.email || "";
    $("ac-name").textContent = name || "–";
    $("ac-email").textContent = currentUser.email || profile.email || "–";
    $("ac-plan").textContent = isPending() ? "Organisation (payment pending)" : PLANS[planKey()].name;
    $("ac-since").textContent = fmtDate(toDate(profile.createdAt) || new Date(currentUser.metadata.creationTime));
    if (profile.organisationName) {
    $("ac-org-wrap").hidden = false;
    $("ac-org").textContent = profile.organisationName;
    }
    if (profile.organisationId) {
    loadOrganisationName(profile.organisationId);
    }
}
/* Reads the organisation's name from organisations/{id}, for accounts made in the app */
async function loadOrganisationName(orgId) {
    try {
    const snap = await getDoc(doc(db, "organisations", orgId));
    const name = snap.exists() ? snap.data().name : "";
    if (name) {
        $("ac-org-wrap").hidden = false;
        $("ac-org").textContent = name;
    }
    } catch (err) {
    console.error("Could not load organisation:", err);
    }
}    

/* ===== Reports ===== */
function severityChips(counts) {
    const c = counts || {};
    const parts = SEVERITIES.filter((s) => c[s] > 0)
    .map((s) => '<span class="chip"><i style="background: var(--' + s + ')"></i>' + c[s] + " " + s + "</span>");
    return parts.length ? '<div class="chips">' + parts.join("") + "</div>" : '<span class="muted">No issues found</span>';
}
function appName(s) {
    const t = s.target || {};
    return t.packageName || t.apkFileName || "Unknown app";
}
function scanType(s) {
    return s.type === "device" ? "Device test" : s.type === "apk" ? "APK scan" : cap(s.type || "Scan");
}

function renderScans() {
    const admin = isOrgAdmin();
    const list = admin ? memberScans : scans;
    const rows = $("scan-rows");
    $("th-member").hidden = !admin;
    const cols = admin ? 6 : 5;
    if (admin && memberReportsState === "loading") {
    rows.innerHTML = '<tr><td colspan="' + cols + '" class="empty">Loading your members\' reports…</td></tr>';
    } else if (admin && memberReportsState === "failed") {
    rows.innerHTML = '<tr><td colspan="' + cols + '" class="empty">Couldn\'t load your members\' reports. Refresh the page to try again.</td></tr>';
    } else if (!list.length) {
    rows.innerHTML = '<tr><td colspan="' + cols + '" class="empty">' + (admin
        ? "Your members haven't run any scans yet. Their scans will appear here once they do."
        : "No scans yet. Run your first scan in the BioAudit app and it will appear here automatically.") + "</td></tr>";
    } else {
    rows.innerHTML = list.map((s, i) =>
        "<tr data-i=\"" + i + "\">" +
        "<td>" + esc(fmtDateTime(toDate(s.createdAt))) + "</td>" +
        (admin ? "<td>" + esc(s.memberName || "–") +
            (s.memberEmail && s.memberEmail !== s.memberName ? '<div class="muted" style="font-size: 0.8rem">' + esc(s.memberEmail) + "</div>" : "") + "</td>" : "") +
        "<td>" + esc(appName(s)) + "</td>" +
        "<td>" + esc(scanType(s)) + "</td>" +
        "<td>" + severityChips(s.counts) + "</td>" +
        '<td><button class="btn btn-ghost btn-small" type="button" data-view="' + i + '">View</button></td>' +
        "</tr>"
    ).join("");
    }

    // Overview numbers
    $("ov-scans").textContent = String(scans.length);
    $("ov-scans-note").textContent = scans.length === 1 ? "1 scan in your history" : scans.length + " scans in your history";
    const latest = scans[0];
    if (latest) {
    $("ov-latest").textContent = appName(latest);
    $("ov-latest-note").textContent = fmtDateTime(toDate(latest.createdAt));
    $("ov-latest-findings").innerHTML = severityChips(latest.counts) +
        '<p style="margin-top: 14px"><button class="btn btn-ghost btn-small" type="button" id="ov-open-latest">Open this report</button></p>';
    $("ov-open-latest").addEventListener("click", () => { showTab("reports"); openScan(0); });
    } else {
    $("ov-latest").textContent = "None yet";
    $("ov-latest-note").textContent = "Run a scan in the app";
    $("ov-latest-findings").innerHTML = '<p class="muted" style="font-size: 0.9rem">Your latest scan will show here once you run one.</p>';
    }
}

$("scan-rows").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (btn) openScan(Number(btn.dataset.view));
});

function findingsHtml(findings) {
    if (!findings.length) return '<p class="muted" style="margin-top: 16px">No issues were found in this scan.</p>';
    const sorted = [...findings].sort((a, b) => SEVERITIES.indexOf((a.severity || "info").toLowerCase()) - SEVERITIES.indexOf((b.severity || "info").toLowerCase()));
    return sorted.map((f) => {
    const sev = (f.severity || "info").toLowerCase();
    return '<div class="finding">' +
        "<h3>" + '<span class="chip"><i style="background: var(--' + esc(sev) + ')"></i>' + esc(sev) + "</span>" + esc(f.title) + "</h3>" +
        (f.category ? '<p><span class="label">Category:</span> ' + esc(f.category) + (f.owasp && f.owasp.length ? " · OWASP " + esc(f.owasp.join(", ")) : "") + "</p>" : "") +
        (f.explanation ? '<p><span class="label">What it means:</span> ' + esc(f.explanation) + "</p>" : "") +
        (f.mitigation ? '<p><span class="label">How to fix it:</span> ' + esc(f.mitigation) + "</p>" : "") +
        (f.evidence ? "<pre>" + esc(f.evidence) + "</pre>" : "") +
    "</div>";
    }).join("");
}

async function openScan(i) {
    const list = isOrgAdmin() ? memberScans : scans;
    let s = list[i];
    if (!s) return;
    document.querySelectorAll("#scan-rows tr").forEach((tr) => tr.classList.toggle("selected", tr.dataset.i === String(i)));
    const box = $("scan-detail");
    box.hidden = false;
    // A member's scan arrives as a summary. Fetch the full scan, with its findings, before showing it.
    if (!s.findings) {
    box.innerHTML = '<p class="muted">Loading the report…</p>';
    box.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
        s = list[i] = { ...(await getScan(currentUser, s.id)), memberName: s.memberName, memberEmail: s.memberEmail };
    } catch (err) {
        console.error("Could not load the report:", err);
        box.innerHTML = '<p class="muted">Couldn\'t load this report. Please try again.</p>';
        return;
    }
    }
    const scope = s.scope || {};
    box.innerHTML =
    '<div class="detail-head">' +
        "<div><h2>" + esc(appName(s)) + '</h2><p class="muted" style="margin-top: 6px; font-size: 0.85rem">' + esc(scanType(s)) + " · " + esc(fmtDateTime(toDate(s.createdAt))) + (s.memberName ? " · Run by " + esc(s.memberName) : "") + "</p></div>" +
        '<button class="btn btn-small" type="button" id="print-report">Save as PDF</button>' +
    "</div>" +
    '<div class="meta">' +
        "<div><span>Findings</span>" + (s.findingCount ?? (s.findings || []).length) + "</div>" +
        "<div><span>App version</span>" + esc(scope.appVersion || "–") + "</div>" +
        "<div><span>Device</span>" + esc(scope.deviceModel || "–") + "</div>" +
        "<div><span>Android version</span>" + esc(scope.androidVersion || "–") + "</div>" +
        "<div><span>BioAudit version</span>" + esc(s.toolVersion || "–") + "</div>" +
    "</div>" +
    '<div style="margin-top: 18px">' + severityChips(s.counts) + "</div>" +
    findingsHtml(s.findings || []);
    $("print-report").addEventListener("click", () => printReport(s));
    box.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* Opens a clean, printable version of a report. Choose "Save as PDF" in the print window. */
function printReport(s) {
    const scope = s.scope || {};
    const rows = (s.findings || []).map((f) =>
    "<section><h3>[" + esc((f.severity || "info").toUpperCase()) + "] " + esc(f.title) + "</h3>" +
    (f.category ? "<p><b>Category:</b> " + esc(f.category) + (f.owasp && f.owasp.length ? " (OWASP " + esc(f.owasp.join(", ")) + ")" : "") + "</p>" : "") +
    (f.explanation ? "<p><b>What it means:</b> " + esc(f.explanation) + "</p>" : "") +
    (f.mitigation ? "<p><b>How to fix it:</b> " + esc(f.mitigation) + "</p>" : "") +
    (f.evidence ? "<pre>" + esc(f.evidence) + "</pre>" : "") + "</section>"
    ).join("") || "<p>No issues were found in this scan.</p>";
    const html =
    "<!DOCTYPE html><html><head><meta charset='utf-8'><title>BioAudit report - " + esc(appName(s)) + "</title>" +
    "<style>body{font-family:Consolas,monospace;color:#111;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.5}" +
    "h1{font-weight:500}h3{margin:28px 0 6px}section{border-top:1px solid #ccc;padding-top:6px}" +
    "pre{background:#f4f4f4;padding:10px;white-space:pre-wrap;word-break:break-word;font-size:12px}" +
    "table{border-collapse:collapse}td{padding:3px 16px 3px 0}</style></he" + "ad><bo" + "dy>" +
    "<h1>BioAudit scan report</h1>" +
    "<table>" +
        "<tr><td><b>App</b></td><td>" + esc(appName(s)) + "</td></tr>" +
        "<tr><td><b>Scan type</b></td><td>" + esc(scanType(s)) + "</td></tr>" +
        "<tr><td><b>Date</b></td><td>" + esc(fmtDateTime(toDate(s.createdAt))) + "</td></tr>" +
        "<tr><td><b>App version</b></td><td>" + esc(scope.appVersion || "-") + "</td></tr>" +
        "<tr><td><b>Device</b></td><td>" + esc(scope.deviceModel || "-") + "</td></tr>" +
        "<tr><td><b>Findings</b></td><td>" + SEVERITIES.map((k) => (s.counts && s.counts[k] ? s.counts[k] : 0) + " " + k).join(", ") + "</td></tr>" +
    "</table>" + rows + "</bo" + "dy></ht" + "ml>"; // split so dev servers don't inject code here
    const w = window.open("", "_blank");
    if (!w) { alert("Allow pop-ups for this site to save the report."); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    // Print from here rather than from inside the new page, so this file never
    // contains a closing script tag inside the script (that breaks the whole page)
    w.focus();
    setTimeout(() => w.print(), 300);
}

/* Admins: the scans of every member, with their names. The server records each of these reads. */
async function loadMemberReports() {
    if (!isOrgAdmin() || memberReportsState === "loading") return;
    memberReportsState = "loading";
    renderScans();
    try {
    const members = await listMembers(currentUser, org.id);
    const lists = await Promise.all(members.filter((m) => m.id !== currentUser.uid).map(async (m) => {
        const name = m.displayName || m.email || "Member";
        try {
        const found = await listMemberScans(currentUser, org.id, m.id);
        return found.map((s) => ({ ...s, memberName: name, memberEmail: m.email || "" }));
        } catch (err) {
        console.error("Could not load the scans of one member:", err);
        return [];
        }
    }));
    memberScans = lists.flat().sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
    memberReportsState = "done";
    } catch (err) {
    console.error("Could not load the members' reports:", err);
    memberReportsState = "failed";
    }
    renderScans();
}

async function loadScans() {
    try {
    // Filtering by userId is what the database rules allow; sorting happens here
    const snap = await getDocs(query(collection(db, "scans"), where("userId", "==", currentUser.uid), limit(100)));
    scans = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    scans.sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
    } catch (err) {
    console.error("Could not load scans:", err);
    scans = [];
    }
    renderScans();
}

$("copy-email").addEventListener("click", async () => {
    try {
    await navigator.clipboard.writeText("fyp26s314@gmail.com");
    $("copy-email").textContent = "Copied!";
    } catch {
    $("copy-email").textContent = "Copy failed – select the address instead";
    }
    setTimeout(() => { $("copy-email").textContent = "Copy email address"; }, 2000);
});

/* ===== Sign out ===== */
$("signout-btn").addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
});

/* ===== Message after returning from Stripe ===== */
const checkoutResult = new URLSearchParams(location.search).get("checkout");
function showCheckoutNotice() {
    const box = $("notice");
    if (checkoutResult === "success") {
    box.hidden = false;
    box.className = "banner " + (planKey() === "organisation" ? "good" : "warn");
    $("notice-text").textContent = planKey() === "organisation"
        ? "Payment received. Your Organisation plan is active. Sign in to the BioAudit app again to use it there."
        : "Payment received. Activating your Organisation plan… this usually takes a few seconds.";
    } else if (checkoutResult === "cancelled") {
    box.hidden = false;
    box.className = "banner warn";
    $("notice-text").textContent = "Checkout was cancelled, so nothing was charged. You can try again any time.";
    }
}

/* ===== Start ===== */
let started = false;
onAuthStateChanged(auth, (user) => {
    if (!user) {
    window.location.href = "login.html";
    return;
    }
    currentUser = user;

    // Live: the page updates by itself when the plan changes (e.g. after payment)
    onSnapshot(doc(db, "users", user.uid), async (snap) => {
    profile = snap.exists() ? snap.data() : {};
    renderProfile();
    renderPlan();
    showCheckoutNotice();
    syncOrganisation();

    if (!started) {
        started = true;
        const orgReady = startOrganisation();
        await loadScans();
        await orgReady;
        $("loading").hidden = true;
        $("app").hidden = false;
        const start = location.hash.replace("#", "");
        showTab(tabs.includes(start) ? start : "overview");
    }
    }, (err) => {
    console.error("Could not load profile:", err);
    });
});