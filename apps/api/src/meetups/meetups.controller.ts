import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../common/decorators/auth.decorators';
import { ProposeMeetupDto } from './dto/meetup.dto';
import { MeetupsService } from './meetups.service';

@ApiTags('meetups')
@ApiBearerAuth()
@Controller()
export class MeetupsController {
  constructor(private readonly meetups: MeetupsService) {}

  @Post('orders/:orderId/meetups')
  propose(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Body() dto: ProposeMeetupDto,
  ) {
    return this.meetups.propose(user, orderId, dto);
  }

  @Post('meetups/:id/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.meetups.accept(user, id);
  }

  @Post('meetups/:id/decline')
  @HttpCode(200)
  decline(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.meetups.decline(user, id);
  }

  @Post('meetups/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.meetups.cancel(user, id);
  }
}
