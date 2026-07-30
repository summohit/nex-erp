import { Controller, Post, UseInterceptors, UploadedFile, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/auth.guard';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Controller('upload')
export class UploadController {
  @UseGuards(AuthGuard)
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new HttpException('No file provided', HttpStatus.BAD_REQUEST);
    }

    try {
      const ext = path.extname(file.originalname);
      const filename = `${crypto.randomBytes(16).toString('hex')}${ext}`;
      const uploadPath = path.join(process.cwd(), 'uploads', filename);

      fs.writeFileSync(uploadPath, file.buffer);

      return { url: `http://localhost:3000/uploads/${filename}` };
    } catch (error) {
      console.error('Upload local save error:', error);
      throw new HttpException(
        'Failed to save file locally',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
