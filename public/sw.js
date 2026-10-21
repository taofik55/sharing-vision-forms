/*
 * Offline support for interviews (CAPI).
 * - Interview pages (/<locale>/interviews/...): network first, cached copy
 *   when offline, so a surveyor can open the form without a connection.
 * - Build assets (/_next/static/...): cache first (immutable file names).
 * Answers are not handled here: finished interviews wait in the app's
 * IndexedDB outbox and are sent when the connection is back.
 */
const VERSION = "sv-capi-v1";
const PAGES = `${VERSION}-pages`;
const STATIC = `${VERSION}-static`;
const INTERVIEW_PAGE = /^\/(id|en)\/interviews(\/|$)/;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(PAGES);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (INTERVIEW_PAGE.test(url.pathname)) {
    event.respondWith(networkFirst(request));
  }
});
