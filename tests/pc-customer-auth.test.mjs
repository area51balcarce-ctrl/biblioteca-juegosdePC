// Execute with: node --test tests/pc-customer-auth.test.mjs
// No network calls, emails or database writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createToken, tokenDigest, getCookieToken, makeCookie, clearCookie, isValidSession } from '../lib/pc/a51-customer-session.js';
import { normalizeCustomerEmail, generateLoginCode, hashLoginCode, verifyLoginCodeHash, isLoginCodeUsable } from '../lib/pc/a51-customer-otp.js';

test('session tokens are random and stored only as hashes', () => {
  const a=createToken(), b=createToken();
  assert.notEqual(a,b);
  assert.match(a,/^[A-Za-z0-9_-]{43}$/);
  assert.match(tokenDigest(a),/^[a-f0-9]{64}$/);
  assert.notEqual(tokenDigest(a),tokenDigest(b));
  assert.equal(tokenDigest('invalid'),null);
});
test('session cookie is persistent, httpOnly, secure and parsed strictly', () => {
  const token=createToken(), cookie=makeCookie(token);
  assert.match(cookie,/Max-Age=2592000/);
  assert.match(cookie,/HttpOnly; Secure; SameSite=Lax/);
  assert.equal(getCookieToken(cookie),token);
  assert.equal(getCookieToken(cookie+'; a51_pc_customer='+token),null);
  assert.match(clearCookie(),/Max-Age=0/);
});
test('session validation enforces idle, revocation and absolute expiry', () => {
  const now=Date.now();
  const base={created_at:new Date(now-86400000).toISOString(),
    last_seen_at:new Date(now-60000).toISOString(),
    expires_at:new Date(now+86400000).toISOString(),revoked_at:null};
  assert.equal(isValidSession(base,now),true);
  assert.equal(isValidSession({...base,revoked_at:new Date(now).toISOString()},now),false);
  assert.equal(isValidSession({...base,last_seen_at:new Date(now-31*86400000).toISOString()},now),false);
  assert.equal(isValidSession({...base,created_at:new Date(now-181*86400000).toISOString()},now),false);
});
test('OTP codes are six digits, scoped and compared safely', () => {
  process.env.AREA51_EMAIL_CODE_SECRET='a'.repeat(48);
  const email=normalizeCustomerEmail(' TEST@example.com ');
  assert.equal(email,'test@example.com');
  const code=generateLoginCode();
  assert.match(code,/^\d{6}$/);
  const hash=hashLoginCode(email,code);
  assert.equal(verifyLoginCodeHash(email,code,hash),true);
  assert.equal(verifyLoginCodeHash(email,code==='000000'?'000001':'000000',hash),false);
  assert.equal(verifyLoginCodeHash(email,code,'wrong'),false);
  assert.equal(normalizeCustomerEmail('bad address'),null);
});
test('OTP expires and can only be attempted five times', () => {
  const now=Date.now();
  const row={attempts:0,consumed_at:null,expires_at:new Date(now+60000).toISOString()};
  assert.equal(isLoginCodeUsable(row,now),true);
  assert.equal(isLoginCodeUsable({...row,attempts:5},now),false);
  assert.equal(isLoginCodeUsable({...row,consumed_at:new Date(now).toISOString()},now),false);
  assert.equal(isLoginCodeUsable({...row,expires_at:new Date(now-1).toISOString()},now),false);
});

test('regression: session remains valid after refresh with consistent timestamps', () => {
  const now=Date.now();
  const created=new Date(now-15000).toISOString();
  const row={created_at:created,last_seen_at:created,
    expires_at:new Date(now+180*86400000-15000).toISOString(),revoked_at:null};
  assert.equal(isValidSession(row,now),true);
  assert.equal(isValidSession({...row,revoked_at:new Date(now).toISOString()},now),false);
  assert.equal(isValidSession({...row,last_seen_at:new Date(now+1000).toISOString()},now),false);
});
test('regression: cookies cannot be reused after logout in validation layer', () => {
  const now=Date.now(), token=createToken();
  assert.equal(getCookieToken('a51_pc_customer='+token),token);
  assert.equal(getCookieToken(''),null);
  const session={created_at:new Date(now-1000).toISOString(),
    last_seen_at:new Date(now-1000).toISOString(),
    expires_at:new Date(now+60000).toISOString(),revoked_at:new Date(now).toISOString()};
  assert.equal(isValidSession(session,now),false);
});
