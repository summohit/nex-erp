import {
  evaluateCondition,
  evaluateFormula,
  extractVariableReferences,
  FormulaEvaluationError,
} from './formula-evaluator';

describe('FormulaEvaluator', () => {
  describe('evaluateFormula', () => {
    it('evaluates simple arithmetic respecting operator precedence', () => {
      expect(evaluateFormula('2 + 3 * 4')).toBe(14);
      expect(evaluateFormula('(2 + 3) * 4')).toBe(20);
      expect(evaluateFormula('100 - 50 / 2')).toBe(75);
    });

    it('evaluates floating point values accurately', () => {
      expect(evaluateFormula('13780 * 0.12')).toBeCloseTo(1653.6, 2);
      expect(evaluateFormula('13780 * 0.4')).toBeCloseTo(5512, 2);
      expect(evaluateFormula('13780 * 0.0325')).toBeCloseTo(447.85, 2);
    });

    it('resolves variables from context', () => {
      const ctx = {
        CTC_MONTHLY: 60000,
        BASIC_FLOOR: 13780,
      };
      expect(evaluateFormula('CTC_MONTHLY * 0.5', ctx)).toBe(30000);
      expect(evaluateFormula('MAX(CTC_MONTHLY * 0.5, BASIC_FLOOR)', ctx)).toBe(30000);

      const lowCtx = {
        CTC_MONTHLY: 20000,
        BASIC_FLOOR: 13780,
      };
      expect(evaluateFormula('MAX(CTC_MONTHLY * 0.5, BASIC_FLOOR)', lowCtx)).toBe(13780);
    });

    it('evaluates MIN and MAX with multiple arguments', () => {
      expect(evaluateFormula('MIN(30000, 15000)')).toBe(15000);
      expect(evaluateFormula('MIN(10000, 15000)')).toBe(10000);
      expect(evaluateFormula('MAX(10, 20, 5)')).toBe(20);
    });

    it('evaluates ROUND and IF functions', () => {
      expect(evaluateFormula('ROUND(123.456, 2)')).toBe(123.46);
      expect(evaluateFormula('ROUND(123.456, 0)')).toBe(123);
      expect(evaluateFormula('IF(1 > 0, 100, 200)')).toBe(100);
      expect(evaluateFormula('IF(1 < 0, 100, 200)')).toBe(200);
    });

    it('throws on unknown variables', () => {
      expect(() => evaluateFormula('UNKNOWN_VAR * 2', {})).toThrow(FormulaEvaluationError);
    });

    it('throws on division by zero', () => {
      expect(() => evaluateFormula('100 / 0')).toThrow('Division by zero');
    });

    it('throws on syntax errors', () => {
      expect(() => evaluateFormula('100 + * 2')).toThrow(FormulaEvaluationError);
      expect(() => evaluateFormula('((100 + 2)')).toThrow(FormulaEvaluationError);
    });
  });

  describe('evaluateCondition', () => {
    it('evaluates relational and logical comparisons', () => {
      const ctx = { BASIC: 13780, ESI_LIMIT: 21000 };
      expect(evaluateCondition('BASIC <= ESI_LIMIT', ctx)).toBe(true);
      expect(evaluateCondition('BASIC > ESI_LIMIT', ctx)).toBe(false);
      expect(evaluateCondition('BASIC <= 21000 AND BASIC >= 10000', ctx)).toBe(true);
      expect(evaluateCondition('BASIC > 21000 OR BASIC < 10000', ctx)).toBe(false);
    });
  });

  describe('extractVariableReferences', () => {
    it('extracts variable identifiers excluding builtin function names', () => {
      const formula = 'MAX(CTC_MONTHLY * 0.5, BASIC_FLOOR) * (PF_EMPLOYER_PCT / 100)';
      const refs = extractVariableReferences(formula);
      expect(refs).toEqual(['CTC_MONTHLY', 'BASIC_FLOOR', 'PF_EMPLOYER_PCT']);
    });

    it('extracts variables from conditions', () => {
      const cond = 'BASIC <= ESI_LIMIT AND GROSS > 0';
      const refs = extractVariableReferences(cond);
      expect(refs).toEqual(['BASIC', 'ESI_LIMIT', 'GROSS']);
    });
  });
});
