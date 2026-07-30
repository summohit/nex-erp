import { Module } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [OnboardingService],
  controllers: [OnboardingController],
  exports: [OnboardingService]
})
export class OnboardingModule {}
