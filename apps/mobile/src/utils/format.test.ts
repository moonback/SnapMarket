import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientId, relativeTime } from './format';

test('relativeTime', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  assert.equal(relativeTime('2026-10-24T11:59:40Z', now), 'à l’instant');
  assert.equal(relativeTime('2026-10-24T11:45:00Z', now), 'il y a 15 min');
  assert.equal(relativeTime('2026-10-24T09:00:00Z', now), 'il y a 3 h');
  assert.equal(relativeTime('2026-10-22T12:00:00Z', now), 'il y a 2 j');
});

test('clientId respecte le format attendu par l’API', () => {
  for (let i = 0; i < 50; i++) assert.match(clientId(), /^[A-Za-z0-9_-]{8,64}$/);
});
