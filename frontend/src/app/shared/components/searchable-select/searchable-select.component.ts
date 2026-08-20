import { Component, Input, Output, EventEmitter, HostListener, ElementRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideChevronDown, LucideSearch } from '@lucide/angular';

export interface SearchableSelectOption {
  id: any;
  name: string;
}

@Component({
  selector: 'app-searchable-select',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideChevronDown, LucideSearch],
  templateUrl: './searchable-select.component.html',
  styleUrls: ['./searchable-select.component.css']
})
export class SearchableSelectComponent {
  private elementRef = inject(ElementRef);

  @Input() options: SearchableSelectOption[] = [];
  @Input() placeholder = 'All';
  @Input() value: any = null;
  @Output() valueChange = new EventEmitter<any>();

  isOpen = false;
  searchText = '';

  get selectedLabel(): string {
    const found = this.options.find(o => o.id === this.value);
    return found ? found.name : this.placeholder;
  }

  get isPlaceholder(): boolean {
    return this.value === null || this.value === undefined;
  }

  get filteredOptions(): SearchableSelectOption[] {
    const q = this.searchText.toLowerCase().trim();
    if (!q) return this.options;
    return this.options.filter(o => o.name.toLowerCase().includes(q));
  }

  toggle() {
    this.isOpen = !this.isOpen;
    if (this.isOpen) this.searchText = '';
  }

  select(opt: SearchableSelectOption | null) {
    this.value = opt ? opt.id : null;
    this.valueChange.emit(this.value);
    this.isOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.isOpen = false;
    }
  }
}
