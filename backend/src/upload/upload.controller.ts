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
// Ticket attachments accept screenshots and documents alike. Allowlisted rather
// than blocklisted: anything executable or scriptable stays out by construction.
const MAX_TICKET_FILE_SIZE = 20 * 1024 * 1024;
const TICKET_FILE_EXTENSIONS = [
  // Images
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.heic',
  // Documents
  '.pdf', '.doc', '.docx', '.odt', '.rtf',
  // Spreadsheets
  '.xls', '.xlsx', '.ods', '.csv',
  // Presentations
  '.ppt', '.pptx', '.odp',
  // Text & logs
  '.txt', '.log', '.json', '.xml', '.md',
  // Archives
  '.zip', '.rar', '.7z',
];
const TICKET_FILE_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml', 'image/heic',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/rtf', 'text/rtf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.presentation',
  'text/plain', 'application/json', 'application/xml', 'text/xml', 'text/markdown',
  'application/zip', 'application/x-zip-compressed',
  'application/vnd.rar', 'application/x-rar-compressed',
  'application/x-7z-compressed',
];

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

  @Post('image')
  @UseInterceptors(FileInterceptor('file', {
    fileFilter: (req: any, file: Express.Multer.File, cb: (error: Error | null, acceptFile: boolean) => void) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!['image/jpeg', 'image/png'].includes(file.mimetype) && !['.jpg', '.jpeg', '.png'].includes(ext)) {
        return cb(new HttpException('Only JPG and PNG images are allowed', HttpStatus.BAD_REQUEST), false);
      }
      cb(null, true);
    },
    limits: { fileSize: 5 * 1024 * 1024 }
  }))
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    return this.processUpload(file, '/candidate_photos');
  }

  @UseGuards(AuthGuard)
  @Post('ticket-attachment')
  @UseInterceptors(FileInterceptor('file', {
    fileFilter: (req: any, file: Express.Multer.File, cb: (error: Error | null, acceptFile: boolean) => void) => {
      // The extension is the gate: MIME is client-supplied and browsers send
      // application/octet-stream for plenty of legitimate types, so trusting it
      // alone would let an executable through under a generic content type.
      const ext = path.extname(file.originalname).toLowerCase();
      if (!TICKET_FILE_EXTENSIONS.includes(ext)) {
        return cb(new HttpException(`File type "${ext || 'unknown'}" is not allowed`, HttpStatus.BAD_REQUEST), false);
      }
      // When the browser does send a specific type, it must agree with the allowlist.
      if (file.mimetype && file.mimetype !== 'application/octet-stream'
          && !TICKET_FILE_MIME_TYPES.includes(file.mimetype)) {
        return cb(new HttpException(`Content type "${file.mimetype}" is not allowed`, HttpStatus.BAD_REQUEST), false);
      }
      cb(null, true);
    },
    limits: { fileSize: MAX_TICKET_FILE_SIZE }
  }))
  async uploadTicketAttachment(@UploadedFile() file: Express.Multer.File) {
    return this.processUpload(file, '/ticket_attachments');
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
      form.append('file', file.buffer.toString('base64'));
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
