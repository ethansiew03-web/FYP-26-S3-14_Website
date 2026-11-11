/*
 * Where the BioAudit backend API lives, the same server the desktop app talks to.
 * The subscription buttons on the dashboard (cancel, keep, renew, manage billing)
 * call it, so cancelling on the website and in the app behave identically.
 *
 * Set `base` to the deployed API address, including the /api part, for example
 *   "https://your-backend.example.com/api"
 * For local testing it is the same address the app uses: "http://127.0.0.1:4000/api".
 *
 * https://bioaudit.me was also to the backend's CORS_ORIGINS setting.
 */
window.bioauditApi = {
  base: "https://bioaudit-api-391854054876.us-central1.run.app/api"
};