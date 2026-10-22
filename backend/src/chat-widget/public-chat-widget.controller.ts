import { Body, Controller, Get, Header, Headers, Param, ParseIntPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard, seconds } from '@nestjs/throttler';
import type { Response } from 'express';
import * as fs from 'fs';
import { join } from 'path';
import { ChatWidgetService } from './chat-widget.service';
import { KnowledgeBaseService } from './knowledge-base.service';

/** The site embedding the widget: Origin for cross-site calls, Referer otherwise. */
function originHost(origin?: string, referer?: string): string | null {
  for (const v of [origin, referer]) {
    if (!v || v === 'null') continue;
    try {
      return new URL(v).hostname;
    } catch { /* try the next one */ }
  }
  return null;
}

// PUBLIC endpoints — deliberately NO AuthGuard. Called by embed.js from the
// careers page and from external sites; CORS for this prefix is opened in main.ts.
@Controller('public/chat-widget')
export class PublicChatWidgetController {
  private embedJs: string | null = null;

  constructor(
    private readonly chat: ChatWidgetService,
    private readonly kb: KnowledgeBaseService,
  ) {}

  @Get('embed.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  embed(@Res() res: Response) {
    if (!this.embedJs || process.env.NODE_ENV !== 'production') {
      this.embedJs = fs.readFileSync(join(__dirname, 'embed', 'embed.js'), 'utf8');
    }
    res.send(this.embedJs);
  }

  @Get(':key/config')
  config(@Param('key') key: string, @Headers('origin') origin?: string, @Headers('referer') referer?: string) {
    return this.chat.publicConfig(key, originHost(origin, referer));
  }

  // ─── Knowledge base ───

  @Get(':key/kb/categories')
  async categories(@Param('key') key: string, @Headers('origin') origin?: string, @Headers('referer') referer?: string) {
    const w = await this.chat.resolveWidget(key, originHost(origin, referer));
    return this.kb.publicCategories(w.companyId);
  }

  @Get(':key/kb/search')
  async search(
    @Param('key') key: string,
    @Query('q') q: string,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
  ) {
    const w = await this.chat.resolveWidget(key, originHost(origin, referer));
    const hits = await this.kb.search(w.companyId, String(q || '').slice(0, 200), 8);
    return hits.map(({ id, title, excerpt, category }) => ({ id, title, excerpt, category: category.name }));
  }

  @Get(':key/kb/articles/:id')
  async article(
    @Param('key') key: string,
    @Param('id', ParseIntPipe) id: number,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
  ) {
    const w = await this.chat.resolveWidget(key, originHost(origin, referer));
    return this.kb.publicArticle(w.companyId, id);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: seconds(60), limit: 20 } })
  @Post(':key/kb/articles/:id/vote')
  async vote(
    @Param('key') key: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
  ) {
    const w = await this.chat.resolveWidget(key, originHost(origin, referer));
    return this.kb.vote(w.companyId, id, !!body?.helpful);
  }

  // ─── Conversations ───

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: seconds(60), limit: 20 } })
  @Post(':key/conversations')
  start(
    @Param('key') key: string,
    @Body() body: any,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
    @Headers('user-agent') ua?: string,
  ) {
    return this.chat.startConversation(key, originHost(origin, referer), body ?? {}, ua);
  }

  @Get(':key/conversations/:id/messages')
  poll(
    @Param('key') key: string,
    @Param('id', ParseIntPipe) id: number,
    @Query('visitorId') visitorId: string,
    @Query('after') after: string,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
  ) {
    return this.chat.pollMessages(key, originHost(origin, referer), id, String(visitorId || ''), Number(after) || 0);
  }

  // Each visitor message can cost a Groq call — keep a lid on it.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: seconds(60), limit: 15 } })
  @Post(':key/conversations/:id/messages')
  send(
    @Param('key') key: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
  ) {
    return this.chat.visitorMessage(key, originHost(origin, referer), id, body ?? {});
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: seconds(60), limit: 6 } })
  @Post(':key/conversations/:id/contact')
  contact(
    @Param('key') key: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
  ) {
    return this.chat.submitContact(key, originHost(origin, referer), id, body ?? {});
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: seconds(60), limit: 12 } })
  @Post(':key/conversations/:id/close')
  close(
    @Param('key') key: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
  ) {
    return this.chat.visitorCloseConversation(key, originHost(origin, referer), id, body ?? {});
  }
}
