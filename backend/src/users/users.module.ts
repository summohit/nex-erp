import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  // AuthModule exports TwoFactorService, used to report twoFactorEnabled on
  // GET /users/me without ever exposing the stored secret.
  imports: [PrismaModule, AuthModule],
  providers: [UsersService],
  controllers: [UsersController]
})
export class UsersModule {}
