import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DialogService } from './dialog.service';
import { UploadService } from '../../services/upload.service';

/** The server's code for a General Shift clock outside the office radius (B3). */
export const OUTSIDE_OFFICE_CODE = 'OUTSIDE_OFFICE_REASON_REQUIRED';

export interface OutsideOfficeAnswer {
  reason: string;
  visitType: 'CLIENT_MEETING' | 'FIELD_VISIT_UNAPPROVED';
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
    if (body.fieldVisit) return this.askFieldVisit(body);
    const direction = body.direction === 'out' ? 'out' : 'in';
    const answer = await this.dialog.promptWithAttachment(
      `${body.message || 'You are outside the office radius.'} `
        + 'Your clock is saved straight away; the Super Admin reviews the visit request.',
      `Out-of-geo ${direction === 'in' ? 'clock-in' : 'clock-out'} visit`,
      {
        placeholder: direction === 'in'
          ? 'Explain the client meeting or unapproved field visit'
          : 'Explain why you are clocking out away from the office',
        confirmLabel: 'Submit for approval',
        required: true,
        accept: 'image/*,application/pdf',
        attachmentLabel: 'Attach a photo or document (optional)',
        attachmentHint: 'Anything that backs up the reason. JPG, PNG or PDF.',
        select: {
          label: 'Visit type',
          options: [
            { value: 'CLIENT_MEETING', label: 'Client meeting' },
            { value: 'FIELD_VISIT_UNAPPROVED', label: 'Field visit (unapproved)' },
          ],
        },
      },
    );
    if (!answer?.text?.trim()) return null;
    const visitType = this.dialog.promptSelection as OutsideOfficeAnswer['visitType'];
    const reason = `${visitType === 'CLIENT_MEETING' ? 'Client meeting' : 'Field visit (unapproved)'}: ${answer.text.trim()}`;
    if (!answer.file) return { reason, visitType };

    try {
      const res: any = await firstValueFrom(this.upload.uploadAttendanceProof(answer.file));
      return { reason, visitType, proofUrl: res?.url ?? res?.path ?? undefined };
    } catch {
      const ok = await this.dialog.confirm(
        'The attachment could not be uploaded. Continue with just the reason, or cancel and try again?',
        'Attachment failed',
        `Clock ${direction} without it`,
        'Cancel',
      );
      return ok ? { reason, visitType } : null;
    }
  }

  /**
   * An approved field visit, but away from the site (16 Nov 2026): a photo and
   * a description are both required. The clock-in is saved as pending and the
   * day counts once the Super Admin approves it.
   */
  private async askFieldVisit(body: any): Promise<OutsideOfficeAnswer | null> {
    let note = '';
    for (;;) {
      const answer = await this.dialog.promptWithAttachment(
        `${note}${body.message || 'You are outside the field visit site.'}`,
        'Clock in away from the site',
        {
          placeholder: 'Describe the issue, e.g. site moved to the client\'s warehouse, gate closed…',
          confirmLabel: 'Send for approval',
          required: true,
          accept: 'image/*',
          attachmentLabel: 'Photo of where you are (required)',
          attachmentHint: 'Take a photo now or choose one. JPG or PNG.',
        },
      );
      if (!answer) return null;
      if (!answer.text?.trim()) { note = 'Describe the issue. '; continue; }
      if (!answer.file) { note = 'A photo is required. '; continue; }
      try {
        const res: any = await firstValueFrom(this.upload.uploadAttendanceProof(answer.file));
        const proofUrl = res?.url ?? res?.path;
        if (!proofUrl) throw new Error('no url');
        return { reason: answer.text.trim(), visitType: 'FIELD_VISIT_UNAPPROVED', proofUrl };
      } catch {
        note = 'The photo could not be uploaded — try again. ';
      }
    }
  }
}
