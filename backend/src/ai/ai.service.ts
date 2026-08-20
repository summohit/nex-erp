import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class AiService {
  private get apiKey(): string {
    if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
    try {
      const envPath = path.join(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/GROQ_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
        if (match && match[1]) return match[1].trim();
      }
    } catch (e) {
      console.error('Error reading .env manually:', e);
    }
    return '';
  }

  async generateJobDescription(prompt: { title: string; department?: string; location?: string; instructions?: string }): Promise<string> {
    const key = this.apiKey;
    if (!key) {
      console.error('GROQ_API_KEY not found in process.env or .env file');
      throw new InternalServerErrorException('Groq API key is not set in environment.');
    }

    const systemPrompt = `You are an expert HR Specialist and Technical Recruiter. Generate a professional, comprehensive, and well-structured job description for an ERP recruitment portal. 
Include sections:
- **About the Role**
- **Key Responsibilities** (bullet points)
- **Requirements & Qualifications** (bullet points)
- **Suggested Screening Questions** (3-4 technical/culture-fit questions)

Format cleanly with GitHub Flavored Markdown styling. Keep the tone professional, encouraging, and clear.`;

    const userMessage = `Job Title: ${prompt.title || 'Role'}
Department: ${prompt.department || 'General'}
Location: ${prompt.location || 'Remote'}
${prompt.instructions ? `Special Instructions / Key Skills: ${prompt.instructions}` : ''}`;

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.7,
          max_tokens: 1024,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Groq API Error Output:', response.status, errorText);
        throw new Error(`Groq API returned status ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || 'Failed to generate job description.';
    } catch (err: any) {
      console.error('AI Service Error:', err.message || err);
      throw new InternalServerErrorException(err.message || 'Error communicating with Groq AI Service');
    }
  }

  async scoreResume(resumeText: string, jobDescription: string): Promise<{ score: number, summary: string }> {
    const key = this.apiKey;
    if (!key) {
      throw new InternalServerErrorException('Groq API key is not set in environment.');
    }

    const systemPrompt = `You are an expert ATS (Applicant Tracking System) AI screener. 
Your job is to read the candidate's resume and the job description, and output a JSON object evaluating their fit.
You MUST reply ONLY with a valid JSON object in the following format:
{
  "score": <number between 0 and 100>,
  "matchingSkills": ["skill1", "skill2"],
  "missingSkills": ["skill1", "skill2"],
  "strengths": "<a 1 to 2 sentence summary of strengths>",
  "recommendation": "STRONG_HIRE" | "CONSIDER" | "NOT_RECOMMENDED"
}
Do not include any markdown blocks, backticks, or other text outside the JSON.`;

    const userMessage = `=== JOB DESCRIPTION ===\n${jobDescription}\n\n=== CANDIDATE RESUME ===\n${resumeText}`;

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.2, // Low temperature for more analytical/consistent scoring
          max_tokens: 1024,
        }),
      });

      if (!response.ok) {
        throw new Error(`Groq API returned status ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content?.trim() || '';
      
      // Try to parse the JSON
      // Sometimes the model might still wrap it in ```json ... ```
      let jsonStr = content;
      if (jsonStr.startsWith('\`\`\`json')) {
        jsonStr = jsonStr.replace(/^\`\`\`json/, '').replace(/\`\`\`$/, '').trim();
      } else if (jsonStr.startsWith('\`\`\`')) {
        jsonStr = jsonStr.replace(/^\`\`\`/, '').replace(/\`\`\`$/, '').trim();
      }

      const parsed = JSON.parse(jsonStr);
      return {
        score: typeof parsed.score === 'number' ? parsed.score : parseInt(parsed.score, 10) || 0,
        summary: JSON.stringify(parsed)
      };
    } catch (err: any) {
      console.error('AI ATS Scoring Error:', err.message || err);
      return { score: 0, summary: JSON.stringify({ score: 0, recommendation: "NOT_RECOMMENDED", strengths: "AI Scoring failed due to an error.", matchingSkills: [], missingSkills: [] }) };
    }
  }
}
