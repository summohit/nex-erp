import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideArrowLeft, LucideBox, LucideTag, LucideLayers, LucideTruck, LucidePlus } from '@lucide/angular';
import { AssetService, InventoryItem } from '../../services/asset.service';

@Component({
  selector: 'app-inventory-setup',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideArrowLeft, LucideBox, LucideTag, LucideLayers, LucideTruck, LucidePlus],
  templateUrl: './inventory-setup.html',
  styleUrls: ['./inventory-setup.css'],
})
export class InventorySetupComponent {
  private assets = inject(AssetService);
  private router = inject(Router);
  readonly loading = signal(true);
  readonly values = signal<Record<string, string[]>>({ category: [], brand: [], subcategory: [], vendor: [] });
  readonly adding = signal<string | null>(null);
  readonly draft = signal('');

  readonly cards = [
    { key: 'category', title: 'Categories', description: 'Organize inventory by its primary classification.', icon: 'category', action: 'Add category' },
    { key: 'brand', title: 'Brands', description: 'Keep product brands consistent across inventory.', icon: 'brand', action: 'Add brand' },
    { key: 'subcategory', title: 'Subcategories', description: 'Add more detail under your inventory categories.', icon: 'subcategory', action: 'Add subcategory' },
    { key: 'vendor', title: 'Vendors', description: 'Maintain the suppliers you purchase inventory from.', icon: 'vendor', action: 'Add vendor' },
  ];

  constructor() {
    this.assets.getInventoryItems().subscribe({
      next: items => this.values.set(this.collect(items)),
      complete: () => this.loading.set(false),
      error: () => this.loading.set(false),
    });
  }

  private collect(items: InventoryItem[]) {
    const unique = (list: (string | null | undefined)[]) => [...new Set(list.map(x => String(x || '').trim()).filter(Boolean))].sort();
    const subcategories = items.map(item => {
      try { return JSON.parse(item.notes || '{}')?.purchase?.subcategory || ''; } catch { return ''; }
    });
    return { category: unique(items.map(x => x.category)), brand: unique(items.map(x => x.brand)), subcategory: unique(subcategories), vendor: unique(items.map(x => x.supplier)) };
  }

  openAdd(key: string) { this.adding.set(key); this.draft.set(''); }
  cancelAdd() { this.adding.set(null); this.draft.set(''); }
  add(key: string) {
    const value = this.draft().trim();
    if (!value) return;
    this.values.update(values => ({ ...values, [key]: [...new Set([...values[key], value])].sort() }));
    this.cancelAdd();
  }
  back() { this.router.navigateByUrl('/assets/inventory'); }
}
