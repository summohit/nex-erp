import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { KnowledgeBaseService } from './knowledge-base.service';

export type BotIntent = 'none' | 'sales' | 'support' | 'job' | 'human';

export interface BotReply {
  message: string;
  intent: BotIntent;
  articles: { id: number; title: string }[];
}

// Used when Groq is unavailable — a visitor saying "talk to a human" should
// still be routed even if the AI never answers.
const INTENT_PATTERNS: [BotIntent, RegExp][] = [
  ['human', /\b(human|agent|person|someone|representative|call me|talk to|speak to|real person)\b/i],
  ['sales', /\b(quote|quotation|pricing|price|cost|demo|proposal|buy|purchase|partner|tender|enquiry|inquiry)\b/i],
  ['job', /\b(apply|job|career|vacanc|opening|hiring|resume|cv|internship|interview)\b/i],
  ['support', /\b(issue|problem|error|not working|broken|bug|support|help desk|complaint)\b/i],
];

@Injectable()
export class ChatBotService {
  constructor(
    private prisma: PrismaService,
    private ai: AiService,
    private kb: KnowledgeBaseService,
  ) {}

  async reply(
    companyId: number,
    opts: { botName: string; companyName: string; source: string; useAi: boolean },
    history: { senderType: string; message: string }[],
    question: string,
  ): Promise<BotReply> {
    const articles = await this.kb.search(companyId, question, 4);
    const careerish = opts.source === 'CAREERS' || INTENT_PATTERNS[2][1].test(question);
    const jobs = careerish ? await this.openJobs(companyId) : [];

    if (opts.useAi) {
      const ai = await this.aiReply(opts, history, question, articles, jobs);
      if (ai) return ai;
    }
    return this.fallbackReply(question, articles, jobs);
  }

  private async aiReply(
    opts: { botName: string; companyName: string; source: string },
    history: { senderType: string; message: string }[],
    question: string,
    articles: { id: number; title: string; content: string }[],
    jobs: { id: number; title: string; summary: string }[],
  ): Promise<BotReply | null> {
    const kbBlock = articles.length
      ? articles.map((a) => `[Article ${a.id}] ${a.title}\n${a.content.slice(0, 1800)}`).join('\n\n---\n\n')
      : '(no matching articles)';
    const jobsBlock = jobs.length ? jobs.map((j) => `- [Job ${j.id}] ${j.title}: ${j.summary}`).join('\n') : '';

    const system = `You are ${opts.botName}, the website assistant for ${opts.companyName}.
The visitor is on the ${opts.source === 'CAREERS' ? 'careers page' : 'company website'}.
Answer ONLY from the knowledge base and job list below. If the answer is not there, say you are not sure and offer to connect them with the team — never invent facts, prices, dates or contact details.
Keep answers short (2-5 sentences), friendly and plain; markdown bold and bullet lists are allowed.

Classify the visitor's need as "intent":
- "sales": wants a quote, pricing, demo, proposal or to buy/partner
- "support": an existing client reporting a problem or needing technical help
- "job": wants to apply, asks about their application or wants to hear from HR
- "human": explicitly asks for a person/agent or is frustrated
- "none": anything else (general questions you can answer)

Reply as JSON: {"answer": string, "intent": "none"|"sales"|"support"|"job"|"human", "articleIds": number[] (articles you actually used)}

KNOWLEDGE BASE:
${kbBlock}
${jobsBlock ? `\nOPEN JOBS (apply on the careers page):\n${jobsBlock}` : ''}`;

    const convo = history.slice(-10).map((m) => ({
      role: (m.senderType === 'VISITOR' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.message,
    }));
    const raw = await this.ai.chatCompletion(
      [{ role: 'system', content: system }, ...convo, { role: 'user', content: question }],
      { json: true, temperature: 0.2 },
    );
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const answer = String(parsed.answer || '').trim();
      if (!answer) return null;
      const intent: BotIntent = ['sales', 'support', 'job', 'human'].includes(parsed.intent) ? parsed.intent : 'none';
      const used = new Set<number>((parsed.articleIds || []).map(Number));
      return {
        message: answer,
        intent,
        articles: articles.filter((a) => used.has(a.id)).map((a) => ({ id: a.id, title: a.title })),
      };
    } catch {
      return null;
    }
  }

  private fallbackReply(
    question: string,
    articles: { id: number; title: string; excerpt: string | null; content: string }[],
    jobs: { id: number; title: string }[],
  ): BotReply {
    const intent = INTENT_PATTERNS.find(([, re]) => re.test(question))?.[0] ?? 'none';
    if (articles.length) {
      const top = articles[0];
      const gist = (top.excerpt || top.content.replace(/[#*_>`]/g, '')).slice(0, 320).trim();
      // An article answered it — only escalate if they asked for a person outright.
      return {
        message: `Here's what I found in **${top.title}**:\n\n${gist}${gist.length >= 320 ? '…' : ''}`,
        intent: intent === 'human' ? 'human' : 'none',
        articles: articles.slice(0, 3).map((a) => ({ id: a.id, title: a.title })),
      };
    }
    if (intent === 'job' && jobs.length) {
      return {
        message: `We're currently hiring for:\n${jobs.slice(0, 6).map((j) => `- ${j.title}`).join('\n')}\n\nYou can apply directly on our careers page.`,
        intent,
        articles: [],
      };
    }
    return {
      message: "I'm not sure about that one. I can connect you with our team — they usually reply within business hours.",
      intent: intent === 'none' ? 'human' : intent,
      articles: [],
    };
  }

  private async openJobs(companyId: number) {
    const jobs = await this.prisma.job.findMany({
      where: { companyId, status: 'Open' },
      select: {
        id: true, title: true, type: true, workLocationType: true, experienceYears: true, requiredSkills: true,
        branch: { select: { name: true } },
        department: { select: { name: true } },
      },
      take: 25,
      orderBy: { createdAt: 'desc' },
    });
    return jobs.map((j) => ({
      id: j.id,
      title: j.title,
      summary: [
        j.department?.name,
        j.type,
        j.workLocationType,
        j.branch?.name,
        j.experienceYears ? `${j.experienceYears} yrs exp` : null,
        j.requiredSkills?.length ? `skills: ${j.requiredSkills.slice(0, 6).join(', ')}` : null,
      ].filter(Boolean).join(' · '),
    }));
  }
}
