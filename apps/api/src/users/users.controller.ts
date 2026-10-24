import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Public } from '../common/decorators/auth.decorators';
import { DeleteAccountDto, PushTokenDto, UpdateProfileDto } from './dto/users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.users.me(user.id);
  }

  @Patch('me')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto);
  }

  @Delete('me')
  @HttpCode(204)
  delete(@CurrentUser() user: AuthUser, @Body() dto: DeleteAccountDto, @Req() req: Request) {
    return this.users.deleteAccount(user.id, dto, req.ip ?? null);
  }

  @Get('me/blocks')
  blocks(@CurrentUser() user: AuthUser) {
    return this.users.listBlocked(user.id);
  }

  @Post('me/push-tokens')
  @HttpCode(204)
  addPushToken(@CurrentUser() user: AuthUser, @Body() dto: PushTokenDto) {
    return this.users.registerPushToken(user.id, dto);
  }

  @Delete('me/push-tokens/:token')
  @HttpCode(204)
  removePushToken(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    return this.users.removePushToken(user.id, token);
  }

  @Public()
  @Get(':id')
  profile(@Param('id') id: string) {
    return this.users.publicProfile(id);
  }

  @Post(':id/block')
  @HttpCode(204)
  block(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.block(user.id, id);
  }

  @Delete(':id/block')
  @HttpCode(204)
  unblock(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.unblock(user.id, id);
  }
}
