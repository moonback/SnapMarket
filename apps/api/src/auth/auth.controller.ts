import { Body, Controller, Get, Header, HttpCode, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Public } from '../common/decorators/auth.decorators';
import { requestMeta } from '../common/utils/request';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  TokenDto,
} from './dto/auth.dto';

const STRICT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const { userId, tokens } = await this.auth.register(dto, requestMeta(req));
    return { user: await this.users.me(userId), tokens };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle(STRICT)
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const { userId, tokens } = await this.auth.login(dto.email, dto.password, requestMeta(req));
    return { user: await this.users.me(userId), tokens };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, requestMeta(req));
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(204)
  logoutAll(@CurrentUser() user: AuthUser) {
    return this.auth.logoutAll(user.id);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(204)
  @Throttle(STRICT)
  verifyEmail(@Body() dto: TokenDto) {
    return this.auth.verifyEmail(dto.token);
  }

  /** Lien cliquable depuis l'email : page HTML minimale. */
  @Public()
  @Get('verify-email')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Throttle(STRICT)
  async verifyEmailLink(@Query('token') token: string) {
    const page = (msg: string) =>
      `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SnapMarket</title><body style="font-family:sans-serif;background:#0B0B12;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>${msg}</p></body></html>`;
    try {
      if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw new Error();
      await this.auth.verifyEmail(token);
      return page('Votre adresse email est confirmée. Vous pouvez retourner dans l’application.');
    } catch {
      return page(
        'Ce lien est invalide ou a expiré. Demandez un nouvel email depuis l’application.',
      );
    }
  }

  @ApiBearerAuth()
  @Post('resend-verification')
  @HttpCode(204)
  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  resend(@CurrentUser() user: AuthUser) {
    return this.auth.resendVerification(user.id);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  async forgot(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    return { message: 'Si un compte existe pour cette adresse, un email a été envoyé.' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  @Throttle(STRICT)
  reset(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.auth.resetPassword(dto.token, dto.password, requestMeta(req));
  }

  @ApiBearerAuth()
  @Post('change-password')
  @HttpCode(204)
  @Throttle(STRICT)
  change(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @Req() req: Request) {
    return this.auth.changePassword(user.id, dto.currentPassword, dto.password, requestMeta(req));
  }
}
