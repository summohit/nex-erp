import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class SocketService {
  private socket!: Socket;
  public isConnected = new BehaviorSubject<boolean>(false);

  constructor(private authService: AuthService) {
    this.connect();
  }

  connect() {
    const token = this.authService.getToken();
    if (!token) return;

    this.socket = io(`${environment.apiUrl.replace('/api', '')}/tasks`, {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    this.socket.on('connect', () => {
      console.log('Socket connected:', this.socket.id);
      this.isConnected.next(true);
    });

    this.socket.on('disconnect', () => {
      console.log('Socket disconnected');
      this.isConnected.next(false);
    });
  }

  joinIssue(issueId: number) {
    if (this.socket) {
      this.socket.emit('joinIssue', issueId);
    }
  }

  leaveIssue(issueId: number) {
    if (this.socket) {
      this.socket.emit('leaveIssue', issueId);
    }
  }

  joinProject(projectId: number) {
    if (this.socket) {
      this.socket.emit('joinProject', projectId);
    }
  }

  leaveProject(projectId: number) {
    if (this.socket) {
      this.socket.emit('leaveProject', projectId);
    }
  }

  onCommentAdded(): Observable<any> {
    return new Observable(observer => {
      if (this.socket) {
        this.socket.on('comment_added', (data) => observer.next(data));
      }
    });
  }

  onActivityAdded(): Observable<any> {
    return new Observable(observer => {
      if (this.socket) {
        this.socket.on('activity_added', (data) => observer.next(data));
      }
    });
  }

  onIssueUpdated(): Observable<any> {
    return new Observable(observer => {
      if (this.socket) {
        this.socket.on('issue_updated', (data) => observer.next(data));
      }
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}
