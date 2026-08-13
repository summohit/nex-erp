import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { LucideShoppingCart, LucideCalendar, LucideDollarSign, LucidePackage } from '@lucide/angular';

interface SalesOrder {
  id: number;
  orderNumber: string;
  client: { name: string };
  date: string;
  total: number;
  currency: string;
  status: string;
}

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CommonModule, LucideShoppingCart, LucideCalendar, LucideDollarSign, LucidePackage],
  templateUrl: './orders.html',
  styleUrls: ['./orders.css']
})
export class OrdersComponent implements OnInit {
  orders: SalesOrder[] = [];



  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadOrders();
  }

  loadOrders() {
    this.http.get<SalesOrder[]>(`${environment.apiUrl}/sales/orders`).subscribe(data => {
      this.orders = data;
    });
  }
}
