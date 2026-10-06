import assert from 'node:assert/strict';
import type { Request } from 'express';
import { describe, it } from 'node:test';
import { getClientIp, LoginFailureLimiter, maskIp } from './requestSecurity';

function request(remoteAddress: string, cloudflareIp?: string): Request {
  return {
    socket: { remoteAddress },
    get(name: string) {
      return name.toLowerCase() === 'cf-connecting-ip' ? cloudflareIp : undefined;
    },
  } as unknown as Request;
}

describe('request security', () => {
  it('trusts CF-Connecting-IP only from the local cloudflared hop', () => {
    assert.equal(getClientIp(request('::1', '203.0.113.24')), '203.0.113.24');
    assert.equal(getClientIp(request('::ffff:127.0.0.1', '2001:db8::12')), '2001:db8::12');
    assert.equal(getClientIp(request('192.168.2.44', '203.0.113.99')), '192.168.2.44');
    assert.equal(getClientIp(request('::1', '203.0.113.24, 198.51.100.2')), '::1');
  });

  it('blocks after ten failures, clears on success, and resets after ten minutes', () => {
    let now = 1_000;
    const limiter = new LoginFailureLimiter(10, 600_000, () => now);
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const status = limiter.recordFailure('203.0.113.24');
      assert.equal(status.remaining, 10 - attempt);
    }
    assert.equal(limiter.status('203.0.113.24').blocked, true);
    assert.equal(limiter.status('203.0.113.24').retryAfterSeconds, 600);

    limiter.clear('203.0.113.24');
    assert.equal(limiter.status('203.0.113.24').blocked, false);

    limiter.recordFailure('203.0.113.24');
    now += 600_000;
    assert.equal(limiter.status('203.0.113.24').remaining, 10);
  });

  it('masks security-log addresses', () => {
    assert.equal(maskIp('203.0.113.24'), '203.0.113.0');
    assert.equal(maskIp('2001:db8:abcd:12::5'), '2001:db8:abcd:12::');
  });
});
