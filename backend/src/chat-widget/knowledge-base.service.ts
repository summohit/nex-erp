import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export function slugify(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'i', 'you', 'we', 'me', 'my', 'your', 'to', 'of', 'in', 'on', 'for',
  'and', 'or', 'do', 'does', 'how', 'what', 'can', 'with', 'it', 'this', 'that', 'be', 'at', 'there', 'any',
  'about', 'please', 'hi', 'hello', 'hey', 'want', 'need', 'know', 'tell', 'have', 'has',
]);

export function searchTerms(query: string): string[] {
  return Array.from(
    new Set(
      (query || '')
        .toLowerCase()
        .split(/[^a-z0-9+#.]+/)
        .map((t) => t.replace(/^\.+|\.+$/g, ''))
        .filter((t) => t.length > 1 && !STOP_WORDS.has(t)),
    ),
  ).slice(0, 12);
}

/** Light stemmer so word forms compare equal: "pricing"/"prices"/"price" → "pric", "applied"/"applies" → "apply". */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length <= 3 || w.endsWith('ss')) return w;
  for (const [suffix, repl] of [['ies', 'y'], ['ied', 'y'], ['ing', ''], ['ed', ''], ['es', ''], ['s', '']] as const) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) {
      w = w.slice(0, -suffix.length) + repl;
      break;
    }
  }
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1); // "price" ↔ "pric(ing)"
  return w.replace(/(.)\1$/, '$1'); // "shipp(ing)" → "ship"
}

/** Groups of words visitors use interchangeably. Compared after stemming. */
const SYNONYM_GROUPS = [
  ['price', 'pricing', 'cost', 'rate', 'fee', 'charge', 'quote', 'quotation', 'budget', 'estimate'],
  ['job', 'career', 'vacancy', 'opening', 'position', 'role', 'hiring', 'recruitment'],
  ['apply', 'application', 'resume', 'cv'],
  ['salary', 'pay', 'compensation', 'ctc', 'package', 'stipend'],
  ['leave', 'holiday', 'vacation', 'pto', 'time-off'],
  ['contact', 'phone', 'email', 'call', 'reach', 'number'],
  ['location', 'address', 'office', 'branch', 'where'],
  ['support', 'help', 'issue', 'problem', 'error', 'bug', 'complaint'],
  ['login', 'signin', 'sign-in', 'password', 'account'],
  ['service', 'offering', 'solution', 'product'],
  ['time', 'timing', 'hour', 'schedule', 'when'],
  ['demo', 'trial', 'presentation'],
  ['refund', 'return', 'cancel', 'cancellation'],
  ['internship', 'intern', 'trainee', 'fresher'],
].map((g) => g.map(stem));

const SYNONYMS = new Map<string, Set<string>>();
for (const group of SYNONYM_GROUPS) {
  for (const w of group) {
    const set = SYNONYMS.get(w) ?? new Set<string>();
    group.forEach((x) => set.add(x));
    SYNONYMS.set(w, set);
  }
}

function expandTerm(term: string) {
  const s = stem(term);
  return { stem: s, variants: new Set([s, ...(SYNONYMS.get(s) ?? [])]) };
}

function wordList(text: string): string[] {
  return (text || '').toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length > 1).map(stem);
}

function wordStems(text: string): Set<string> {
  return new Set(wordList(text));
}

/** Typo tolerance: one edit for 4–6 letter words, two from 7 letters. Short words must match exactly. */
function closeEnough(a: string, b: string): boolean {
  if (a.length < 4 || b.length < 4) return false;
  const max = a.length >= 7 ? 2 : 1;
  if (Math.abs(a.length - b.length) > max) return false;
  if (b.startsWith(a) || a.startsWith(b)) return true;
  return editDistance(a, b, max) <= max;
}

/** Levenshtein distance, giving up early once it passes max. */
function editDistance(a: string, b: string, max: number): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

@Injectable()
export class KnowledgeBaseService {
  constructor(private prisma: PrismaService) {}

  // ─── Admin: categories ─────────────────────────────────────────────────────

  listCategories(companyId: number) {
    return this.prisma.knowledgeBaseCategory.findMany({
      where: { companyId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { articles: true } } },
    });
  }

  async createCategory(companyId: number, data: any) {
    if (!data?.name?.trim()) throw new BadRequestException('Category name is required.');
    const slug = await this.uniqueCategorySlug(companyId, slugify(data.slug || data.name));
    return this.prisma.knowledgeBaseCategory.create({
      data: {
        companyId,
        name: data.name.trim(),
        slug,
        description: data.description ?? null,
        icon: data.icon || 'help-circle',
        sortOrder: Number(data.sortOrder) || 0,
        isPublic: data.isPublic ?? true,
      },
    });
  }

  async updateCategory(companyId: number, id: number, data: any) {
    await this.findCategory(companyId, id);
    return this.prisma.knowledgeBaseCategory.update({
      where: { id },
      data: {
        name: data.name?.trim() || undefined,
        description: data.description,
        icon: data.icon,
        sortOrder: data.sortOrder != null ? Number(data.sortOrder) : undefined,
        isPublic: data.isPublic,
      },
    });
  }

  async deleteCategory(companyId: number, id: number) {
    await this.findCategory(companyId, id);
    await this.prisma.knowledgeBaseCategory.delete({ where: { id } });
    return { success: true };
  }

  // ─── Admin: articles ───────────────────────────────────────────────────────

  listArticles(companyId: number, categoryId?: number) {
    return this.prisma.knowledgeBaseArticle.findMany({
      where: { category: { companyId }, ...(categoryId ? { categoryId } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
      include: { category: { select: { id: true, name: true } } },
    });
  }

  async getArticle(companyId: number, id: number) {
    const article = await this.prisma.knowledgeBaseArticle.findFirst({
      where: { id, category: { companyId } },
      include: { category: { select: { id: true, name: true } } },
    });
    if (!article) throw new NotFoundException('Article not found');
    return article;
  }

  async createArticle(companyId: number, data: any) {
    if (!data?.title?.trim()) throw new BadRequestException('Title is required.');
    if (!data?.content?.trim()) throw new BadRequestException('Content is required.');
    const categoryId = Number(data.categoryId);
    await this.findCategory(companyId, categoryId);
    const slug = await this.uniqueArticleSlug(categoryId, slugify(data.slug || data.title));
    return this.prisma.knowledgeBaseArticle.create({
      data: {
        categoryId,
        title: data.title.trim(),
        slug,
        content: data.content,
        excerpt: data.excerpt || null,
        tags: this.normaliseTags(data.tags),
        isPublished: data.isPublished ?? true,
        sortOrder: Number(data.sortOrder) || 0,
      },
    });
  }

  async updateArticle(companyId: number, id: number, data: any) {
    const existing = await this.getArticle(companyId, id);
    let categoryId: number | undefined;
    if (data.categoryId && Number(data.categoryId) !== existing.categoryId) {
      categoryId = Number(data.categoryId);
      await this.findCategory(companyId, categoryId);
    }
    return this.prisma.knowledgeBaseArticle.update({
      where: { id },
      data: {
        categoryId,
        title: data.title?.trim() || undefined,
        content: data.content,
        excerpt: data.excerpt,
        tags: data.tags !== undefined ? this.normaliseTags(data.tags) : undefined,
        isPublished: data.isPublished,
        sortOrder: data.sortOrder != null ? Number(data.sortOrder) : undefined,
      },
    });
  }

  async deleteArticle(companyId: number, id: number) {
    await this.getArticle(companyId, id);
    await this.prisma.knowledgeBaseArticle.delete({ where: { id } });
    return { success: true };
  }

  // ─── Public ────────────────────────────────────────────────────────────────

  publicCategories(companyId: number) {
    return this.prisma.knowledgeBaseCategory.findMany({
      where: { companyId, isPublic: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true, name: true, slug: true, description: true, icon: true,
        articles: {
          where: { isPublished: true },
          orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
          select: { id: true, title: true, excerpt: true },
        },
      },
    });
  }

  async publicArticle(companyId: number, id: number) {
    const article = await this.prisma.knowledgeBaseArticle.findFirst({
      where: { id, isPublished: true, category: { companyId, isPublic: true } },
      select: {
        id: true, title: true, content: true, updatedAt: true, helpfulCount: true,
        category: { select: { id: true, name: true } },
      },
    });
    if (!article) throw new NotFoundException('Article not found');
    await this.prisma.knowledgeBaseArticle.update({ where: { id }, data: { views: { increment: 1 } } });
    return article;
  }

  async vote(companyId: number, id: number, helpful: boolean) {
    const article = await this.prisma.knowledgeBaseArticle.findFirst({
      where: { id, isPublished: true, category: { companyId, isPublic: true } },
      select: { id: true },
    });
    if (!article) throw new NotFoundException('Article not found');
    await this.prisma.knowledgeBaseArticle.update({
      where: { id },
      data: helpful ? { helpfulCount: { increment: 1 } } : { notHelpful: { increment: 1 } },
    });
    return { success: true };
  }

  /**
   * Search ranked by where the terms hit (title > tags > body), tolerant of
   * typos ("pricng"), word forms ("applying" ↔ "apply") and common synonyms
   * ("cost" ↔ "price"). The article count per company is small, so every
   * published article is scored in memory — no full-text index to maintain.
   */
  async search(companyId: number, query: string, limit = 5) {
    const terms = searchTerms(query);
    if (!terms.length) return [];
    const articles = await this.prisma.knowledgeBaseArticle.findMany({
      where: { isPublished: true, category: { companyId, isPublic: true } },
      select: { id: true, title: true, excerpt: true, content: true, tags: true, category: { select: { name: true } } },
      take: 500,
    });
    const queries = terms.map(expandTerm);
    return articles
      .map((a) => {
        const title = wordStems(a.title);
        const tags = new Set(a.tags.flatMap((t) => [...wordStems(t)]));
        const bodyWords = wordList(a.content);
        const body = new Map<string, number>();
        for (const w of bodyWords) body.set(w, (body.get(w) ?? 0) + 1);
        let score = 0;
        for (const q of queries) {
          // Best hit per query term, so one word can't score in every field variant.
          let best = 0;
          for (const v of q.variants) {
            const weight = v === q.stem ? 1 : 0.7; // a synonym counts a little less than the word itself
            if (title.has(v)) best = Math.max(best, 5 * weight);
            if (tags.has(v)) best = Math.max(best, 4 * weight);
            const n = body.get(v) ?? 0;
            if (n) best = Math.max(best, (1 + Math.min(3, n - 1)) * weight);
          }
          if (!best) {
            if ([...title].some((w) => closeEnough(q.stem, w))) best = 3;
            else if ([...tags].some((w) => closeEnough(q.stem, w))) best = 2.5;
            else if ([...body.keys()].some((w) => closeEnough(q.stem, w))) best = 0.75;
          }
          score += best;
        }
        return { ...a, score };
      })
      .filter((a) => a.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async findCategory(companyId: number, id: number) {
    const cat = await this.prisma.knowledgeBaseCategory.findFirst({ where: { id, companyId } });
    if (!cat) throw new NotFoundException('Category not found');
    return cat;
  }

  private normaliseTags(tags: any): string[] {
    const list = Array.isArray(tags) ? tags : String(tags || '').split(',');
    return Array.from(new Set(list.map((t) => String(t).trim().toLowerCase()).filter(Boolean)));
  }

  private async uniqueCategorySlug(companyId: number, base: string) {
    let slug = base;
    for (let i = 2; await this.prisma.knowledgeBaseCategory.findUnique({ where: { companyId_slug: { companyId, slug } } }); i++) {
      slug = `${base}-${i}`;
    }
    return slug;
  }

  private async uniqueArticleSlug(categoryId: number, base: string) {
    let slug = base;
    for (let i = 2; await this.prisma.knowledgeBaseArticle.findUnique({ where: { categoryId_slug: { categoryId, slug } } }); i++) {
      slug = `${base}-${i}`;
    }
    return slug;
  }
}
