/**
 * aiService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * All Gemini calls are routed through the server-side /api/gemini proxy.
 * The GEMINI_API_KEY is NEVER exposed to the browser bundle.
 *
 * The proxy lives in server.ts → POST /api/gemini
 * It accepts: { model, contents, config }
 * It returns the raw GoogleGenAI response object.
 */

import { Type } from "@google/genai";

// ─────────────────────────────────────────────────────────────────────────────
// Internal proxy caller — single point of contact with the backend
// ─────────────────────────────────────────────────────────────────────────────

async function callGemini(payload: {
  model?: string;
  contents: any;
  config?: any;
}): Promise<{ text: string }> {
  const base = import.meta.env.VITE_API_BASE_URL || "";
  const res = await fetch(`${base}/api/gemini`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: payload.model || "gemini-2.0-flash",
      contents: payload.contents,
      config: payload.config,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Gemini proxy error ${res.status}`);
  }

  const data = await res.json();
  // GoogleGenAI response shape: { candidates: [...], text: string, ... }
  const text: string =
    data.text ||
    data.candidates?.[0]?.content?.parts?.[0]?.text ||
    "";
  return { text };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function scoreMatch(job: any, candidate: any) {
  const prompt = `
Score the match between this legal job and candidate on a scale of 0 to 10.

Job:
  Title: ${job.title}
  Company: ${job.company}
  Practice Area: ${job.practice_area}
  PQE Required: ${job.pqe}
  Description: ${job.description}

Candidate:
  Name: ${candidate.name}
  Current Firm: ${candidate.current_firm}
  Practice Area: ${candidate.practice_area}
  PQE Years: ${candidate.pqe_years}
  Summary: ${candidate.profile_summary}

Return ONLY a JSON object with:
  score    (number, 0–10)
  reasons  (array of strings)
  summary  (string, max 200 chars)
`.trim();

  try {
    const { text } = await callGemini({
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score:   { type: Type.NUMBER },
            reasons: { type: Type.ARRAY, items: { type: Type.STRING } },
            summary: { type: Type.STRING },
          },
          required: ["score", "reasons", "summary"],
        },
      },
    });
    return JSON.parse(text);
  } catch (err) {
    console.error("[aiService] scoreMatch error:", err);
    return {
      score: 5.0,
      reasons: ["AI scoring unavailable — using fallback."],
      summary: "Baseline match (AI scoring failed).",
    };
  }
}

export async function generateOutreach(match: any) {
  const prompt = `
Generate a professional recruiter email for this candidate match.

Candidate: ${match.candidate_name}
Candidate Practice Area: ${match.candidate_practice_area}
Candidate PQE: ${match.candidate_pqe_years} years

Job: ${match.job_title} at ${match.job_company}
Job Practice Area: ${match.job_practice_area}
Job PQE Required: ${match.job_pqe}
Job Requirements: ${match.job_description}

Match Reasons: ${match.match_reasons}

Guidelines:
- Personalise based on the candidate's experience and the job requirements.
- Mention why they are a strong match.
- Professional yet engaging.
- End with: [Insert link to schedule a call]

Return ONLY a JSON object with:
  subject (string)
  body    (string)
`.trim();

  try {
    const { text } = await callGemini({
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            body:    { type: Type.STRING },
          },
          required: ["subject", "body"],
        },
      },
    });
    return JSON.parse(text);
  } catch (err) {
    console.error("[aiService] generateOutreach error:", err);
    return {
      subject: `Opportunity: ${match.job_title} at ${match.job_company}`,
      body: `Hi ${match.candidate_name},\n\nI believe you would be a great fit for the ${match.job_title} role at ${match.job_company}.\n\n[Insert link to schedule a call]\n\nBest regards`,
    };
  }
}

export async function getMarketInsights(firmName: string) {
  try {
    const { text } = await callGemini({
      contents: `Provide recent news and market position for the Australian law firm: ${firmName}. Focus on partner moves, major cases, and financial performance.`,
      config: { tools: [{ googleSearch: {} }] },
    });
    return text;
  } catch (err) {
    console.error("[aiService] getMarketInsights error:", err);
    return "Market insights temporarily unavailable.";
  }
}

export async function discoverItems(type: "Job" | "Candidate", query: string, context?: any) {
  let prompt = "";

  if (type === "Job") {
    prompt = `Find recent legal job openings for: ${query}.
Search law firm career pages and legal job boards.
Extract practice area, PQE requirements, and salary where available.
Return a list of jobs with title, company, location, and URL.`;
  } else {
    const jobContext = context
      ? `\nSearching for candidates matching:\n- Practice Area: ${context.practiceArea || "Legal"}\n- PQE: ${context.pqe || "Any"}\n- Job Highlights: ${context.description?.substring(0, 400) || ""}`
      : "";
    prompt = `Find legal professionals matching: ${query}.${jobContext}
Search public profiles on LinkedIn or law firm "Our People" pages.
Calibrate confidence 0–1 by profile completeness.
Return a list with: title (name), company (current firm), location, url, confidence, metadata.`;
  }

  const { text } = await callGemini({
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title:      { type: Type.STRING },
                company:    { type: Type.STRING },
                location:   { type: Type.STRING },
                url:        { type: Type.STRING },
                confidence: { type: Type.NUMBER },
                metadata: {
                  type: Type.OBJECT,
                  properties: {
                    practiceArea: { type: Type.STRING },
                    pqe:          { type: Type.STRING },
                    skills:       { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                },
              },
              required: ["title", "url"],
            },
          },
        },
        required: ["items"],
      },
    },
  });

  return JSON.parse(text).items;
}

export async function scrapeUrl(url: string, type: "Job" | "Candidate") {
  const prompt =
    type === "Job"
      ? `Extract job details from this URL: ${url}. I need: title, company, location, description, practiceArea, pqe. Return as JSON.`
      : `Extract candidate details from this profile URL: ${url}. I need: name, currentFirm, location, practiceArea, pqeYears (integer), profileSummary. Return as JSON.`;

  const schema =
    type === "Job"
      ? {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING }, company: { type: Type.STRING },
            location: { type: Type.STRING }, description: { type: Type.STRING },
            practiceArea: { type: Type.STRING }, pqe: { type: Type.STRING },
          },
          required: ["title", "company"],
        }
      : {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING }, currentFirm: { type: Type.STRING },
            location: { type: Type.STRING }, practiceArea: { type: Type.STRING },
            pqeYears: { type: Type.INTEGER }, profileSummary: { type: Type.STRING },
          },
          required: ["name"],
        };

  const { text } = await callGemini({
    contents: prompt,
    config: { tools: [{ urlContext: {} }], responseMimeType: "application/json", responseSchema: schema },
  });
  return JSON.parse(text);
}

export async function findSimilarCandidates(candidate: any) {
  const prompt = `
Based on this legal professional's profile, identify "lookalike" characteristics for the Australian legal market.

Name: ${candidate.name}
Firm: ${candidate.currentFirm}
Practice Area: ${candidate.practiceArea}
PQE: ${candidate.pqeYears} years
Location: ${candidate.location}

Return ONLY a JSON object with:
  searchKeywords  (array of strings)
  similarFirms    (array of strings — same tier/culture in Australia)
  keySkills       (array of strings)
  seniorityLevel  (string)
`.trim();

  try {
    const { text } = await callGemini({
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            searchKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
            similarFirms:   { type: Type.ARRAY, items: { type: Type.STRING } },
            keySkills:      { type: Type.ARRAY, items: { type: Type.STRING } },
            seniorityLevel: { type: Type.STRING },
          },
          required: ["searchKeywords", "similarFirms", "keySkills", "seniorityLevel"],
        },
      },
    });
    return JSON.parse(text);
  } catch (err) {
    console.error("[aiService] findSimilarCandidates error:", err);
    throw err;
  }
}

export async function generateInterviewQuestions(job: any, candidate: any) {
  const prompt = `
Generate 5 tailored interview questions for a legal recruiter to ask this candidate.
Focus on practice-specific technical skills, PQE-appropriate experience, and cultural fit.

Job: ${job.title} at ${job.company} (${job.practiceArea})
Candidate: ${candidate.name} (${candidate.pqeYears} yrs PQE, ${candidate.practiceArea})

Return ONLY a JSON object with:
  questions (array of objects with 'question' and 'rationale' strings)
`.trim();

  try {
    const { text } = await callGemini({
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question:  { type: Type.STRING },
                  rationale: { type: Type.STRING },
                },
                required: ["question", "rationale"],
              },
            },
          },
          required: ["questions"],
        },
      },
    });
    return JSON.parse(text).questions;
  } catch (err) {
    console.error("[aiService] generateInterviewQuestions error:", err);
    throw err;
  }
}

export async function getSalaryBenchmark(practiceArea: string, pqeYears: number, location: string) {
  const prompt = `
Provide a salary benchmark for the Australian legal market (FY 2025/26) for:
Practice Area: ${practiceArea}
PQE: ${pqeYears} years
Location: ${location}

Return ONLY a JSON object with:
  lowRange         (number, AUD)
  highRange        (number, AUD)
  median           (number, AUD)
  marketCommentary (string)
  topPayingFirms   (array of strings)
`.trim();

  try {
    const { text } = await callGemini({
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            lowRange:         { type: Type.NUMBER },
            highRange:        { type: Type.NUMBER },
            median:           { type: Type.NUMBER },
            marketCommentary: { type: Type.STRING },
            topPayingFirms:   { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ["lowRange", "highRange", "median", "marketCommentary"],
        },
      },
    });
    return JSON.parse(text);
  } catch (err) {
    console.error("[aiService] getSalaryBenchmark error:", err);
    throw err;
  }
}

export async function getMarketSentiment() {
  const prompt = `
Provide a brief 3-sentence "Market Sentiment" update for the Australian legal recruitment market as of early 2026.
Focus on:
1. Most in-demand practice areas.
2. Salary trend direction.
3. Candidate availability (active vs passive).

Return ONLY a JSON object with:
  sentiment         (string: "Bullish" | "Neutral" | "Tight")
  summary           (string, 3 sentences)
  trendingAreas     (array of strings)
  averagePqeDemand  (string, e.g. "3–5 years")
`.trim();

  try {
    const { text } = await callGemini({
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sentiment:        { type: Type.STRING },
            summary:          { type: Type.STRING },
            trendingAreas:    { type: Type.ARRAY, items: { type: Type.STRING } },
            averagePqeDemand: { type: Type.STRING },
          },
          required: ["sentiment", "summary", "trendingAreas", "averagePqeDemand"],
        },
      },
    });
    return JSON.parse(text);
  } catch (err) {
    console.error("[aiService] getMarketSentiment error:", err);
    throw err;
  }
}
