import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/ws/notifications',
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(private jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.query?.token;
      if (!token) {
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET || 'super-secret',
      });

      const userId = payload.sub;
      const companyId = payload.companyId;

      client.data = { userId, companyId };
      client.join(`user_${userId}`);
      client.join(`company_${companyId}`);

      this.logger.log(`WebSocket Connected: User ${userId} (Company ${companyId})`);
    } catch (err) {
      this.logger.warn(`WebSocket connection unauthorized: ${err.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`WebSocket Disconnected: Client ${client.id}`);
  }

  sendToUser(userId: number, payload: any) {
    if (this.server) {
      this.server.to(`user_${userId}`).emit('notification', payload);
    }
  }

  sendToCompany(companyId: number, payload: any) {
    if (this.server) {
      this.server.to(`company_${companyId}`).emit('notification', payload);
    }
  }
}
