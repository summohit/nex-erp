import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { INACTIVE_USER_STATUSES } from './inactive-users';

/** The uploaded document types we read, and the details each can give. */
export const READABLE_DOCUMENTS: Record<string, 'PAN' | 'UAN' | 'BANK'> = {
  'PAN Card': 'PAN',
  UAN: 'UAN',
  'Bank Proof / Cancelled Cheque': 'BANK',
};

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const UAN = /^[0-9]{12}$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT = /^[0-9]{9,18}$/;
const MAX_BYTES = 8 * 1024 * 1024;

const PROMPTS: Record<'PAN' | 'UAN' | 'BANK', string> = {
  PAN: `This should be an Indian PAN card (Permanent Account Number). Read it.
Return JSON only: {"isPanCard": boolean, "pan": "10-character PAN like ABCDE1234F, or null", "name": "name printed on the card, or null"}.
Never guess a character you can't read — return null instead.`,
  UAN: `This should show an Indian EPFO UAN (Universal Account Number, exactly 12 digits) — e.g. a UAN card, passbook or portal screenshot.
Do not return a PF member ID (which contains letters) or any other number.
Return JSON only: {"uan": "12 digits, or null", "name": "member name shown, or null"}.
Never guess a digit you can't read — return null instead.`,
  BANK: `This should be a cancelled cheque or a bank proof (passbook / statement / letter) for an Indian bank account.
Return JSON only: {"accountNumber": "digits only, or null", "ifsc": "11-character IFSC like HDFC0001234, or null", "bankName": "bank name, or null", "accountHolder": "account holder name, or null"}.
Never guess a digit you can't read — return null instead.`,
};

/** Errors that will repeat for every document (model gone, key refused), as opposed to one bad file. */
export function isSetupError(err: any): boolean {
  const text = String(err?.message || err || '');
  const status = Number(err?.status ?? err?.code ?? (text.match(/"code":\s*(\d{3})/)?.[1] || 0));
  // An exhausted quota (429 "exceeded your current quota") won't recover by retrying this run.
  return [401, 403, 404].includes(status) || /model .* (is no longer available|not found)|API key|exceeded your current quota/i.test(text);
}

/** Temporary: the model is overloaded or we're over the rate limit — worth a retry. */
export function isBusyError(err: any): boolean {
  const text = String(err?.message || err || '');
  const status = Number(err?.status ?? err?.code ?? (text.match(/"code":\s*(\d{3})/)?.[1] || 0));
  if (/exceeded your current quota/i.test(text)) return false;
  return [429, 503].includes(status) || /high demand|overloaded|rate limit|RESOURCE_EXHAUSTED|UNAVAILABLE/i.test(text);
}

export interface ReadProgress {
  running: boolean;
  total: number;
  done: number;
  suggested: number;
  unreadable: number;
  failed: number;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
}

/**
 * Reads PAN / UAN / bank details from employees' uploaded documents with
 * Gemini and stores them as suggestions. It never writes to Employee — Finance
 * verifies each suggestion against the document first.
 *
 * Started only by a Finance/admin button press: documents go to Google.
 */
@Injectable()
export class DocumentReaderService {
  private readonly logger = new Logger(DocumentReaderService.name);
  private readonly progress = new Map<number, ReadProgress>();
  private ai: GoogleGenAI | null = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
  // An alias Google moves to the current Flash model: pinned versions get
  // retired for new keys (gemini-2.5-flash did, Nov 2026). Override with DOC_READER_MODEL.
  private readonly model = process.env.DOC_READER_MODEL || 'gemini-flash-latest';

  constructor(private prisma: PrismaService) {}

  status(companyId: number): ReadProgress {
    return this.progress.get(companyId) ?? {
      running: false, total: 0, done: 0, suggested: 0, unreadable: 0, failed: 0, startedAt: null, finishedAt: null, lastError: null,
    };
  }

  /**
   * Queue every readable document that could still help: its detail isn't
   * verified yet and the document hasn't been read before. Returns at once;
   * the reading continues in the background (see status()).
   */
  async start(companyId: number, employeeIds?: number[]) {
    if (!this.ai) throw new BadRequestException('Document reading needs GEMINI_API_KEY on the server.');
    if (this.status(companyId).running) throw new BadRequestException('Already reading documents — wait for it to finish.');

    const docs = await this.prisma.employeeDocument.findMany({
      where: {
        documentType: { in: Object.keys(READABLE_DOCUMENTS) },
        employee: {
          companyId,
          user: { status: { notIn: INACTIVE_USER_STATUSES } },
          ...(employeeIds?.length && { id: { in: employeeIds } }),
        },
      },
      select: {
        id: true, fileUrl: true, documentType: true, employeeId: true,
        employee: { select: { panVerifiedAt: true, uanVerifiedAt: true, bankVerifiedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const alreadyRead = new Set(
      (await this.prisma.employeeDetailSuggestion.findMany({
        where: { companyId, documentId: { in: docs.map((d) => d.id) } },
        select: { documentId: true },
      })).map((s) => s.documentId),
    );
    const queue = docs.filter((d) => {
      if (alreadyRead.has(d.id)) return false;
      const kind = READABLE_DOCUMENTS[d.documentType || ''];
      const verified = kind === 'PAN' ? d.employee.panVerifiedAt : kind === 'UAN' ? d.employee.uanVerifiedAt : d.employee.bankVerifiedAt;
      return !verified;
    });

    const p: ReadProgress = {
      running: queue.length > 0, total: queue.length, done: 0, suggested: 0, unreadable: 0, failed: 0,
      startedAt: new Date().toISOString(), finishedAt: queue.length ? null : new Date().toISOString(), lastError: null,
    };
    this.progress.set(companyId, p);
    if (queue.length) void this.run(companyId, queue, p);
    return p;
  }

  private async run(companyId: number, queue: { id: number; fileUrl: string; documentType: string | null; employeeId: number }[], p: ReadProgress) {
    // Two at a time: quick enough for ~100 files, gentle on the API quota.
    const workers = Array.from({ length: 2 }, async () => {
      while (queue.length) {
        const doc = queue.shift()!;
        try {
          const n = await this.readOne(companyId, doc);
          if (n > 0) p.suggested += n;
          else p.unreadable++;
        } catch (err: any) {
          p.failed++;
          p.lastError = err?.message?.slice(0, 200) || 'Failed to read a document';
          this.logger.warn(`Reading document ${doc.id} failed: ${p.lastError}`);
          // A wrong model or key fails every file the same way — stop instead of burning through the queue.
          if (isSetupError(err)) {
            p.lastError = `Stopped: ${p.lastError}`;
            queue.length = 0;
          }
        } finally {
          p.done++;
        }
      }
    });
    await Promise.all(workers);
    p.running = false;
    p.finishedAt = new Date().toISOString();
  }

  /** Read one document; store each valid detail as a suggestion. Returns how many were stored. */
  private async readOne(companyId: number, doc: { id: number; fileUrl: string; documentType: string | null; employeeId: number }): Promise<number> {
    const kind = READABLE_DOCUMENTS[doc.documentType || ''];
    const file = await axios.get<ArrayBuffer>(doc.fileUrl, { responseType: 'arraybuffer', timeout: 20000, maxContentLength: MAX_BYTES });
    const mimeType = this.mimeOf(doc.fileUrl, String(file.headers['content-type'] || ''));
    if (!mimeType) {
      await this.note(companyId, doc, 'Not an image or PDF — enter by hand.');
      return 0;
    }

    const request = {
      model: this.model,
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: Buffer.from(file.data).toString('base64') } }, { text: PROMPTS[kind] }] }],
      config: { responseMimeType: 'application/json', temperature: 0 },
    };
    // "High demand" (503) and rate limits (429) pass: wait and try again, up to 3 more times.
    let res: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>> | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await this.ai!.models.generateContent(request);
        break;
      } catch (err: any) {
        if (!isBusyError(err) || attempt >= 3) throw err;
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
      }
    }
    let out: any = {};
    try {
      out = JSON.parse(res.text || '{}');
    } catch {
      out = {};
    }

    const found = this.extract(kind, out);
    if (!found.values.length) {
      await this.note(companyId, doc, found.note || 'Couldn\'t read the details — enter by hand.');
      return 0;
    }
    await this.prisma.employeeDetailSuggestion.createMany({
      data: found.values.map((v) => ({ companyId, employeeId: doc.employeeId, field: v.field, value: v.value, documentId: doc.id, note: found.note })),
    });
    return found.values.length;
  }

  /** Model output → only values that pass the format check. Exported shape for tests. */
  extract(kind: 'PAN' | 'UAN' | 'BANK', out: any): { values: { field: string; value: string }[]; note: string | null } {
    const clean = (v: any, keepSpaces = false) => {
      if (v === null || v === undefined) return '';
      const s = String(v).toUpperCase().trim();
      return keepSpaces ? s.replace(/\s+/g, ' ') : s.replace(/[\s-]/g, '');
    };
    const values: { field: string; value: string }[] = [];
    let note: string | null = null;
    if (kind === 'PAN') {
      if (out.isPanCard === false) return { values, note: 'This doesn\'t look like a PAN card.' };
      const pan = clean(out.pan);
      if (PAN.test(pan)) values.push({ field: 'PAN', value: pan });
      if (out.name) note = `Name on card: ${String(out.name).slice(0, 80)}`;
    } else if (kind === 'UAN') {
      const uan = clean(out.uan);
      if (UAN.test(uan)) values.push({ field: 'UAN', value: uan });
      if (out.name) note = `Name shown: ${String(out.name).slice(0, 80)}`;
    } else {
      const acc = clean(out.accountNumber);
      const ifsc = clean(out.ifsc);
      if (ACCOUNT.test(acc)) values.push({ field: 'BANK_ACCOUNT', value: acc });
      if (IFSC.test(ifsc)) values.push({ field: 'IFSC', value: ifsc });
      if (out.bankName && values.length) values.push({ field: 'BANK_NAME', value: clean(out.bankName, true).slice(0, 80) });
      if (out.accountHolder) note = `Account holder: ${String(out.accountHolder).slice(0, 80)}`;
    }
    return { values, note };
  }

  /** Mark a document as read even when nothing came out, so it isn't read again. */
  private async note(companyId: number, doc: { id: number; employeeId: number; documentType: string | null }, note: string) {
    await this.prisma.employeeDetailSuggestion.create({
      data: { companyId, employeeId: doc.employeeId, field: 'UNREADABLE', value: '', documentId: doc.id, status: 'REJECTED', note },
    });
  }

  private mimeOf(url: string, header: string): string | null {
    const h = header.split(';')[0].trim().toLowerCase();
    if (['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(h)) return h;
    const ext = (url.split('?')[0].match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
    return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' } as Record<string, string>)[ext] ?? null;
  }
}
