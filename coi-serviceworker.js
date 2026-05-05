/*! coi-serviceworker v0.1.7 - Guido Zuidhof, licensed under MIT */
/* https://github.com/gzuidhof/coi-serviceworker */
if (typeof window === 'undefined') {
  // Service Worker context
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

  async function handleFetch(request) {
    if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
      return;
    }
    const r = await fetch(request);
    if (r.status === 0) return r;
    const headers = new Headers(r.headers);
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers });
  }

  self.addEventListener("fetch", (event) => {
    event.respondWith(handleFetch(event.request));
  });
} else {
  // Window context - register the service worker
  (async () => {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.register(
        window.document.currentScript.src
      ).catch(err => console.warn("COI SW registration failed:", err));

      if (registration && !crossOriginIsolated) {
        // Reload once to pick up the new headers
        const searchParams = new URLSearchParams(location.search);
        if (!searchParams.has("coi-sw-reload")) {
          searchParams.set("coi-sw-reload", "1");
          location.search = searchParams;
        }
      }
    }
  })();
}
