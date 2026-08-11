import { Injectable, BadRequestException, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import Groq from 'groq-sdk';

@Injectable()
export class ProjectAiService {
  private groq: Groq;

  constructor(private prisma: PrismaService) {
    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
  }

  async analyzeProjectDocuments(companyId: number, projectId: number) {
    if (!process.env.GROQ_API_KEY) {
      throw new HttpException('Groq API Key not configured', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
      include: { documents: true, analysisRuns: { orderBy: { version: 'desc' }, take: 1 } }
    });

    if (!project) throw new NotFoundException('Project not found');

    const extractedDocs = project.documents.filter(d => d.rawText && d.rawText.trim().length > 0);
    
    if (extractedDocs.length === 0) {
      throw new BadRequestException('No readable text found in uploaded documents. Please ensure files are not empty or password-protected.');
    }

    // Determine new version
    const newVersion = project.analysisRuns.length > 0 ? project.analysisRuns[0].version + 1 : 1;

    // 1. Create Analysis Run (Processing)
    const analysisRun = await this.prisma.projectAnalysisRun.create({
      data: {
        projectId,
        version: newVersion,
        status: 'PROCESSING',
        aiModel: 'llama-3.3-70b-versatile',
        documentsAnalyzed: extractedDocs.length,
      }
    });

    // 2. Mark project as ANALYZING
    await this.prisma.project.update({
      where: { id: projectId },
      data: { onboardingStatus: 'ANALYZING' }
    });

    // Combine document text
    let combinedText = extractedDocs.map(d => `--- Document: ${d.name} ---\n${d.rawText}`).join('\n\n');
    if (combinedText.length > 25000) {
      combinedText = combinedText.substring(0, 25000) + '\n...[TRUNCATED]';
    }

    const systemPrompt = `You are an expert AI Project Manager. Analyze the provided project documents to generate a comprehensive project intelligence payload.
Return the response in strict JSON matching EXACTLY the structure requested below. Every requested field MUST exist in the JSON. If info is missing, provide reasonable expert estimates and mark them as AI_ESTIMATED, or leave empty if inapplicable.

JSON SCHEMA:
{
  "summary": {
    "executiveSummary": "string", "businessObjective": "string", "projectGoals": "string",
    "projectType": "string", "projectComplexity": "string", "projectPriority": "string", "successCriteria": "string"
  },
  "scope": {
    "inScope": "string", "outOfScope": "string", "deliverables": "string", "features": "string",
    "acceptanceCriteria": "string", "scopeConfidence": number, "scopeGaps": "string"
  },
  "requirements": [{ "title": "string", "description": "string", "category": "string", "priority": "string", "sourceDocument": "string", "sourceReference": "string", "acceptanceCriteria": "string", "confidence": number, "type": "EXTRACTED|AI_ESTIMATED" }],
  "wbsTasks": [{ "phase": "string", "module": "string", "feature": "string", "task": "string", "subtask": "string", "description": "string", "estimatedEffort": number, "dependencies": "string", "requiredSkill": "string", "requiredLevel": "string", "priority": "string" }],
  "resourcePlans": [{ "role": "string", "seniority": "string", "quantity": number, "allocationPercent": number, "estimatedHours": number, "requiredSkills": "string", "responsibilities": "string", "reason": "string", "confidence": number, "type": "EXTRACTED|AI_ESTIMATED" }],
  "costEstimate": { "resourceCost": number, "infrastructureCost": number, "vendorCost": number, "licenseCost": number, "otherCost": number, "contingency": number, "totalCost": number, "estimatedRevenue": number, "estimatedProfit": number, "estimatedMargin": number, "currency": "USD", "confidence": number, "type": "EXTRACTED|AI_ESTIMATED" },
  "roadmap": { "estimatedDuration": number, "phases": "string (JSON array representation)", "criticalPath": "string", "scheduleConfidence": number },
  "milestones": [{ "name": "string", "description": "string", "deliverables": "string", "dependencies": "string", "responsibleRole": "string", "approvalReq": "string" }],
  "risks": [{ "risk": "string", "description": "string", "category": "string", "probability": "string", "impact": "string", "riskScore": number, "mitigation": "string", "contingency": "string", "owner": "string", "source": "string", "confidence": number }],
  "dependencies": [{ "dependency": "string", "type": "string", "description": "string", "dependentTask": "string", "internalExternal": "string", "owner": "string", "impact": "string" }],
  "assumptions": [{ "assumption": "string", "reason": "string", "source": "string", "impactIfIncorrect": "string", "confidence": number }],
  "stakeholders": [{ "stakeholder": "string", "organization": "string", "role": "string", "influence": "string", "interest": "string", "responsibility": "string", "communicationReq": "string", "approvalAuthority": boolean }],
  "raci": [{ "projectArea": "string", "responsible": "string", "accountable": "string", "consulted": "string", "informed": "string" }],
  "openQuestions": [{ "question": "string", "category": "string", "importance": "string", "isBlocking": boolean, "source": "string", "suggestedAnswer": "string" }],
  "missingInfo": [{ "missingItem": "string", "whyRequired": "string", "impact": "string", "priority": "string", "isBlocking": boolean }],
  "recommendations": [{ "recommendation": "string", "category": "string", "reason": "string", "expectedImpact": "string", "confidence": number, "source": "string" }],
  "aiConfidence": { "scope": number, "requirements": number, "timeline": number, "resourcePlan": number, "cost": number, "riskAnalysis": number, "overall": number },
  "health": { "readinessScore": number, "scopeScore": number, "requirementScore": number, "resourceScore": number, "budgetScore": number, "timelineScore": number, "riskScore": number, "documentationScore": number, "healthStatus": "HEALTHY|AT_RISK|CRITICAL" },
  "kickoffReadiness": { "reqsApproved": boolean, "scopeApproved": boolean, "budgetApproved": boolean, "resourcesAvailable": boolean, "timelineFeasible": boolean, "stakeholdersIded": boolean, "dependenciesIded": boolean, "risksReviewed": boolean, "docsAvailable": boolean, "clientApprovals": boolean, "overallStatus": "READY|READY_WITH_CONDITIONS|NOT_READY" }
}`;

    const startTime = Date.now();

    try {
      const completion = await this.groq.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Here are the project documents:\n\n${combinedText}` }
        ],
        model: 'llama-3.3-70b-versatile',
        response_format: { type: 'json_object' },
        temperature: 0.2,
      });

      const processingDuration = Date.now() - startTime;
      const responseText = completion.choices[0]?.message?.content || '{}';
      const ai = JSON.parse(responseText);

      // Explicit mapping in a massive transaction
      await this.prisma.$transaction(async (tx) => {
        const aId = analysisRun.id;

        if (ai.summary) {
          await tx.projectSummary.create({
            data: {
              analysisId: aId,
              executiveSummary: ai.summary.executiveSummary || '',
              businessObjective: ai.summary.businessObjective || '',
              projectGoals: ai.summary.projectGoals || '',
              projectType: ai.summary.projectType || '',
              projectComplexity: ai.summary.projectComplexity || '',
              projectPriority: ai.summary.projectPriority || '',
              successCriteria: ai.summary.successCriteria || ''
            }
          });
        }

        if (ai.scope) {
          await tx.projectScope.create({
            data: {
              analysisId: aId,
              inScope: ai.scope.inScope || '',
              outOfScope: ai.scope.outOfScope || '',
              deliverables: ai.scope.deliverables || '',
              features: ai.scope.features || '',
              acceptanceCriteria: ai.scope.acceptanceCriteria || '',
              scopeConfidence: ai.scope.scopeConfidence,
              scopeGaps: ai.scope.scopeGaps
            }
          });
        }

        if (ai.requirements?.length) {
          await tx.projectRequirement.createMany({
            data: ai.requirements.map((r: any) => ({
              analysisId: aId,
              title: r.title || 'Untitled',
              description: r.description || '',
              category: r.category || 'GENERAL',
              priority: r.priority || 'UNKNOWN',
              sourceDocument: r.sourceDocument,
              sourceReference: r.sourceReference,
              acceptanceCriteria: r.acceptanceCriteria,
              confidence: r.confidence,
              type: r.type || 'EXTRACTED'
            }))
          });
        }

        if (ai.wbsTasks?.length) {
          await tx.projectWbsTask.createMany({
            data: ai.wbsTasks.map((w: any) => ({
              analysisId: aId,
              phase: w.phase || 'General',
              module: w.module || '',
              feature: w.feature || '',
              task: w.task || 'Untitled Task',
              subtask: w.subtask,
              description: w.description,
              estimatedEffort: w.estimatedEffort,
              dependencies: w.dependencies,
              requiredSkill: w.requiredSkill,
              requiredLevel: w.requiredLevel,
              priority: w.priority || 'MEDIUM'
            }))
          });
        }

        if (ai.resourcePlans?.length) {
          await tx.projectResourcePlan.createMany({
            data: ai.resourcePlans.map((r: any) => ({
              analysisId: aId,
              role: r.role || 'Unknown Role',
              seniority: r.seniority,
              quantity: r.quantity || 1,
              allocationPercent: r.allocationPercent || 100,
              estimatedHours: r.estimatedHours,
              requiredSkills: r.requiredSkills,
              responsibilities: r.responsibilities,
              reason: r.reason,
              confidence: r.confidence,
              type: r.type || 'AI_ESTIMATED'
            }))
          });
        }

        if (ai.costEstimate) {
          await tx.projectCostEstimate.create({
            data: {
              analysisId: aId,
              resourceCost: ai.costEstimate.resourceCost,
              infrastructureCost: ai.costEstimate.infrastructureCost,
              vendorCost: ai.costEstimate.vendorCost,
              licenseCost: ai.costEstimate.licenseCost,
              otherCost: ai.costEstimate.otherCost,
              contingency: ai.costEstimate.contingency,
              totalCost: ai.costEstimate.totalCost,
              estimatedRevenue: ai.costEstimate.estimatedRevenue,
              estimatedProfit: ai.costEstimate.estimatedProfit,
              estimatedMargin: ai.costEstimate.estimatedMargin,
              currency: ai.costEstimate.currency || 'USD',
              confidence: ai.costEstimate.confidence,
              type: ai.costEstimate.type || 'AI_ESTIMATED'
            }
          });
        }

        if (ai.roadmap) {
          await tx.projectRoadmap.create({
            data: {
              analysisId: aId,
              estimatedDuration: ai.roadmap.estimatedDuration,
              phases: typeof ai.roadmap.phases === 'string' ? ai.roadmap.phases : JSON.stringify(ai.roadmap.phases || []),
              criticalPath: ai.roadmap.criticalPath,
              scheduleConfidence: ai.roadmap.scheduleConfidence
            }
          });
        }

        if (ai.milestones?.length) {
          await tx.projectMilestone.createMany({
            data: ai.milestones.map((m: any) => ({
              analysisId: aId,
              name: m.name || 'Untitled Milestone',
              description: m.description,
              deliverables: m.deliverables,
              dependencies: m.dependencies,
              responsibleRole: m.responsibleRole,
              approvalReq: m.approvalReq
            }))
          });
        }

        if (ai.risks?.length) {
          await tx.projectRisk.createMany({
            data: ai.risks.map((r: any) => ({
              analysisId: aId,
              risk: r.risk || 'Unknown Risk',
              description: r.description || '',
              category: r.category || 'GENERAL',
              probability: r.probability || 'UNKNOWN',
              impact: r.impact || 'UNKNOWN',
              riskScore: r.riskScore,
              mitigation: r.mitigation,
              contingency: r.contingency,
              owner: r.owner,
              source: r.source,
              confidence: r.confidence
            }))
          });
        }

        if (ai.dependencies?.length) {
          await tx.projectDependency.createMany({
            data: ai.dependencies.map((d: any) => ({
              analysisId: aId,
              dependency: d.dependency || 'Unknown Dependency',
              type: d.type || 'GENERAL',
              description: d.description,
              dependentTask: d.dependentTask,
              internalExternal: d.internalExternal || 'INTERNAL',
              owner: d.owner,
              impact: d.impact
            }))
          });
        }

        if (ai.assumptions?.length) {
          await tx.projectAssumption.createMany({
            data: ai.assumptions.map((a: any) => ({
              analysisId: aId,
              assumption: a.assumption || 'Unknown Assumption',
              reason: a.reason,
              source: a.source,
              impactIfIncorrect: a.impactIfIncorrect,
              confidence: a.confidence
            }))
          });
        }

        if (ai.stakeholders?.length) {
          await tx.projectStakeholder.createMany({
            data: ai.stakeholders.map((s: any) => ({
              analysisId: aId,
              stakeholder: s.stakeholder || 'Unknown',
              organization: s.organization,
              role: s.role,
              influence: s.influence,
              interest: s.interest,
              responsibility: s.responsibility,
              communicationReq: s.communicationReq,
              approvalAuthority: !!s.approvalAuthority
            }))
          });
        }

        if (ai.raci?.length) {
          await tx.projectRaci.createMany({
            data: ai.raci.map((r: any) => ({
              analysisId: aId,
              projectArea: r.projectArea || 'General',
              responsible: r.responsible,
              accountable: r.accountable,
              consulted: r.consulted,
              informed: r.informed
            }))
          });
        }

        if (ai.openQuestions?.length) {
          await tx.projectOpenQuestion.createMany({
            data: ai.openQuestions.map((q: any) => ({
              analysisId: aId,
              question: q.question || 'Missing question',
              category: q.category,
              importance: q.importance,
              isBlocking: !!q.isBlocking,
              source: q.source,
              suggestedAnswer: q.suggestedAnswer
            }))
          });
        }

        if (ai.missingInfo?.length) {
          await tx.projectMissingInfo.createMany({
            data: ai.missingInfo.map((m: any) => ({
              analysisId: aId,
              missingItem: m.missingItem || 'Unknown',
              whyRequired: m.whyRequired || '',
              impact: m.impact || '',
              priority: m.priority || 'MEDIUM',
              isBlocking: !!m.isBlocking
            }))
          });
        }

        if (ai.recommendations?.length) {
          await tx.projectRecommendation.createMany({
            data: ai.recommendations.map((r: any) => ({
              analysisId: aId,
              recommendation: r.recommendation || '',
              category: r.category || 'GENERAL',
              reason: r.reason || '',
              expectedImpact: r.expectedImpact || '',
              confidence: r.confidence,
              source: r.source
            }))
          });
        }

        if (ai.aiConfidence) {
          await tx.projectAiConfidence.create({
            data: {
              analysisId: aId,
              scope: ai.aiConfidence.scope,
              requirements: ai.aiConfidence.requirements,
              timeline: ai.aiConfidence.timeline,
              resourcePlan: ai.aiConfidence.resourcePlan,
              cost: ai.aiConfidence.cost,
              riskAnalysis: ai.aiConfidence.riskAnalysis,
              overall: ai.aiConfidence.overall
            }
          });
        }

        if (ai.health) {
          await tx.projectHealth.create({
            data: {
              analysisId: aId,
              readinessScore: ai.health.readinessScore,
              scopeScore: ai.health.scopeScore,
              requirementScore: ai.health.requirementScore,
              resourceScore: ai.health.resourceScore,
              budgetScore: ai.health.budgetScore,
              timelineScore: ai.health.timelineScore,
              riskScore: ai.health.riskScore,
              documentationScore: ai.health.documentationScore,
              healthStatus: ai.health.healthStatus || 'AT_RISK'
            }
          });
        }

        if (ai.kickoffReadiness) {
          await tx.projectKickoffReadiness.create({
            data: {
              analysisId: aId,
              reqsApproved: !!ai.kickoffReadiness.reqsApproved,
              scopeApproved: !!ai.kickoffReadiness.scopeApproved,
              budgetApproved: !!ai.kickoffReadiness.budgetApproved,
              resourcesAvailable: !!ai.kickoffReadiness.resourcesAvailable,
              timelineFeasible: !!ai.kickoffReadiness.timelineFeasible,
              stakeholdersIded: !!ai.kickoffReadiness.stakeholdersIded,
              dependenciesIded: !!ai.kickoffReadiness.dependenciesIded,
              risksReviewed: !!ai.kickoffReadiness.risksReviewed,
              docsAvailable: !!ai.kickoffReadiness.docsAvailable,
              clientApprovals: !!ai.kickoffReadiness.clientApprovals,
              overallStatus: ai.kickoffReadiness.overallStatus || 'NOT_READY'
            }
          });
        }

        // Finalize run
        await tx.projectAnalysisRun.update({
          where: { id: aId },
          data: {
            status: 'COMPLETED',
            processingDuration,
            overallConfidence: ai.aiConfidence?.overall
          }
        });

        // Finalize project
        await tx.project.update({
          where: { id: projectId },
          data: { onboardingStatus: 'ANALYZED' }
        });
      });

      return {
        status: 'SUCCESS',
        message: 'Project analysis completed successfully',
        projectId,
        analysisId: analysisRun.id,
        analysisVersion: newVersion,
        onboardingStatus: 'ANALYZED',
        readinessScore: ai.health?.readinessScore,
        healthStatus: ai.health?.healthStatus,
        estimatedCost: ai.costEstimate?.totalCost,
        estimatedRevenue: ai.costEstimate?.estimatedRevenue,
        estimatedMargin: ai.costEstimate?.estimatedMargin,
        resourceCount: ai.resourcePlans?.length || 0,
        milestoneCount: ai.milestones?.length || 0,
        riskCount: ai.risks?.length || 0,
        requirementCount: ai.requirements?.length || 0,
        openQuestionCount: ai.openQuestions?.length || 0,
        blockingIssueCount: ai.missingInfo?.filter((m: any) => m.isBlocking).length || 0,
        confidence: ai.aiConfidence?.overall,
        nextAction: 'UNDER_REVIEW'
      };
    } catch (error: any) {
      console.error('Groq AI Error:', error);
      
      await this.prisma.projectAnalysisRun.update({
        where: { id: analysisRun.id },
        data: {
          status: 'FAILED',
          errorMessage: error.message || 'Unknown processing error'
        }
      });
      
      await this.prisma.project.update({
        where: { id: projectId },
        data: { onboardingStatus: 'ERROR' }
      });
      
      throw new HttpException('AI Analysis failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
