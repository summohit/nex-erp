import { Controller, Post, UseInterceptors, UploadedFile, UseGuards, UseFilters, HttpException, HttpStatus, ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/auth.guard';
import * as path from 'path';
import * as crypto from 'crypto';
import axios from 'axios';
import FormData from 'form-data';
import { MulterError } from 'multer';

const ALLOWED_MIME_TYPES = ['application/pdf'];
const ALLOWED_EXTENSIONS = ['.pdf'];
const MAX_RESUME_FILE_SIZE = 10 * 1024 * 1024;
const MAX_UPLOAD_FILE_SIZE = 20 * 1024 * 1024;

function resumeFileFilter(req: any, file: Express.Multer.File, cb: (error: Error | null, acceptFile: boolean) => void) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype) && !ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new HttpException('Only PDF files are allowed', HttpStatus.BAD_REQUEST), false);
  }
  cb(null, true);
}

@Catch(MulterError)
class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    if (exception.code === 'LIMIT_FILE_SIZE') {
      return response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: `File is too large. Maximum allowed size is ${MAX_UPLOAD_FILE_SIZE / (1024 * 1024)}MB.`
      });
    }
    return response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      message: exception.message || 'File upload failed.'
    });
  }
}

@Controller('upload')
@UseFilters(MulterExceptionFilter)
export class UploadController {

  @UseGuards(AuthGuard)
  @Post()
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: MAX_UPLOAD_FILE_SIZE }
  }))
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    return this.processUpload(file, '/erp_uploads');
  }

  @Post('resume')
  @UseInterceptors(FileInterceptor('file', {
    fileFilter: resumeFileFilter,
    limits: { fileSize: MAX_RESUME_FILE_SIZE }
  }))
  async uploadResume(@UploadedFile() file: Express.Multer.File) {
    return this.processUpload(file, '/resumes');
  }

  private async processUpload(file: Express.Multer.File, folder: string) {
    if (!file) {
      throw new HttpException('No file provided', HttpStatus.BAD_REQUEST);
    }

    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
    if (!privateKey) {
      throw new HttpException('ImageKit not configured', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    try {
      const ext = path.extname(file.originalname);
      const filename = `${crypto.randomBytes(16).toString('hex')}${ext}`;

      const form = new FormData();
      form.append('file', file.buffer, filename);
      form.append('fileName', filename);
      form.append('folder', folder);

      const authHeader = 'Basic ' + Buffer.from(privateKey + ':').toString('base64');

      const response = await axios.post('https://upload.imagekit.io/api/v1/files/upload', form, {
        headers: {
          ...form.getHeaders(),
          Authorization: authHeader
        }
      });

      return { url: response.data.url };
    } catch (error: any) {
      console.error('ImageKit upload error:', error.response?.data || error.message);
      const providerMessage = error.response?.data?.message;
      throw new HttpException(
        providerMessage ? `Failed to upload file: ${providerMessage}` : 'Failed to upload file. Please try again.',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
