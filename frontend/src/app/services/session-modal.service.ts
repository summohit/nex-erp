import { Injectable, Inject, DOCUMENT } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SessionModalService {
  private isModalOpen = false;

  constructor(@Inject(DOCUMENT) private document: Document) {}

  prompt(): Promise<boolean> {
    if (this.isModalOpen) {
      // Return a promise that never resolves so we don't trigger multiple refreshes concurrently
      return new Promise(() => {}); 
    }
    
    return new Promise((resolve) => {
      this.isModalOpen = true;

      const dialog = this.document.createElement('dialog');
      dialog.className = 'session-expired-dialog';
      dialog.innerHTML = `
        <div style="padding: 24px; font-family: 'Inter', sans-serif; display: flex; flex-direction: column; gap: 16px; min-width: 320px; max-width: 400px; color: #0f172a; background: #fff; border-radius: 12px;">
          <h2 style="margin: 0; font-size: 20px; color: #ef4444; display: flex; align-items: center; gap: 10px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Session Expired
          </h2>
          <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #475569;">
            Your secure session has expired. To protect your data, please refresh your session or log out.
          </p>
          <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 12px;">
            <button id="btn-logout" style="padding: 10px 18px; border-radius: 8px; border: 1px solid #cbd5e1; background: transparent; cursor: pointer; font-weight: 500; font-size: 14px; color: #334155; transition: background 0.2s;">Log Out</button>
            <button id="btn-continue" style="padding: 10px 18px; border-radius: 8px; border: none; background: #2563eb; color: #fff; cursor: pointer; font-weight: 500; font-size: 14px; transition: background 0.2s;">Continue Session</button>
          </div>
        </div>
      `;

      Object.assign(dialog.style, {
        padding: '0',
        border: 'none',
        borderRadius: '12px',
        boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)',
        overflow: 'hidden'
      });

      const style = this.document.createElement('style');
      style.innerHTML = `
        dialog.session-expired-dialog::backdrop {
          background: rgba(15, 23, 42, 0.6);
          backdrop-filter: blur(8px);
        }
        #btn-logout:hover { background: #f1f5f9 !important; }
        #btn-continue:hover { background: #1d4ed8 !important; }
      `;
      this.document.head.appendChild(style);
      this.document.body.appendChild(dialog);

      const cleanup = () => {
        dialog.close();
        dialog.remove();
        style.remove();
        this.isModalOpen = false;
      };

      const btnLogout = dialog.querySelector('#btn-logout') as HTMLButtonElement;
      const btnContinue = dialog.querySelector('#btn-continue') as HTMLButtonElement;

      btnLogout.addEventListener('click', () => {
        cleanup();
        resolve(false);
      });

      btnContinue.addEventListener('click', () => {
        btnContinue.innerHTML = 'Refreshing...';
        btnContinue.disabled = true;
        btnContinue.style.opacity = '0.7';
        // Delay resolve slightly for UX feel
        setTimeout(() => {
          cleanup();
          resolve(true);
        }, 300);
      });

      // Prevent closing by hitting Escape
      dialog.addEventListener('cancel', (e) => {
        e.preventDefault();
      });

      dialog.showModal();
    });
  }
}
