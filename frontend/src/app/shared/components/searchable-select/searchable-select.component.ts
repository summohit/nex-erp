import { Component, Input, Output, EventEmitter, HostListener, ElementRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideChevronDown, LucideSearch, LucideX, LucideCheck, LucideLoader2 } from '@lucide/angular';

export interface SearchableSelectOption {
  id: any;
  name: string;
  subtitle?: string;
  badge?: string;
  badgeType?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  tag?: string;
  tagClass?: string;
  avatarUrl?: string;
  avatarText?: string;
  avatarColor?: string;
  icon?: string;
  meta?: string;
}

@Component({
  selector: 'app-searchable-select',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideChevronDown, LucideSearch, LucideX, LucideCheck, LucideLoader2],
  templateUrl: './searchable-select.component.html',
  styleUrls: ['./searchable-select.component.css']
})
export class SearchableSelectComponent {
  private elementRef = inject(ElementRef);

  @Input() options: SearchableSelectOption[] = [];
  @Input() placeholder = 'All';
  @Input() value: any = null;
  @Input() clearable = false;
  @Input() disabled = false;
  @Input() fullWidth = false;
  @Input() loading = false;
  @Input() set isLoading(val: boolean) { this.loading = !!val; }
  @Input() loadingText = 'Loading options...';
  @Output() valueChange = new EventEmitter<any>();

  isOpen = false;
  searchText = '';

  get selectedOption(): SearchableSelectOption | undefined {
    return this.options.find(o => o.id === this.value);
  }

  get selectedLabel(): string {
    if (this.selectedOption) return this.selectedOption.name;
    return this.loading ? this.loadingText : this.placeholder;
  }

  get isPlaceholder(): boolean {
    return this.selectedOption === undefined;
  }

  get filteredOptions(): SearchableSelectOption[] {
    const q = this.searchText.toLowerCase().trim();
    if (!q) return this.options;
    return this.options.filter(o =>
      (o.name && o.name.toLowerCase().includes(q)) ||
      (o.subtitle && o.subtitle.toLowerCase().includes(q)) ||
      (o.tag && o.tag.toLowerCase().includes(q)) ||
      (o.badge && o.badge.toLowerCase().includes(q)) ||
      (o.meta && o.meta.toLowerCase().includes(q))
    );
  }

  onImageError(opt: SearchableSelectOption) {
    opt.avatarUrl = undefined;
  }

  toggle() {
    if (this.disabled) return;
    this.isOpen = !this.isOpen;
    if (this.isOpen && !this.loading) {
      this.searchText = '';
      setTimeout(() => {
        const inputEl = this.elementRef.nativeElement.querySelector('.select-search input') as HTMLInputElement;
        if (inputEl) inputEl.focus();
      }, 50);
    }
  }

  select(opt: SearchableSelectOption | null) {
    this.value = opt ? opt.id : null;
    this.valueChange.emit(this.value);
    this.isOpen = false;
  }

  clear(event: MouseEvent) {
    if (this.disabled) return;
    event.stopPropagation();
    this.value = null;
    this.valueChange.emit(null);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.isOpen = false;
    }
  }
}

