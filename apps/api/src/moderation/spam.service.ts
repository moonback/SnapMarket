import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { sha256 } from '../common/utils/crypto';
import { REDIS } from '../redis/redis.module';

export type SpamVerdict = 'allow' | 'flag' | 'reject';

export interface SpamResult {
  verdict: SpamVerdict;
  score: number;
  reasons: string[];
}

interface Rule {
  id: string;
  weight: number;
  test: (text: string) => boolean;
}

/**
 * Règles simples et explicables de détection de spam / fraude. Chaque règle a un
 * poids ; le total détermine le verdict. Les règles sont volontairement lisibles
 * pour pouvoir être auditées et étendues (ex. liste administrable).
 */
export const SPAM_RULES: Rule[] = [
  {
    id: 'off_platform_payment',
    weight: 3,
    test: (t) =>
      /\b(western\s*union|moneygram|mandat\s*cash|transcash|coupons?\s*pcs|neosurf|paysafecard)\b/i.test(
        t,
      ),
  },
  {
    id: 'off_platform_contact',
    weight: 1,
    test: (t) => /\b(whats\s*app|telegram|signal|wechat)\b/i.test(t),
  },
  {
    id: 'phone_number',
    weight: 1,
    test: (t) => /(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}/.test(t),
  },
  {
    id: 'email_address',
    weight: 1,
    test: (t) => /[\w.+-]+@[\w-]+\.[\w.]{2,}/.test(t),
  },
  {
    id: 'many_links',
    weight: 2,
    test: (t) => (t.match(/https?:\/\//gi) ?? []).length > 2,
  },
  {
    id: 'shortened_link',
    weight: 2,
    test: (t) => /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|cutt\.ly)\//i.test(t),
  },
];

const FLAG_THRESHOLD = 2;
const REJECT_THRESHOLD = 4;
const DUPLICATE_WINDOW_SECONDS = 600;
const DUPLICATE_MAX = 3;

@Injectable()
export class SpamService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  evaluateText(text: string): SpamResult {
    const reasons: string[] = [];
    let score = 0;
    for (const rule of SPAM_RULES) {
      if (rule.test(text)) {
        reasons.push(rule.id);
        score += rule.weight;
      }
    }
    return { score, reasons, verdict: verdictFor(score) };
  }

  /** Évalue un texte et pénalise les envois identiques répétés par un même utilisateur. */
  async evaluate(userId: string, scope: string, text: string): Promise<SpamResult> {
    const result = this.evaluateText(text);
    const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
    if (normalized.length >= 8) {
      const key = `spam:dup:${scope}:${userId}:${sha256(normalized).slice(0, 16)}`;
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, DUPLICATE_WINDOW_SECONDS);
      if (count > DUPLICATE_MAX) {
        result.reasons.push('duplicate_content');
        result.score += REJECT_THRESHOLD;
      }
    }
    result.verdict = verdictFor(result.score);
    return result;
  }
}

function verdictFor(score: number): SpamVerdict {
  if (score >= REJECT_THRESHOLD) return 'reject';
  if (score >= FLAG_THRESHOLD) return 'flag';
  return 'allow';
}
