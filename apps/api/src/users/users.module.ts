import { Global, Module } from '@nestjs/common';
import { PasswordService } from '../auth/password.service';
import { UserPresenter } from './user-presenter.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Global()
@Module({
  controllers: [UsersController],
  providers: [UsersService, UserPresenter, PasswordService],
  exports: [UsersService, UserPresenter, PasswordService],
})
export class UsersModule {}
