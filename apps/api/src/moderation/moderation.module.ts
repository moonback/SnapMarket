import { Global, Module } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { SpamService } from './spam.service';

@Global()
@Module({ providers: [SpamService, ModerationService], exports: [SpamService, ModerationService] })
export class ModerationModule {}
