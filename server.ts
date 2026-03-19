import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import multer from "multer";
import Database from "better-sqlite3";
import { scoreMatch, generateOutreach } from "./src/services/aiService";
import { scoreMatch as baselineScore, batchScore } from "./src/services/legalMatchScorer";
import { LocalScraper } from "./src/services/localScraper";
import { ApifyClient } from "apify-client";
import admin from "firebase-admin";
import fs from "fs";
import rateLimit from "express-rate-limit";
import { GoogleGenAI } from "@google/genai";

// Load Firebase configuration
let firestore: admin.firestore.Firestore;
try {
  const firebaseConfig = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));
  admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
  firestore = admin.firestore(firebaseConfig.firestoreDatabaseId);
} catch (error) {
  console.error("Firebase initialization failed:", error);
  // Fallback to default firestore if possible or handle gracefully
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({ dest: "uploads/" });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Gemini Proxy with Rate Limiting
  const geminiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // limit each IP to 60 requests per windowMs
    message: { error: "Too many requests to Gemini API, please try again later." }
  });

  app.post("/api/gemini", geminiLimiter, async (req, res) => {
    const { model, contents, config } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Gemini API key not configured on server." });
    }

    try {
      console.log(`[Gemini Proxy] Request to model: ${model}`);
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: model || "gemini-3-flash-preview",
        contents,
        config
      });

      // Estimate token count (rough estimate: 4 chars per token)
      const inputLength = JSON.stringify(contents).length;
      const outputLength = response.text?.length || 0;
      const estTokens = Math.ceil((inputLength + outputLength) / 4);
      
      console.log(`[Gemini Proxy] Success. Estimated tokens: ${estTokens}`);
      res.json(response);
    } catch (error: any) {
      console.error("[Gemini Proxy] Error:", error);
      res.status(500).json({ error: error.message || "Failed to call Gemini API" });
    }
  });

  // FMA Proxy (Placeholder for now)
  app.post("/api/fma-enrich", async (req, res) => {
    const apiKey = process.env.FMA_API_KEY;
    if (!apiKey) return res.status(400).json({ error: "FMA API key not set" });
    // Implementation would go here
    res.json({ message: "FMA enrichment coming soon" });
  });

  // Initialize Database
  const db = new Database("nirvana.db");
  db.pragma("journal_mode = WAL");

  // Create tables if they don't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT,
      description TEXT,
      salary TEXT,
      pqe TEXT,
      practice_area TEXT,
      source_platform TEXT,
      job_url TEXT,
      scraped_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'Active'
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      location TEXT,
      current_firm TEXT,
      practice_area TEXT,
      pqe_years INTEGER,
      profile_summary TEXT,
      profile_url TEXT,
      skills TEXT,
      experience TEXT,
      status TEXT DEFAULT 'New',
      source_platform TEXT,
      scraped_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      cv_path TEXT
    );

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      industry TEXT,
      contact_person TEXT,
      email TEXT,
      status TEXT DEFAULT 'Active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS candidate_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id TEXT,
      job_id TEXT,
      stage TEXT NOT NULL, -- 'Applied', 'Screening', 'Interview', 'Offer', 'Placed', 'Rejected'
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(candidate_id) REFERENCES candidates(id),
      FOREIGN KEY(job_id) REFERENCES jobs(id)
    );

    CREATE TABLE IF NOT EXISTS candidate_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id TEXT,
      author TEXT,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(candidate_id) REFERENCES candidates(id)
    );

    CREATE TABLE IF NOT EXISTS placements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id TEXT,
      job_id TEXT,
      fee REAL,
      start_date DATE,
      status TEXT DEFAULT 'Pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(candidate_id) REFERENCES candidates(id),
      FOREIGN KEY(job_id) REFERENCES jobs(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT OR IGNORE INTO settings (key, value) VALUES ('aiBackend', 'gemini');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('dataBackend', 'sqlite');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('emailBackend', 'local');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('schedulerEnabled', 'false');

    CREATE TABLE IF NOT EXISTS followup_sequences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      steps TEXT, -- JSON array of steps
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id TEXT,
      job_id TEXT,
      title TEXT,
      start_time DATETIME,
      end_time DATETIME,
      location TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(candidate_id) REFERENCES candidates(id),
      FOREIGN KEY(job_id) REFERENCES jobs(id)
    );

    CREATE TABLE IF NOT EXISTS jobs_discovered (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      company TEXT,
      url TEXT UNIQUE,
      source TEXT,
      discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS candidates_discovered (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      profile_url TEXT UNIQUE,
      source TEXT,
      discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS discovery_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER,
      candidate_id INTEGER,
      score REAL,
      reasons TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(job_id) REFERENCES jobs_discovered(id),
      FOREIGN KEY(candidate_id) REFERENCES candidates_discovered(id)
    );

    CREATE TABLE IF NOT EXISTS discovery_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT,
      results_count INTEGER,
      apify_run_id TEXT,
      search_params TEXT, -- JSON string of search params
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      candidate_id TEXT,
      baseline_score REAL,
      llm_score REAL,
      match_reasons TEXT,
      match_summary TEXT,
      status TEXT DEFAULT 'Pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(job_id) REFERENCES jobs(id),
      FOREIGN KEY(candidate_id) REFERENCES candidates(id)
    );

    CREATE TABLE IF NOT EXISTS outreach_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id TEXT,
      job_id TEXT,
      type TEXT, -- 'Candidate' or 'Employer'
      status TEXT, -- 'Draft', 'Sent', 'Opened', 'Replied'
      subject TEXT,
      body TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(candidate_id) REFERENCES candidates(id),
      FOREIGN KEY(job_id) REFERENCES jobs(id)
    );
  `);

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", backend: "sqlite" });
  });

  app.get("/api/clients", (req, res) => {
    const clients = db.prepare("SELECT * FROM clients ORDER BY name ASC").all();
    res.json(clients);
  });

  app.get("/api/pipeline", (req, res) => {
    const pipeline = db.prepare(`
      SELECT cs.*, c.name as candidate_name, j.title as job_title, j.company as job_company
      FROM candidate_stages cs
      JOIN candidates c ON cs.candidate_id = c.id
      JOIN jobs j ON cs.job_id = j.id
      ORDER BY cs.updated_at DESC
    `).all();
    res.json(pipeline);
  });

  app.get("/api/candidates/:id/notes", (req, res) => {
    const notes = db.prepare("SELECT * FROM candidate_notes WHERE candidate_id = ? ORDER BY created_at DESC").all(req.params.id);
    res.json(notes);
  });

  app.post("/api/candidates/:id/notes", (req, res) => {
    const { content, author } = req.body;
    const result = db.prepare("INSERT INTO candidate_notes (candidate_id, content, author) VALUES (?, ?, ?)")
      .run(req.params.id, content, author || "System");
    res.json({ id: result.lastInsertRowid });
  });

  app.patch("/api/pipeline/:id/stage", (req, res) => {
    const { stage } = req.body;
    db.prepare("UPDATE candidate_stages SET stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(stage, req.params.id);
    res.json({ success: true });
  });

  app.post("/api/candidates/:id/cv", upload.single("cv"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    db.prepare("UPDATE candidates SET cv_path = ? WHERE id = ?").run(req.file.path, req.params.id);
    res.json({ success: true, path: req.file.path });
  });

  app.post("/api/matches/:id/score", async (req, res) => {
    // Try SQLite first
    let match = db.prepare(`
      SELECT m.*, j.title, j.company, j.practice_area, j.pqe, j.description,
             c.name, c.current_firm, c.practice_area as candidate_practice_area, c.pqe_years, c.profile_summary
      FROM matches m
      JOIN jobs j ON m.job_id = j.id
      JOIN candidates c ON m.candidate_id = c.id
      WHERE m.id = ?
    `).get(req.params.id) as any;

    if (!match) {
      // Try Firestore
      try {
        const matchDoc = await firestore.collection("matches").doc(req.params.id).get();
        if (matchDoc.exists) {
          const matchData = matchDoc.data()!;
          const jobDoc = await firestore.collection("jobs").doc(matchData.jobId).get();
          const candDoc = await firestore.collection("candidates").doc(matchData.candidateId).get();
          
          if (jobDoc.exists && candDoc.exists) {
            const job = jobDoc.data()!;
            const cand = candDoc.data()!;
            match = {
              ...matchData,
              title: job.title, company: job.company, practice_area: job.practiceArea, pqe: job.pqe, description: job.description,
              name: cand.name, current_firm: cand.currentFirm, candidate_practice_area: cand.practiceArea, pqe_years: cand.pqe_years, profile_summary: cand.profileSummary
            };
          }
        }
      } catch (error) {
        console.error("Firestore fetch error (score):", error);
      }
    }

    if (!match) return res.status(404).json({ error: "Match not found" });

    // NEW: Use baseline scorer as pre-filter
    const baseline = baselineScore(
      { name: match.name, current_firm: match.current_firm, practice_area: match.candidate_practice_area, pqe_years: match.pqe_years, profile_summary: match.profile_summary },
      { title: match.title, company: match.company, practice_area: match.practice_area, pqe: match.pqe, description: match.description }
    );

    if (!baseline.hard_filter_pass) {
      return res.json({
        score: 0,
        reasons: ["Hard filter failed: " + baseline.excluded_reason],
        summary: "This match does not meet the minimum requirements for location, practice area, or PQE."
      });
    }

    const aiResult = await scoreMatch(
      { title: match.title, company: match.company, practice_area: match.practice_area, pqe: match.pqe, description: match.description },
      { name: match.name, current_firm: match.current_firm, practice_area: match.candidate_practice_area, pqe_years: match.pqe_years, profile_summary: match.profile_summary }
    );

    // Update SQLite if it exists there
    db.prepare("UPDATE matches SET llm_score = ?, match_reasons = ?, match_summary = ? WHERE id = ?")
      .run(aiResult.score, JSON.stringify(aiResult.reasons), aiResult.summary, req.params.id);

    // Update Firestore
    try {
      await firestore.collection("matches").doc(req.params.id).set({
        llmScore: aiResult.score,
        matchReasons: aiResult.reasons,
        matchSummary: aiResult.summary,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (error) {
      console.error("Firestore update error (score):", error);
    }

    res.json(aiResult);
  });

  app.post("/api/matches/:id/outreach", async (req, res) => {
    // Try SQLite first
    let match = db.prepare(`
      SELECT m.*, 
             j.title as job_title, j.company as job_company, j.practice_area as job_practice_area, j.pqe as job_pqe, j.description as job_description,
             c.name as candidate_name, c.practice_area as candidate_practice_area, c.pqe_years as candidate_pqe_years
      FROM matches m
      JOIN jobs j ON m.job_id = j.id
      JOIN candidates c ON m.candidate_id = c.id
      WHERE m.id = ?
    `).get(req.params.id) as any;

    if (!match) {
      // Try Firestore
      try {
        const matchDoc = await firestore.collection("matches").doc(req.params.id).get();
        if (matchDoc.exists) {
          const matchData = matchDoc.data()!;
          const jobDoc = await firestore.collection("jobs").doc(matchData.jobId).get();
          const candDoc = await firestore.collection("candidates").doc(matchData.candidateId).get();
          
          if (jobDoc.exists && candDoc.exists) {
            const job = jobDoc.data()!;
            const cand = candDoc.data()!;
            match = {
              ...matchData,
              job_title: job.title, job_company: job.company, job_practice_area: job.practiceArea, job_pqe: job.pqe, job_description: job.description,
              candidate_name: cand.name, candidate_practice_area: cand.practiceArea, candidate_pqe_years: cand.pqeYears
            };
          }
        }
      } catch (error) {
        console.error("Firestore fetch error (outreach):", error);
      }
    }

    if (!match) return res.status(404).json({ error: "Match not found" });

    const outreach = await generateOutreach(match);
    res.json(outreach);
  });


  app.post("/api/orchestrator/run", async (req, res) => {
    const { keywords = "lawyer", location = "Sydney" } = req.body;
    const scraper = new LocalScraper();

    try {
      console.log(`Starting orchestrator run for keywords: ${keywords}, location: ${location}`);
      
      const [jobs, candidates] = await Promise.all([
        scraper.scrapeJobs(keywords, location),
        scraper.scrapeCandidates(keywords, location)
      ]);

      console.log(`Scraped ${jobs.length} jobs and ${candidates.length} candidates.`);

      // Prepare DB statements
      const insertJob = db.prepare(`
        INSERT OR REPLACE INTO jobs (id, title, company, location, practice_area, salary, job_url, source_platform)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertCandidate = db.prepare(`
        INSERT OR REPLACE INTO candidates (id, name, current_firm, location, practice_area, pqe_years, status, profile_url, source_platform)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // 1. Sync to SQLite (Synchronous Transaction)
      const syncToSQLite = db.transaction(() => {
        for (const job of jobs) {
          const jobId = `j_${Buffer.from(job.url).toString('base64').substring(0, 10)}`;
          insertJob.run(jobId, job.title, job.company, job.location, job.practice_area, job.salary, job.url, job.source);
        }

        for (const cand of candidates) {
          const candId = `c_${Buffer.from(cand.profile_url).toString('base64').substring(0, 10)}`;
          const pqeMatch = cand.pqe_estimate.match(/\d+/);
          const pqeYears = pqeMatch ? parseInt(pqeMatch[0]) : 0;
          
          insertCandidate.run(
            candId, 
            cand.name, 
            cand.current_firm, 
            cand.location, 
            cand.practice_areas.join(', '), 
            pqeYears, 
            'New', 
            cand.profile_url, 
            cand.source
          );
        }
      });

      syncToSQLite();

      // 2. Sync to Firestore (Asynchronous)
      if (firestore) {
        console.log("Syncing to Firestore...");
        for (const job of jobs) {
          const jobId = `j_${Buffer.from(job.url).toString('base64').substring(0, 10)}`;
          try {
            await firestore.collection("jobs").doc(jobId).set({
              id: jobId,
              title: job.title,
              company: job.company,
              location: job.location,
              practiceArea: job.practice_area,
              salary: job.salary,
              jobUrl: job.url,
              source: job.source,
              createdAt: new Date().toISOString()
            });
          } catch (e) {
            console.error(`Firestore job sync error: ${e}`);
          }
        }

        for (const cand of candidates) {
          const candId = `c_${Buffer.from(cand.profile_url).toString('base64').substring(0, 10)}`;
          const pqeMatch = cand.pqe_estimate.match(/\d+/);
          const pqeYears = pqeMatch ? parseInt(pqeMatch[0]) : 0;
          
          try {
            await firestore.collection("candidates").doc(candId).set({
              id: candId,
              name: cand.name,
              currentFirm: cand.current_firm,
              location: cand.location,
              practiceArea: cand.practice_areas.join(', '),
              pqeYears: pqeYears,
              status: 'New',
              profileUrl: cand.profile_url,
              source: cand.source,
              createdAt: new Date().toISOString()
            });
          } catch (e) {
            console.error(`Firestore candidate sync error: ${e}`);
          }
        }
      } else {
        console.warn("Firestore not initialized, skipping Firestore sync.");
      }

      // NEW: Run matching algorithm
      console.log("Running matching algorithm...");
      const dbJobs = db.prepare("SELECT * FROM jobs").all();
      const dbCandidates = db.prepare("SELECT * FROM candidates").all();

      const matches = batchScore(dbCandidates, dbJobs, {
        minScore: parseFloat(process.env.LLM_MIN_BASELINE_SCORE || '6'),
        topN: parseInt(process.env.LLM_MAX_PAIRS_PER_RUN || '10'),
      });

      console.log(`Generated ${matches.length} baseline matches.`);

      const insertMatch = db.prepare(`
        INSERT OR REPLACE INTO matches (id, job_id, candidate_id, baseline_score, status, match_reasons)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const m of matches) {
        const matchId = `m_${m.job_id}_${m.candidate_id}`;
        insertMatch.run(
          matchId,
          m.job_id,
          m.candidate_id,
          m.score_10,
          'New',
          JSON.stringify(m.breakdown)
        );

        try {
          if (firestore) {
            await firestore.collection("matches").doc(matchId).set({
              id: matchId,
              jobId: m.job_id,
              candidateId: m.candidate_id,
              jobTitle: m.job_title,
              jobCompany: m.company,
              candidateName: m.candidate_name,
              baselineScore: m.score_10,
              status: 'New',
              matchReasons: m.breakdown,
              createdAt: new Date().toISOString()
            });
          }
        } catch (e) {
          console.error(`Firestore match sync error: ${e}`);
        }
      }

      res.json({ 
        status: "success", 
        message: "Orchestrator run completed.",
        stats: {
          jobsFound: jobs.length,
          candidatesFound: candidates.length,
          matchesGenerated: matches.length
        }
      });
    } catch (error) {
      console.error("Orchestrator run failed:", error);
      res.status(500).json({ error: "Orchestrator run failed", details: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/discovery/local/run", async (req, res) => {
    const { keywords = "lawyer", location = "Sydney", type = "Job" } = req.body;
    const scraper = new LocalScraper();

    try {
      console.log(`Starting local discovery run for type: ${type}, keywords: ${keywords}, location: ${location}`);
      
      let results: any[] = [];
      if (type === "Job") {
        results = await scraper.scrapeJobs(keywords, location);
      } else {
        results = await scraper.scrapeCandidates(keywords, location);
      }

      // Sync to Firestore discovery collection
      for (const result of results) {
        const docId = `disc_${Buffer.from(result.url || result.profile_url).toString('base64').substring(0, 15)}`;
        try {
          await firestore.collection("discovery").doc(docId).set({
            type: type,
            title: result.title || result.name,
            company: result.company || result.current_firm || "",
            location: result.location || "",
            url: result.url || result.profile_url,
            source: result.source || "Local Scraper",
            confidence: 0.9,
            status: "New",
            discoveredAt: new Date().toISOString(),
            metadata: {
              practiceArea: result.practice_area || (result.practice_areas ? result.practice_areas.join(', ') : ""),
              pqe: result.pqe || result.pqe_estimate || ""
            }
          });
        } catch (e) {
          console.error(`Firestore discovery sync error: ${e}`);
        }
      }

      res.json({ 
        status: "success", 
        message: "Local discovery run completed.",
        resultsCount: results.length
      });
    } catch (error) {
      console.error("Local discovery run failed:", error);
      res.status(500).json({ error: "Local discovery run failed", details: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/jobs", (req, res) => {
    const jobs = db.prepare("SELECT * FROM jobs ORDER BY scraped_date DESC").all();
    res.json(jobs);
  });

  app.get("/api/candidates", (req, res) => {
    const candidates = db.prepare("SELECT * FROM candidates ORDER BY scraped_date DESC").all();
    res.json(candidates);
  });

  app.get("/api/matches", (req, res) => {
    const matches = db.prepare(`
      SELECT m.*, j.title as job_title, j.company as job_company, c.name as candidate_name
      FROM matches m
      JOIN jobs j ON m.job_id = j.id
      JOIN candidates c ON m.candidate_id = c.id
      ORDER BY m.created_at DESC
    `).all();
    res.json(matches);
  });

  // Discovery Routes
  app.get("/api/discovery/status", (req, res) => {
    const lastRun = db.prepare("SELECT * FROM discovery_runs ORDER BY started_at DESC LIMIT 1").get();
    res.json({ enabled: true, lastRun });
  });

  app.get("/api/discovery/jobs", (req, res) => {
    const jobs = db.prepare("SELECT * FROM jobs_discovered ORDER BY discovered_at DESC").all();
    res.json(jobs);
  });

  app.get("/api/discovery/candidates", (req, res) => {
    const candidates = db.prepare("SELECT * FROM candidates_discovered ORDER BY discovered_at DESC").all();
    res.json(candidates);
  });

  app.get("/api/discovery/matches", (req, res) => {
    const matches = db.prepare(`
      SELECT dm.*, jd.title as job_title, jd.company as job_company, cd.name as candidate_name
      FROM discovery_matches dm
      JOIN jobs_discovered jd ON dm.job_id = jd.id
      JOIN candidates_discovered cd ON dm.candidate_id = cd.id
      ORDER BY dm.created_at DESC
    `).all();
    res.json(matches);
  });

  app.post("/api/discovery/run", (req, res) => {
    const runId = db.prepare("INSERT INTO discovery_runs (status) VALUES (?)").run("Running").lastInsertRowid;
    
    // Mock discovery logic
    setTimeout(() => {
      db.prepare("UPDATE discovery_runs SET status = ?, results_count = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run("Completed", 5, runId);
      
      db.prepare("INSERT OR IGNORE INTO jobs_discovered (title, company, url, source) VALUES (?, ?, ?, ?)")
        .run("Partner - M&A", "Global Law Firm", "https://example.com/job/p1", "Discovery Agent");
      
      db.prepare("INSERT OR IGNORE INTO candidates_discovered (name, profile_url, source) VALUES (?, ?, ?)")
        .run("Jane Doe", "https://linkedin.com/in/janedoe", "Discovery Agent");
    }, 2000);

    res.json({ id: runId, status: "Started" });
  });

  // Apify Discovery Routes
  const apifyToken = process.env.APIFY_API_TOKEN;
  const apifyActorId = process.env.APIFY_ACTOR_ID || "pIyH7237rHZBxoO7q";
  
  let apifyClient: ApifyClient | null = null;
  if (apifyToken) {
    apifyClient = new ApifyClient({ token: apifyToken });
  }

  app.post("/api/discovery/apify/run", async (req, res) => {
    if (!apifyClient) {
      return res.status(400).json({ error: "Apify API token not configured. Please set APIFY_API_TOKEN in environment variables." });
    }
    const { firstname, lastname, location, current_job_title, max_profiles } = req.body;
    
    try {
      const runInput = {
        firstname: firstname || "",
        lastname: lastname || "",
        max_profiles: max_profiles || 10,
        location: location || "",
        current_job_title: current_job_title || "",
        include_email: true,
      };

      const run = await apifyClient.actor(apifyActorId).start(runInput);
      
      const runId = db.prepare("INSERT INTO discovery_runs (status, apify_run_id, search_params) VALUES (?, ?, ?)")
        .run("Running", run.id, JSON.stringify(runInput)).lastInsertRowid;

      res.json({ id: runId, apify_run_id: run.id, status: "Started" });
    } catch (error: any) {
      console.error("Apify Run Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/discovery/apify/runs", (req, res) => {
    const runs = db.prepare("SELECT * FROM discovery_runs WHERE apify_run_id IS NOT NULL ORDER BY started_at DESC").all();
    res.json(runs);
  });

  app.get("/api/discovery/apify/runs/:id", async (req, res) => {
    if (!apifyClient) {
      return res.status(400).json({ error: "Apify API token not configured." });
    }
    const run = db.prepare("SELECT * FROM discovery_runs WHERE id = ?").get(req.params.id) as any;
    if (!run) return res.status(404).json({ error: "Run not found" });

    if (run.status === "Running") {
      try {
        const apifyRun = await apifyClient.run(run.apify_run_id).get();
        if (apifyRun?.status === "SUCCEEDED") {
          const dataset = await apifyClient.dataset(apifyRun.defaultDatasetId).listItems();
          
          db.prepare("UPDATE discovery_runs SET status = ?, results_count = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run("Completed", dataset.items.length, req.params.id);
          
          // Insert into candidates_discovered
          const insertCandidate = db.prepare("INSERT OR IGNORE INTO candidates_discovered (name, profile_url, source) VALUES (?, ?, ?)");
          for (const item of dataset.items as any[]) {
            insertCandidate.run(item.fullName || item.name || "Unknown", item.url || item.profileUrl || "", "Apify Scraper");
          }
          
          run.status = "Completed";
          run.results = dataset.items;
        } else if (apifyRun?.status === "FAILED" || apifyRun?.status === "ABORTED" || apifyRun?.status === "TIMED-OUT") {
          db.prepare("UPDATE discovery_runs SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(apifyRun.status, req.params.id);
          run.status = apifyRun.status;
        }
      } catch (error: any) {
        console.error("Apify Status Error:", error);
      }
    } else if (run.status === "Completed") {
      try {
        const apifyRun = await apifyClient.run(run.apify_run_id).get();
        if (apifyRun) {
          const dataset = await apifyClient.dataset(apifyRun.defaultDatasetId).listItems();
          run.results = dataset.items;
        }
      } catch (error: any) {
        console.error("Apify Results Error:", error);
      }
    }

    res.json(run);
  });

  app.delete("/api/discovery/apify/runs/:id", (req, res) => {
    try {
      db.prepare("DELETE FROM discovery_runs WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/discovery/apify/import", (req, res) => {
    const { candidate } = req.body;
    
    try {
      // Check if candidate already exists by profile URL
      const profileUrl = candidate.url || candidate.profileUrl || "";
      const existing = db.prepare("SELECT id FROM candidates WHERE profile_url = ?").get(profileUrl) as any;
      
      if (existing) {
        return res.json({ success: true, id: existing.id, message: "Candidate already exists" });
      }

      const id = `c_${Date.now()}`;
      db.prepare(`
        INSERT INTO candidates (id, name, location, current_firm, profile_url, skills, experience, profile_summary, source_platform)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        candidate.fullName || candidate.name || "Unknown",
        candidate.location || "",
        candidate.currentCompany || candidate.headline || "",
        profileUrl,
        JSON.stringify(candidate.skills || []),
        JSON.stringify(candidate.experience || []),
        candidate.summary || candidate.about || "",
        "LinkedIn (Apify)"
      );
      
      res.json({ success: true, id });
    } catch (error: any) {
      console.error("Import Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Analytics Route
  app.get("/api/analytics", (req, res) => {
    const jobCount = db.prepare("SELECT COUNT(*) as count FROM jobs").get() as any;
    const candidateCount = db.prepare("SELECT COUNT(*) as count FROM candidates").get() as any;
    const matchCount = db.prepare("SELECT COUNT(*) as count FROM matches WHERE llm_score >= 8").get() as any;
    const placementCount = db.prepare("SELECT COUNT(*) as count FROM placements WHERE status = 'Completed'").get() as any;

    res.json({
      jobs: jobCount.count,
      candidates: candidateCount.count,
      strongMatches: matchCount.count,
      placements: placementCount.count,
      pipeline: [
        { name: "Applied", count: db.prepare("SELECT COUNT(*) as count FROM candidate_stages WHERE stage = 'Applied'").get() },
        { name: "Screening", count: db.prepare("SELECT COUNT(*) as count FROM candidate_stages WHERE stage = 'Screening'").get() },
        { name: "Interview", count: db.prepare("SELECT COUNT(*) as count FROM candidate_stages WHERE stage = 'Interview'").get() },
        { name: "Offer", count: db.prepare("SELECT COUNT(*) as count FROM candidate_stages WHERE stage = 'Offer'").get() },
        { name: "Placed", count: db.prepare("SELECT COUNT(*) as count FROM candidate_stages WHERE stage = 'Placed'").get() },
      ]
    });
  });

  // Meetings Routes
  app.get("/api/meetings", (req, res) => {
    const meetings = db.prepare(`
      SELECT m.*, c.name as candidate_name, j.title as job_title
      FROM meetings m
      LEFT JOIN candidates c ON m.candidate_id = c.id
      LEFT JOIN jobs j ON m.job_id = j.id
      ORDER BY m.start_time ASC
    `).all();
    res.json(meetings);
  });

  // Sequences Routes
  app.get("/api/sequences", (req, res) => {
    const sequences = db.prepare("SELECT * FROM followup_sequences").all();
    res.json(sequences);
  });

  // Settings Route
  app.get("/api/settings", (req, res) => {
    const settingsRows = db.prepare("SELECT * FROM settings").all();
    const settings: any = {};
    settingsRows.forEach((row: any) => {
      settings[row.key] = row.value === 'true' ? true : row.value === 'false' ? false : row.value;
    });
    res.json(settings);
  });

  app.post("/api/settings", (req, res) => {
    const settings = req.body;
    const upsert = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
    
    const transaction = db.transaction(() => {
      Object.entries(settings).forEach(([key, value]) => {
        upsert.run(key, String(value));
      });
    });
    
    transaction();
    res.json({ status: "success" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
