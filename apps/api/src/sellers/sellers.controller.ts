import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser, VerifiedEmail } from '../common/decorators/auth.decorators';
import { ProRequestDto } from './dto/seller.dto';
import { SellersService } from './sellers.service';

@ApiTags('sellers')
@ApiBearerAuth()
@Controller('sellers')
export class SellersController {
  constructor(private readonly sellers: SellersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.sellers.me(user.id);
  }

  @Post('me/pro-request')
  @VerifiedEmail()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  pro(@CurrentUser() user: AuthUser, @Body() dto: ProRequestDto) {
    return this.sellers.requestPro(user.id, dto);
  }

  @Post('me/stripe/onboarding')
  @HttpCode(200)
  @VerifiedEmail()
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  onboarding(@CurrentUser() user: AuthUser) {
    return this.sellers.onboardingLink(user.id);
  }

  @Post('me/stripe/refresh')
  @HttpCode(200)
  refresh(@CurrentUser() user: AuthUser) {
    return this.sellers.refreshStripeStatus(user.id);
  }
}
