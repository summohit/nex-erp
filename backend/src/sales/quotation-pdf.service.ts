import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

/**
 * Renders a quotation as a printable A4 document.
 *
 * Modelled on the myBillBook quotation the company already issues, so the two
 * are interchangeable to a client: seller letterhead, a BILL TO block, priced
 * line items, a GST breakdown, bank details, terms, and the total in words.
 *
 * Seller details come from the Company Profile; everything about the buyer is
 * read off the quotation itself, which captured it when the quote was raised.
 *
 * Uses the same puppeteer approach as PdfService and OfferLettersService,
 * including their fallback: if Chromium cannot start, the HTML is returned
 * instead of failing, so the user still gets a document they can print.
 */
@Injectable()
export class QuotationPdfService {
  private readonly logger = new Logger(QuotationPdfService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  async generate(companyId: number, quotationId: number): Promise<{ buffer: Buffer; isPdf: boolean; fileName: string }> {
    const quote = await this.prisma.quotation.findFirst({
      where: { id: quotationId, companyId },
      include: {
        items: true,
        client: true,
        lead: { select: { companyName: true, contactName: true, email: true, phone: true, address: true } },
      },
    });
    if (!quote) throw new NotFoundException('Quotation not found');

    const [company, settings] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: companyId } }),
      this.prisma.systemSetting.findUnique({ where: { companyId } }),
    ]);

    const html = this.buildHtml(quote, company, settings);
    const fileName = `${quote.quoteNumber}.pdf`;

    try {
      const puppeteer = require('puppeteer');
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
      });
      await browser.close();
      return { buffer: Buffer.from(pdfBuffer), isPdf: true, fileName };
    } catch (e: any) {
      // Matches PdfService: a missing Chromium should degrade to something
      // printable, not turn into a 500 on a document the user needs now.
      this.logger.warn(`Puppeteer unavailable (${e?.message}); returning HTML`);
      return { buffer: Buffer.from(html, 'utf-8'), isPdf: false, fileName: fileName.replace(/\.pdf$/, '.html') };
    }
  }

  /**
   * Email the quotation to the buyer with the PDF attached.
   *
   * The recipient defaults to whatever the quote captured, so the address the
   * user confirmed in the UI is the one used. Refuses rather than guessing when
   * there is none — a quotation sent to the wrong party cannot be recalled.
   */
  async emailToBuyer(companyId: number, quotationId: number, to?: string, message?: string) {
    const quote = await this.prisma.quotation.findFirst({
      where: { id: quotationId, companyId },
      include: { client: true, lead: { select: { email: true, contactName: true, companyName: true } } },
    });
    if (!quote) throw new NotFoundException('Quotation not found');

    const recipient = (to || quote.billingEmail || quote.lead?.email || '').trim();
    if (!recipient) {
      throw new BadRequestException(
        'No email address on this quotation or its deal. Add one before sending.',
      );
    }

    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    const { buffer, isPdf, fileName } = await this.generate(companyId, quotationId);
    if (!isPdf) {
      // The HTML fallback is fine to look at, but emailing a .html "quotation"
      // to a client is not. Fail loudly instead.
      throw new BadRequestException(
        'The quotation PDF could not be generated on the server, so nothing was sent.',
      );
    }

    await this.mail.sendQuotationEmail({
      to: recipient,
      quoteNumber: quote.quoteNumber,
      companyName: company?.name || 'NEX ERP',
      buyerName: quote.billingContactName || quote.lead?.contactName || quote.billingCompanyName || undefined,
      totalLabel: `${quote.currency === 'INR' ? '₹' : quote.currency} ${this.money(quote.total)}`,
      validUntil: this.date(quote.validUntil),
      message,
      pdf: buffer,
      fileName,
    });

    // SENT is a real state the model documents; leaving it DRAFT after mailing
    // it to a client would misreport the pipeline.
    if (quote.status === 'DRAFT') {
      await this.prisma.quotation.update({ where: { id: quotationId }, data: { status: 'SENT' } });
    }

    return { sent: true, to: recipient, quoteNumber: quote.quoteNumber };
  }

  // ── tax ────────────────────────────────────────────────────────────────────

  /**
   * Intra-state supply is CGST + SGST at half the rate each; inter-state is a
   * single IGST at the full rate. Decided by comparing the buyer's place of
   * supply with the seller's own state, both taken from the addresses on file.
   *
   * With no place of supply recorded we assume intra-state, which is what the
   * reference quotation shows and the commoner case — and the split is printed
   * either way, so a wrong assumption is visible rather than silent.
   */
  private splitTax(tax: number, rate: number, placeOfSupply?: string | null, sellerAddress?: string | null) {
    const buyer = (placeOfSupply || '').trim().toLowerCase();
    const seller = (sellerAddress || '').toLowerCase();
    const interState = !!buyer && !!seller && !seller.includes(buyer);

    return interState
      ? { interState, rows: [{ label: `IGST @${rate}%`, amount: tax }] }
      : {
          interState,
          rows: [
            { label: `CGST @${rate / 2}%`, amount: tax / 2 },
            { label: `SGST @${rate / 2}%`, amount: tax / 2 },
          ],
        };
  }

  // ── amount in words ────────────────────────────────────────────────────────

  private static readonly ONES = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
    'Eighteen', 'Nineteen',
  ];
  private static readonly TENS = [
    '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
  ];

  private twoDigits(n: number): string {
    if (n < 20) return QuotationPdfService.ONES[n];
    const t = QuotationPdfService.TENS[Math.floor(n / 10)];
    const o = QuotationPdfService.ONES[n % 10];
    return o ? `${t} ${o}` : t;
  }

  /**
   * Indian numbering: thousand, lakh, crore — not the short scale. "Ninety Nine
   * Thousand One Hundred Twenty Rupees", matching the reference document.
   */
  amountInWords(value: number): string {
    const total = Math.round(Number(value) || 0);
    const rupees = Math.floor(total);
    const paise = Math.round((Number(value) - rupees) * 100);

    if (rupees === 0 && !paise) return 'Zero Rupees';

    const parts: string[] = [];
    const crore = Math.floor(rupees / 10000000);
    const lakh = Math.floor((rupees % 10000000) / 100000);
    const thousand = Math.floor((rupees % 100000) / 1000);
    const hundred = Math.floor((rupees % 1000) / 100);
    const rest = rupees % 100;

    if (crore) parts.push(`${this.twoDigits(crore)} Crore`);
    if (lakh) parts.push(`${this.twoDigits(lakh)} Lakh`);
    if (thousand) parts.push(`${this.twoDigits(thousand)} Thousand`);
    if (hundred) parts.push(`${QuotationPdfService.ONES[hundred]} Hundred`);
    if (rest) parts.push(this.twoDigits(rest));

    let words = `${parts.join(' ')} Rupees`;
    if (paise) words += ` and ${this.twoDigits(paise)} Paise`;
    return words;
  }

  // ── formatting ─────────────────────────────────────────────────────────────

  /** Indian grouping: 99,120 not 99,120 — and 1,00,000 not 100,000. */
  private money(n: number): string {
    return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      .format(Number(n) || 0);
  }

  private date(d: Date | string | null | undefined): string {
    if (!d) return '—';
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
  }

  private esc(v: unknown): string {
    return String(v ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));
  }

  /** A labelled line that disappears entirely when there is no value. */
  private row(label: string, value: unknown): string {
    const v = String(value ?? '').trim();
    if (!v) return '';
    return `<div class="kv"><span class="k">${this.esc(label)}</span><span class="v">${this.esc(v)}</span></div>`;
  }

  // ── template ───────────────────────────────────────────────────────────────

  private buildHtml(q: any, c: any, s?: any): string {
    const currency = q.currency === 'INR' ? '₹' : this.esc(q.currency);
    const rate = Number(q.taxRate ?? 0);
    // A quote raised at 0% is not a GST document: printing an empty TAX column,
    // "CGST @0%" rows and a Place of Supply invites the reader to look for a tax
    // that was never charged. Everything GST-specific comes out instead.
    const hasTax = rate > 0;
    const { rows: taxRows } = hasTax
      ? this.splitTax(Number(q.tax || 0), rate, q.billingPlaceOfSupply, c?.address)
      : { rows: [] as { label: string; amount: number }[] };

    // Prefer what the quote captured; fall back to the lead only where the quote
    // recorded nothing, so an older quotation still prints something sensible.
    const buyerName = q.billingCompanyName || q.client?.name || q.lead?.companyName || '—';
    const buyerAddress = q.billingAddress || q.lead?.address || '';
    const buyerContact = q.billingContactName || q.lead?.contactName || '';
    const buyerMobile = q.billingMobile || q.lead?.phone || '';
    const buyerEmail = q.billingEmail || q.lead?.email || '';

    const itemRows = (q.items || []).map((it: any) => {
      const amount = Number(it.total ?? Number(it.quantity) * Number(it.unitPrice));
      const lineTax = amount * (rate / 100);
      return `
        <tr>
          <td>
            <div class="item-name">${this.esc(it.name || it.description || '—')}</div>
            ${it.name && it.description ? `<div class="item-desc">${this.esc(it.description)}</div>` : ''}
          </td>
          <td class="num">${this.esc(it.quantity)} ${this.esc(it.unit || '')}</td>
          <td class="num">${this.money(it.unitPrice)}</td>
          ${hasTax ? `<td class="num">${this.money(lineTax)}<div class="sub">(${rate}%)</div></td>` : ''}
          <td class="num">${this.money(amount + lineTax)}</td>
        </tr>`;
    }).join('');

    const qtyTotal = (q.items || []).reduce((s: number, i: any) => s + (Number(i.quantity) || 0), 0);

    return `<!doctype html>
<html><head><meta charset="utf-8"><title>${this.esc(q.quoteNumber)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 11px; color: #1f2937; }
  .tag { font-size: 10px; font-weight: 700; letter-spacing: .5px; color: #374151; }
  .head { display: flex; gap: 18px; align-items: flex-start; margin-top: 10px; }
  .logo { width: 120px; flex: 0 0 120px; }
  .logo img { max-width: 100%; max-height: 62px; object-fit: contain; }
  .co-name { font-size: 20px; font-weight: 700; color: #1d4ed8; margin-bottom: 4px; }
  .co-line { line-height: 1.55; color: #374151; }
  .co-line b { color: #111827; }
  .bar { display: flex; justify-content: space-between; gap: 16px;
         margin: 14px 0 0; padding: 9px 12px; background: #eef2f7;
         border-top: 2px solid #1d4ed8; }
  .bar b { color: #111827; }
  .cols { display: flex; gap: 28px; margin: 14px 0 4px; }
  .col { flex: 1; }
  .col-title { font-size: 11px; font-weight: 700; color: #6b7280; letter-spacing: .4px; margin-bottom: 5px; }
  .buyer-name { font-size: 13px; font-weight: 700; color: #111827; margin-bottom: 3px; }
  .buyer-addr { line-height: 1.5; margin-bottom: 3px; }
  .kv { display: flex; gap: 6px; line-height: 1.6; }
  .kv .k { color: #6b7280; }
  .kv .v { color: #111827; }
  .meta .kv { justify-content: space-between; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; }
  thead th { font-size: 10px; letter-spacing: .4px; color: #374151; text-align: left;
             padding: 8px 6px; border-top: 1.5px solid #1d4ed8; border-bottom: 1px solid #d1d5db; }
  thead th.num, td.num { text-align: right; }
  tbody td { padding: 9px 6px; border-bottom: 1px solid #f1f3f6; vertical-align: top; }
  .item-name { font-weight: 600; color: #111827; }
  .item-desc { color: #6b7280; margin-top: 2px; }
  .sub { font-size: 9px; color: #6b7280; }
  .subtotal td { font-weight: 700; border-top: 1.5px solid #1d4ed8; border-bottom: 1.5px solid #1d4ed8; }
  .lower { display: flex; gap: 28px; margin-top: 16px; }
  .totals { margin-left: auto; width: 46%; }
  .totals .kv { justify-content: space-between; padding: 3px 0; }
  .grand { border-top: 1px solid #9ca3af; margin-top: 5px; padding-top: 6px;
           font-size: 13px; font-weight: 700; }
  .words { text-align: right; margin-top: 8px; color: #374151; }
  .terms { white-space: pre-wrap; line-height: 1.6; color: #374151; }
  .sign { margin-top: 44px; text-align: right; }
  /* Capped rather than sized, so a large upload cannot push the signature line
     off the page — and the aspect ratio is left to the image. */
  .sign .stamp { display: block; margin-left: auto; max-height: 78px; max-width: 190px; margin-bottom: 6px; }
  .sign b { display: block; }
</style></head>
<body>
  <div class="tag">QUOTATION</div>

  <div class="head">
    <div class="logo">${c?.logoUrl ? `<img src="${this.esc(c.logoUrl)}" alt="" />` : ''}</div>
    <div style="flex:1">
      <div class="co-name">${this.esc(c?.name || 'Company')}</div>
      <div class="co-line">
        ${c?.address ? `${this.esc(c.address)}<br/>` : ''}
        ${c?.mobile ? `<b>Mobile:</b> ${this.esc(c.mobile)} &nbsp;&nbsp;` : ''}
        ${c?.gstin ? `<b>GSTIN:</b> ${this.esc(c.gstin)} &nbsp;&nbsp;` : ''}
        ${c?.panNumber ? `<b>PAN Number:</b> ${this.esc(c.panNumber)}` : ''}
        ${c?.email ? `<br/><b>Email:</b> ${this.esc(c.email)}` : ''}
        ${c?.domain ? `<br/><b>Website:</b> ${this.esc(c.domain)}` : ''}
      </div>
    </div>
  </div>

  <div class="bar">
    <span><b>Quotation No.:</b> ${this.esc(q.quoteNumber)}</span>
    <span><b>Quotation Date:</b> ${this.date(q.date)}</span>
    <span><b>Expiry Date:</b> ${this.date(q.validUntil)}</span>
  </div>

  <div class="cols">
    <div class="col">
      <div class="col-title">BILL TO</div>
      <div class="buyer-name">${this.esc(buyerName)}</div>
      ${buyerAddress ? `<div class="buyer-addr">${this.esc(buyerAddress)}</div>` : ''}
      ${this.row('Contact:', buyerContact)}
      ${this.row('Mobile:', buyerMobile)}
      ${this.row('Email:', buyerEmail)}
      ${hasTax ? this.row('GSTIN:', q.billingGstin) : ''}
      ${this.row('PAN Number:', q.billingPan)}
      ${hasTax ? this.row('Place of Supply:', q.billingPlaceOfSupply) : ''}
    </div>
    <div class="col meta">
      ${this.row('Udhyam Reg. No.', c?.udyamRegNo)}
      ${this.row('Deal', q.lead?.companyName)}
    </div>
  </div>

  <table>
    <thead><tr>
      <th>SERVICES</th><th class="num">QTY.</th><th class="num">RATE</th>
      ${hasTax ? '<th class="num">TAX</th>' : ''}<th class="num">AMOUNT</th>
    </tr></thead>
    <tbody>
      ${itemRows || `<tr><td colspan="${hasTax ? 5 : 4}">No line items.</td></tr>`}
      <tr class="subtotal">
        <td>SUBTOTAL</td><td class="num">${qtyTotal}</td><td></td>
        ${hasTax ? `<td class="num">${currency} ${this.money(q.tax)}</td>` : ''}
        <td class="num">${currency} ${this.money(q.total)}</td>
      </tr>
    </tbody>
  </table>

  <div class="lower">
    <div class="col">
      ${c?.bankAccountName || c?.bankIfsc || c?.bankAccountNumber ? `
        <div class="col-title">BANK DETAILS</div>
        ${this.row('Name:', c?.bankAccountName)}
        ${this.row('IFSC Code:', c?.bankIfsc)}
        ${this.row('Account No:', c?.bankAccountNumber)}
        ${this.row('Bank:', [c?.bankName, c?.bankBranch].filter(Boolean).join(', '))}
      ` : ''}
    </div>
    <div class="totals">
      <div class="kv"><span class="k">${hasTax ? 'Taxable Amount' : 'Amount'}</span><span class="v">${currency} ${this.money(q.subtotal)}</span></div>
      ${taxRows.map((t) => `<div class="kv"><span class="k">${this.esc(t.label)}</span><span class="v">${currency} ${this.money(t.amount)}</span></div>`).join('')}
      <div class="kv grand"><span>Total Amount</span><span>${currency} ${this.money(q.total)}</span></div>
      <div class="words"><b>Total Amount (in words)</b><br/>${this.esc(this.amountInWords(q.total))}</div>
    </div>
  </div>

  ${q.terms ? `<div style="margin-top:18px"><div class="col-title">TERMS AND CONDITIONS</div><div class="terms">${this.esc(q.terms)}</div></div>` : ''}

  <div class="sign">
    ${s?.quotationSignatureUrl ? `<img class="stamp" src="${this.esc(s.quotationSignatureUrl)}" alt="" />` : ''}
    <b>AUTHORISED SIGNATORY FOR</b>
    ${this.esc(s?.quotationSignatoryName || c?.name || '')}
  </div>
</body></html>`;
  }
}
