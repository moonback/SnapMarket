import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCents, parseEurosToCents } from './money';
import { allowedOrderTransitions, canTransitionOrder } from './order-state-machine';
import { productInputSchema, registerSchema } from './schemas';

test('formatCents', () => {
  assert.equal(formatCents(1234), '12,34 €');
  assert.equal(formatCents(5), '0,05 €');
  assert.equal(formatCents(123456789), '1 234 567,89 €');
  assert.throws(() => formatCents(1.5));
});

test('parseEurosToCents', () => {
  assert.equal(parseEurosToCents('12,5'), 1250);
  assert.equal(parseEurosToCents('12.05'), 1205);
  assert.equal(parseEurosToCents('7'), 700);
  assert.equal(parseEurosToCents('0,1'), 10);
  assert.equal(parseEurosToCents('1,234'), null);
  assert.equal(parseEurosToCents('abc'), null);
  assert.equal(parseEurosToCents('-3'), null);
});

test('state machine: buyer cannot mark order paid', () => {
  assert.equal(canTransitionOrder('PENDING_PAYMENT', 'PAID', 'BUYER', 'SHIPPING'), false);
  assert.equal(canTransitionOrder('PENDING_PAYMENT', 'PAID', 'SYSTEM', 'SHIPPING'), true);
});

test('state machine: shipping-only transitions are refused for meetups', () => {
  assert.equal(canTransitionOrder('PAID', 'PREPARING', 'SELLER', 'MEETUP'), false);
  assert.deepEqual(allowedOrderTransitions('SHIPPED', 'BUYER', 'SHIPPING').sort(), [
    'COMPLETED',
    'DISPUTED',
  ]);
});

test('schemas', () => {
  assert.equal(
    registerSchema.safeParse({
      email: 'A@B.fr',
      username: 'alice',
      password: 'weak',
      acceptTerms: true,
    }).success,
    false,
  );
  const r = productInputSchema.safeParse({
    title: 'Veste',
    description: '',
    priceCents: 2500,
    categoryId: 'c1',
    condition: 'GOOD',
    deliveryModes: ['SHIPPING'],
    mediaIds: [],
  });
  assert.equal(r.success, false, 'shipping fee required when shipping enabled');
});
