import axios from 'axios';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright-core';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface JobListing {
  title: string;
  company: string;
  location: string;
  salary: string;
  practice_area: string;
  pqe: string;
  job_type: string;
  description_snippet: string;
  url: string;
  source: string;
  date_posted: string;
  scraped_at: string;
}

export interface CandidateProfile {
  name: string;
  current_title: string;
  current_firm: string;
  location: string;
  pqe_estimate: string;
  practice_areas: string[];
  education: string;
  profile_url: string;
  source: string;
  scraped_at: string;
}

const HEADERS_POOL = [
  {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept-Language': 'en-AU,en;q=0.9',
  },
  {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15',
    'Accept-Language': 'en-AU,en;q=0.9',
  },
];

function getHeaders() {
  return HEADERS_POOL[Math.floor(Math.random() * HEADERS_POOL.length)];
}

function extractPQE(text: string): string {
  const patterns = [
    /(\d+)\s*[-–]\s*(\d+)\s*(?:years?|yrs?)?\s*(?:PQE|post[- ]qualified)/i,
    /(\d+)\+?\s*(?:years?|yrs?)\s*(?:PQE|post[- ]qualified)/i,
    /PQE[:\s]+(\d+)\s*[-–]\s*(\d+)/i,
    /(\d+)\s*(?:years?|yrs?)\s*(?:experience|exp)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].trim();
  }
  return '';
}

function extractPracticeArea(text: string): string {
  const areas: Record<string, string[]> = {
    'Corporate & Commercial': ['corporate', 'commercial', 'm&a', 'mergers', 'acquisitions'],
    'Litigation': ['litigation', 'dispute', 'court', 'trial', 'arbitration'],
    'Property': ['property', 'real estate', 'conveyancing', 'leasing'],
    'Family Law': ['family', 'divorce', 'custody', 'matrimonial'],
    'Criminal': ['criminal', 'defence', 'prosecution', 'magistrate'],
    'Employment': ['employment', 'industrial relations', 'workplace', 'ir', 'fair work'],
    'Banking & Finance': ['banking', 'finance', 'financial services', 'funds'],
    'Tax': ['tax', 'revenue', 'stamp duty', 'gst'],
    'IP & Technology': ['ip', 'intellectual property', 'technology', 'tech', 'privacy', 'data'],
    'Planning & Environment': ['planning', 'environment', 'environmental'],
    'Insolvency': ['insolvency', 'restructuring', 'liquidation', 'bankruptcy'],
    'Government': ['government', 'public law', 'administrative', 'aba'],
    'Health': ['health', 'medical', 'hospital', 'pharmaceutical'],
    'Immigration': ['immigration', 'migration', 'visa'],
  };
  const textLower = text.toLowerCase();
  for (const [area, keywords] of Object.entries(areas)) {
    if (keywords.some(kw => textLower.includes(kw))) return area;
  }
  return 'General Practice';
}

export class SeekScraper {
  async searchJobs(keywords: string, location: string): Promise<JobListing[]> {
    const jobs: JobListing[] = [];
    const url = `https://www.seek.com.au/jobs?keywords=${encodeURIComponent(keywords)}&where=${encodeURIComponent(location)}&classification=1316`;
    
    try {
      const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000);
      
      const content = await page.content();
      const $ = cheerio.load(content);
      
      $('[data-automation="normalJob"]').each((_, el) => {
        const titleEl = $(el).find('[data-automation="jobTitle"]');
        const companyEl = $(el).find('[data-automation="jobCompany"]');
        const locationEl = $(el).find('[data-automation="jobLocation"]');
        const salaryEl = $(el).find('[data-automation="jobSalary"]');
        const snippetEl = $(el).find('[data-automation="jobShortDescription"]');
        
        const textBlob = $(el).text();
        
        jobs.push({
          title: titleEl.text().trim(),
          company: companyEl.text().trim(),
          location: locationEl.text().trim() || location,
          salary: salaryEl.text().trim(),
          practice_area: extractPracticeArea(textBlob),
          pqe: extractPQE(textBlob),
          description_snippet: snippetEl.text().trim(),
          url: `https://www.seek.com.au${titleEl.attr('href')}`,
          source: 'SEEK',
          date_posted: '',
          scraped_at: new Date().toISOString(),
          job_type: '',
        });
      });
      await browser.close();
    } catch (e) {
      console.error('[SEEK] Error:', e);
    }
    return jobs;
  }
}

export class IndeedAUScraper {
  async searchJobs(keywords: string, location: string): Promise<JobListing[]> {
    const jobs: JobListing[] = [];
    const url = `https://au.indeed.com/jobs?q=${encodeURIComponent(keywords)}&l=${encodeURIComponent(location)}`;
    
    try {
      const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000);
      
      const content = await page.content();
      const $ = cheerio.load(content);
      
      $('.job_seen_beacon').each((_, el) => {
        const titleEl = $(el).find('.jobTitle span');
        const companyEl = $(el).find('[data-testid="company-name"]');
        const locationEl = $(el).find('[data-testid="text-location"]');
        const salaryEl = $(el).find('[class*="salary"]');
        
        const textBlob = $(el).text();
        
        jobs.push({
          title: titleEl.text().trim(),
          company: companyEl.text().trim(),
          location: locationEl.text().trim() || location,
          salary: salaryEl.text().trim(),
          practice_area: extractPracticeArea(textBlob),
          pqe: extractPQE(textBlob),
          description_snippet: '',
          url: `https://au.indeed.com${$(el).find('h2.jobTitle a').attr('href')}`,
          source: 'Indeed AU',
          date_posted: '',
          scraped_at: new Date().toISOString(),
          job_type: '',
        });
      });
      await browser.close();
    } catch (e) {
      console.error('[Indeed] Error:', e);
    }
    return jobs;
  }
}

export class LawyersWeeklyScraper {
  async searchJobs(keywords: string, location: string): Promise<JobListing[]> {
    const jobs: JobListing[] = [];
    const url = `https://www.lawyersweekly.com.au/jobs?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(location)}`;
    
    try {
      const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000);
      
      const content = await page.content();
      const $ = cheerio.load(content);
      
      $('.job-listing, article.job').each((_, el) => {
        const titleEl = $(el).find('h2, h3, .job-title');
        const companyEl = $(el).find('.company');
        const locationEl = $(el).find('.location');
        
        const textBlob = $(el).text();
        
        jobs.push({
          title: titleEl.text().trim(),
          company: companyEl.text().trim(),
          location: locationEl.text().trim() || location,
          salary: '',
          practice_area: extractPracticeArea(textBlob),
          pqe: extractPQE(textBlob),
          description_snippet: '',
          url: `https://www.lawyersweekly.com.au${$(el).find('a').attr('href')}`,
          source: 'Lawyers Weekly',
          date_posted: '',
          scraped_at: new Date().toISOString(),
          job_type: '',
        });
      });
      await browser.close();
    } catch (e) {
      console.error('[LawyersWeekly] Error:', e);
    }
    return jobs;
  }
}

export class LocalScraper {
  private seek = new SeekScraper();
  private indeed = new IndeedAUScraper();
  private lawyersWeekly = new LawyersWeeklyScraper();

  async scrapeJobs(keywords: string, location: string): Promise<JobListing[]> {
    const results = await Promise.allSettled([
      this.seek.searchJobs(keywords, location),
      this.indeed.searchJobs(keywords, location),
      this.lawyersWeekly.searchJobs(keywords, location),
    ]);

    const allJobs: JobListing[] = [];
    results.forEach(res => {
      if (res.status === 'fulfilled') {
        allJobs.push(...res.value);
      }
    });

    // If Node.js scrapers failed or returned too few results, try Python scraper
    if (allJobs.length < 5) {
      console.log('Node.js scrapers returned few results, trying Python scraper...');
      try {
        const pythonJobs = await this.runPythonScraper('jobs', keywords, location);
        allJobs.push(...pythonJobs);
      } catch (e) {
        console.error('Python scraper failed:', e);
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    return allJobs.filter(job => {
      const key = `${job.title.toLowerCase()}|${job.company.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async scrapeCandidates(keywords: string, location: string): Promise<CandidateProfile[]> {
    try {
      return await this.runPythonScraper('candidates', keywords, location);
    } catch (e) {
      console.error('Python candidate scraper failed:', e);
      return [];
    }
  }

  private async runPythonScraper(type: 'jobs' | 'candidates' | 'all', keywords: string, location: string): Promise<any[]> {
    const outputPath = path.join(process.cwd(), `scraper_output_${Date.now()}.json`);
    const cmd = `python3 scraper.py ${type} --keywords "${keywords}" --location "${location}" --output "${outputPath}" --format json`;
    
    try {
      execSync(cmd, { stdio: 'inherit' });
      if (fs.existsSync(outputPath)) {
        const data = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
        fs.unlinkSync(outputPath); // Clean up
        return data;
      }
    } catch (e) {
      console.error(`Error running Python scraper: ${e}`);
    }
    return [];
  }
}
