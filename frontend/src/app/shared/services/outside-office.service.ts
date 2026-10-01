import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DialogService } from './dialog.service';
import { UploadService } from '../../services/upload.service';

/** The server's code for a General Shift clock outside the office radius (B3). */
export const OUTSIDE_OFFICE_CODE = 'OUTSIDE_OFFICE_REASON_REQUIRED';

export interface OutsideOfficeAnswer {
  reason: string;
  proofUrl?: string;
}

/**
 * Asks why someone is clocking in or out away from the office.
 *
 * One place for the header button, the dashboard punch card and the attendance
 * page, so all three ask the same question and treat the attachment the same
 * way: a reason is required, a photo or PDF is optional, and the clock is
 * accepted but waits on an administrator.
 */
@Injectable({ providedIn: 'root' })
export class OutsideOfficeService {
  private dialog = inject(DialogService);
  private upload = inject(UploadService);

  isOutsideOffice(err: any): boolean {
    return err?.error?.code === OUTSIDE_OFFICE_CODE;
  }

  /** Null when the person cancels. */
  async ask(err: any): Promise<OutsideOfficeAnswer | null> {
    const body = err?.error ?? {};
    const direction = body.direction === 'out' ? 'out' : 'in';
    const answer = await this.dialog.promptWithAttachment(
      `${body.message || 'You are outside the office radius.'} `
        + 'Your clock is saved straight away; an administrator reviews the reason.',
      `Clocking ${direction} away from the office`,
      {
        placeholder: direction === 'in'
          ? 'e.g. Starting the day at the client site in Gurgaon'
          : 'e.g. Left early for a client meeting',
        confirmLabel: `Clock ${direction}`,
        required: true,
        accept: 'image/*,application/pdf',
        attachmentLabel: 'Attach a photo or document (optional)',
        attachmentHint: 'Anything that backs up the reason. JPG, PNG or PDF.',
      },
    );
    if (!answer?.text?.trim()) return null;
    if (!answer.file) return { reason: answer.text.trim() };

    try {
      const res: any = await firstValueFrom(this.upload.uploadAttendanceProof(answer.file));
      return { reason: answer.text.trim(), proofUrl: res?.url ?? res?.path ?? undefined };
    } catch {
      const ok = await this.dialog.confirm(
        'The attachment could not be uploaded. Continue with just the reason, or cancel and try again?',
        'Attachment failed',
        `Clock ${direction} without it`,
        'Cancel',
      );
      return ok ? { reason: answer.text.trim() } : null;
    }
  }
}
