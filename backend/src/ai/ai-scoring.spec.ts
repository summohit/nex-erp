jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('child_process', () => ({ execFileSync: jest.fn() }));

import axios from 'axios';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { PdfService, ResumeUnreadableError } from './pdf.service';
import { AiScoringCron } from './ai-scoring.cron';

const get = axios.get as jest.Mock;
const pdftotext = execFileSync as unknown as jest.Mock;

/** Make the mocked pdftotext write `text` where the real one would. */
function extracts(text: string) {
  pdftotext.mockImplementation((_cmd: string, [, out]: string[]) => fs.writeFileSync(out, text));
}

const RESUME = 'Priya Sharma — Network Engineer. CCNA, CCNP. Seven years of Cisco routing and switching at enterprise scale.';

/**
 * From 6 Aug to 14 Oct 2026 pdftotext was missing on the server and every
 * candidate was scored against an invented resume. Nothing may be invented now.
 */
describe('reading a resume', () => {
  const pdf = new PdfService();
  beforeEach(() => {
    get.mockReset().mockResolvedValue({ data: Buffer.from('%PDF-1.4') });
    pdftotext.mockReset();
  });

  it('returns the real text', async () => {
    extracts(RESUME);
    await expect(pdf.extractTextFromUrl('https://files/r.pdf')).resolves.toBe(RESUME);
  });

  it('calls a resume that is gone unreadable, not a made-up one', async () => {
    get.mockRejectedValue({ response: { status: 404 }, message: 'Not Found' });
    await expect(pdf.extractTextFromUrl('https://files/r.pdf')).rejects.toBeInstanceOf(ResumeUnreadableError);
  });

  it('calls a scanned PDF with no text unreadable', async () => {
    extracts('  \f ');
    await expect(pdf.extractTextFromUrl('https://files/r.pdf')).rejects.toThrow(/no readable text/);
  });

  it('treats a network blip as worth retrying, not as unreadable', async () => {
    get.mockRejectedValue(new Error('socket hang up'));
    const err = await pdf.extractTextFromUrl('https://files/r.pdf').catch((e) => e);
    expect(err).not.toBeInstanceOf(ResumeUnreadableError);
  });

  it('blames the server, not the resume, when pdftotext is missing', async () => {
    pdftotext.mockImplementation(() => { throw Object.assign(new Error('spawn pdftotext ENOENT'), { code: 'ENOENT' }); });
    const err = await pdf.extractTextFromUrl('https://files/r.pdf').catch((e) => e);
    expect(err).not.toBeInstanceOf(ResumeUnreadableError);
    expect(err.message).toMatch(/poppler-utils/);
  });
});

describe('the scoring run', () => {
  const app = { id: 1066, resumeUrl: 'https://files/r.pdf', job: { title: 'Network Engineer', descriptionHtml: '<p>CCNA</p>' } };

  function make(apps: any[] = [app]) {
    const prisma: any = {
      jobApplication: {
        findMany: jest.fn().mockResolvedValue(apps),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const ai: any = { scoreResume: jest.fn().mockResolvedValue({ score: 72, summary: '{"score":72}' }) };
    const pdf: any = { extractTextFromUrl: jest.fn().mockResolvedValue(RESUME) };
    return { cron: new AiScoringCron(prisma, ai, pdf), prisma, ai, pdf };
  }
  const saved = (prisma: any) => prisma.jobApplication.update.mock.calls.map((c: any) => c[0].data);

  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('scores the real resume', async () => {
    const { cron, prisma, ai } = make();
    await cron.processUnscoredApplications();
    expect(ai.scoreResume).toHaveBeenCalledWith(RESUME, '<p>CCNA</p>');
    expect(saved(prisma)).toEqual([{ isAiScored: true, aiScore: 72, aiSummary: '{"score":72}' }]);
  });

  it('records an unreadable resume with no score, so no "% Match" is shown', async () => {
    const { cron, prisma, pdf } = make();
    pdf.extractTextFromUrl.mockRejectedValue(new ResumeUnreadableError('the PDF has no readable text (probably a scanned image)'));
    await cron.processUnscoredApplications();
    const [data] = saved(prisma);
    expect(data).toMatchObject({ isAiScored: true, aiScore: null });
    expect(JSON.parse(data.aiSummary)).toMatchObject({ score: null, strengths: expect.stringMatching(/could not be read/) });
  });

  it('leaves a failed AI call unscored for the next run, and sets it aside after three', async () => {
    const { cron, prisma, ai } = make();
    ai.scoreResume.mockRejectedValue(new Error('AI scoring failed: Groq API returned status 429'));

    await cron.processUnscoredApplications();
    await cron.processUnscoredApplications();
    expect(prisma.jobApplication.update).not.toHaveBeenCalled();

    await cron.processUnscoredApplications();
    const [data] = saved(prisma);
    expect(data).toMatchObject({ isAiScored: true, aiScore: null });
    expect(JSON.parse(data.aiSummary).strengths).toMatch(/failed 3 times/);
  });

  it('gives no score when the job has no description', async () => {
    const { cron, prisma } = make([{ ...app, job: { title: 'X', descriptionHtml: null } }]);
    await cron.processUnscoredApplications();
    expect(saved(prisma)[0]).toMatchObject({ isAiScored: true, aiScore: null });
  });

  it('takes the newest applications first', async () => {
    const { cron, prisma } = make();
    await cron.processUnscoredApplications();
    expect(prisma.jobApplication.findMany.mock.calls[0][0].orderBy).toEqual({ id: 'desc' });
  });
});
