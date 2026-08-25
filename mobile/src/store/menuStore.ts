import { create } from 'zustand';
import { usersService } from '../api/usersService';

export interface MenuItem {
  id: string;
  title: string;
  icon?: string;
  route?: string;
  subItems?: MenuItem[];
  /** True for links meant to open in the system browser (e.g. the public
   * careers page) instead of navigating to an in-app screen. */
  external?: boolean;
}

export interface MenuSection {
  title: string;
  items: MenuItem[];
}

interface MenuState {
  sections: MenuSection[];
  isLoading: boolean;
  fetchMenus: () => Promise<void>;
}

export const useMenuStore = create<MenuState>((set) => ({
  sections: [],
  isLoading: false,

  fetchMenus: async () => {
    set({ isLoading: true });
    try {
      const data = await usersService.getSidebarMenus();
      set({ sections: Array.isArray(data) ? data : [], isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },
}));
