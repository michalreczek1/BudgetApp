const CACHE_NAME = "budget-app-static-v21";
const STATIC_ASSETS = [
  "/",
  "/budget-app.html",
  "/style.css",
  "/date-utils.js",
  "/app.js",
  "/js/formatters.js",
  "/js/toast.js",
  "/js/pwa.js",
  "/js/api.js",
  "/js/admin.js",
  "/js/render.js",
  "/js/analysis.js",
  "/js/ui-modals.js",
  "/js/scheduling.js",
  "/js/actions.js",
  "/js/state.js",
  "/manifest.webmanifest",
  "/newicon.jpg",
  "/icon-192.png",
  "/icon-512.png",
];

const STATIC_ASSET_PATHS = new Set(STATIC_ASSETS);

function shouldUseNetworkFirst(requestUrl, request) {
  if (request.mode === "navigate") {
    return true;
  }

  if (STATIC_ASSET_PATHS.has(requestUrl.pathname)) {
    return true;
  }

  return ["script", "style", "document"].includes(request.destination);
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    if (request.mode === "navigate") {
      return caches.match("/budget-app.html");
    }

    throw error;
  }
}

async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await fetch(request);
  if (!networkResponse || networkResponse.status !== 200) {
    return networkResponse;
  }

  const cache = await caches.open(CACHE_NAME);
  cache.put(request, networkResponse.clone());
  return networkResponse;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (requestUrl.pathname.startsWith("/api/")) {
    return;
  }

  event.respondWith(
    shouldUseNetworkFirst(requestUrl, event.request)
      ? networkFirst(event.request)
      : cacheFirst(event.request)
  );
});
