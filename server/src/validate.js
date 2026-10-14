// Input validation for the configurable Ever Jobs API connection.
// Only scheme + host + port are ever accepted; paths, credentials,
// query strings and anything else are rejected.

const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * Validate a protocol/host/port triple.
 * @returns {{ ok: true, settings: {protocol:string, host:string, port:number} } | { ok: false, error: string }}
 */
export function validateApiTarget(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Malformed request body.' };
  }
  const protocol = String(input.protocol ?? '').toLowerCase();
  if (protocol !== 'http' && protocol !== 'https') {
    return { ok: false, error: 'Protocol must be http or https.' };
  }

  let host = String(input.host ?? '').trim().toLowerCase();
  // Strip accidental brackets around IPv6 literals.
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host) return { ok: false, error: 'API server is required.' };
  if (
    host.includes('/') ||
    host.includes('?') ||
    host.includes('#') ||
    host.includes('@') ||
    host.includes(':') // no embedded ports / userinfo; IPv6 colons are validated below
  ) {
    // Colons are only legitimate for bare IPv6 literals, checked next.
    const bareIpv6 = /^[0-9a-f:]+$/.test(host) && host.includes(':');
    if (!bareIpv6) {
      return { ok: false, error: 'API server must be a bare hostname or IP address (no URL path, port or credentials).' };
    }
  }
  const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) && host.split('.').every((p) => Number(p) <= 255);
  const isIpv6 = host.includes(':') && isIPv6ish(host);
  if (!isIpv4 && !isIpv6 && !HOSTNAME_RE.test(host)) {
    return { ok: false, error: 'Invalid hostname or IP address.' };
  }

  // Reject anything that is not a plain integer (Number(true) === 1 would
  // otherwise coerce booleans/strings into a "valid" port).
  const rawPort = typeof input.port === 'string' ? input.port.trim() : input.port;
  if (typeof rawPort !== 'number' && !/^\d{1,5}$/.test(String(rawPort ?? ''))) {
    return { ok: false, error: 'Port must be an integer between 1 and 65535.' };
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: 'Port must be an integer between 1 and 65535.' };
  }

  return { ok: true, settings: { protocol, host, port } };
}

// Parse an EVER_JOBS_API_URL style environment value into a target triple.
export function parseApiUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.pathname !== '/' && u.pathname !== '') return null;
    if (u.username || u.password || u.search) return null;
    const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
    const res = validateApiTarget({ protocol: u.protocol.slice(0, -1), host: u.hostname, port });
    return res.ok ? res.settings : null;
  } catch {
    return null;
  }
}

// Minimal IPv6 syntax check (enough to stop obvious garbage; the real
// protection is that we only ever connect after DNS revalidation).
function isIPv6ish(s) {
  if (!/^[0-9a-f:.]+$/.test(s)) return false;
  const groups = s.split(':');
  if (groups.length < 3 || groups.length > 8) return false;
  const emptyIdx = groups.filter((g) => g === '');
  if (emptyIdx.length > 0 && !s.includes('::')) return false;
  return groups.every((g) => g === '' || /^[0-9a-f]{1,4}$/.test(g) || /^(\d{1,3}\.){3}\d{1,3}$/.test(g));
}

// ---- SSRF / trust policy -------------------------------------------------

// Default trust policy for a trusted-LAN, single-user deployment:
// loopback + RFC1918 + IPv6 ULA only. Public addresses require an explicit
// ALLOWED_API_HOSTS entry.
export function isTrustedAddress(ip) {
  if (isIpv4Address(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0 && b === 0) return false;
    return false; // everything else (incl. 169.254.x link-local/metadata, public)
  }
  if (isIpv6Address(ip)) {
    const v = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (v === '::1') return true;
    if (v === '::') return false;
    if (/^f[cd][0-9a-f]{2}:/.test(v)) return true; // ULA fc00::/7
    if (/^::ffff:/.test(v)) {
      const mapped = v.slice(7);
      return isIpv4Address(mapped) ? isTrustedAddress(mapped) : false;
    }
    return false;
  }
  return false;
}

function isIpv4Address(ip) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every((p) => Number(p) <= 255);
}

function isIpv6Address(ip) {
  return ip.includes(':');
}

// Explicit allowlist (comma-separated exact hostnames/IPs, case-insensitive).
export function parseAllowedHosts(envValue) {
  if (!envValue) return null;
  const list = envValue
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? new Set(list) : null;
}
