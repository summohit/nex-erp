import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable } from 'rxjs';

/** Module ids in rail order, and each module's page ids in order. */
export interface MenuOrder {
  modules: string[];
  subs: Record<string, string[]>;
}

/**
 * Sorts `list` by the saved ids. Anything the saved order does not mention
 * (a menu added since, or one just granted) keeps its default place relative
 * to its neighbours, so nothing ever disappears.
 */
export function applySavedOrder<T>(list: T[], saved: string[] | undefined, id: (x: T) => string): T[] {
  if (!saved?.length) return list;
  const rank = new Map(saved.map((s, i) => [s, i]));
  const known = list.filter(x => rank.has(id(x))).sort((a, b) => rank.get(id(a))! - rank.get(id(b))!);
  // Slot the known ones back into the positions known items held, in saved order.
  let k = 0;
  return list.map(x => (rank.has(id(x)) ? known[k++] : x));
}

@Injectable({
  providedIn: 'root'
})
export class MenusService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl + '/v1/menus';

  getSidebarMenus(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/sidebar`);
  }

  /** This person's own sidebar order (16 Nov 2026); null = default. */
  getMenuOrder(): Observable<MenuOrder | null> {
    return this.http.get<MenuOrder | null>(`${this.apiUrl}/order`);
  }

  /** Save the order; null resets to the default. */
  saveMenuOrder(order: MenuOrder | null): Observable<MenuOrder | null> {
    return this.http.put<MenuOrder | null>(`${this.apiUrl}/order`, { order });
  }
}
