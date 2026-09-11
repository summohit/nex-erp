import { QuotationPdfService } from './quotation-pdf.service';

/**
 * These exercise buildHtml directly rather than driving puppeteer: what matters
 * is the markup fed to the renderer, and launching a browser per assertion would
 * make the suite unusable.
 */
describe('QuotationPdfService.buildHtml', () => {
  const service = new QuotationPdfService({} as any, {} as any);
  const html = (q: any, c: any = {}, s: any = undefined) =>
    (service as any).buildHtml(q, c, s) as string;

  const quote = (over: any = {}) => ({
    quoteNumber: 'QT-1',
    date: '2026-09-11',
    validUntil: '2026-10-11',
    currency: 'INR',
    subtotal: 1000,
    tax: 180,
    taxRate: 18,
    total: 1180,
    billingCompanyName: 'Buyer Ltd',
    billingGstin: '09AAECN8946R1ZD',
    billingPlaceOfSupply: 'Delhi',
    items: [{ name: 'Service', description: '', quantity: 1, unit: 'number', unitPrice: 1000, total: 1000 }],
    ...over,
  });

  describe('when GST applies', () => {
    it('prints the tax column and the CGST/SGST split', () => {
      const out = html(quote());
      expect(out).toContain('>TAX<');
      expect(out).toContain('CGST @9%');
      expect(out).toContain('SGST @9%');
      expect(out).toContain('Taxable Amount');
      expect(out).toContain('Place of Supply');
      expect(out).toContain('GSTIN:');
    });
  });

  // A quote raised at 0% is not a GST document. An empty TAX column and a
  // "CGST @0%" row invite the reader to hunt for a tax nobody charged.
  describe('when the quote carries no GST', () => {
    const out = () => html(quote({ taxRate: 0, tax: 0, total: 1000 }));

    it('drops the tax column, the tax rows and the GST-only buyer fields', () => {
      expect(out()).not.toContain('>TAX<');
      expect(out()).not.toContain('CGST');
      expect(out()).not.toContain('IGST');
      expect(out()).not.toContain('Place of Supply');
      expect(out()).not.toContain('GSTIN:');
    });

    it('labels the subtotal "Amount" rather than "Taxable Amount"', () => {
      expect(out()).toContain('>Amount<');
      expect(out()).not.toContain('Taxable Amount');
    });

    it('keeps the columns balanced — four headers and four cells per row', () => {
      const body = out();
      const headers = (body.match(/<th[ >]/g) || []).length;
      expect(headers).toBe(4);
      const subtotalRow = body.split('<tr class="subtotal">')[1].split('</tr>')[0];
      expect((subtotalRow.match(/<td/g) || []).length).toBe(4);
    });

    it('still prints the PAN, which is not GST-specific', () => {
      expect(html(quote({ taxRate: 0, tax: 0, total: 1000, billingPan: 'AAECN8946R' })))
        .toContain('PAN Number:');
    });
  });

  describe('the signature block', () => {
    it('falls back to the company name when no signatory is configured', () => {
      const out = html(quote(), { name: 'N-Expert Solutions Private Limited' });
      expect(out).toContain('AUTHORISED SIGNATORY FOR');
      expect(out).toContain('N-Expert Solutions Private Limited');
      expect(out).not.toContain('class="stamp"');
    });

    it('prints the configured name and signature image when both are set', () => {
      const out = html(quote(), { name: 'Company' }, {
        quotationSignatoryName: 'N-Expert Solutions Private Limited',
        quotationSignatureUrl: 'https://ik.imagekit.io/x/sign.png',
      });
      expect(out).toContain('class="stamp" src="https://ik.imagekit.io/x/sign.png"');
      expect(out).toContain('N-Expert Solutions Private Limited');
    });

    // A missing upload must never stop a quotation from being produced.
    it('omits only the image when the name is set but no image is', () => {
      const out = html(quote(), { name: 'Company' }, { quotationSignatoryName: 'Someone Ltd' });
      expect(out).not.toContain('class="stamp"');
      expect(out).toContain('Someone Ltd');
    });
  });
});
