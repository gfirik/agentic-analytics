// Address blocking for the fetcher (security spec §4): private, loopback, link-local, multicast, reserved and
// documentation ranges, for IPv4 and IPv6 (including IPv4-mapped and NAT64 forms that embed an IPv4 address).
// Pure functions over address strings; the fetcher applies them to every address DNS returns, at connect time.

/** IPv4 dotted quad → 32-bit unsigned number, or undefined. */
export function parseIPv4(ip: string): number | undefined {
  const parts = ip.split(".");
  if (parts.length !== 4) return undefined;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return undefined;
    const v = Number(p);
    if (v > 255) return undefined;
    n = n * 256 + v;
  }
  return n;
}

/** IPv6 text → 16 bytes, or undefined. Handles "::" compression and a trailing dotted IPv4. */
export function parseIPv6(ip: string): number[] | undefined {
  let s = ip.toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(":")) return undefined;
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(":");
  const last = s.slice(lastColon + 1);
  if (last.includes(".")) {
    const v4 = parseIPv4(last);
    if (v4 === undefined) return undefined;
    tail = [(v4 >>> 24) & 255, (v4 >>> 16) & 255, (v4 >>> 8) & 255, v4 & 255];
    s = `${s.slice(0, lastColon + 1)}0:0`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return undefined;
  const group = (h: string) => (h === "" ? [] : h.split(":"));
  const head = group(halves[0] ?? "");
  const rest = halves.length === 2 ? group(halves[1] ?? "") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return undefined;
  const words = [...head, ...new Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  const bytes: number[] = [];
  for (const w of words) {
    if (!/^[0-9a-f]{1,4}$/.test(w)) return undefined;
    const v = Number.parseInt(w, 16);
    bytes.push(v >> 8, v & 255);
  }
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes.length === 16 ? bytes : undefined;
}

const V4_BLOCKED: readonly [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata lives here)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function v4Blocked(n: number): boolean {
  return V4_BLOCKED.some(([base, bits]) => {
    const b = parseIPv4(base) as number;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (b & mask) >>> 0;
  });
}

const startsWith = (bytes: readonly number[], prefix: readonly number[], bits: number): boolean => {
  for (let i = 0; i < bits; i++) {
    const byte = Math.floor(i / 8);
    const bit = 7 - (i % 8);
    if ((((bytes[byte] ?? 0) >> bit) & 1) !== (((prefix[byte] ?? 0) >> bit) & 1)) return false;
  }
  return true;
};

function v6Blocked(b: readonly number[]): boolean {
  const embedded = (from: number) =>
    ((b[from] ?? 0) * 2 ** 24 + (b[from + 1] ?? 0) * 2 ** 16 + (b[from + 2] ?? 0) * 256 + (b[from + 3] ?? 0)) >>> 0;
  if (b.every((x) => x === 0)) return true; // ::
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return true; // ::1
  if (startsWith(b, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff], 96)) return v4Blocked(embedded(12)); // ::ffff:a.b.c.d
  if (startsWith(b, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 96)) return v4Blocked(embedded(12)); // ::a.b.c.d (deprecated)
  if (startsWith(b, [0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0, 0], 96)) return v4Blocked(embedded(12)); // ::ffff:0:a.b.c.d (SIIT)
  if (startsWith(b, [0x00, 0x64, 0xff, 0x9b, 0x00, 0x01], 48)) return true; // 64:ff9b:1::/48 local-use NAT64
  if (startsWith(b, [0x00, 0x64, 0xff, 0x9b], 96)) return v4Blocked(embedded(12)); // 64:ff9b::/96 NAT64
  if (startsWith(b, [0x20, 0x01, 0x00, 0x00], 32)) return true; // Teredo 2001::/32 tunnels to arbitrary IPv4
  if (startsWith(b, [0x20, 0x02], 16)) return v4Blocked(embedded(2)); // 2002::/16 6to4 embeds an IPv4
  if (startsWith(b, [0xfc], 7)) return true; // unique local fc00::/7
  if (startsWith(b, [0xfe, 0x80], 10)) return true; // link-local fe80::/10
  if (startsWith(b, [0xfe, 0xc0], 10)) return true; // site-local (deprecated)
  if (startsWith(b, [0xff], 8)) return true; // multicast
  if (startsWith(b, [0x20, 0x01, 0x0d, 0xb8], 32)) return true; // documentation
  if (startsWith(b, [0x01, 0, 0, 0, 0, 0, 0, 0], 64)) return true; // discard-only 100::/64
  return false;
}

/** True when the fetcher must not connect to this address (or it isn't a valid IP address at all). */
export function isBlockedAddress(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4 !== undefined) return v4Blocked(v4);
  const v6 = parseIPv6(ip);
  if (v6) return v6Blocked(v6);
  return true; // not an IP literal: never connect to something we can't classify
}
