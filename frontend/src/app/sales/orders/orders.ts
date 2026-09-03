import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import { LucideShoppingCart, LucideCalendar, LucidePackage, LucideIndianRupee } from '@lucide/angular';

interface SalesOrderItem {
  id: number;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface SalesOrder {
  id: number;
  orderNumber: string;
  client: { name: string };
  date: string;
  total: number;
  currency: string;
  status: string;
  isRental?: boolean;
  rentalStatus?: string | null;
  rentalEndDate?: string | null;
  items?: SalesOrderItem[];
}

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideShoppingCart, LucideCalendar, LucidePackage, LucideIndianRupee],
  templateUrl: './orders.html',
  styleUrls: ['./orders.css']
})
export class OrdersComponent implements OnInit {
  /** Mirrors the server's transition rules so the UI only offers valid moves. */
  private readonly statusFlow: Record<string, string[]> = {
    DRAFT: ['CONFIRMED', 'CANCELLED'],
    PENDING_APPROVAL: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['DELIVERED', 'CANCELLED'],
    DELIVERED: [],
    CANCELLED: [],
  };

  updatingId: number | null = null;

  nextStatuses(order: SalesOrder): string[] {
    return this.statusFlow[order.status] ?? [];
  }

  setStatus(order: SalesOrder, status: string, event?: Event) {
    event?.stopPropagation();
    if (status === 'CANCELLED' &&
        !confirm(`Cancel order ${order.orderNumber}? This cannot be undone.`)) return;

    this.updatingId = order.id;
    this.http.patch<SalesOrder>(
      `${environment.apiUrl}/sales/orders/${order.id}/status`, { status }
    ).subscribe({
      next: (updated) => {
        Object.assign(order, updated);
        if (this.selectedOrder?.id === order.id) Object.assign(this.selectedOrder, updated);
        this.updatingId = null;
        this.toast.success(`Order marked ${status.toLowerCase()}`);
      },
      error: (err) => {
        this.updatingId = null;
        this.toast.error(err?.error?.message || 'Could not update the order.');
      },
    });
  }

  returnRental(order: SalesOrder, event?: Event) {
    event?.stopPropagation();
    this.updatingId = order.id;
    this.http.patch<SalesOrder>(
      `${environment.apiUrl}/sales/orders/${order.id}/return`, {}
    ).subscribe({
      next: (updated) => {
        Object.assign(order, updated);
        this.updatingId = null;
        this.toast.success('Rental marked returned');
      },
      error: (err) => {
        this.updatingId = null;
        this.toast.error(err?.error?.message || 'Could not mark the rental returned.');
      },
    });
  }

  orders: SalesOrder[] = [];
  selectedOrder: SalesOrder | null = null;
  showViewModal = false;

  constructor(private http: HttpClient, private toast: HotToastService) {}

  ngOnInit() {
    this.loadOrders();
  }

  loadOrders() {
    this.http.get<SalesOrder[]>(`${environment.apiUrl}/sales/orders`).subscribe(data => {
      this.orders = data;
    });
  }

  viewOrder(order: SalesOrder) {
    this.selectedOrder = order;
    this.showViewModal = true;
  }

  closeViewModal() {
    this.showViewModal = false;
    this.selectedOrder = null;
  }

  getItemsSubtotal(order: SalesOrder): number {
    return (order.items || []).reduce((s, i) => s + i.total, 0);
  }
}
