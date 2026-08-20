import { Injectable, BadRequestException, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleGenAI } from '@google/genai';
import Groq from 'groq-sdk';
import { normalizeAndValidateAnalysis } from './project-analysis-validator';

@Injectable()
export class ProjectAiService {
  private geminiAi: GoogleGenAI;
  private groqAi: Groq;

  constructor(private prisma: PrismaService) {
    if (process.env.GEMINI_API_KEY) {
      this.geminiAi = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
      });
    }
    if (process.env.GROQ_API_KEY) {
      this.groqAi = new Groq({
        apiKey: process.env.GROQ_API_KEY,
      });
    }
  }

  async analyzeProjectDocuments(companyId: number, projectId: number, constraints?: any, requestedModel?: string) {
    const aiModel = requestedModel || 'openai/gpt-oss-120b';
    const isGemini = aiModel.startsWith('gemini') || aiModel.startsWith('gemma');

    if (isGemini && !process.env.GEMINI_API_KEY) {
      throw new HttpException('Gemini API Key not configured', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    if (!isGemini && !process.env.GROQ_API_KEY) {
      throw new HttpException('Groq API Key not configured', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
      include: { documents: true, analysisRuns: { orderBy: { version: 'desc' }, take: 1 } }
    });

    if (!project) throw new NotFoundException('Project not found');

    // Deduplicate documents by file name (keep latest updated document per name)
    const uniqueDocsMap = new Map<string, typeof project.documents[0]>();
    for (const doc of project.documents) {
      if (doc.rawText && doc.rawText.trim().length > 0) {
        const existing = uniqueDocsMap.get(doc.name);
        if (!existing || new Date(doc.updatedAt || doc.createdAt) > new Date(existing.updatedAt || existing.createdAt)) {
          uniqueDocsMap.set(doc.name, doc);
        }
      }
    }
    const extractedDocs = Array.from(uniqueDocsMap.values());
    
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
        aiModel: aiModel,
        documentsAnalyzed: extractedDocs.length,
        resourceConstraints: constraints || null
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

    let constraintsPrompt = '';
    if (constraints) {
      constraintsPrompt = `\n5. SCHEDULING CONSTRAINTS (STRICT):\n`;
      
      if (constraints.teamMembers && constraints.teamMembers.length > 0) {
        const memberIds = constraints.teamMembers.map((m: any) => m.id);
        const detailedMembers = await this.prisma.employee.findMany({
          where: { id: { in: memberIds } },
          include: {
            designation: true,
            department: true,
            skills: true,
          }
        });

        let teamProfiles = '';
        detailedMembers.forEach(m => {
          const role = m.designation?.name || 'Team Member';
          const dept = m.department?.name || 'Unassigned';
          const skillsList = m.skills.map(s => `${s.name} (${s.level})`).join(', ');
          const skillsText = skillsList ? `Skills: ${skillsList}` : 'Skills: Not specified';
          const aboutText = m.about ? `Bio: ${m.about}` : '';
          
          teamProfiles += `\n      - ${m.firstName} ${m.lastName} | Role: ${role} | Dept: ${dept} | ${skillsText} | ${aboutText}`;
        });

        constraintsPrompt += `   - Available Team Members and their Profiles:${teamProfiles}\n     You MUST exclusively assign these specific named individuals to the Resource Plan and WBS Tasks, making sure to assign tasks that match their specific skills and roles.\n`;
      } else if (constraints.engineerCount) {
        constraintsPrompt += `   - You have ${constraints.engineerCount} engineers available.\n`;
      }

      if (constraints.maxHoursPerDay || constraints.startDate || constraints.daysOff) {
        constraintsPrompt += `   - Schedule limits: max ${constraints.maxHoursPerDay || 8} hours per day, starting on ${constraints.startDate || 'a realistic date'}, with ${constraints.daysOff?.join(', ') || 'weekends'} off.\n   - For every WBS task, you MUST calculate the 'workingDays', 'startDate', 'startTime', 'endDate', and 'endTime' respecting these constraints and task 'dependencies'.\n`;
      }

      if (constraints.methodology) {
        constraintsPrompt += `\n6. METHODOLOGY (STRICT):\n   - Use the **${constraints.methodology}** project management methodology. `;
        if (constraints.methodology === 'Agile') {
          constraintsPrompt += `Break the WBS into Epics, Sprints, and User Stories/Tasks.\n`;
        } else {
          constraintsPrompt += `Break the WBS into sequential logical Phases (e.g., Planning, Design, Execution, Testing, Deployment).\n`;
        }
      }

      if (constraints.targetBudget) {
        constraintsPrompt += `\n7. BUDGET CONSTRAINTS:\n   - The target budget ceiling is ${constraints.targetBudget}. Try to align estimated effort/costs within this budget. If it is mathematically impossible to meet the scope requirements within this budget, flag a 'Financial' risk and add a 'isReadyForKickoff: false' validation blocker.\n`;
      }
    }

    const systemPrompt = `You are an expert Senior Project Manager. Analyze the provided project documents to generate a comprehensive, highly thorough project intelligence payload.

STRICT COMPREHENSIVENESS & RECONCILIATION DIRECTIVES:
1. DEPTH & COMPLETENESS: Do NOT truncate arrays. Provide a thorough, realistic breakdown based on the input documents.
   - Requirements: Extract ALL functional and non-functional requirements (minimum 6-12 distinct items).
   - WBS Tasks: Break down work into detailed tasks across phases (e.g. Planning, Architecture/Design, Procurement, Implementation, Testing, Deployment). Generate at least 8-15 detailed tasks.
   - Risks: Identify ALL technical, financial, and operational risks (minimum 4-8 items).
   - Resource Plans: Detail ALL required roles and team members (minimum 3-6 distinct role allocations).
   - Dependencies, Assumptions, Stakeholders, RACI, Open Questions: Populate every section thoroughly!

2. FINANCIAL & COST MATHEMATICS (STRICT):
   - CRITICAL REQUIREMENT: For Indian-context projects, calculate all financial metrics (hourly rates, material costs, totals) in Indian Rupees (INR). Set currency to 'INR'. Do NOT assume USD magnitude for Indian resources.
   - totalCost MUST equal the EXACT sum of all cost component fields you populate (e.g. resourceCost + infrastructureCost + hardwareCost + licenseCost + vendorCost + cloudCost + implementationCost + travelCost + otherCost + contingency). If this math is wrong, the entire object is invalid.
   - If contract revenue or price is missing from the source documents, estimatedRevenue and estimatedMargin MUST be null or omitted (do NOT guess a margin if there is no revenue data).

3. WBS vs RESOURCE RECONCILIATION:
   - The total estimated hours across all Resource Plans ("estimatedHours") MUST logically reconcile with the total effort needed to complete all WBS tasks ("estimatedEffort") plus reasonable contingency/management overhead buffer.

4. HEALTH SCORE & STATUS AGREEMENT:
   - "readinessScore" must be a number between 0 and 100.
   - If readinessScore >= 80: healthStatus MUST be "HEALTHY".
   - If readinessScore is between 50 and 79: healthStatus MUST be "AT_RISK".
   - If readinessScore < 50: healthStatus MUST be "CRITICAL".
   - DO NOT provide contradictory readinessScore and healthStatus!

5. ENTERPRISE LEVEL SUMMARY:
   - "executiveSummary": MUST be a highly detailed, comprehensive, multi-paragraph enterprise-grade executive briefing (minimum 400-500 words). It MUST include the following specific sections formatted with Markdown headers:
     ### 1. Executive Overview
     (A high-level summary of the project's purpose, background, and strategic value)
     ### 2. Scope & Objectives
     (Detailed explanation of key deliverables, out-of-scope items, and primary goals)
     ### 3. Financial & Resource Implications
     (Detailed budget overview, key resource requirements, margin expectations, and cost drivers)
     ### 4. Key Risks & Mitigation
     (Major technical, financial, or operational risks identified and their mitigation strategies)
     ### 5. Strategic Alignment & Next Steps
     (How this project aligns with overarching business goals and immediate recommended next actions)
   Ensure the summary is rich with specific details, facts, numbers, and data extracted directly from the uploaded documents. Do not use generic boilerplate text.
${constraintsPrompt}

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
  "wbsTasks": [{ "wbsId": "string", "phase": "string", "module": "string", "feature": "string", "task": "string", "subtask": "string", "description": "string", "estimatedEffort": number, "quantity": number, "engineer": "string", "workingDays": number, "startDate": "YYYY-MM-DD", "startTime": "string", "endDate": "YYYY-MM-DD", "endTime": "string", "sourceReference": "string", "remarks": "string", "dependencies": "string", "requiredSkill": "string", "requiredLevel": "string", "priority": "string" }],
  "resourcePlans": [{ "role": "string", "seniority": "string", "quantity": number, "allocationPercent": number, "estimatedHours": number, "requiredSkills": "string", "responsibilities": "string", "reason": "string", "confidence": number, "type": "EXTRACTED|AI_ESTIMATED" }],
  "costEstimate": { "resourceCost": number, "infrastructureCost": number, "hardwareCost": number, "licenseCost": number, "vendorCost": number, "cloudCost": number, "implementationCost": number, "travelCost": number, "otherCost": number, "contingency": number, "totalCost": number, "estimatedRevenue": number, "estimatedProfit": number, "estimatedMargin": number, "currency": "INR", "confidence": number, "type": "EXTRACTED|AI_ESTIMATED" },
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
  "health": { "readinessScore": number, "healthStatus": "HEALTHY|AT_RISK|CRITICAL", "breakdown": { "requirementCompleteness": number, "scopeClarity": number, "resourceAvailability": number, "timelineFeasibility": number, "budgetConfidence": number, "riskLevel": number, "documentationCompleteness": number } },
  "kickoffReadiness": { "reqsApproved": boolean, "scopeApproved": boolean, "budgetApproved": boolean, "resourcesAvailable": boolean, "timelineFeasible": boolean, "stakeholdersIded": boolean, "dependenciesIded": boolean, "risksReviewed": boolean, "docsAvailable": boolean, "clientApprovals": boolean, "overallStatus": "READY|READY_WITH_CONDITIONS|NOT_READY" }
}`;

    const startTime = Date.now();

    try {
      let rawJson = '';

      if (isGemini) {
        const completion = await this.geminiAi.models.generateContent({
          model: aiModel,
          contents: `Here are the project documents:\n\n${combinedText}`,
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: 'application/json',
            temperature: 0.2
          }
        });
        rawJson = completion.text || '';
      } else {
        const completion = await this.groqAi.chat.completions.create({
          model: aiModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Here are the project documents:\n\n${combinedText}` }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2
        });
        rawJson = completion.choices[0]?.message?.content || '';
      }

      // Parse the JSON output
      const ai = JSON.parse(rawJson);
      const processingDuration = Date.now() - startTime;

      const normalized = normalizeAndValidateAnalysis(ai);

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
            data: ai.wbsTasks.map((w: any) => {
              // Convert "YYYY-MM-DD" to Date safely if exists
              const parseDate = (dString: any) => {
                if (!dString) return null;
                const d = new Date(dString);
                return isNaN(d.getTime()) ? null : d;
              };

              return {
                analysisId: aId,
                wbsId: w.wbsId || null,
                phase: w.phase || 'General',
                module: w.module || '',
                feature: w.feature || '',
                task: w.task || 'Untitled Task',
                subtask: w.subtask,
                description: w.description,
                estimatedEffort: w.estimatedEffort,
                quantity: w.quantity || null,
                engineer: w.engineer || null,
                workingDays: w.workingDays || null,
                startDate: parseDate(w.startDate),
                startTime: w.startTime || null,
                endDate: parseDate(w.endDate),
                endTime: w.endTime || null,
                sourceReference: w.sourceReference || null,
                remarks: w.remarks || null,
                dependencies: w.dependencies,
                requiredSkill: w.requiredSkill,
                requiredLevel: w.requiredLevel,
                priority: w.priority || 'MEDIUM'
              };
            })
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
              currency: ai.costEstimate.currency || 'INR',
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
            overallConfidence: ai.aiConfidence?.overall,
            totalCost: normalized.costEstimate.totalCost,
            costCurrency: normalized.costEstimate.currency,
            costBreakdown: normalized.costEstimate.components as any,
            costTotalMismatch: normalized.costEstimate.totalMismatch,
            estimatedRevenue: normalized.costEstimate.contractValue,
            estimatedMarginPct: normalized.costEstimate.estimatedMarginPct,
            marginDisplay: normalized.costEstimate.marginDisplay,
            readinessScore: normalized.health.score,
            healthStatus: normalized.health.status,
            healthBreakdown: normalized.health.breakdown as any,
            validationWarnings: normalized.warnings as any,
            isReadyForKickoff: normalized.isReadyForKickoff,
            kickoffBlockers: normalized.kickoffBlockers
          }
        });

        // Finalize project
        await tx.project.update({
          where: { id: projectId },
          data: { 
            onboardingStatus: normalized.isReadyForKickoff ? 'ANALYZED' : 'ANALYZED_WITH_WARNINGS',
            ...(constraints?.startDate && { startDate: new Date(constraints.startDate) }),
            ...(constraints?.endDate && { endDate: new Date(constraints.endDate) })
          }
        });

        if (constraints?.teamMembers?.length > 0) {
          const memberIds = constraints.teamMembers.map((m: any) => m.id);
          for (const memberId of memberIds) {
            await tx.projectMember.upsert({
              where: {
                projectId_employeeId: {
                  projectId: projectId,
                  employeeId: memberId
                }
              },
              create: {
                projectId: projectId,
                employeeId: memberId,
                role: 'MEMBER'
              },
              update: {}
            });
          }
        }
      });

      return {
        status: 'SUCCESS',
        message: normalized.isReadyForKickoff 
          ? 'Project analysis completed successfully' 
          : `Project analysis completed with ${normalized.kickoffBlockers.length} blocking issue(s) requiring review`,
        projectId,
        analysisId: analysisRun.id,
        analysisVersion: newVersion,
        onboardingStatus: normalized.isReadyForKickoff ? 'ANALYZED' : 'ANALYZED_WITH_WARNINGS',
        readinessScore: normalized.health.score,
        healthStatus: normalized.health.status,
        estimatedCost: normalized.costEstimate.totalCost,
        currency: normalized.costEstimate.currency,
        estimatedRevenue: normalized.costEstimate.contractValue,
        estimatedMargin: normalized.costEstimate.marginDisplay,
        resourceCount: ai.resourcePlans?.length || 0,
        milestoneCount: ai.milestones?.length || 0,
        riskCount: ai.risks?.length || 0,
        requirementCount: ai.requirements?.length || 0,
        openQuestionCount: ai.openQuestions?.length || 0,
        blockingIssueCount: ai.missingInfo?.filter((m: any) => m.isBlocking).length || 0,
        confidence: ai.aiConfidence?.overall,
        validationWarnings: normalized.warnings,
        isReadyForKickoff: normalized.isReadyForKickoff,
        nextAction: normalized.isReadyForKickoff ? 'UNDER_REVIEW' : 'NEEDS_ATTENTION'
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
      
      console.error('AI Error:', error);
      throw new HttpException(error.message || 'AI Analysis failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
