import { apiClient } from './apiClient';

export interface TicketEmployee {
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  designation?: { name: string };
  department?: { id: number; name: string };
}

export interface TicketComment {
  id: number;
  body: string;
  authorId: number;
  author: TicketEmployee;
  createdAt: string;
  updatedAt: string;
}

export interface TicketActivity {
  id: number;
  action: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  actor: TicketEmployee;
  createdAt: string;
}

export interface TicketAttachment {
  id: number;
  fileName: string;
  fileUrl: string;
  fileSize?: number | null;
  createdAt: string;
}

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'REJECTED';
export type TicketPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type TicketType = 'BUG' | 'FEATURE_REQUEST' | 'IMPROVEMENT' | 'QUESTION';
export type TicketPlatform = 'WEB' | 'MOBILE' | 'BOTH';

export interface Ticket {
  id: number;
  ticketNumber: string;
  title: string;
  description?: string;
  type: TicketType;
  status: TicketStatus;
  priority: TicketPriority;
  platform: TicketPlatform;
  departmentId: number | null;
  department?: { id: number; name: string };
  raisedByDepartmentId?: number | null;
  raisedByDepartment?: { id: number; name: string };
  reporterId: number;
  reporter?: TicketEmployee;
  assigneeId?: number | null;
  assignee?: TicketEmployee;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  comments?: TicketComment[];
  activities?: TicketActivity[];
  attachments?: TicketAttachment[];
  _count?: { comments: number };
}

export interface TicketStats {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
}

/** Server-resolved capabilities — the JWT carries no department. */
export interface TicketPermissions {
  canManage: boolean;
  isDevTeam: boolean;
  isManagement: boolean;
  employeeId: number | null;
  departmentId: number | null;
  departmentName: string | null;
}

export interface NewTicketAttachment {
  fileName: string;
  fileUrl: string;
  fileSize?: number | null;
}

export const ticketService = {
  getTickets: async (filters: Record<string, any> = {}): Promise<Ticket[]> => {
    const params: Record<string, string> = {};
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params[k] = String(v);
    });
    const response = await apiClient.get('/tickets', { params });
    return response.data;
  },

  getStats: async (): Promise<TicketStats> => {
    const response = await apiClient.get('/tickets/stats');
    return response.data;
  },

  getMyPermissions: async (): Promise<TicketPermissions> => {
    const response = await apiClient.get('/tickets/my-permissions');
    return response.data;
  },

  getTicket: async (id: number): Promise<Ticket> => {
    const response = await apiClient.get(`/tickets/${id}`);
    return response.data;
  },

  createTicket: async (data: {
    title: string;
    description?: string;
    type: TicketType;
    priority: TicketPriority;
    platform: TicketPlatform;
    raisedByDepartmentId?: number | null;
    attachments?: NewTicketAttachment[];
  }): Promise<Ticket> => {
    const response = await apiClient.post('/tickets', data);
    return response.data;
  },

  updateTicket: async (id: number, data: Partial<Ticket>): Promise<Ticket> => {
    const response = await apiClient.patch(`/tickets/${id}`, data);
    return response.data;
  },

  /** Employees in the ticket's department — the only valid reassignment targets. */
  getAssignableMembers: async (id: number): Promise<TicketEmployee[]> => {
    const response = await apiClient.get(`/tickets/${id}/assignable-members`);
    return response.data;
  },

  addComment: async (id: number, body: string): Promise<TicketComment> => {
    const response = await apiClient.post(`/tickets/${id}/comments`, { body });
    return response.data;
  },

  /** Uploads one screenshot/document to ImageKit via the backend. */
  uploadAttachment: async (formData: FormData): Promise<{ url: string }> => {
    const response = await apiClient.post('/upload/ticket-attachment', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },
};
