import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { SUPPORTED_CRAWL_PROTOCOLS, type ResolvedAddress } from './crawl.types.js';

function ipv4ToNumber(address: string): number {
  return address.split('.').reduce((value, part) => (value << 8) + Number(part), 0) >>> 0;
}

function ipv4InCidr(address: string, base: string, prefixLength: number): boolean {
  const value = ipv4ToNumber(address);
  const baseValue = ipv4ToNumber(base);
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

const BLOCKED_IPV4_CIDRS: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
];

function expandIpv6(address: string): bigint {
  let source = address.toLowerCase().split('%')[0];

  if (source.includes('.')) {
    const lastColon = source.lastIndexOf(':');
    const ipv4 = source.slice(lastColon + 1);
    const value = ipv4ToNumber(ipv4);
    source = `${source.slice(0, lastColon)}:${((value >>> 16) & 0xffff).toString(16)}:${(value & 0xffff).toString(16)}`;
  }

  const halves = source.split('::');
  if (halves.length > 2) throw new Error('Invalid IPv6 address');

  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) throw new Error('Invalid IPv6 address');

  const parts = halves.length === 2 ? [...left, ...Array(missing).fill('0'), ...right] : left;
  if (parts.length !== 8) throw new Error('Invalid IPv6 address');

  return parts.reduce((value, part) => (value << 16n) | BigInt(`0x${part || '0'}`), 0n);
}

function ipv6InCidr(address: string, base: string, prefixLength: number): boolean {
  const shift = BigInt(128 - prefixLength);
  return (expandIpv6(address) >> shift) === (expandIpv6(base) >> shift);
}

const BLOCKED_IPV6_CIDRS: ReadonlyArray<readonly [string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8]
];

function isPublicAddress(address: string): boolean {
  const family = isIP(address);

  if (family === 4) {
    return !BLOCKED_IPV4_CIDRS.some(([base, prefixLength]) => ipv4InCidr(address, base, prefixLength));
  }

  if (family === 6) {
    const mappedPrefix = '::ffff:';
    if (address.toLowerCase().startsWith(mappedPrefix) && address.slice(mappedPrefix.length).includes('.')) {
      return isPublicAddress(address.slice(mappedPrefix.length));
    }
    return !BLOCKED_IPV6_CIDRS.some(([base, prefixLength]) => ipv6InCidr(address, base, prefixLength));
  }

  return false;
}

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
}

export async function assertPublicHttpTarget(url: URL): Promise<void> {
  if (!SUPPORTED_CRAWL_PROTOCOLS.includes(url.protocol as (typeof SUPPORTED_CRAWL_PROTOCOLS)[number])) {
    throw new Error('Crawler target must use HTTP or HTTPS');
  }

  if (url.username || url.password) {
    throw new Error('Crawler target credentials are blocked');
  }

  const hostname = normalizedHostname(url);
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Crawler target is not public');
  }

  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error('Crawler target address is blocked because it is not public');
    return;
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = (await lookup(hostname, { all: true, verbatim: true })) as ResolvedAddress[];
  } catch {
    throw new Error('Crawler target could not be resolved to a public address');
  }

  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('Crawler target resolved to a blocked or non-public address');
  }
}
