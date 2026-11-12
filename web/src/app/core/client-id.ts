/**
 * Identifies this browser tab. Sent with every write (header `X-Client-Id`) so the tab can
 * skip the live-update echo of its own changes. Not `crypto.randomUUID()`: that only exists
 * on HTTPS or localhost, and the app is often opened by IP on the office network.
 */
export const CLIENT_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
