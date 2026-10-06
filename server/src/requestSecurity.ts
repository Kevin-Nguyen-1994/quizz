import net from 'node:net';
import type { NextFunction, Request, Response } from 'express';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1']);

function normalizeIp(value: string | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim();
  if (!candidate || candidate.includes(',')) return null;
  const unmapped = candidate.startsWith('::ffff:') ? candidate.slice(7) : candidate;
  return net.isIP(unmapped) ? unmapped : null;
}

/**
 * Cloudflared reaches this server through localhost. Only in that trusted case
 * do we use Cloudflare's single-value client IP header. Direct LAN clients
 * cannot change their identity by supplying forwarding headers themselves.
 */
export function getClientIp(req: Request): string {
  const remoteIp = normalizeIp(req.socket.remoteAddress) ?? 'unknown';
  if (!LOOPBACK_ADDRESSES.has(remoteIp)) return remoteIp;
  return normalizeIp(req.get('CF-Connecting-IP')) ?? remoteIp;
}

export function maskIp(ip: string): string {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  if (net.isIPv6(ip)) return `${ip.split(':').slice(0, 4).join(':')}::`;
  return 'unknown';
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
}

interface FailureWindow {
  failures: number;
  startedAt: number;
  logged: boolean;
}

export interface LoginRateLimitStatus {
  blocked: boolean;
  remaining: number;
  retryAfterSeconds: number;
  shouldLog: boolean;
}

export class LoginFailureLimiter {
  private readonly windows = new Map<string, FailureWindow>();

  constructor(
    readonly limit = 10,
    readonly windowMs = 10 * 60 * 1000,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 10_000,
  ) {}

  private activeWindow(identity: string): FailureWindow | null {
    const entry = this.windows.get(identity);
    if (!entry) return null;
    if (this.now() - entry.startedAt >= this.windowMs) {
      this.windows.delete(identity);
      return null;
    }
    return entry;
  }

  status(identity: string): LoginRateLimitStatus {
    const entry = this.activeWindow(identity);
    const failures = entry?.failures ?? 0;
    const blocked = failures >= this.limit;
    const elapsed = entry ? this.now() - entry.startedAt : 0;
    return {
      blocked,
      remaining: Math.max(0, this.limit - failures),
      retryAfterSeconds: blocked ? Math.max(1, Math.ceil((this.windowMs - elapsed) / 1000)) : 0,
      shouldLog: blocked && !entry?.logged,
    };
  }

  recordFailure(identity: string): LoginRateLimitStatus {
    let entry = this.activeWindow(identity);
    if (!entry) {
      if (this.windows.size >= this.maxEntries) {
        const oldest = this.windows.keys().next().value as string | undefined;
        if (oldest) this.windows.delete(oldest);
      }
      entry = { failures: 0, startedAt: this.now(), logged: false };
      this.windows.set(identity, entry);
    }
    entry.failures += 1;
    return this.status(identity);
  }

  markLogged(identity: string): void {
    const entry = this.activeWindow(identity);
    if (entry) entry.logged = true;
  }

  clear(identity: string): void {
    this.windows.delete(identity);
  }
}
