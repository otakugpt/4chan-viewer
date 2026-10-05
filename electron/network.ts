import https from "node:https";
import dns from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [ip, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["192.88.99.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as [string, number][]) blocked.addSubnet(ip, prefix);
export const isPublicIPv4 = (ip: string) => isIP(ip) === 4 && !blocked.check(ip);
export interface ByteResponse { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }

// Resolve once, reject private networks, then pin the socket to the checked address.
export async function getBytes(raw: string, limit: number, headers: Record<string, string> = {}): Promise<ByteResponse> {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Invalid destination");
  const signal = AbortSignal.timeout(20_000);
  const addresses = await new Promise<Awaited<ReturnType<typeof dns.lookup>>[]>((resolve, reject) => {
    const abort = () => reject(new Error("DNS timeout"));
    signal.addEventListener("abort", abort, { once: true });
    dns.lookup(url.hostname, { family: 4, all: true }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
  if (!addresses.length || addresses.some(a => !isPublicIPv4(a.address))) throw new Error("Private destination rejected");
  const address = addresses[0].address;
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      signal, family: 4, agent: false,
      lookup: (_host, options, callback) => {
        if (options.all) callback(null, [{ address, family: 4 }]);
        else callback(null, address, 4);
      },
      headers: { "User-Agent": "RIFT/1.0 (read-only BBS viewer)", "Accept-Encoding": "identity", ...headers },
    }, response => {
      if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400 && response.statusCode !== 304) {
        response.destroy(); reject(Object.assign(new Error("Redirect rejected"), { code: "REDIRECT" })); return;
      }
      if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
        response.destroy(); reject(new Error("Unexpected encoding")); return;
      }
      const length = Number(response.headers["content-length"] ?? 0);
      if (length > limit) { response.destroy(); reject(new Error("Response too large")); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) { response.destroy(new Error("Response too large")); return; }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
  });
}

export function serialQueue(spacing: number, maximum = 24) {
  let tail = Promise.resolve();
  let pending = 0, started = 0;
  return <T>(work: () => Promise<T>): Promise<T> => {
    if (pending >= maximum) return Promise.reject(new Error("Busy; retry later"));
    pending++;
    const task = tail.then(async () => {
      const delay = spacing - (Date.now() - started);
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      started = Date.now();
      return work();
    });
    tail = task.then(() => {}, () => {}).finally(() => { pending--; });
    return task;
  };
}
