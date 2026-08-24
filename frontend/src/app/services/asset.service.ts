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

export interface InventoryItem {
  id: number;
  name: string;
  brand?: string;
  category: string;
  itemType: 'ASSET' | 'CONSUMABLE';
  unit: string;
  quantity: number;
  unitCost: number;
  purchaseDate?: string;
  supplier?: string;
  batchNumber?: string;
  expiryDate?: string;
  location?: string;
  model?: string;
  serialNumber?: string;
  warrantyExpiry?: string;
  notes?: string;
  status: 'ACTIVE' | 'IN_REPAIR' | 'RETIRED';
  // Derived server-side from the transaction ledger
  grossAssigned: number;
  netAssigned: number;
  returned: number;
  consumed: number;
  expired: number;
  available: number;
  totalValue: number;
  statusLabel: string;
  lowStock: boolean;
  expiringSoon: boolean;
  createdAt: string;
}

export interface InventoryTransaction {
  id: number;
  itemId: number;
  type: 'PURCHASE' | 'ASSIGNMENT' | 'RETURN' | 'CONSUMPTION' | 'EXPIRED' | 'ADJUSTMENT';
  quantity: number;
  date: string;
  employeeId?: number;
  employee?: { id: number; firstName: string; lastName: string };
  assigneeText?: string;
  expectedReturnDate?: string;
  parentTransactionId?: number;
  linkedReturns?: { id: number; quantity: number; date?: string; conditionOnReturn?: string; notes?: string }[];
  purpose?: string;
  conditionOnReturn?: string;
  reason?: string;
  createdById?: number;
  createdBy?: { id: number; email: string; role: string };
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
  }  createHardwareRequest(data: { requestType: string; category: string; urgency: string; reason: string; images?: string[] }): Observable<HardwareRequest> {
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

  // 4. Product/Batch Inventory
  getInventoryItems(): Observable<InventoryItem[]> {
    return this.http.get<InventoryItem[]>(`${this.apiUrl}/inventory`);
  }

  getInventoryAssignments(): Observable<InventoryTransaction[]> {
    return this.http.get<InventoryTransaction[]>(`${this.apiUrl}/inventory/assignments`);
  }

  createInventoryItem(data: any): Observable<InventoryItem> {
    return this.http.post<InventoryItem>(`${this.apiUrl}/inventory`, data);
  }

  importInventoryItems(rows: any[]): Observable<{ created: number; failed: number; errors: any[] }> {
    return this.http.post<{ created: number; failed: number; errors: any[] }>(`${this.apiUrl}/inventory/import`, { rows });
  }

  updateInventoryItem(id: number, data: any): Observable<InventoryItem> {
    return this.http.put<InventoryItem>(`${this.apiUrl}/inventory/${id}`, data);
  }

  setInventoryItemStatus(id: number, status: string): Observable<InventoryItem> {
    return this.http.put<InventoryItem>(`${this.apiUrl}/inventory/${id}/status`, { status });
  }

  deleteInventoryItem(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/inventory/${id}`);
  }

  getInventoryTransactions(itemId: number): Observable<InventoryTransaction[]> {
    return this.http.get<InventoryTransaction[]>(`${this.apiUrl}/inventory/${itemId}/transactions`);
  }

  assignInventoryItem(itemId: number, data: {
    quantity: number; employeeId?: number; assigneeText?: string;
    date?: string; expectedReturnDate?: string; purpose?: string;
  }): Observable<InventoryTransaction> {
    return this.http.post<InventoryTransaction>(`${this.apiUrl}/inventory/${itemId}/assign`, data);
  }

  returnInventoryUnits(txnId: number, data: {
    quantity: number; returnDate?: string; conditionOnReturn?: string; notes?: string;
  }): Observable<InventoryTransaction> {
    return this.http.put<InventoryTransaction>(`${this.apiUrl}/inventory/transactions/${txnId}/return`, data);
  }

  consumeInventoryItem(itemId: number, data: {
    quantity: number; date?: string; location?: string; purpose?: string;
  }): Observable<InventoryTransaction> {
    return this.http.post<InventoryTransaction>(`${this.apiUrl}/inventory/${itemId}/consume`, data);
  }

  expireInventoryItem(itemId: number, data: {
    quantity: number; date?: string; reason?: string;
  }): Observable<InventoryTransaction> {
    return this.http.post<InventoryTransaction>(`${this.apiUrl}/inventory/${itemId}/expire`, data);
  }

  adjustInventoryStock(itemId: number, data: {
    delta: number; date?: string; reason?: string;
  }): Observable<InventoryTransaction> {
    return this.http.post<InventoryTransaction>(`${this.apiUrl}/inventory/${itemId}/adjust`, data);
  }
}
