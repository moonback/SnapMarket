import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/** Paramètres Argon2id (recommandations OWASP : m=19 MiB, t=2, p=1 au minimum). */
const OPTIONS: argon2.HashOptions & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | null = null;

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, OPTIONS);
  }

  async verify(hash: string | null, plain: string): Promise<boolean> {
    if (!hash) {
      // Calcul factice pour ne pas révéler l'existence du compte par le temps de réponse.
      this.dummyHash ??= argon2.hash('dummy-password-for-timing', OPTIONS);
      const dummy = await this.dummyHash;
      await argon2.verify(dummy, plain).catch(() => false);
      return false;
    }
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
