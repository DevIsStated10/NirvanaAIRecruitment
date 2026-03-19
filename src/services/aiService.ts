import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function scoreMatch(job: any, candidate: any) {
  if (!process.env.GEMINI_API_KEY) {
    return {
      score: 7.0,
      reasons: ["Gemini API key not configured. Using baseline score."],
      summary: "Baseline match based on practice area and location."
    };
  }

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
    
    Return a JSON object with:
    - score (number, 0-10)
    - reasons (array of strings)
    - summary (string, max 200 characters)
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER },
            reasons: { type: Type.ARRAY, items: { type: Type.STRING } },
            summary: { type: Type.STRING }
          },
          required: ["score", "reasons", "summary"]
        }
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("AI Scoring error:", error);
    return {
      score: 5.0,
      reasons: ["AI scoring failed due to an error."],
      summary: "Error during AI analysis."
    };
  }
}

export async function generateOutreach(match: any) {
  if (!process.env.GEMINI_API_KEY) {
    return {
      subject: `Opportunity: ${match.job_title} at ${match.job_company}`,
      body: `Hi ${match.candidate_name},\n\nI saw your profile and thought you'd be a great fit for the ${match.job_title} role at ${match.job_company}. Given your background in ${match.candidate_practice_area} and ${match.candidate_pqe_years} years of experience, I'd love to discuss this further.\n\n[Insert link to schedule a call]\n\nBest regards,\nRecruitment Team`
    };
  }

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
    - Personalize the email based on the candidate's experience and the job's requirements.
    - Mention why they are a strong match.
    - Keep it professional yet engaging.
    - Include a clear call-to-action placeholder at the end, e.g., "[Insert link to schedule a call]".
    
    Return a JSON object with:
    - subject (string)
    - body (string)
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            body: { type: Type.STRING }
          },
          required: ["subject", "body"]
        }
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("AI Outreach error:", error);
    return {
      subject: "New Opportunity",
      body: "Failed to generate body."
    };
  }
}

export async function getMarketInsights(firmName: string) {
  if (!process.env.GEMINI_API_KEY) {
    return "Market insights unavailable without API key.";
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Provide recent news and market position for the law firm: ${firmName}. Focus on recent partner moves, major cases, or financial performance.`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    return response.text;
  } catch (error) {
    console.error("Market Insights error:", error);
    return "Failed to fetch market insights.";
  }
}

export async function discoverItems(type: "Job" | "Candidate", query: string, context?: any) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key not configured.");
  }

  let prompt = "";
  if (type === "Job") {
    prompt = `Find recent legal job openings for: ${query}. 
    Search for roles on law firm career pages and legal job boards. 
    Focus on extracting specific details like practice area, PQE requirements, and salary if available.
    Return a list of jobs with title, company, location, and URL.`;
  } else {
    const jobContext = context ? `
    Searching for candidates matching these specific job requirements:
    - Target Practice Area: ${context.practiceArea || "Legal"}
    - Target PQE: ${context.pqe || "Any"}
    - Job Description Highlights: ${context.description?.substring(0, 500) || "N/A"}
    ` : "";

    prompt = `Find legal professionals (candidates) matching: ${query}. 
    ${jobContext}
    Search for public profiles on LinkedIn or law firm "Our People" pages. 
    
    Guidelines for Candidate Discovery:
    - Derive specific search keywords from the query and job context (e.g., specific law firm names, niche practice areas, bar admissions).
    - Filter results strictly to those matching the practice area and PQE level if specified.
    - Calibrate the "confidence" score (0.0 to 1.0) based on profile completeness:
      - 1.0: Full name, current firm, exact practice area match, clear PQE indication, and profile URL.
      - 0.7: Missing one minor detail but strong practice area match.
      - 0.4: Vague profile or partial match.
    
    Return a list of candidates with name, current firm, location, and profile URL.`;
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
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
                  title: { type: Type.STRING, description: "Job title or Candidate name" },
                  company: { type: Type.STRING, description: "Company name or Current Law Firm" },
                  location: { type: Type.STRING },
                  url: { type: Type.STRING },
                  confidence: { type: Type.NUMBER, description: "Score from 0 to 1 calibrated by profile completeness" },
                  metadata: { 
                    type: Type.OBJECT,
                    properties: {
                      practiceArea: { type: Type.STRING },
                      pqe: { type: Type.STRING },
                      skills: { type: Type.ARRAY, items: { type: Type.STRING } }
                    }
                  }
                },
                required: ["title", "url"]
              }
            }
          },
          required: ["items"]
        }
      }
    });

    return JSON.parse(response.text).items;
  } catch (error) {
    console.error("Discovery error:", error);
    throw error;
  }
}

export async function scrapeUrl(url: string, type: "Job" | "Candidate") {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key not configured.");
  }

  const prompt = type === "Job"
    ? `Extract job details from this URL: ${url}. I need: title, company, location, description, practice area, and PQE requirements. Return as JSON.`
    : `Extract candidate details from this profile URL: ${url}. I need: name, current firm, location, practice area, PQE years (as integer), and profile summary. Return as JSON.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ urlContext: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: type === "Job" ? {
            title: { type: Type.STRING },
            company: { type: Type.STRING },
            location: { type: Type.STRING },
            description: { type: Type.STRING },
            practiceArea: { type: Type.STRING },
            pqe: { type: Type.STRING }
          } : {
            name: { type: Type.STRING },
            currentFirm: { type: Type.STRING },
            location: { type: Type.STRING },
            practiceArea: { type: Type.STRING },
            pqeYears: { type: Type.INTEGER },
            profileSummary: { type: Type.STRING }
          },
          required: type === "Job" ? ["title", "company"] : ["name"]
        }
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("Scraping error:", error);
    throw error;
  }
}

export async function findSimilarCandidates(candidate: any) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key not configured.");
  }

  const prompt = `
    Based on this legal professional's profile, identify the key "lookalike" characteristics for finding similar candidates in the Australian legal market.
    
    Candidate:
    Name: ${candidate.name}
    Firm: ${candidate.currentFirm}
    Practice Area: ${candidate.practiceArea}
    PQE: ${candidate.pqeYears} years
    Location: ${candidate.location}
    
    Return a JSON object with:
    - searchKeywords (array of strings for Google/LinkedIn searching)
    - similarFirms (array of strings of firms with similar tier/culture in Australia)
    - keySkills (array of strings)
    - seniorityLevel (string, e.g., "Senior Associate", "Special Counsel")
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            searchKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
            similarFirms: { type: Type.ARRAY, items: { type: Type.STRING } },
            keySkills: { type: Type.ARRAY, items: { type: Type.STRING } },
            seniorityLevel: { type: Type.STRING }
          },
          required: ["searchKeywords", "similarFirms", "keySkills", "seniorityLevel"]
        }
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("Find Similar error:", error);
    throw error;
  }
}

export async function generateInterviewQuestions(job: any, candidate: any) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key not configured.");
  }

  const prompt = `
    Generate 5 tailored interview questions for a legal recruiter to ask this candidate for this specific role in Australia.
    Focus on practice-specific technical skills, PQE-appropriate experience, and cultural fit for the firm.
    
    Job: ${job.title} at ${job.company} (${job.practiceArea})
    Candidate: ${candidate.name} (${candidate.pqeYears} yrs PQE, ${candidate.practiceArea})
    
    Return a JSON object with:
    - questions (array of objects with 'question' and 'rationale' strings)
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
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
                  question: { type: Type.STRING },
                  rationale: { type: Type.STRING }
                },
                required: ["question", "rationale"]
              }
            }
          },
          required: ["questions"]
        }
      }
    });

    return JSON.parse(response.text).questions;
  } catch (error) {
    console.error("Interview Questions error:", error);
    throw error;
  }
}

export async function getSalaryBenchmark(practiceArea: string, pqeYears: number, location: string) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key not configured.");
  }

  const prompt = `
    Provide a salary benchmark for the Australian legal market (FY 2024/25) for the following:
    Practice Area: ${practiceArea}
    PQE: ${pqeYears} years
    Location: ${location}
    
    Return a JSON object with:
    - lowRange (number, AUD)
    - highRange (number, AUD)
    - median (number, AUD)
    - marketCommentary (string, brief overview of demand/supply)
    - topPayingFirms (array of strings)
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            lowRange: { type: Type.NUMBER },
            highRange: { type: Type.NUMBER },
            median: { type: Type.NUMBER },
            marketCommentary: { type: Type.STRING },
            topPayingFirms: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["lowRange", "highRange", "median", "marketCommentary"]
        }
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("Salary Benchmark error:", error);
    throw error;
  }
}

export async function getMarketSentiment() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key not configured.");
  }

  const prompt = `
    Provide a brief, 3-sentence "Market Sentiment" update for the Australian legal recruitment market as of March 2026.
    Focus on:
    1. Most in-demand practice areas.
    2. Salary trend direction.
    3. Candidate availability (active vs passive).
    
    Return a JSON object with:
    - sentiment (string, e.g., "Bullish", "Neutral", "Tight")
    - summary (string, the 3-sentence update)
    - trendingAreas (array of strings)
    - averagePqeDemand (string, e.g., "3-5 years")
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sentiment: { type: Type.STRING },
            summary: { type: Type.STRING },
            trendingAreas: { type: Type.ARRAY, items: { type: Type.STRING } },
            averagePqeDemand: { type: Type.STRING }
          },
          required: ["sentiment", "summary", "trendingAreas", "averagePqeDemand"]
        }
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("Market Sentiment error:", error);
    throw error;
  }
}
