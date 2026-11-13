/*
 * Shared helper for calling the BioAudit backend. The address is set in js/api-config.js.
 * Passes a signed in Firebase user as the last argument to send their ID token.
 */

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(method, path, body, user) {
  const base = ((window.bioauditApi && window.bioauditApi.base) || "").trim().replace(/\/+$/, "");
  if (!base) throw new ApiError("The BioAudit server address isn't set up. Please contact the team.");

  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (user) headers.Authorization = "Bearer " + (await user.getIdToken());

  let response;
  try {
    response = await fetch(base + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    console.error("BioAudit server unreachable:", err);
    throw new ApiError("Couldn't reach the BioAudit server. Please try again shortly.");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const e = data.error || {};
    const details = (e.details || []).map((d) => d.field + ": " + d.message).join(". ");
    const message = [e.message, details].filter(Boolean).join(" ");
    throw new ApiError(message || "Something went wrong. Please try again.", response.status);
  }
  return data;
}
