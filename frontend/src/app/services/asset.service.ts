import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Asset {
  id: number;
  assetTag: string;
  name: string;
  category: string;
  quantity?: number;
  brand?: string;
  model?: string;
  serialNumber?: string;
  purchaseDate?: string;
  cost?: number;
  warrantyExpiry?: string;
  images?: string[];
  location?: string;
  notes?: string;
  tags?: string[];
  status: string;
  ram?: string;
  storage?: string;
  processor?: string;
  assignments?: AssetAssignment[];
  createdAt: string;
}

export interface AssetAssignment {
  id: number;
  assetId: number;
  asset?: Asset;
  employeeId: number;
  employee?: {
    id: number;
    firstName: string;
    lastName: string;
    department?: { name: string };
    designation?: { name: string };
  };
  assignedDate: string;
  returnDate?: string;
  conditionOnAssign?: string;
  conditionOnReturn?: string;
  notes?: string;
  status: 'ACTIVE' | 'RETURNED';
  createdAt: string;
}

export interface HardwareRequest {
  id: number;
  employeeId: number;
  employee?: {
    id: number;
    firstName: string;
    lastName: string;
    department?: { name: string };
    designation?: { name: string };
  };
  requestType: 'NEW_DEVICE' | 'REPLACEMENT' | 'REPAIR' | 'PERIPHERAL';
  category: string;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH';
  reason: string;
  images?: string | string[];
  status: 'PENDING' | 'APPROVED' | 'FULFILLED' | 'REJECTED';
  rejectionReason?: string;
  fulfilledAssetId?: number;
  fulfilledAsset?: Asset;
  approvedBy?: {
    employee?: {
      firstName: string;
      lastName: string;
    };
  };
  createdAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class AssetService {
  private apiUrl = `${environment.apiUrl}/assets`;

  constructor(private http: HttpClient) {}

  // 1. Asset Inventory
  getAllAssets(): Observable<Asset[]> {
    return this.http.get<Asset[]>(this.apiUrl);
  }

  createAsset(data: Partial<Asset>): Observable<Asset> {
    return this.http.post<Asset>(this.apiUrl, data);
  }

  updateAsset(id: number, data: Partial<Asset>): Observable<Asset> {
    return this.http.put<Asset>(`${this.apiUrl}/${id}`, data);
  }

  deleteAsset(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/${id}`);
  }

  getCategories(): Observable<string[]> {
    return this.http.get<string[]>(`${this.apiUrl}/categories`);
  }

  // 2. Assignments
  getAssignments(): Observable<AssetAssignment[]> {
    return this.http.get<AssetAssignment[]>(`${this.apiUrl}/assignments`);
  }

  assignAsset(data: { assetId: number; employeeId: number; assignedDate?: string; conditionOnAssign?: string; notes?: string }): Observable<AssetAssignment> {
    return this.http.post<AssetAssignment>(`${this.apiUrl}/assign`, data);
  }

  returnAsset(id: number, data: { returnDate?: string; conditionOnReturn?: string; assetNextStatus?: string; notes?: string }): Observable<AssetAssignment> {
    return this.http.put<AssetAssignment>(`${this.apiUrl}/assignments/${id}/return`, data);
  }

  // 3. Hardware Requests
  getHardwareRequests(): Observable<HardwareRequest[]> {
    return this.http.get<HardwareRequest[]>(`${this.apiUrl}/requests`);
  }

  createHardwareRequest(data: { requestType: string; category: string; urgency: string; reason: string; images?: string[] }): Observable<HardwareRequest> {
    return this.http.post<HardwareRequest>(`${this.apiUrl}/requests`, data);
  }

  updateHardwareRequest(id: number, data: { requestType?: string; category?: string; urgency?: string; reason?: string; images?: string[] }): Observable<HardwareRequest> {
    return this.http.put<HardwareRequest>(`${this.apiUrl}/requests/${id}`, data);
  }

  cancelHardwareRequest(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/requests/${id}`);
  }

  updateHardwareRequestStatus(id: number, data: { status: string; rejectionReason?: string; fulfilledAssetId?: number }): Observable<HardwareRequest> {
    return this.http.put<HardwareRequest>(`${this.apiUrl}/requests/${id}/status`, data);
  }
}
