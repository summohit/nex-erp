import { Controller, Get, Res, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'path';
import * as fs from 'fs';

// The Android release build is served straight off disk rather than through
// ImageKit: it is ~80MB, changes only on release, and needs to keep a stable
// public URL so QR codes and links printed on onboarding material don't rot.
//
// Drop the signed release build at backend/uploads/app/nex-workspace.apk
// (that whole directory is gitignored, so the binary never enters the repo).
// An optional sidecar backend/uploads/app/version.json of the shape
// { "version": "2.4.0", "notes": "..." } drives the label on the landing page.
const APP_DIR = join(process.cwd(), 'uploads', 'app');
const APK_PATH = join(APP_DIR, 'nex-workspace.apk');
const VERSION_PATH = join(APP_DIR, 'version.json');

function readVersion(): { version?: string; notes?: string } {
  try {
    if (fs.existsSync(VERSION_PATH)) {
      return JSON.parse(fs.readFileSync(VERSION_PATH, 'utf8'));
    }
  } catch {}
  return {};
}

@Controller('app-download')
export class AppDownloadController {
  // Public on purpose — this is what the marketing site's download button hits.
  @Get('android/info')
  getAndroidInfo() {
    if (!fs.existsSync(APK_PATH)) {
      return { available: false };
    }
    const stat = fs.statSync(APK_PATH);
    const { version, notes } = readVersion();
    return {
      available: true,
      version: version || null,
      notes: notes || null,
      sizeBytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };
  }

  @Get('android')
  downloadAndroid(@Res() res: Response) {
    if (!fs.existsSync(APK_PATH)) {
      throw new NotFoundException('No Android build has been published yet.');
    }

    const { version } = readVersion();
    const fileName = version ? `nex-workspace-v${version}.apk` : 'nex-workspace.apk';

    // Android needs this exact MIME type for the package installer to be
    // offered as a handler; without it Chrome saves the file but the tap-to-
    // install prompt never appears.
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', fs.statSync(APK_PATH).size);

    fs.createReadStream(APK_PATH).pipe(res);
  }
}
