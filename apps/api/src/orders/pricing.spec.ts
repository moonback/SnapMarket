import { computeCommissionCents, computeOrderPricing } from './pricing';

describe('pricing', () => {
  it('calcule 5 % de commission sur le prix des articles, hors livraison', () => {
    const p = computeOrderPricing({
      unitPriceCents: 2000,
      quantity: 1,
      shippingFeeCents: 490,
      commissionBps: 500,
    });
    expect(p).toEqual({
      itemPriceCents: 2000,
      shippingFeeCents: 490,
      totalCents: 2490,
      commissionCents: 100,
      commissionBps: 500,
      sellerPayoutCents: 2390,
    });
  });

  it('arrondit le demi-centime au supérieur et le reste au plus proche', () => {
    expect(computeCommissionCents(1010, 500)).toBe(51); // 50,5 -> 51
    expect(computeCommissionCents(1009, 500)).toBe(50); // 50,45 -> 50
    expect(computeCommissionCents(1019, 500)).toBe(51); // 50,95 -> 51
    expect(computeCommissionCents(1, 500)).toBe(0); // 0,05 -> 0
    expect(computeCommissionCents(10, 500)).toBe(1); // 0,5 -> 1
  });

  it('multiplie par la quantité', () => {
    const p = computeOrderPricing({
      unitPriceCents: 1500,
      quantity: 3,
      shippingFeeCents: 0,
      commissionBps: 500,
    });
    expect(p.itemPriceCents).toBe(4500);
    expect(p.commissionCents).toBe(225);
    expect(p.sellerPayoutCents).toBe(4275);
  });

  it('accepte une commission nulle', () => {
    const p = computeOrderPricing({
      unitPriceCents: 999,
      quantity: 1,
      shippingFeeCents: 100,
      commissionBps: 0,
    });
    expect(p.commissionCents).toBe(0);
    expect(p.sellerPayoutCents).toBe(1099);
  });

  it('préserve l’invariant total = commission + versement vendeur', () => {
    for (let price = 100; price < 20000; price += 137) {
      for (const bps of [0, 250, 500, 1234, 3000]) {
        const p = computeOrderPricing({
          unitPriceCents: price,
          quantity: 1,
          shippingFeeCents: 350,
          commissionBps: bps,
        });
        expect(p.commissionCents + p.sellerPayoutCents).toBe(p.totalCents);
        expect(Number.isInteger(p.commissionCents)).toBe(true);
      }
    }
  });

  it('refuse les montants non entiers ou négatifs', () => {
    expect(() =>
      computeOrderPricing({
        unitPriceCents: 10.5,
        quantity: 1,
        shippingFeeCents: 0,
        commissionBps: 500,
      }),
    ).toThrow();
    expect(() =>
      computeOrderPricing({
        unitPriceCents: 100,
        quantity: 0,
        shippingFeeCents: 0,
        commissionBps: 500,
      }),
    ).toThrow();
    expect(() =>
      computeOrderPricing({
        unitPriceCents: 100,
        quantity: 1,
        shippingFeeCents: -1,
        commissionBps: 500,
      }),
    ).toThrow();
    expect(() => computeCommissionCents(100, 10001)).toThrow();
  });
});
