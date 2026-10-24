import { isValidSiret } from './sellers.service';

describe('isValidSiret', () => {
  it('accepte un SIRET valide (clé de Luhn)', () => {
    expect(isValidSiret('73282932000074')).toBe(true);
  });
  it('refuse un SIRET invalide ou mal formé', () => {
    expect(isValidSiret('73282932000075')).toBe(false);
    expect(isValidSiret('1234')).toBe(false);
    expect(isValidSiret('7328293200007a')).toBe(false);
  });
});
