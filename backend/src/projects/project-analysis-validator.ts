/**
 * project-analysis-validator.ts
 *
 * Sits between the raw Groq AI JSON response and the DB/UI.
 * Never trusts LLM arithmetic or classification labels directly —
 * recalculates, cross-checks, and flags inconsistencies instead of
 * silently passing them through.
 */

// ---------- Types ----------

export type CostClassification =
  | 'DOCUMENT_VALUE'
  | 'AI_ESTIMATE'
  | 'CALCULATED'
  | 'USER_PROVIDED';

export interface CostComponent {
  label: string;
  amount: number;
  classification: CostClassification;
}

export interface NormalizedCostEstimate {
  currency: 'INR' | 'USD';
  components: CostComponent[];
  componentSum: number;
  aiReportedTotal: number | null;
  totalCost: number; // authoritative — always componentSum, never AI's raw total
  totalMismatch: boolean;
  mismatchAmount: number;
  contractValue: number | null;
  estimatedProfit: number | null;
  estimatedMarginPct: number | null;
  marginDisplay: string; // "42.3%" or "Not Available"
  marginNote: string | null;
}

export type HealthStatus =
  | 'EXCELLENT'
  | 'HEALTHY'
  | 'AT_RISK'
  | 'HIGH_RISK'
  | 'CRITICAL';

export interface HealthFactorBreakdown {
  requirementCompleteness: number;
  scopeClarity: number;
  resourceAvailability: number;
  timelineFeasibility: number;
  budgetConfidence: number;
  riskLevel: number; // inverted: higher = lower risk
  documentationCompleteness: number;
}

export interface NormalizedHealth {
  score: number; // 0-100, integer
  status: HealthStatus;
  breakdown: HealthFactorBreakdown;
  breakdownSource: 'AI_PROVIDED' | 'HEURISTIC_FALLBACK';
}

export interface ValidationWarning {
  code: string;
  severity: 'BLOCKING' | 'NON_BLOCKING';
  message: string;
}

export interface NormalizedAnalysis {
  costEstimate: NormalizedCostEstimate;
  health: NormalizedHealth;
  arrayDepthFlags: ValidationWarning[];
  wbsResourceConsistency: ValidationWarning[];
  warnings: ValidationWarning[]; // all warnings combined
  isReadyForKickoff: boolean;
  kickoffBlockers: string[];
}

// ---------- Currency ----------

const DEFAULT_CURRENCY: 'INR' | 'USD' = 'INR';

export function formatCurrency(amount: number, currency: 'INR' | 'USD' = DEFAULT_CURRENCY): string {
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

// ---------- Cost normalization (fixes: total mismatch, margin=0%, currency) ----------

export function normalizeCostEstimate(raw: any): NormalizedCostEstimate {
  const currency: 'INR' | 'USD' = raw?.currency === 'USD' ? 'USD' : DEFAULT_CURRENCY;

  const componentDefs: Array<{ key: string; label: string }> = [
    { key: 'resourceCost', label: 'Resource Cost' },
    { key: 'infrastructureCost', label: 'Infrastructure' },
    { key: 'hardwareCost', label: 'Hardware' },
    { key: 'licenseCost', label: 'Software/License' },
    { key: 'vendorCost', label: 'Vendor' },
    { key: 'cloudCost', label: 'Cloud/Hosting' },
    { key: 'implementationCost', label: 'Implementation' },
    { key: 'travelCost', label: 'Travel/Operational' },
    { key: 'contingency', label: 'Contingency' },
    { key: 'otherCost', label: 'Other' },
  ];

  const components: CostComponent[] = componentDefs
    .filter((c) => typeof raw?.[c.key] === 'number' && raw[c.key] > 0)
    .map((c) => ({
      label: c.label,
      amount: raw[c.key],
      classification: (raw?.[`${c.key}Source`] as CostClassification) || 'AI_ESTIMATE',
    }));

  const componentSum = components.reduce((sum, c) => sum + c.amount, 0);
  const aiReportedTotal = typeof raw?.totalCost === 'number' ? raw.totalCost : null;

  const mismatchAmount = aiReportedTotal !== null ? Math.abs(aiReportedTotal - componentSum) : 0;
  const totalMismatch = aiReportedTotal !== null && mismatchAmount > 1; // >1 unit tolerance for rounding

  let finalComponents = components;
  let totalCost = componentSum;

  if (components.length === 0 && aiReportedTotal !== null) {
    finalComponents = [
      { label: 'Unallocated (AI total, no breakdown provided)', amount: aiReportedTotal, classification: 'AI_ESTIMATE' },
    ];
    totalCost = aiReportedTotal;
  } else if (totalMismatch && aiReportedTotal !== null && aiReportedTotal > componentSum) {
    finalComponents = [
      ...components,
      {
        label: 'Unexplained Variance (flagged — needs itemization)',
        amount: aiReportedTotal - componentSum,
        classification: 'AI_ESTIMATE',
      },
    ];
    totalCost = aiReportedTotal;
  }

  const contractValue = typeof raw?.estimatedRevenue === 'number' ? raw.estimatedRevenue : null;
  let estimatedProfit: number | null = null;
  let estimatedMarginPct: number | null = null;
  let marginDisplay = 'Not Available';
  let marginNote: string | null = 'Contract value was not found in the provided documents.';

  if (contractValue !== null) {
    estimatedProfit = contractValue - totalCost;
    estimatedMarginPct = contractValue > 0 ? (estimatedProfit / contractValue) * 100 : null;
    if (estimatedMarginPct !== null) {
      marginDisplay = `${estimatedMarginPct.toFixed(1)}%`;
      marginNote = estimatedMarginPct < 0 ? 'Estimated cost exceeds contract value — negative margin.' : null;
    }
  }

  return {
    currency,
    components: finalComponents,
    componentSum,
    aiReportedTotal,
    totalCost,
    totalMismatch,
    mismatchAmount,
    contractValue,
    estimatedProfit,
    estimatedMarginPct,
    marginDisplay,
    marginNote,
  };
}

// ---------- Health score (fixes: 80% + AT_RISK contradiction) ----------

const HEALTH_WEIGHTS: Record<keyof HealthFactorBreakdown, number> = {
  requirementCompleteness: 0.15,
  scopeClarity: 0.15,
  resourceAvailability: 0.15,
  timelineFeasibility: 0.15,
  budgetConfidence: 0.15,
  riskLevel: 0.15,
  documentationCompleteness: 0.10,
};

export function deriveHealthStatus(score: number): HealthStatus {
  if (score >= 90) return 'EXCELLENT';
  if (score >= 75) return 'HEALTHY';
  if (score >= 60) return 'AT_RISK';
  if (score >= 40) return 'HIGH_RISK';
  return 'CRITICAL';
}

function heuristicHealthBreakdown(ai: any): HealthFactorBreakdown {
  const reqCount = ai?.requirements?.length ?? 0;
  const wbsCount = (ai?.wbsTasks ?? ai?.milestones ?? []).length;
  const riskCount = ai?.risks?.length ?? 0;
  const highRisks = (ai?.risks ?? []).filter((r: any) => r?.impact === 'High' || r?.severity === 'High').length;
  const blockingMissing = (ai?.missingInfo ?? []).filter((m: any) => m?.isBlocking).length;
  const resourceCount = ai?.resourcePlans?.length ?? 0;

  const scaleTo100 = (count: number, expectedMin: number) => Math.min(100, Math.round((count / expectedMin) * 100));

  return {
    requirementCompleteness: scaleTo100(reqCount, 15), 
    scopeClarity: reqCount > 0 ? 60 : 20,
    resourceAvailability: scaleTo100(resourceCount, 5),
    timelineFeasibility: wbsCount > 0 ? scaleTo100(wbsCount, 20) : 20,
    budgetConfidence: 50, 
    riskLevel: Math.max(0, 100 - highRisks * 20 - blockingMissing * 15),
    documentationCompleteness: scaleTo100(reqCount + wbsCount, 30),
  };
}

export function normalizeHealth(ai: any, costEstimate: NormalizedCostEstimate): NormalizedHealth {
  const aiBreakdown = ai?.health?.breakdown as Partial<HealthFactorBreakdown> | undefined;
  const breakdownSource: 'AI_PROVIDED' | 'HEURISTIC_FALLBACK' = aiBreakdown ? 'AI_PROVIDED' : 'HEURISTIC_FALLBACK';

  const breakdown: HealthFactorBreakdown = aiBreakdown
    ? {
        requirementCompleteness: aiBreakdown.requirementCompleteness ?? 50,
        scopeClarity: aiBreakdown.scopeClarity ?? 50,
        resourceAvailability: aiBreakdown.resourceAvailability ?? 50,
        timelineFeasibility: aiBreakdown.timelineFeasibility ?? 50,
        budgetConfidence: costEstimate.totalMismatch ? 30 : aiBreakdown.budgetConfidence ?? 60,
        riskLevel: aiBreakdown.riskLevel ?? 50,
        documentationCompleteness: aiBreakdown.documentationCompleteness ?? 50,
      }
    : heuristicHealthBreakdown(ai);

  if (costEstimate.totalMismatch) {
    breakdown.budgetConfidence = Math.min(breakdown.budgetConfidence, 30);
  }

  const rawScore = (Object.keys(HEALTH_WEIGHTS) as Array<keyof HealthFactorBreakdown>).reduce(
    (sum, key) => sum + breakdown[key] * HEALTH_WEIGHTS[key],
    0,
  );
  const score = Math.round(rawScore);
  const status = deriveHealthStatus(score); 

  return { score, status, breakdown, breakdownSource };
}

// ---------- Array depth check (flags suspiciously thin AI output) ----------

const MIN_EXPECTED: Record<string, number> = {
  requirements: 8,
  wbsTasks: 15,
  resourcePlans: 3,
  risks: 4,
};

export function checkArrayDepth(ai: any): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const checks: Array<[string, any[]]> = [
    ['requirements', ai?.requirements ?? []],
    ['wbsTasks', ai?.wbsTasks ?? ai?.milestones ?? []],
    ['resourcePlans', ai?.resourcePlans ?? []],
    ['risks', ai?.risks ?? []],
  ];

  for (const [key, arr] of checks) {
    const min = MIN_EXPECTED[key];
    if (arr.length < min) {
      warnings.push({
        code: `THIN_${key.toUpperCase()}`,
        severity: 'NON_BLOCKING',
        message: `Only ${arr.length} ${key} generated (expected ${min}+ for a project this size). Re-analysis recommended before kickoff.`,
      });
    }
  }
  return warnings;
}

// ---------- WBS vs Resource consistency (fixes: 100hrs WBS vs 240hrs resourced) ----------

export function checkWbsResourceConsistency(ai: any): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const wbsTasks = ai?.wbsTasks ?? ai?.milestones ?? [];
  const resourcePlans = ai?.resourcePlans ?? [];

  const totalWbsHours = wbsTasks.reduce((sum: number, t: any) => sum + (t?.estimatedEffort ?? t?.effortHours ?? t?.estimatedHours ?? 0), 0);
  const totalResourceHours = resourcePlans.reduce((sum: number, r: any) => sum + (r?.estimatedHours ?? r?.estHours ?? 0), 0);

  if (totalWbsHours === 0 || totalResourceHours === 0) {
    warnings.push({
      code: 'INSUFFICIENT_DATA_FOR_HOURS_CHECK',
      severity: 'NON_BLOCKING',
      message: 'Cannot validate WBS-to-resource hour consistency — one or both datasets are empty.',
    });
    return warnings;
  }

  const MathAbs = Math.abs(totalWbsHours - totalResourceHours);
  const MathMax = Math.max(totalWbsHours, totalResourceHours);
  const variance = MathAbs / MathMax;
  
  if (variance > 0.25) {
    warnings.push({
      code: 'WBS_RESOURCE_HOUR_MISMATCH',
      severity: 'BLOCKING',
      message: `WBS effort totals ${totalWbsHours}hrs but Resource Plan allocates ${totalResourceHours}hrs (${Math.round(
        variance * 100,
      )}% variance). These should reconcile — likely means the WBS is incomplete.`,
    });
  }

  return warnings;
}

// ---------- Orchestrator ----------

export function normalizeAndValidateAnalysis(ai: any): NormalizedAnalysis {
  const costEstimate = normalizeCostEstimate(ai?.costEstimate ?? {});
  const health = normalizeHealth(ai, costEstimate);
  const arrayDepthFlags = checkArrayDepth(ai);
  const wbsResourceConsistency = checkWbsResourceConsistency(ai);

  const warnings: ValidationWarning[] = [];
  if (costEstimate.totalMismatch) {
    warnings.push({
      code: 'COST_TOTAL_MISMATCH',
      severity: 'BLOCKING',
      message: `AI-reported total (${formatCurrency(costEstimate.aiReportedTotal ?? 0, costEstimate.currency)}) did not match the sum of cost components (${formatCurrency(
        costEstimate.componentSum,
        costEstimate.currency,
      )}). Variance of ${formatCurrency(costEstimate.mismatchAmount, costEstimate.currency)} has been surfaced as an "Unexplained Variance" line — itemize before approval.`,
    });
  }
  warnings.push(...arrayDepthFlags, ...wbsResourceConsistency);

  const blockingIssues = warnings.filter((w) => w.severity === 'BLOCKING');
  const kickoffBlockers = blockingIssues.map((w) => w.message);
  const isReadyForKickoff = blockingIssues.length === 0;

  return {
    costEstimate,
    health,
    arrayDepthFlags,
    wbsResourceConsistency,
    warnings,
    isReadyForKickoff,
    kickoffBlockers,
  };
}
