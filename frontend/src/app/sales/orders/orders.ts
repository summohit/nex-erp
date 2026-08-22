import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { FormsModule } from '@angular/forms';
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
  orders: SalesOrder[] = [];
  selectedOrder: SalesOrder | null = null;
  showViewModal = false;

  constructor(private http: HttpClient) {}

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
