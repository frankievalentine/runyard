import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { TailnetState } from "./setup/checks.ts";
import type { TailscaleCli } from "./tailscale.ts";

type Fetch = (req: Request, server: Bun.Server<undefined>) => Response | Promise<Response>;

const CHECK_MS = 5 * 60 * 1000;
// Until it serves: Tailscale may still be logging in, such as when both start at boot or
// together in Docker.
const WAITING_MS = 15 * 1000;

/**
 * Serves HTTPS on this machine's tailnet addresses with its `*.ts.net`
 * certificate. It re-reads Tailscale every few seconds until it serves, then
 * every few minutes: it starts once Tailscale is up, restarts when the address, name or certificate changes
 * (`tailscale cert` renews near expiry), and stops if Tailscale goes away.
 */
export class TailnetListener {
  private servers: Bun.Server<undefined>[] = [];
  private current = "";
  private lastProblem = "";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private readonly options: {
      tailscale: TailscaleCli;
      dataDir: string;
      port: number;
      fetch: Fetch;
      log?: (message: string) => void;
    },
  ) {}

  async start() {
    await this.check();
    this.schedule();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.close();
  }

  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(
      () => void this.check().then(() => this.schedule()),
      this.servers.length > 0 ? CHECK_MS : WAITING_MS,
    );
    this.timer.unref();
  }

  /** The URL the dashboard is reachable at, once serving. */
  get url(): string | undefined {
    return this.current
      ? `https://${this.current.split("\n")[0]}:${this.options.port}/`
      : undefined;
  }

  /** For the setup checks: serving, a problem, or not read yet. */
  get state(): TailnetState {
    if (this.url) return { kind: "serving", url: this.url };
    return this.lastProblem ? { kind: "problem", message: this.lastProblem } : { kind: "starting" };
  }

  /** Never throws: any failure is logged and leaves loopback serving. */
  async check() {
    try {
      await this.refresh();
    } catch (error) {
      this.problem(
        `Tailnet listener: ${error instanceof Error ? error.message : String(error)}`,
        false,
      );
    }
  }

  private async refresh() {
    const { tailscale, dataDir, port, fetch } = this.options;
    const self = await tailscale.self();
    if (self instanceof Error)
      return this.problem(`${sentence(self.message)} Serving on loopback only.`, true);
    if (!self.canCert) {
      return this.problem(
        "This tailnet can't issue HTTPS certificates. Turn on HTTPS Certificates in the Tailscale admin console (DNS page).",
        true,
      );
    }
    const dir = join(dataDir, "tls");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const certFile = join(dir, "cert.pem");
    const keyFile = join(dir, "key.pem");
    const failed = await tailscale.cert(self.dnsName, certFile, keyFile);
    // A failed renewal keeps serving the certificate already loaded.
    if (failed) return this.problem(failed.message, this.servers.length === 0);
    const [cert, key] = await Promise.all([Bun.file(certFile).text(), Bun.file(keyFile).text()]);
    const identity = [self.dnsName, ...self.ips, cert].join("\n");
    if (identity === this.current && this.servers.length > 0) return;

    this.close();
    try {
      this.servers = self.ips.map((hostname) =>
        Bun.serve({ hostname, port, tls: { cert, key }, fetch }),
      );
    } catch (error) {
      this.close();
      return this.problem(
        `Couldn't listen on the tailnet: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
    this.current = identity;
    this.lastProblem = "";
    this.options.log?.(`runyard listening on ${this.url} (tailnet)`);
  }

  private close() {
    for (const server of this.servers) void server.stop();
    this.servers = [];
    this.current = "";
  }

  /** Logs a problem once until it changes; `stop` also takes the tailnet listener down. */
  private problem(message: string, stop: boolean) {
    if (stop) this.close();
    if (message !== this.lastProblem) this.options.log?.(message);
    this.lastProblem = message;
  }
}

/** Ends a CLI message with a period, so another sentence can follow it. */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
