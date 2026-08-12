import {
  normalizeCostEstimate,
  normalizeHealth,
  checkArrayDepth,
  checkWbsResourceConsistency,
  normalizeAndValidateAnalysis,
} from './project-analysis-validator';

describe('project-analysis-validator', () => {
  describe('normalizeCostEstimate', () => {
    it('should return "Not Available" margin when contractValue is missing', () => {
      const raw = {
        resourceCost: 1000,
        infrastructureCost: 500,
      };
      const result = normalizeCostEstimate(raw);
      expect(result.marginDisplay).toBe('Not Available');
      expect(result.estimatedMarginPct).toBeNull();
      expect(result.totalCost).toBe(1500);
      expect(result.components.length).toBe(2);
    });

    it('should calculate negative margin correctly', () => {
      const raw = {
        resourceCost: 1000,
        infrastructureCost: 500,
        estimatedRevenue: 1000,
      };
      const result = normalizeCostEstimate(raw);
      expect(result.totalCost).toBe(1500);
      expect(result.estimatedMarginPct).toBe(-50);
      expect(result.marginDisplay).toBe('-50.0%');
    });

    it('should add variance line if aiReportedTotal > component sum', () => {
      const raw = {
        resourceCost: 1000,
        infrastructureCost: 500,
        totalCost: 2000,
      };
      const result = normalizeCostEstimate(raw);
      expect(result.totalMismatch).toBe(true);
      expect(result.mismatchAmount).toBe(500);
      expect(result.totalCost).toBe(2000);
      expect(result.components.length).toBe(3);
      expect(result.components[2].label).toContain('Unexplained Variance');
      expect(result.components[2].amount).toBe(500);
    });

    it('should prioritize component sum if aiReportedTotal < component sum', () => {
      const raw = {
        resourceCost: 1000,
        infrastructureCost: 500,
        totalCost: 1200,
      };
      const result = normalizeCostEstimate(raw);
      expect(result.totalMismatch).toBe(true);
      expect(result.mismatchAmount).toBe(300);
      expect(result.totalCost).toBe(1500);
      expect(result.components.length).toBe(2);
    });
  });

  describe('checkWbsResourceConsistency', () => {
    it('should return no warnings if both arrays are empty (insufficient data)', () => {
      const raw = {
        wbsTasks: [],
        resourcePlans: [],
      };
      const warnings = checkWbsResourceConsistency(raw);
      expect(warnings.length).toBe(1);
      expect(warnings[0].code).toBe('INSUFFICIENT_DATA_FOR_HOURS_CHECK');
      expect(warnings[0].severity).toBe('NON_BLOCKING');
    });

    it('should flag blocking mismatch when variance > 25%', () => {
      const raw = {
        wbsTasks: [{ estimatedEffort: 100 }],
        resourcePlans: [{ estimatedHours: 200 }],
      };
      const warnings = checkWbsResourceConsistency(raw);
      expect(warnings.length).toBe(1);
      expect(warnings[0].code).toBe('WBS_RESOURCE_HOUR_MISMATCH');
      expect(warnings[0].severity).toBe('BLOCKING');
    });

    it('should not flag mismatch when variance <= 25%', () => {
      const raw = {
        wbsTasks: [{ estimatedEffort: 100 }],
        resourcePlans: [{ estimatedHours: 120 }],
      };
      const warnings = checkWbsResourceConsistency(raw);
      expect(warnings.length).toBe(0);
    });
  });
});
