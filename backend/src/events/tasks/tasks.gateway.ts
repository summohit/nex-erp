import { 
  WebSocketGateway, 
  WebSocketServer, 
  SubscribeMessage, 
  OnGatewayConnection, 
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';

@WebSocketGateway({ 
  cors: { origin: '*' },
  namespace: '/tasks'
})
export class TasksGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    // Optional: Authenticate connection using token in handshake
    const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.split(' ')[1];
    if (token) {
      try {
        // The same fallback every other verifier uses. This one said
        // 'super-secret-key-change-in-production', and with JWT_SECRET unset
        // both sides fell back to different strings -- so every socket
        // connection failed signature verification and the logs filled with
        // "Socket authentication failed: invalid signature".
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super-secret');
        client.data.user = decoded;
      } catch (err) {
        // Just log or disconnect
        console.error('Socket authentication failed:', err.message);
      }
    }
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinIssue')
  handleJoinIssue(@ConnectedSocket() client: Socket, @MessageBody() issueId: number) {
    if (issueId) {
      const roomName = `issue_${issueId}`;
      client.join(roomName);
      console.log(`Client ${client.id} joined room ${roomName}`);
      return { event: 'joined', room: roomName };
    }
  }

  @SubscribeMessage('leaveIssue')
  handleLeaveIssue(@ConnectedSocket() client: Socket, @MessageBody() issueId: number) {
    if (issueId) {
      const roomName = `issue_${issueId}`;
      client.leave(roomName);
      console.log(`Client ${client.id} left room ${roomName}`);
    }
  }

  @SubscribeMessage('joinProject')
  handleJoinProject(@ConnectedSocket() client: Socket, @MessageBody() projectId: number) {
    if (projectId) {
      const roomName = `project_${projectId}`;
      client.join(roomName);
      console.log(`Client ${client.id} joined room ${roomName}`);
    }
  }

  @SubscribeMessage('leaveProject')
  handleLeaveProject(@ConnectedSocket() client: Socket, @MessageBody() projectId: number) {
    if (projectId) {
      const roomName = `project_${projectId}`;
      client.leave(roomName);
      console.log(`Client ${client.id} left room ${roomName}`);
    }
  }

  // --- Utility methods to emit events from Services ---
  
  emitIssueUpdated(issueId: number, projectId: number, data: any) {
    this.server.to(`issue_${issueId}`).emit('issue_updated', data);
    this.server.to(`project_${projectId}`).emit('issue_updated', data);
  }

  emitCommentAdded(issueId: number, comment: any) {
    this.server.to(`issue_${issueId}`).emit('comment_added', comment);
  }

  emitActivityAdded(issueId: number, activity: any) {
    this.server.to(`issue_${issueId}`).emit('activity_added', activity);
  }
}
