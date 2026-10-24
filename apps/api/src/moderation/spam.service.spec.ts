import { SpamService } from './spam.service';

describe('SpamService', () => {
  const store = new Map<string, number>();
  const redis = {
    incr: async (k: string) => {
      store.set(k, (store.get(k) ?? 0) + 1);
      return store.get(k)!;
    },
    expire: async () => 1,
  };
  const spam = new SpamService(redis as never);

  it('laisse passer un message ordinaire', () => {
    expect(spam.evaluateText('Bonjour, est-ce que la taille M est disponible ?').verdict).toBe(
      'allow',
    );
  });

  it('signale un contact hors plateforme', () => {
    const r = spam.evaluateText('Écris-moi sur whatsapp au 06 12 34 56 78');
    expect(r.verdict).toBe('flag');
    expect(r.reasons).toEqual(expect.arrayContaining(['off_platform_contact', 'phone_number']));
  });

  it('refuse un moyen de paiement frauduleux combiné à un contact externe', () => {
    expect(spam.evaluateText('Paiement par coupons PCS uniquement, mail: a@b.fr').verdict).toBe(
      'reject',
    );
  });

  it('refuse un message identique répété', async () => {
    const results = [];
    for (let i = 0; i < 5; i++)
      results.push((await spam.evaluate('u1', 'message', 'Super affaire à saisir vite')).verdict);
    expect(results.slice(0, 3)).toEqual(['allow', 'allow', 'allow']);
    expect(results[4]).toBe('reject');
  });
});
