/**
 * An HTTPS front door for the screenshot demo, so the dashboard runs at a tailnet-style address as
 * it does for a reader with Tailscale: the setup command is offered over HTTPS only. Forwards every
 * request, the Host header included, to the demo's plain-HTTP port. Used by capture.sh:
 * `bun https-proxy.ts <listen port> <demo port> <cert.pem> <key.pem>`.
 */
const [listen, target, cert, key] = process.argv.slice(2);
if (!listen || !target || !cert || !key) {
  console.error("Usage: bun https-proxy.ts <listen port> <demo port> <cert.pem> <key.pem>");
  process.exit(1);
}

Bun.serve({
  port: Number(listen),
  hostname: "127.0.0.1",
  tls: { cert: Bun.file(cert), key: Bun.file(key) },
  // The dashboard's event stream stays open; don't cut it off.
  idleTimeout: 0,
  fetch(request) {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.set("host", request.headers.get("host") ?? url.host);
    return fetch(`http://127.0.0.1:${target}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    });
  },
});
console.log(`HTTPS proxy on 127.0.0.1:${listen} for the demo on ${target}`);
