import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import {
  LucideShoppingCart, LucidePlus, LucideTrash2, LucideCreditCard,
  LucidePackage, LucideUser, LucidePercent, LucideFileText,
  LucideIndianRupee, LucideX, LucideCheck, LucideChevronDown,
  LucideCircleMinus, LucideCirclePlus, LucideTag
} from '@lucide/angular';
import { DialogHostComponent } from '../../shared/components/dialog-host/dialog-host.component';
import { DialogService } from '../../shared/services/dialog.service';

interface CartItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discount: number;
  total: number;
}

@Component({
  selector: 'app-pos',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucideShoppingCart, LucidePlus, LucideTrash2, LucideCreditCard,
    LucidePackage, LucideUser, LucidePercent, LucideFileText,
    LucideIndianRupee, LucideX, LucideCheck, LucideChevronDown,
    LucideCircleMinus, LucideCirclePlus, LucideTag, DialogHostComponent
  ],
  templateUrl: './pos.html',
  styleUrls: ['./pos.css']
})
export class PosComponent implements OnInit {
  private dialog = inject(DialogService);
  clients: any[] = [];
  selectedClientId: number | null = null;

  cart: CartItem[] = [];

  newItem = {
    description: '',
    quantity: 1,
    unit: 'number',
    unitPrice: 0,
    discount: 0
  };

  orderNotes = '';
  paymentMethod = 'CASH';
  taxRate = 18;
  isCheckingOut = false;
  checkoutSuccess = false;

  readonly unitOptions = ['number', 'meter', 'roll', 'bunch', 'bundle', 'kg', 'litre', 'box', 'piece', 'hour', 'day'];
  readonly paymentMethods = [
    { value: 'CASH', label: 'Cash' },
    { value: 'CARD', label: 'Card' },
    { value: 'UPI', label: 'UPI' },
    { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
    { value: 'CHEQUE', label: 'Cheque' }
  ];

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadClients();
  }

  loadClients() {
    this.http.get<any[]>(`${environment.apiUrl}/v1/clients?status=ACTIVE`).subscribe(data => {
      this.clients = data;
    });
  }

  addToCart() {
    if (!this.newItem.description.trim() || this.newItem.quantity <= 0 || this.newItem.unitPrice <= 0) return;

    const lineTotal = this.newItem.quantity * this.newItem.unitPrice;
    const discountAmt = lineTotal * (this.newItem.discount / 100);

    this.cart.push({
      description: this.newItem.description.trim(),
      quantity: this.newItem.quantity,
      unit: this.newItem.unit,
      unitPrice: this.newItem.unitPrice,
      discount: this.newItem.discount,
      total: lineTotal - discountAmt
    });

    this.newItem = { description: '', quantity: 1, unit: 'number', unitPrice: 0, discount: 0 };
  }

  updateCartItem(index: number) {
    const item = this.cart[index];
    const lineTotal = item.quantity * item.unitPrice;
    item.total = lineTotal - (lineTotal * (item.discount / 100));
  }

  removeFromCart(index: number) {
    this.cart.splice(index, 1);
  }

  incrementQty(index: number) {
    this.cart[index].quantity++;
    this.updateCartItem(index);
  }

  decrementQty(index: number) {
    if (this.cart[index].quantity > 1) {
      this.cart[index].quantity--;
      this.updateCartItem(index);
    }
  }

  getSubtotal() {
    return this.cart.reduce((sum, item) => sum + item.total, 0);
  }

  getTax() {
    return this.getSubtotal() * (this.taxRate / 100);
  }

  getTotal() {
    return this.getSubtotal() + this.getTax();
  }

  getItemCount() {
    return this.cart.reduce((sum, item) => sum + item.quantity, 0);
  }

  async clearCart() {
    if (this.cart.length === 0) return;
    const ok = await this.dialog.confirm('Clear all items from the cart?', 'Clear Cart', 'Clear');
    if (ok) {
      this.cart = [];
    }
  }

  checkout() {
    if (this.cart.length === 0 || !this.selectedClientId || this.isCheckingOut) return;

    this.isCheckingOut = true;

    const payload = {
      clientId: this.selectedClientId,
      currency: 'INR',
      taxRate: this.taxRate,
      paymentMethod: this.paymentMethod,
      notes: this.orderNotes,
      items: this.cart.map(c => ({
        description: c.description,
        quantity: c.quantity,
        unit: c.unit,
        unitPrice: c.unitPrice,
        discount: c.discount
      }))
    };

    this.http.post(`${environment.apiUrl}/sales/pos/checkout`, payload).subscribe({
      next: () => {
        this.isCheckingOut = false;
        this.checkoutSuccess = true;
        setTimeout(() => {
          this.checkoutSuccess = false;
          this.cart = [];
          this.selectedClientId = null;
          this.orderNotes = '';
          this.taxRate = 18;
          this.paymentMethod = 'CASH';
        }, 2000);
      },
      error: (err) => {
        this.isCheckingOut = false;
        this.dialog.error(err?.error?.message || 'Checkout failed. Please try again.');
      }
    });
  }
}
