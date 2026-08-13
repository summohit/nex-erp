import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { LucideShoppingCart, LucideSearch, LucidePlus, LucideTrash2, LucideCreditCard } from '@lucide/angular';

interface CartItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

@Component({
  selector: 'app-pos',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideShoppingCart, LucideSearch, LucidePlus, LucideTrash2, LucideCreditCard],
  templateUrl: './pos.html',
  styleUrls: ['./pos.css']
})
export class PosComponent implements OnInit {
  clients: any[] = [];
  selectedClientId: number | null = null;
  
  cart: CartItem[] = [];
  
  // Quick Add Item
  newItem = {
    description: '',
    quantity: 1,
    unitPrice: 0
  };



  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadClients();
  }

  loadClients() {
    this.http.get<any[]>(`${environment.apiUrl}/clients`).subscribe(data => {
      this.clients = data;
    });
  }

  addToCart() {
    if (!this.newItem.description || this.newItem.quantity <= 0 || this.newItem.unitPrice <= 0) return;
    
    this.cart.push({
      ...this.newItem,
      total: this.newItem.quantity * this.newItem.unitPrice
    });

    this.newItem = { description: '', quantity: 1, unitPrice: 0 };
  }

  removeFromCart(index: number) {
    this.cart.splice(index, 1);
  }

  getCartTotal() {
    return this.cart.reduce((sum, item) => sum + item.total, 0);
  }

  checkout() {
    if (this.cart.length === 0 || !this.selectedClientId) return;

    const payload = {
      clientId: this.selectedClientId,
      currency: 'USD',
      items: this.cart.map(c => ({
        description: c.description,
        quantity: c.quantity,
        unitPrice: c.unitPrice
      }))
    };

    this.http.post(`${environment.apiUrl}/sales/pos/checkout`, payload).subscribe(() => {
      alert('Checkout Successful! Order created.');
      this.cart = [];
      this.selectedClientId = null;
    }, err => {
      alert(err.error.message || 'Checkout failed');
    });
  }
}
