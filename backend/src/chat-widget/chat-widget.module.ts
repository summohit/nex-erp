import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { CrmModule } from '../crm/crm.module';
import { TicketsModule } from '../tickets/tickets.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AiModule } from '../ai/ai.module';
import { ChatWidgetController } from './chat-widget.controller';
import { PublicChatWidgetController } from './public-chat-widget.controller';
import { ChatWidgetService } from './chat-widget.service';
import { ChatBotService } from './chat-bot.service';
import { KnowledgeBaseService } from './knowledge-base.service';
import { WebsiteChatAccessGuard } from './website-chat-access.guard';

@Module({
  imports: [PrismaModule, PermissionsModule, CrmModule, TicketsModule, NotificationsModule, AiModule],
  controllers: [ChatWidgetController, PublicChatWidgetController],
  providers: [ChatWidgetService, ChatBotService, KnowledgeBaseService, WebsiteChatAccessGuard],
})
export class ChatWidgetModule {}
