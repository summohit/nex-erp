import { Component, OnInit, inject, signal, computed, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { environment } from '../../../environments/environment';
import {
  LucideLock, LucideFileText, LucideCheck, LucideX, LucidePenLine,
  LucideDownload, LucideLoader2, LucideAlertCircle,
  LucideShieldCheck, LucideType, LucideUpload, LucideTrash2
} from '@lucide/angular';

type Stage = 'LOADING' | 'LOCKED' | 'SIGNING' | 'COMPLETED' | 'DECLINED' | 'ERROR';
type SigTab = 'TYPE' | 'DRAW' | 'UPLOAD';

interface AccessInfo {
  candidateName: string;
  jobTitle: string;
  status: string;
  requiresPassword: boolean;
  passwordHint: string | null;
  alreadySigned: boolean;
}

interface SigningDoc {
  html: string;
  header: string;
  footer: string;
  status: string;
  candidateName: string;
  jobTitle: string;
  companyName: string;
  signedPdfUrl: string | null;
  respondedAt: string | null;
}

@Component({
  selector: 'app-offer-letter',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucideLock, LucideFileText, LucideCheck, LucideX, LucidePenLine,
    LucideDownload, LucideLoader2, LucideAlertCircle,
    LucideShieldCheck, LucideType, LucideUpload, LucideTrash2
  ],
  templateUrl: './offer-letter.html',
  styleUrls: ['./offer-letter.css']
})
export class OfferLetterComponent implements OnInit, AfterViewChecked {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private sanitizer = inject(DomSanitizer);

  @ViewChild('drawCanvas') drawCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('docScroll') docScroll?: ElementRef<HTMLElement>;
  @ViewChild('signField') signField?: ElementRef<HTMLElement>;

  private token = '';
  private password = '';

  stage = signal<Stage>('LOADING');
  errorMsg = signal<string>('');
  access = signal<AccessInfo | null>(null);
  doc = signal<SigningDoc | null>(null);

  // ---- unlock ----
  passwordInput = signal('');
  isUnlocking = signal(false);
  unlockError = signal('');

  // ---- signature adoption ----
  showAdoptModal = signal(false);
  sigTab = signal<SigTab>('TYPE');
  typedName = signal('');
  selectedFont = signal(0);
  adoptedSignature = signal<string | null>(null);   // data URI
  adoptedType = signal<'TYPED' | 'DRAWN' | 'UPLOADED'>('TYPED');
  private canvasReady = false;
  private isDrawing = false;
  private hasDrawn = signal(false);

  // ---- submission ----
  isSubmitting = signal(false);
  showDeclineModal = signal(false);
  declineReason = signal('');
  agreedToTerms = signal(false);

  readonly signatureFonts = [
    { label: 'Brush', css: "'Brush Script MT','Snell Roundhand',cursive" },
    { label: 'Script', css: "'Segoe Script','Bradley Hand',cursive" },
    { label: 'Chancery', css: "'Apple Chancery','URW Chancery L',cursive" },
    { label: 'Hand', css: "'Lucida Handwriting','Comic Sans MS',cursive" },
  ];

  /** Document body is server-rendered from our own template, so it is trusted. */
  docHtml = computed<SafeHtml | null>(() => {
    const d = this.doc();
    return d ? this.sanitizer.bypassSecurityTrustHtml(d.header + d.html + d.footer) : null;
  });

  /** DocuSign-style progress: the signature is the one required field. */
  fieldsTotal = 1;
  fieldsDone = computed(() => (this.adoptedSignature() ? 1 : 0));
  allFieldsComplete = computed(() => this.fieldsDone() === this.fieldsTotal);
  canFinish = computed(() => this.allFieldsComplete() && this.agreedToTerms() && !this.isSubmitting());

  ngOnInit() {
    this.token = this.route.snapshot.paramMap.get('token') || '';
    if (!this.token) {
      this.stage.set('ERROR');
      this.errorMsg.set('This signing link is not valid.');
      return;
    }
    this.loadAccess();
  }

  ngAfterViewChecked() {
    // Canvas only exists once the Draw tab is rendered.
    if (this.showAdoptModal() && this.sigTab() === 'DRAW' && this.drawCanvas && !this.canvasReady) {
      this.initCanvas();
    }
  }

  private loadAccess() {
    this.http.get<AccessInfo>(`${environment.apiUrl}/public/offer-letters/${this.token}/access`).subscribe({
      next: (info) => {
        this.access.set(info);
        this.typedName.set(info.candidateName || '');

        if (info.alreadySigned) {
          // Already actioned — surface the completed state without a password.
          this.stage.set(info.status === 'DECLINED' ? 'DECLINED' : 'COMPLETED');
          this.loadDocument('');
          return;
        }
        this.stage.set(info.requiresPassword ? 'LOCKED' : 'SIGNING');
        if (!info.requiresPassword) this.loadDocument('');
      },
      error: (err) => {
        this.stage.set('ERROR');
        this.errorMsg.set(err?.error?.message || 'This offer letter could not be found.');
      }
    });
  }

  submitPassword() {
    const pw = this.passwordInput().trim();
    if (!pw) return;
    this.isUnlocking.set(true);
    this.unlockError.set('');

    this.http.post(`${environment.apiUrl}/public/offer-letters/${this.token}/unlock`, { password: pw }).subscribe({
      next: () => {
        this.password = pw;
        this.isUnlocking.set(false);
        this.stage.set('SIGNING');
        this.loadDocument(pw);
      },
      error: (err) => {
        this.isUnlocking.set(false);
        this.unlockError.set(err?.error?.message || 'Incorrect details. Please try again.');
      }
    });
  }

  private loadDocument(pw: string) {
    this.http.post<SigningDoc>(
      `${environment.apiUrl}/public/offer-letters/${this.token}/document`, { password: pw }
    ).subscribe({
      next: (d) => this.doc.set(d),
      error: (err) => {
        this.stage.set('ERROR');
        this.errorMsg.set(err?.error?.message || 'Could not load the document.');
      }
    });
  }

  // ═══════════════ Signature adoption ═══════════════

  openAdoptModal() {
    this.sigTab.set('TYPE');
    this.canvasReady = false;
    this.hasDrawn.set(false);
    if (!this.typedName()) this.typedName.set(this.access()?.candidateName || '');
    this.showAdoptModal.set(true);
  }

  closeAdoptModal() {
    this.showAdoptModal.set(false);
    this.canvasReady = false;
  }

  setSigTab(tab: SigTab) {
    this.sigTab.set(tab);
    this.canvasReady = false;
    this.hasDrawn.set(false);
  }

  // ---- draw ----
  private initCanvas() {
    const canvas = this.drawCanvas?.nativeElement;
    if (!canvas) return;
    // Match the backing store to the displayed size so strokes aren't blurry.
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1e3a8a';
    this.canvasReady = true;
  }

  private pointerPos(e: MouseEvent | TouchEvent): { x: number; y: number } {
    const canvas = this.drawCanvas!.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const p = 'touches' in e ? e.touches[0] : e;
    return { x: p.clientX - rect.left, y: p.clientY - rect.top };
  }

  startDraw(e: MouseEvent | TouchEvent) {
    e.preventDefault();
    if (!this.canvasReady) this.initCanvas();
    const ctx = this.drawCanvas?.nativeElement.getContext('2d');
    if (!ctx) return;
    this.isDrawing = true;
    const { x, y } = this.pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  moveDraw(e: MouseEvent | TouchEvent) {
    if (!this.isDrawing) return;
    e.preventDefault();
    const ctx = this.drawCanvas?.nativeElement.getContext('2d');
    if (!ctx) return;
    const { x, y } = this.pointerPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    this.hasDrawn.set(true);
  }

  endDraw() {
    this.isDrawing = false;
  }

  clearCanvas() {
    const canvas = this.drawCanvas?.nativeElement;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.hasDrawn.set(false);
  }

  // ---- upload ----
  onSignatureUpload(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      this.adoptedSignature.set(reader.result as string);
      this.adoptedType.set('UPLOADED');
      this.closeAdoptModal();
      this.scrollToField();
    };
    reader.readAsDataURL(file);
  }

  canAdopt = computed(() => {
    if (this.sigTab() === 'TYPE') return !!this.typedName().trim();
    if (this.sigTab() === 'DRAW') return this.hasDrawn();
    return false;
  });

  /** Typed signatures are rasterised so both paths yield an embeddable image. */
  private typedToDataUri(): string {
    const canvas = document.createElement('canvas');
    const w = 520, h = 140, dpr = 2;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#1e3a8a';
    ctx.font = `46px ${this.signatureFonts[this.selectedFont()].css}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(this.typedName().trim(), 8, h / 2);
    return canvas.toDataURL('image/png');
  }

  adoptSignature() {
    if (!this.canAdopt()) return;

    if (this.sigTab() === 'TYPE') {
      this.adoptedSignature.set(this.typedToDataUri());
      this.adoptedType.set('TYPED');
    } else if (this.sigTab() === 'DRAW') {
      this.adoptedSignature.set(this.drawCanvas!.nativeElement.toDataURL('image/png'));
      this.adoptedType.set('DRAWN');
    }
    this.closeAdoptModal();
    this.scrollToField();
  }

  clearAdopted() {
    this.adoptedSignature.set(null);
  }

  scrollToField() {
    setTimeout(() => {
      this.signField?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  }

  // ═══════════════ Submit ═══════════════

  finishSigning() {
    if (!this.canFinish()) return;
    this.isSubmitting.set(true);

    this.http.post<any>(`${environment.apiUrl}/public/offer-letters/${this.token}/respond`, {
      decision: 'ACCEPTED',
      signatureName: this.access()?.candidateName || this.typedName().trim(),
      signatureImage: this.adoptedSignature(),
      signatureType: this.adoptedType(),
    }).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.stage.set('COMPLETED');
        this.loadDocument(this.password);
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.errorMsg.set(err?.error?.message || 'Could not submit your signature. Please try again.');
      }
    });
  }

  openDecline() { this.showDeclineModal.set(true); }
  closeDecline() { this.showDeclineModal.set(false); }

  confirmDecline() {
    this.isSubmitting.set(true);
    this.http.post<any>(`${environment.apiUrl}/public/offer-letters/${this.token}/respond`, {
      decision: 'DECLINED',
      signatureName: this.access()?.candidateName || '',
    }).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.showDeclineModal.set(false);
        this.stage.set('DECLINED');
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.errorMsg.set(err?.error?.message || 'Could not record your response.');
      }
    });
  }

  downloadSigned() {
    const url = this.doc()?.signedPdfUrl;
    if (url) window.open(url, '_blank');
  }
}
