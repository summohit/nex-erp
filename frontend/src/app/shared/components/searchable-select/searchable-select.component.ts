import { Component, Input, Output, EventEmitter, HostListener, ElementRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideChevronDown, LucideSearch, LucideX, LucideCheck } from '@lucide/angular';

export interface SearchableSelectOption {
  id: any;
  name: string;
  subtitle?: string;
}

@Component({
  selector: 'app-searchable-select',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideChevronDown, LucideSearch, LucideX, LucideCheck],
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
  @Output() valueChange = new EventEmitter<any>();

  isOpen = false;
  searchText = '';

  get selectedOption(): SearchableSelectOption | undefined {
    return this.options.find(o => o.id === this.value);
  }

  get selectedLabel(): string {
    return this.selectedOption ? this.selectedOption.name : this.placeholder;
  }

  get isPlaceholder(): boolean {
    return this.value === null || this.value === undefined || this.value === '';
  }

  get filteredOptions(): SearchableSelectOption[] {
    const q = this.searchText.toLowerCase().trim();
    if (!q) return this.options;
    return this.options.filter(o =>
      o.name.toLowerCase().includes(q) || (o.subtitle && o.subtitle.toLowerCase().includes(q))
    );
  }

  toggle() {
    if (this.disabled) return;
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
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

