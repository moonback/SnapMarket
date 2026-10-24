import { Global, Module } from '@nestjs/common';
import { MeetupsController } from './meetups.controller';
import { MeetupsService } from './meetups.service';

@Global()
@Module({
  controllers: [MeetupsController],
  providers: [MeetupsService],
  exports: [MeetupsService],
})
export class MeetupsModule {}
