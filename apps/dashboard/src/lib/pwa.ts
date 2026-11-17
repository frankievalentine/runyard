/**
 * Registers the service worker (public/sw.js) that keeps the dashboard's shell for the installed
 * app. Browsers allow it only over HTTPS or on localhost, which is also where Runyard can be
 * installed; on a plain http:// address this does nothing. Development builds skip it so Vite's
 * modules are never cached.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !window.isSecureContext || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Non-essential: the dashboard works the same without it.
    });
  });
}
