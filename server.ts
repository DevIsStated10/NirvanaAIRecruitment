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

// ─────────────────────────────────────────────────────────────────────────────
// Firebase initialisation
// ─────────────────────────────────────────────────────────────────────────────
let firestore: admin.firestore.Firestore;
try {
  const firebaseConfig = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));
  admin.initializeApp({ projectId: firebaseConfig.projectId });
  firestore = admin.firestore(firebaseConfig.firestoreDatabaseId);
} catch (error) {
  console.error("Firebase initialization failed:", error);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const upload = multer({ dest: "uploads/" });

// ─────────────────────────────────────────────────────────────────────────────
// Startup cost / safety check
// ─────────────────────────────────────────────────────────────────────────────
function runCostCheck() {
  const aiBackend = process.env.AI_BACKEND || "gemini";
  const dataBackend = process.env.DATA_BACKEND || "sqlite";
  console.log("\n──────────────────────────────────────────");
  console.log("  NirvanaAI — Startup Cost Check");
  console.log("──────────────────────────────────────────");
  console.log(`  AI Backend   : ${aiBackend}${aiBackend === "gemini" ? " ⚠ (charges may apply)" : " ✓ free"}`);
  console.log(`  Data Backend : ${dataBackend}${dataBackend === "firebase" ? " ⚠ (charges may apply)" : " ✓ free"}`);
  console.log(`  Email Sandbox: ${process.env.EMAIL_SANDBOX !== "false" ? "ON ✓" : "OFF ⚠"}`);
  console.log(`  Gemini Key   : ${process.env.GEMINI_API_KEY ? "set" : "not set"}`);
  console.log("──────────────────────────────────────────\n");
}

async function startServer() {
  runCostCheck();

  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  app.use(cors({ origin: process.env.FRONTEND_URL || true, credentials: true }));
  app.use(express.json({ limit: "10mb" }));

  // ─────────────────────────────────────────────────────────────────────────
  // FIX 1 — Gemini proxy (key stays server-side, never in the browser bundle)
  // ─────────────────────────────────────────────────────────────────────────
  const geminiLimiter = rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many AI requests — please wait a moment." },
  });

  app.post("/api/gemini", geminiLimiter, async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: "Gemini API key not configured on the server.",
        hint: "Add GEMINI_API_KEY to your .env file.",
      });
    }

    const { model, contents, config } = req.body;
    if (!contents) return res.status(400).json({ error: "contents is required" });

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: model || "gemini-2.0-flash",
        contents,
        config,
      });

      // Rough token estimate for cost logging
      const inputLen  = JSON.stringify(contents).length;
      const outputLen = response.text?.length || 0;
      const estTokens = Math.ceil((inputLen + outputLen) / 4);
      console.log(`[Gemini Proxy] model=${model || "gemini-2.0-flash"} ~${estTokens} tokens`);

      res.json(response);
    } catch (err: any) {
      console.error("[Gemini Proxy] Error:", err?.message);
      res.status(500).json({ error: err?.message || "Gemini call failed" });
    }
  });

  // FMA enrichment proxy — key stays server-side
  app.post("/api/fma-enrich", async (req, res) => {
    const apiKey = process.env.FMA_API_KEY;
    if (!apiKey) return res.status(503).json({ error: "FMA_API_KEY not configured" });
    const { linkedinUrl } = req.body;
    if (!linkedinUrl) return res.status(400).json({ error: "linkedinUrl required" });

    try {
      // ⚠ COST FLAG: FMA is a paid service — verify endpoint URL against real FMA docs
      const response = await fetch("https://api.fma.io/v1/enrich", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ linkedin_url: linkedinUrl }),
      });
      const data = await response.json() as any;
      res.json({ email: data.email, phone: data.phone, source: "fma" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SQLite initialisation
  // ─────────────────────────────────────────────────────────────────────────
  const db = new Database("nirvana.db");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

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
      stage TEXT NOT NULL,
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
      steps TEXT,
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
      search_params TEXT,
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
      type TEXT,
      status TEXT,
      subject TEXT,
      body TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(candidate_id) REFERENCES candidates(id),
      FOREIGN KEY(job_id) REFERENCES jobs(id)
    );
  `);

  // ─────────────────────────────────────────────────────────────────────────
  // Core API routes
  // ─────────────────────────────────────────────────────────────────────────

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", backend: "sqlite", ts: new Date().toISOString() });
  });

  // ── Clients ──────────────────────────────────────────────────────────────
  app.get("/api/clients", (_req, res) => {
    const clients = db.prepare("SELECT * FROM clients ORDER BY name ASC").all();
    res.json(clients);
  });

  app.post("/api/clients", (req, res) => {
    const { name, industry, contact_person, email, status = "Active" } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const id = `cl_${Date.now()}`;
    db.prepare(
      "INSERT INTO clients (id, name, industry, contact_person, email, status) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, name, industry || "", contact_person || "", email || "", status);
    res.json({ id });
  });

  // ── Pipeline ─────────────────────────────────────────────────────────────
  app.get("/api/pipeline", (_req, res) => {
    const pipeline = db.prepare(`
      SELECT cs.*, c.name as candidate_name, j.title as job_title, j.company as job_company
      FROM candidate_stages cs
      JOIN candidates c ON cs.candidate_id = c.id
      JOIN jobs j ON cs.job_id = j.id
      ORDER BY cs.updated_at DESC
    `).all();
    res.json(pipeline);
  });

  app.patch("/api/pipeline/:id/stage", (req, res) => {
    const { stage } = req.body;
    db.prepare("UPDATE candidate_stages SET stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(stage, req.params.id);
    res.json({ success: true });
  });

  // ── Candidate notes ───────────────────────────────────────────────────────
  app.get("/api/candidates/:id/notes", (req, res) => {
    const notes = db.prepare(
      "SELECT * FROM candidate_notes WHERE candidate_id = ? ORDER BY created_at DESC"
    ).all(req.params.id);
    res.json(notes);
  });

  app.post("/api/candidates/:id/notes", (req, res) => {
    const { content, author } = req.body;
    const result = db.prepare(
      "INSERT INTO candidate_notes (candidate_id, content, author) VALUES (?, ?, ?)"
    ).run(req.params.id, content, author || "System");
    res.json({ id: result.lastInsertRowid });
  });

  // ── CV upload ─────────────────────────────────────────────────────────────
  app.post("/api/candidates/:id/cv", upload.single("cv"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    db.prepare("UPDATE candidates SET cv_path = ? WHERE id = ?").run(req.file.path, req.params.id);
    res.json({ success: true, path: req.file.path });
  });

  // ── Jobs ─────────────────────────────────────────────────────────────────
  // FIX 3 — search queries the full DB with a WHERE clause, not just 20 visible records
  app.get("/api/jobs", (req, res) => {
    const { q, practice_area, location, status } = req.query as Record<string, string>;

    let sql = "SELECT * FROM jobs WHERE 1=1";
    const params: any[] = [];

    if (q) {
      sql += " AND (LOWER(title) LIKE ? OR LOWER(company) LIKE ? OR LOWER(description) LIKE ?)";
      const like = `%${q.toLowerCase()}%`;
      params.push(like, like, like);
    }
    if (practice_area && practice_area !== "All") {
      sql += " AND LOWER(practice_area) LIKE ?";
      params.push(`%${practice_area.toLowerCase()}%`);
    }
    if (location && location !== "All") {
      sql += " AND LOWER(location) LIKE ?";
      params.push(`%${location.toLowerCase()}%`);
    }
    if (status && status !== "All") {
      sql += " AND status = ?";
      params.push(status);
    }

    sql += " ORDER BY scraped_date DESC";
    const jobs = db.prepare(sql).all(...params);
    res.json(jobs);
  });

  // ── Candidates ────────────────────────────────────────────────────────────
  // FIX 3 — same full-DB search for candidates
  app.get("/api/candidates", (req, res) => {
    const { q, practice_area, location, status } = req.query as Record<string, string>;

    let sql = "SELECT * FROM candidates WHERE 1=1";
    const params: any[] = [];

    if (q) {
      sql += " AND (LOWER(name) LIKE ? OR LOWER(current_firm) LIKE ? OR LOWER(practice_area) LIKE ? OR LOWER(profile_summary) LIKE ?)";
      const like = `%${q.toLowerCase()}%`;
      params.push(like, like, like, like);
    }
    if (practice_area && practice_area !== "All") {
      sql += " AND LOWER(practice_area) LIKE ?";
      params.push(`%${practice_area.toLowerCase()}%`);
    }
    if (location && location !== "All") {
      sql += " AND LOWER(location) LIKE ?";
      params.push(`%${location.toLowerCase()}%`);
    }
    if (status && status !== "All") {
      sql += " AND status = ?";
      params.push(status);
    }

    sql += " ORDER BY scraped_date DESC";
    const candidates = db.prepare(sql).all(...params);
    res.json(candidates);
  });

  // ── Matches ───────────────────────────────────────────────────────────────
  app.get("/api/matches", (_req, res) => {
    const matches = db.prepare(`
      SELECT m.*, j.title as job_title, j.company as job_company, c.name as candidate_name
      FROM matches m
      JOIN jobs j ON m.job_id = j.id
      JOIN candidates c ON m.candidate_id = c.id
      ORDER BY m.created_at DESC
    `).all();
    res.json(matches);
  });

  app.post("/api/matches/:id/score", async (req, res) => {
    let match = db.prepare(`
      SELECT m.*, j.title, j.company, j.practice_area, j.pqe, j.description,
             c.name, c.current_firm, c.practice_area as candidate_practice_area,
             c.pqe_years, c.profile_summary
      FROM matches m
      JOIN jobs j ON m.job_id = j.id
      JOIN candidates c ON m.candidate_id = c.id
      WHERE m.id = ?
    `).get(req.params.id) as any;

    if (!match && firestore) {
      try {
        const matchDoc = await firestore.collection("matches").doc(req.params.id).get();
        if (matchDoc.exists) {
          const md = matchDoc.data()!;
          const [jobDoc, candDoc] = await Promise.all([
            firestore.collection("jobs").doc(md.jobId).get(),
            firestore.collection("candidates").doc(md.candidateId).get(),
          ]);
          if (jobDoc.exists && candDoc.exists) {
            const job = jobDoc.data()!;
            const cand = candDoc.data()!;
            match = {
              ...md,
              title: job.title, company: job.company, practice_area: job.practiceArea,
              pqe: job.pqe, description: job.description,
              name: cand.name, current_firm: cand.currentFirm,
              candidate_practice_area: cand.practiceArea,
              pqe_years: cand.pqeYears, profile_summary: cand.profileSummary,
            };
          }
        }
      } catch (err) { console.error("Firestore fetch error (score):", err); }
    }

    if (!match) return res.status(404).json({ error: "Match not found" });

    const baseline = baselineScore(
      { name: match.name, current_firm: match.current_firm, practice_area: match.candidate_practice_area, pqe_years: match.pqe_years, profile_summary: match.profile_summary },
      { title: match.title, company: match.company, practice_area: match.practice_area, pqe: match.pqe, description: match.description }
    );

    if (!baseline.hard_filter_pass) {
      return res.json({
        score: 0,
        reasons: [`Hard filter failed: ${baseline.excluded_reason}`],
        summary: "This match does not meet the minimum requirements for location, practice area, or PQE.",
      });
    }

    const aiResult = await scoreMatch(
      { title: match.title, company: match.company, practice_area: match.practice_area, pqe: match.pqe, description: match.description },
      { name: match.name, current_firm: match.current_firm, practice_area: match.candidate_practice_area, pqe_years: match.pqe_years, profile_summary: match.profile_summary }
    );

    db.prepare("UPDATE matches SET llm_score = ?, match_reasons = ?, match_summary = ? WHERE id = ?")
      .run(aiResult.score, JSON.stringify(aiResult.reasons), aiResult.summary, req.params.id);

    if (firestore) {
      try {
        await firestore.collection("matches").doc(req.params.id).set(
          { llmScore: aiResult.score, matchReasons: aiResult.reasons, matchSummary: aiResult.summary, updatedAt: new Date().toISOString() },
          { merge: true }
        );
      } catch (err) { console.error("Firestore update error (score):", err); }
    }

    res.json(aiResult);
  });

  app.post("/api/matches/:id/outreach", async (req, res) => {
    let match = db.prepare(`
      SELECT m.*,
             j.title as job_title, j.company as job_company,
             j.practice_area as job_practice_area, j.pqe as job_pqe, j.description as job_description,
             c.name as candidate_name, c.practice_area as candidate_practice_area,
             c.pqe_years as candidate_pqe_years
      FROM matches m
      JOIN jobs j ON m.job_id = j.id
      JOIN candidates c ON m.candidate_id = c.id
      WHERE m.id = ?
    `).get(req.params.id) as any;

    if (!match && firestore) {
      try {
        const matchDoc = await firestore.collection("matches").doc(req.params.id).get();
        if (matchDoc.exists) {
          const md = matchDoc.data()!;
          const [jobDoc, candDoc] = await Promise.all([
            firestore.collection("jobs").doc(md.jobId).get(),
            firestore.collection("candidates").doc(md.candidateId).get(),
          ]);
          if (jobDoc.exists && candDoc.exists) {
            const job = jobDoc.data()!;
            const cand = candDoc.data()!;
            match = {
              ...md,
              job_title: job.title, job_company: job.company,
              job_practice_area: job.practiceArea, job_pqe: job.pqe, job_description: job.description,
              candidate_name: cand.name, candidate_practice_area: cand.practiceArea,
              candidate_pqe_years: cand.pqeYears,
            };
          }
        }
      } catch (err) { console.error("Firestore fetch error (outreach):", err); }
    }

    if (!match) return res.status(404).json({ error: "Match not found" });
    const outreach = await generateOutreach(match);
    res.json(outreach);
  });

  // ── Orchestrator ──────────────────────────────────────────────────────────
  // FIX 2 — removed async calls from inside db.transaction() (SQLite transactions
  //          must be synchronous; async calls were silently failing / deadlocking)
  app.post("/api/orchestrator/run", async (req, res) => {
    const { keywords = "lawyer", location = "Sydney" } = req.body;
    const scraper = new LocalScraper();

    try {
      console.log(`[Orchestrator] starting: keywords="${keywords}" location="${location}"`);

      const [jobs, candidates] = await Promise.all([
        scraper.scrapeJobs(keywords, location),
        scraper.scrapeCandidates(keywords, location),
      ]);

      console.log(`[Orchestrator] scraped ${jobs.length} jobs, ${candidates.length} candidates`);

      const insertJob = db.prepare(`
        INSERT OR REPLACE INTO jobs (id, title, company, location, practice_area, salary, job_url, source_platform)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertCandidate = db.prepare(`
        INSERT OR REPLACE INTO candidates (id, name, current_firm, location, practice_area, pqe_years, status, profile_url, source_platform)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // ── Step 1: synchronous SQLite writes ──────────────────────────────
      const jobRows: { id: string; job: any }[] = [];
      const candRows: { id: string; cand: any; pqeYears: number }[] = [];

      db.transaction(() => {
        for (const job of jobs) {
          const jobId = `j_${Buffer.from(job.url).toString("base64").substring(0, 10)}`;
          insertJob.run(jobId, job.title, job.company, job.location, job.practice_area, job.salary, job.url, job.source);
          jobRows.push({ id: jobId, job });
        }
        for (const cand of candidates) {
          const candId = `c_${Buffer.from(cand.profile_url).toString("base64").substring(0, 10)}`;
          const pqeMatch = cand.pqe_estimate.match(/\d+/);
          const pqeYears = pqeMatch ? parseInt(pqeMatch[0]) : 0;
          insertCandidate.run(candId, cand.name, cand.current_firm, cand.location, cand.practice_areas.join(", "), pqeYears, "New", cand.profile_url, cand.source);
          candRows.push({ id: candId, cand, pqeYears });
        }
      })();

      // ── Step 2: async Firestore writes (outside transaction) ────────────
      if (firestore) {
        await Promise.allSettled([
          ...jobRows.map(({ id, job }) =>
            firestore.collection("jobs").doc(id).set({
              id, title: job.title, company: job.company, location: job.location,
              practiceArea: job.practice_area, salary: job.salary, jobUrl: job.url,
              source: job.source, createdAt: new Date().toISOString(),
            })
          ),
          ...candRows.map(({ id, cand, pqeYears }) =>
            firestore.collection("candidates").doc(id).set({
              id, name: cand.name, currentFirm: cand.current_firm, location: cand.location,
              practiceArea: cand.practice_areas.join(", "), pqeYears, status: "New",
              profileUrl: cand.profile_url, source: cand.source,
              createdAt: new Date().toISOString(),
            })
          ),
        ]);
      }

      // ── Step 3: run matching ────────────────────────────────────────────
      console.log("[Orchestrator] running matching algorithm...");
      const dbJobs       = db.prepare("SELECT * FROM jobs").all();
      const dbCandidates = db.prepare("SELECT * FROM candidates").all();

      const matchResults = batchScore(dbCandidates, dbJobs, {
        minScore: parseFloat(process.env.LLM_MIN_BASELINE_SCORE || "6"),
        topN: parseInt(process.env.LLM_MAX_PAIRS_PER_RUN || "10"),
      });

      console.log(`[Orchestrator] ${matchResults.length} baseline matches generated`);

      const insertMatch = db.prepare(`
        INSERT OR REPLACE INTO matches (id, job_id, candidate_id, baseline_score, status, match_reasons)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const matchRows: { id: string; m: any }[] = [];
      db.transaction(() => {
        for (const m of matchResults) {
          const matchId = `m_${m.job_id}_${m.candidate_id}`;
          insertMatch.run(matchId, m.job_id, m.candidate_id, m.score_10, "New", JSON.stringify(m.breakdown));
          matchRows.push({ id: matchId, m });
        }
      })();

      if (firestore) {
        await Promise.allSettled(
          matchRows.map(({ id, m }) =>
            firestore.collection("matches").doc(id).set({
              id, jobId: m.job_id, candidateId: m.candidate_id,
              jobTitle: m.job_title, jobCompany: m.company,
              candidateName: m.candidate_name, baselineScore: m.score_10,
              status: "New", matchReasons: m.breakdown,
              createdAt: new Date().toISOString(),
            })
          )
        );
      }

      res.json({
        status: "success",
        message: "Orchestrator run completed.",
        stats: { jobsFound: jobs.length, candidatesFound: candidates.length, matchesGenerated: matchResults.length },
      });
    } catch (error) {
      console.error("[Orchestrator] failed:", error);
      res.status(500).json({ error: "Orchestrator run failed", details: error instanceof Error ? error.message : String(error) });
    }
  });

  // ── Local discovery ───────────────────────────────────────────────────────
  app.post("/api/discovery/local/run", async (req, res) => {
    const { keywords = "lawyer", location = "Sydney", type = "Job" } = req.body;
    const scraper = new LocalScraper();

    try {
      let results: any[] = [];
      if (type === "Job") {
        results = await scraper.scrapeJobs(keywords, location);
      } else {
        results = await scraper.scrapeCandidates(keywords, location);
      }

      if (firestore) {
        await Promise.allSettled(
          results.map((result) => {
            const docId = `disc_${Buffer.from(result.url || result.profile_url || String(Date.now())).toString("base64").substring(0, 15)}`;
            return firestore.collection("discovery").doc(docId).set({
              type,
              title: result.title || result.name,
              company: result.company || result.current_firm || "",
              location: result.location || "",
              url: result.url || result.profile_url,
              source: result.source || "Local Scraper",
              confidence: 0.9,
              status: "New",
              discoveredAt: new Date().toISOString(),
              metadata: {
                practiceArea: result.practice_area || (result.practice_areas ? result.practice_areas.join(", ") : ""),
                pqe: result.pqe || result.pqe_estimate || "",
              },
            });
          })
        );
      }

      res.json({ status: "success", message: "Local discovery run completed.", resultsCount: results.length });
    } catch (error) {
      console.error("Local discovery run failed:", error);
      res.status(500).json({ error: "Local discovery run failed", details: error instanceof Error ? error.message : String(error) });
    }
  });

  // ── Discovery routes ──────────────────────────────────────────────────────
  app.get("/api/discovery/status", (_req, res) => {
    const lastRun = db.prepare("SELECT * FROM discovery_runs ORDER BY started_at DESC LIMIT 1").get();
    res.json({ enabled: true, lastRun });
  });

  app.get("/api/discovery/jobs", (_req, res) => {
    res.json(db.prepare("SELECT * FROM jobs_discovered ORDER BY discovered_at DESC").all());
  });

  app.get("/api/discovery/candidates", (_req, res) => {
    res.json(db.prepare("SELECT * FROM candidates_discovered ORDER BY discovered_at DESC").all());
  });

  app.get("/api/discovery/matches", (_req, res) => {
    res.json(db.prepare(`
      SELECT dm.*, jd.title as job_title, jd.company as job_company, cd.name as candidate_name
      FROM discovery_matches dm
      JOIN jobs_discovered jd ON dm.job_id = jd.id
      JOIN candidates_discovered cd ON dm.candidate_id = cd.id
      ORDER BY dm.created_at DESC
    `).all());
  });

  app.post("/api/discovery/run", (_req, res) => {
    const runId = db.prepare("INSERT INTO discovery_runs (status) VALUES (?)").run("Running").lastInsertRowid;
    setTimeout(() => {
      db.prepare("UPDATE discovery_runs SET status = ?, results_count = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run("Completed", 0, runId);
    }, 2000);
    res.json({ id: runId, status: "Started" });
  });

  // ── Apify ─────────────────────────────────────────────────────────────────
  const apifyToken  = process.env.APIFY_API_TOKEN;
  const apifyActorId = process.env.APIFY_ACTOR_ID || "pIyH7237rHZBxoO7q";
  let apifyClient: ApifyClient | null = null;
  if (apifyToken) apifyClient = new ApifyClient({ token: apifyToken });

  app.post("/api/discovery/apify/run", async (req, res) => {
    if (!apifyClient) return res.status(400).json({ error: "APIFY_API_TOKEN not configured." });
    const { firstname, lastname, location, current_job_title, max_profiles } = req.body;
    try {
      const runInput = { firstname: firstname || "", lastname: lastname || "", max_profiles: max_profiles || 10, location: location || "", current_job_title: current_job_title || "", include_email: true };
      const run = await apifyClient.actor(apifyActorId).start(runInput);
      const runId = db.prepare("INSERT INTO discovery_runs (status, apify_run_id, search_params) VALUES (?, ?, ?)")
        .run("Running", run.id, JSON.stringify(runInput)).lastInsertRowid;
      res.json({ id: runId, apify_run_id: run.id, status: "Started" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/discovery/apify/runs", (_req, res) => {
    res.json(db.prepare("SELECT * FROM discovery_runs WHERE apify_run_id IS NOT NULL ORDER BY started_at DESC").all());
  });

  app.get("/api/discovery/apify/runs/:id", async (req, res) => {
    if (!apifyClient) return res.status(400).json({ error: "APIFY_API_TOKEN not configured." });
    const run = db.prepare("SELECT * FROM discovery_runs WHERE id = ?").get(req.params.id) as any;
    if (!run) return res.status(404).json({ error: "Run not found" });

    if (run.status === "Running") {
      try {
        const apifyRun = await apifyClient.run(run.apify_run_id).get();
        if (apifyRun?.status === "SUCCEEDED") {
          const dataset = await apifyClient.dataset(apifyRun.defaultDatasetId).listItems();
          db.prepare("UPDATE discovery_runs SET status = ?, results_count = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run("Completed", dataset.items.length, req.params.id);
          const insertCand = db.prepare("INSERT OR IGNORE INTO candidates_discovered (name, profile_url, source) VALUES (?, ?, ?)");
          db.transaction(() => {
            for (const item of dataset.items as any[]) {
              insertCand.run(item.fullName || item.name || "Unknown", item.url || item.profileUrl || "", "Apify Scraper");
            }
          })();
          run.status = "Completed";
          run.results = dataset.items;
        } else if (["FAILED", "ABORTED", "TIMED-OUT"].includes(apifyRun?.status || "")) {
          db.prepare("UPDATE discovery_runs SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(apifyRun!.status, req.params.id);
          run.status = apifyRun!.status;
        }
      } catch (err: any) { console.error("Apify status error:", err); }
    } else if (run.status === "Completed") {
      try {
        const apifyRun = await apifyClient.run(run.apify_run_id).get();
        if (apifyRun) {
          const dataset = await apifyClient.dataset(apifyRun.defaultDatasetId).listItems();
          run.results = dataset.items;
        }
      } catch (err: any) { console.error("Apify results error:", err); }
    }
    res.json(run);
  });

  app.delete("/api/discovery/apify/runs/:id", (req, res) => {
    try {
      db.prepare("DELETE FROM discovery_runs WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/discovery/apify/import", (req, res) => {
    const { candidate } = req.body;
    try {
      const profileUrl = candidate.url || candidate.profileUrl || "";
      const existing = db.prepare("SELECT id FROM candidates WHERE profile_url = ?").get(profileUrl) as any;
      if (existing) return res.json({ success: true, id: existing.id, message: "Candidate already exists" });
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
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Analytics ─────────────────────────────────────────────────────────────
  app.get("/api/analytics", (_req, res) => {
    const jobCount       = (db.prepare("SELECT COUNT(*) as count FROM jobs").get() as any).count;
    const candidateCount = (db.prepare("SELECT COUNT(*) as count FROM candidates").get() as any).count;
    const matchCount     = (db.prepare("SELECT COUNT(*) as count FROM matches WHERE llm_score >= 8").get() as any).count;
    const placementCount = (db.prepare("SELECT COUNT(*) as count FROM placements WHERE status = 'Completed'").get() as any).count;
    const stages = ["Applied", "Screening", "Interview", "Offer", "Placed"];
    res.json({
      jobs: jobCount, candidates: candidateCount, strongMatches: matchCount, placements: placementCount,
      pipeline: stages.map(stage => ({
        name: stage,
        count: (db.prepare("SELECT COUNT(*) as count FROM candidate_stages WHERE stage = ?").get(stage) as any).count,
      })),
    });
  });

  // ── Meetings ──────────────────────────────────────────────────────────────
  app.get("/api/meetings", (_req, res) => {
    res.json(db.prepare(`
      SELECT m.*, c.name as candidate_name, j.title as job_title
      FROM meetings m
      LEFT JOIN candidates c ON m.candidate_id = c.id
      LEFT JOIN jobs j ON m.job_id = j.id
      ORDER BY m.start_time ASC
    `).all());
  });

  // ── Sequences ─────────────────────────────────────────────────────────────
  app.get("/api/sequences", (_req, res) => {
    res.json(db.prepare("SELECT * FROM followup_sequences").all());
  });

  // ── Settings ──────────────────────────────────────────────────────────────
  app.get("/api/settings", (_req, res) => {
    const rows = db.prepare("SELECT * FROM settings").all() as any[];
    const settings: any = {};
    rows.forEach(row => {
      settings[row.key] = row.value === "true" ? true : row.value === "false" ? false : row.value;
    });
    res.json(settings);
  });

  app.post("/api/settings", (req, res) => {
    const upsert = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
    db.transaction(() => {
      Object.entries(req.body).forEach(([key, value]) => upsert.run(key, String(value)));
    })();
    res.json({ status: "success" });
  });

  // ── Sources list (for dynamic filter dropdowns) ───────────────────────────
  app.get("/api/jobs/sources", (_req, res) => {
    const rows = db.prepare("SELECT DISTINCT source_platform FROM jobs WHERE source_platform IS NOT NULL").all() as any[];
    res.json(rows.map(r => r.source_platform));
  });

  app.get("/api/candidates/sources", (_req, res) => {
    const rows = db.prepare("SELECT DISTINCT source_platform FROM candidates WHERE source_platform IS NOT NULL").all() as any[];
    res.json(rows.map(r => r.source_platform));
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Vite dev middleware / static production serving
  // ─────────────────────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`✓ NirvanaAI server running on http://localhost:${PORT}`);
  });
}

startServer();
