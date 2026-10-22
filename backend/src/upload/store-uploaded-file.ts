import { HttpException, HttpStatus } from '@nestjs/common';
import * as path from 'path';
import { join } from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';

/**
 * Store an uploaded file in ImageKit, or on this backend's disk when no ImageKit
 * key is set. Shared by /upload and modules with their own upload rules (Website Chat).
 */
export async function storeUploadedFile(file: Express.Multer.File, folder: string, req: any): Promise<{ url: string }> {
  if (!file) {
    throw new HttpException('No file provided', HttpStatus.BAD_REQUEST);
  }

  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
  if (!privateKey) {
    return saveLocal(file, folder, req);
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

/** No ImageKit keys in this environment: store the file on this backend's own
 *  disk and serve it through the /uploads/ static route (see main.ts). */
function saveLocal(file: Express.Multer.File, folder: string, req: any) {
  const localDir = folder.replace(/^\/+|\/+$/g, '');
  const dir = join(process.cwd(), 'uploads', localDir);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(file.originalname);
  const filename = `${crypto.randomBytes(16).toString('hex')}${ext}`;
  fs.writeFileSync(join(dir, filename), file.buffer);

  const host = process.env.PUBLIC_BASE_URL || (req ? `${req.protocol}://${req.get('host')}` : '');
  return { url: `${host}/uploads/${localDir}/${filename}` };
}
