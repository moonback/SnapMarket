import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jwtExpiry } from './session';

test('jwtExpiry lit le champ exp', () => {
  const payload = Buffer.from(JSON.stringify({ sub: 'u', exp: 1700000000 })).toString('base64url');
  assert.equal(jwtExpiry(`h.${payload}.s`), 1700000000);
  assert.equal(jwtExpiry('invalid'), null);
  assert.equal(jwtExpiry('a.@@@.c'), null);
});
