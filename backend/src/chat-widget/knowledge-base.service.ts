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
   * Keyword search ranked by where the terms hit (title > tags > body). The
   * article count per company is small, so scoring in memory is simpler and
   * good enough — no full-text index to maintain.
   */
  async search(companyId: number, query: string, limit = 5) {
    const terms = searchTerms(query);
    if (!terms.length) return [];
    const candidates = await this.prisma.knowledgeBaseArticle.findMany({
      where: {
        isPublished: true,
        category: { companyId, isPublic: true },
        OR: terms.flatMap((t) => [
          { title: { contains: t, mode: 'insensitive' as const } },
          { content: { contains: t, mode: 'insensitive' as const } },
          { tags: { has: t } },
        ]),
      },
      select: { id: true, title: true, excerpt: true, content: true, tags: true, category: { select: { name: true } } },
      take: 50,
    });
    return candidates
      .map((a) => {
        const title = a.title.toLowerCase();
        const body = a.content.toLowerCase();
        const tags = a.tags.map((t) => t.toLowerCase());
        let score = 0;
        for (const t of terms) {
          if (title.includes(t)) score += 5;
          if (tags.includes(t)) score += 4;
          if (body.includes(t)) score += 1 + Math.min(3, body.split(t).length - 2);
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
