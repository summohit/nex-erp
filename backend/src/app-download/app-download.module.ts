import { Module } from '@nestjs/common';
import { AppDownloadController } from './app-download.controller';

@Module({
  controllers: [AppDownloadController],
})
export class AppDownloadModule {}
