import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TwoFactorService } from './two-factor.service';
import { TwoFactorController } from './two-factor.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { CompanySeederModule } from '../company-seeder/company-seeder.module';

@Module({
  imports: [
    PrismaModule,
    MailModule,
    CompanySeederModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'super-secret',
      signOptions: { expiresIn: '1d' },
    }),
  ],
  providers: [AuthService, TwoFactorService],
  controllers: [AuthController, TwoFactorController],
  exports: [TwoFactorService]
})
export class AuthModule {}
