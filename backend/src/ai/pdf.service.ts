import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';

/**
 * The resume itself is the problem — gone from storage, or a PDF with no text
 * layer — so trying again will not help. The scorer records it as unreadable
 * rather than scoring it.
 */
export class ResumeUnreadableError extends Error {}

/** Less text than this is not a resume; a scanned PDF yields a few stray characters. */
const MIN_RESUME_CHARS = 50;

@Injectable()
export class PdfService {
  /**
   * The text of the PDF at `url`.
   *
   * There used to be a fallback here that returned a made-up resume ("JavaScript,
   * Node.js… B.S. in Computer Science") whenever extraction failed. pdftotext was
   * never installed on the production server, so from 6 Aug to 14 Oct 2026 every
   * candidate was scored against that invented text and every "% Match" was
   * fiction. Never invent input: a resume that cannot be read is reported as
   * such (ResumeUnreadableError), and anything that might pass on a retry — a
   * network blip, pdftotext missing — throws a plain Error so it is retried.
   */
  async extractTextFromUrl(url: string): Promise<string> {
    let pdf: Buffer;
    try {
      const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30_000 });
      pdf = Buffer.from(response.data);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404 || status === 403 || status === 410) {
        throw new ResumeUnreadableError(`the resume file is no longer available (HTTP ${status})`);
      }
      throw new Error(`could not download the resume: ${err?.message ?? err}`);
    }

    const tempId = crypto.randomBytes(8).toString('hex');
    const tempPdfPath = path.join(os.tmpdir(), `resume_${tempId}.pdf`);
    const tempTxtPath = path.join(os.tmpdir(), `resume_${tempId}.txt`);
    let text: string;
    try {
      fs.writeFileSync(tempPdfPath, pdf);
      try {
        // pdftotext comes from poppler-utils. execFile, not a shell: no quoting
        // of paths, and a missing binary shows up as ENOENT.
        execFileSync('pdftotext', [tempPdfPath, tempTxtPath], { stdio: 'ignore' });
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          // The server, not the resume: retry once poppler-utils is installed.
          throw new Error('pdftotext is not installed on this server (apt-get install poppler-utils)');
        }
        throw new ResumeUnreadableError('the file is not a readable PDF');
      }
      text = fs.readFileSync(tempTxtPath, 'utf8');
    } finally {
      if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
      if (fs.existsSync(tempTxtPath)) fs.unlinkSync(tempTxtPath);
    }

    if (text.trim().length < MIN_RESUME_CHARS) {
      throw new ResumeUnreadableError('the PDF has no readable text (probably a scanned image)');
    }
    return text;
  }
}
