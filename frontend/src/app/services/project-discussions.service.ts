import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface ProjectDiscussion {
  id: number;
  title: string;
  content: string;
  authorId: number;
  author: any;
  comments?: ProjectDiscussionComment[];
  attachments?: ProjectDiscussionAttachment[];
  _count?: { comments: number };
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDiscussionComment {
  id: number;
  content: string;
  discussionId: number;
  authorId: number;
  author: any;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDiscussionAttachment {
  id: number;
  fileName: string;
  fileUrl: string;
  fileSize?: number;
  discussionId: number;
  uploadedById: number;
  uploadedBy: any;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class ProjectDiscussionsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/projects`;

  list(projectId: number) {
    return this.http.get<ProjectDiscussion[]>(`${this.apiUrl}/${projectId}/discussions`);
  }

  get(projectId: number, id: number) {
    return this.http.get<ProjectDiscussion>(`${this.apiUrl}/${projectId}/discussions/${id}`);
  }

  create(projectId: number, payload: { title: string; content: string; mentionedUserIds?: number[] }) {
    return this.http.post<ProjectDiscussion>(`${this.apiUrl}/${projectId}/discussions`, payload);
  }

  delete(projectId: number, id: number) {
    return this.http.delete<any>(`${this.apiUrl}/${projectId}/discussions/${id}`);
  }

  addComment(projectId: number, id: number, payload: { content: string; mentionedUserIds?: number[] }) {
    return this.http.post<ProjectDiscussionComment>(`${this.apiUrl}/${projectId}/discussions/${id}/comments`, payload);
  }

  deleteComment(projectId: number, id: number, commentId: number) {
    return this.http.delete<any>(`${this.apiUrl}/${projectId}/discussions/${id}/comments/${commentId}`);
  }

  uploadAttachment(projectId: number, id: number, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<ProjectDiscussionAttachment>(`${this.apiUrl}/${projectId}/discussions/${id}/attachments/upload`, formData);
  }

  addLinkAttachment(projectId: number, id: number, url: string, name?: string) {
    return this.http.post<ProjectDiscussionAttachment>(`${this.apiUrl}/${projectId}/discussions/${id}/attachments/link`, { url, name });
  }

  deleteAttachment(projectId: number, id: number, attachmentId: number) {
    return this.http.delete<any>(`${this.apiUrl}/${projectId}/discussions/${id}/attachments/${attachmentId}`);
  }
}
