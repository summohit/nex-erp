/**
 * The terms a new quotation starts with when a company has not set its own.
 *
 * Lived as a private constant inside LeadProfileComponent, which meant changing
 * a payment term needed a code change and a deploy. It is now the fallback
 * behind SystemSetting.quotationTerms — shared here so the settings screen can
 * show exactly what a quote would use, rather than a second copy that drifts.
 */
export const DEFAULT_QUOTATION_TERMS =
    '1. Validity: This proposal is valid for the period stated above.\n' +
    '2. Payment Terms: 50% advance against Purchase Order and balance before dispatch / on delivery.\n' +
    '3. Taxes: Prices are exclusive of GST unless stated otherwise. GST will be charged at the applicable rate.\n' +
    '4. Delivery: Delivery/implementation timelines will be communicated upon order confirmation.\n' +
    '5. Warranty: Standard manufacturer warranty applies from the date of delivery.\n' +
    '6. Force Majeure: Neither party shall be liable for delays caused by events beyond reasonable control.\n' +
    '7. Acceptance: This proposal is subject to our standard terms of sale and acceptance of a Purchase Order.\n' +
    '8. Governing Law: This proposal shall be governed by the laws of India and subject to jurisdiction of the courts.';
