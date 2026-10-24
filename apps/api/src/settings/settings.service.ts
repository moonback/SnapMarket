import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG, AppConfig } from '../config/configuration';
import { AuditService } from '../audit/audit.service';
import { STORY_MAX_TTL_HOURS } from '@snapmarket/shared';

/** Paramètres métier modifiables (liste blanche, bornes strictes). */
export interface PlatformSettings {
  commissionBps: number;
  storyTtlHours: number;
  offersEnabled: boolean;
  autoHideReportThreshold: number;
}

type SettingKey = keyof PlatformSettings;

const VALIDATORS: { [K in SettingKey]: (v: unknown) => v is PlatformSettings[K] } = {
  commissionBps: (v): v is number =>
    Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 3000,
  storyTtlHours: (v): v is number =>
    Number.isInteger(v) && (v as number) >= 1 && (v as number) <= STORY_MAX_TTL_HOURS,
  offersEnabled: (v): v is boolean => typeof v === 'boolean',
  autoHideReportThreshold: (v): v is number =>
    Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 50,
};

const CACHE_MS = 30_000;

@Injectable()
export class SettingsService {
  private cache: { value: PlatformSettings; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  defaults(): PlatformSettings {
    return {
      commissionBps: this.config.business.defaultCommissionBps,
      storyTtlHours: this.config.business.defaultStoryTtlHours,
      offersEnabled: true,
      autoHideReportThreshold: 3,
    };
  }

  async get(): Promise<PlatformSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const rows = await this.prisma.platformSetting.findMany();
    const value = this.defaults();
    for (const row of rows) {
      const key = row.key as SettingKey;
      if (key in VALIDATORS && VALIDATORS[key](row.value)) {
        (value as unknown as Record<string, unknown>)[key] = row.value;
      }
    }
    this.cache = { value, at: Date.now() };
    return value;
  }

  async update(patch: Record<string, unknown>, actorId: string): Promise<PlatformSettings> {
    const entries = Object.entries(patch);
    for (const [key, value] of entries) {
      if (!(key in VALIDATORS)) throw new BadRequestException(`Paramètre inconnu : ${key}`);
      if (!VALIDATORS[key as SettingKey](value)) {
        throw new BadRequestException(`Valeur invalide pour ${key}`);
      }
    }
    const before = await this.get();
    await this.prisma.$transaction(async (tx) => {
      for (const [key, value] of entries) {
        await tx.platformSetting.upsert({
          where: { key },
          create: { key, value: value as never, updatedById: actorId },
          update: { value: value as never, updatedById: actorId },
        });
      }
      await this.audit.log(
        {
          actorId,
          action: 'settings.update',
          entityType: 'PlatformSetting',
          metadata: { before: { ...before }, patch: patch as never },
        },
        tx,
      );
    });
    this.cache = null;
    return this.get();
  }
}
