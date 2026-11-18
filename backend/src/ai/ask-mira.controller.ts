import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AskMiraService } from './ask-mira.service';

/** Ask MIRA — Super Admin only (checked in the service). */
@Controller('ai/ask-mira')
@UseGuards(AuthGuard)
export class AskMiraController {
  constructor(private readonly mira: AskMiraService) {}

  @Get('briefing')
  briefing(@Request() req) {
    return this.mira.briefing(req.user);
  }

  @Post('chat')
  chat(@Request() req, @Body() body: { messages: { role: 'user' | 'assistant'; content: string }[] }) {
    const messages = (body?.messages ?? []).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
    return this.mira.ask(req.user, messages);
  }
}
