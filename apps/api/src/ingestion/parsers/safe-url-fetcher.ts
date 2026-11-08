import { lookup, LookupAddress } from 'node:dns';
import ipaddr from 'ipaddr.js';
import { Agent, request } from 'undici';
import { publicHttpUrlSchema } from '../../study-materials/study-materials.schemas';

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain'];

export class UnsafeUrlError extends Error {}

/** Only globally routable unicast addresses are allowed (blocks RFC1918, loopback,
 *  link-local/cloud metadata 169.254.169.254, CGNAT, ULA, 6to4/Teredo tunnels, …). */
export function isPublicIpAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  }
  return parsed.range() === 'unicast';
}

/**
 * DNS lookup hook used for the actual socket connection. Validating here (not
 * just before the request) closes the DNS-rebinding TOCTOU window.
 */
function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: (...args: unknown[]) => void,
): void {
  lookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some((a) => !isPublicIpAddress(a.address))) {
      return callback(new UnsafeUrlError(`Host ${hostname} resolves to a non-public address`));
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

const ssrfSafeAgent = new Agent({
  connect: { lookup: guardedLookup as never, timeout: 10_000 },
  headersTimeout: 10_000,
  bodyTimeout: 15_000,
});

function assertUrlIsAllowed(rawUrl: string): URL {
  const parsed = publicHttpUrlSchema.safeParse(rawUrl);
  if (!parsed.success) throw new UnsafeUrlError('URL is not allowed');
  const url = new URL(parsed.data);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  // IP literals bypass DNS lookup, so check them directly.
  if (ipaddr.isValid(host) && !isPublicIpAddress(host)) {
    throw new UnsafeUrlError('URL points to a non-public address');
  }
  return url;
}

export async function fetchPublicWebPage(rawUrl: string): Promise<{ html: string; finalUrl: string }> {
  let url = assertUrlIsAllowed(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await request(url, {
      method: 'GET',
      dispatcher: ssrfSafeAgent,
      headers: { 'user-agent': 'EduPlatformBot/1.0 (+content-ingestion)', accept: 'text/html' },
    });

    if (response.statusCode >= 300 && response.statusCode < 400) {
      const location = response.headers.location;
      await response.body.dump();
      if (typeof location !== 'string') throw new UnsafeUrlError('Redirect without location');
      url = assertUrlIsAllowed(new URL(location, url).toString()); // re-validate every hop
      continue;
    }
    if (response.statusCode !== 200) {
      await response.body.dump();
      throw new Error(`Source returned HTTP ${response.statusCode}`);
    }

    const contentType = String(response.headers['content-type'] ?? '').split(';')[0].trim();
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      await response.body.dump();
      throw new UnsafeUrlError(`Unsupported content type: ${contentType || 'unknown'}`);
    }

    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > MAX_RESPONSE_BYTES) {
        response.body.destroy();
        throw new UnsafeUrlError('Page exceeds maximum size');
      }
      chunks.push(chunk as Buffer);
    }
    return { html: Buffer.concat(chunks).toString('utf8'), finalUrl: url.toString() };
  }
  throw new UnsafeUrlError('Too many redirects');
}
