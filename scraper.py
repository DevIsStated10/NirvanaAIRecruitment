import asyncio
import json
import csv
import time
import random
import re
import argparse
import logging
from datetime import datetime
from dataclasses import dataclass, field, asdict
from typing import Optional
from urllib.parse import urlencode, quote_plus

import requests
from bs4 import BeautifulSoup

# Playwright for JS-heavy sites (LinkedIn, SEEK)
try:
    from playwright.async_api import async_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False
    print("⚠  Playwright not installed. Install with: pip install playwright && playwright install chromium")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# DATA MODELS
# ─────────────────────────────────────────────

@dataclass
class JobListing:
    title: str = ""
    company: str = ""
    location: str = ""
    salary: str = ""
    practice_area: str = ""
    pqe: str = ""
    job_type: str = ""          # full-time, part-time, contract
    description_snippet: str = ""
    url: str = ""
    source: str = ""
    date_posted: str = ""
    scraped_at: str = field(default_factory=lambda: datetime.now().isoformat())

@dataclass
class CandidateProfile:
    name: str = ""
    current_title: str = ""
    current_firm: str = ""
    location: str = ""
    pqe_estimate: str = ""
    practice_areas: list = field(default_factory=list)
    education: str = ""
    profile_url: str = ""
    source: str = ""
    scraped_at: str = field(default_factory=lambda: datetime.now().isoformat())


# ─────────────────────────────────────────────
# SHARED UTILITIES
# ─────────────────────────────────────────────

HEADERS_POOL = [
    {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept-Language": "en-AU,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
    },
    {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15",
        "Accept-Language": "en-AU,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept-Language": "en-AU,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
]

def get_headers():
    return random.choice(HEADERS_POOL)

def polite_delay(min_s=1.5, max_s=4.0):
    time.sleep(random.uniform(min_s, max_s))

def safe_get(url, session=None, retries=3, timeout=15):
    """HTTP GET with retries and rotating user-agents."""
    caller = session or requests
    for attempt in range(retries):
        try:
            resp = caller.get(url, headers=get_headers(), timeout=timeout)
            if resp.status_code == 200:
                return resp
            elif resp.status_code == 429:
                wait = (attempt + 1) * 5
                log.warning(f"Rate limited on {url}, waiting {wait}s...")
                time.sleep(wait)
            else:
                log.warning(f"HTTP {resp.status_code} on {url}")
        except Exception as e:
            log.warning(f"Request error (attempt {attempt+1}): {e}")
            time.sleep(2)
    return None

def extract_pqe(text: str) -> str:
    """Extract PQE (post-qualified experience) from job text."""
    patterns = [
        r'(\d+)\s*[-–]\s*(\d+)\s*(?:years?|yrs?)?\s*(?:PQE|post[- ]qualified)',
        r'(\d+)\+?\s*(?:years?|yrs?)\s*(?:PQE|post[- ]qualified)',
        r'PQE[:\s]+(\d+)\s*[-–]\s*(\d+)',
        r'(\d+)\s*(?:years?|yrs?)\s*(?:experience|exp)',
    ]
    text_lower = text.lower()
    for pattern in patterns:
        m = re.search(pattern, text_lower, re.IGNORECASE)
        if m:
            return m.group(0).strip()
    return ""

def extract_practice_area(text: str) -> str:
    """Detect practice area from job/profile text."""
    areas = {
        "Corporate & Commercial": ["corporate", "commercial", "m&a", "mergers", "acquisitions"],
        "Litigation": ["litigation", "dispute", "court", "trial", "arbitration"],
        "Property": ["property", "real estate", "conveyancing", "leasing"],
        "Family Law": ["family", "divorce", "custody", "matrimonial"],
        "Criminal": ["criminal", "defence", "prosecution", "magistrate"],
        "Employment": ["employment", "industrial relations", "workplace", "ir", "fair work"],
        "Banking & Finance": ["banking", "finance", "financial services", "funds"],
        "Tax": ["tax", "revenue", "stamp duty", "gst"],
        "IP & Technology": ["ip", "intellectual property", "technology", "tech", "privacy", "data"],
        "Planning & Environment": ["planning", "environment", "environmental"],
        "Insolvency": ["insolvency", "restructuring", "liquidation", "bankruptcy"],
        "Government": ["government", "public law", "administrative", "aba"],
        "Health": ["health", "medical", "hospital", "pharmaceutical"],
        "Immigration": ["immigration", "migration", "visa"],
    }
    text_lower = text.lower()
    for area, keywords in areas.items():
        if any(kw in text_lower for kw in keywords):
            return area
    return "General Practice"


# ─────────────────────────────────────────────
# SEEK SCRAPER (AU's #1 job board)
# ─────────────────────────────────────────────

class SeekScraper:
    BASE = "https://www.seek.com.au"

    async def search_jobs(self, keywords: str, location: str, max_results: int = 25) -> list[JobListing]:
        if not PLAYWRIGHT_AVAILABLE:
            log.warning("[SEEK] Playwright not available, skipping")
            return []

        jobs = []
        params = {
            "keywords": keywords,
            "where": location,
            "classification": "1316",  # Legal
        }
        url = f"{self.BASE}/jobs?{urlencode(params)}"
        log.info(f"[SEEK] Fetching: {url}")

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"]
            )
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                viewport={"width": 1280, "height": 900},
                locale="en-AU",
            )
            page = await context.new_page()

            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=45000)
                await page.wait_for_timeout(5000)

                content = await page.content()
                soup = BeautifulSoup(content, "lxml")
                job_cards = soup.select("article[data-card-type='JobCard']") or soup.select("[data-automation='normalJob']")

                for card in job_cards[:max_results]:
                    try:
                        title_el = card.select_one("[data-automation='jobTitle']") or card.select_one("h3 a")
                        company_el = card.select_one("[data-automation='jobCompany']") or card.select_one("[class*='company']")
                        location_el = card.select_one("[data-automation='jobLocation']") or card.select_one("[class*='location']")
                        salary_el = card.select_one("[data-automation='jobSalary']") or card.select_one("[class*='salary']")
                        date_el = card.select_one("[data-automation='jobListingDate']") or card.select_one("time")
                        snippet_el = card.select_one("[data-automation='jobShortDescription']") or card.select_one("[class*='description']")

                        title = title_el.get_text(strip=True) if title_el else ""
                        href = title_el.get("href", "") if title_el else ""
                        job_url = f"{self.BASE}{href}" if href.startswith("/") else href
                        text_blob = card.get_text(" ", strip=True)

                        job = JobListing(
                            title=title,
                            company=company_el.get_text(strip=True) if company_el else "",
                            location=location_el.get_text(strip=True) if location_el else location,
                            salary=salary_el.get_text(strip=True) if salary_el else "",
                            practice_area=extract_practice_area(text_blob),
                            pqe=extract_pqe(text_blob),
                            description_snippet=snippet_el.get_text(strip=True)[:300] if snippet_el else "",
                            url=job_url,
                            source="SEEK",
                            date_posted=date_el.get_text(strip=True) if date_el else "",
                        )
                        if job.title:
                            jobs.append(job)
                    except Exception as e:
                        log.debug(f"[SEEK] Error parsing card: {e}")

            except Exception as e:
                log.error(f"[SEEK] Page error: {e}")
            finally:
                await browser.close()

        log.info(f"[SEEK] Found {len(jobs)} jobs")
        return jobs


# ─────────────────────────────────────────────
# INDEED AU SCRAPER
# ─────────────────────────────────────────────

class IndeedAUScraper:
    BASE = "https://au.indeed.com"

    async def search_jobs(self, keywords: str, location: str, max_results: int = 25) -> list[JobListing]:
        if not PLAYWRIGHT_AVAILABLE:
            log.warning("[Indeed] Playwright not available, skipping")
            return []

        jobs = []
        params = {
            "q": keywords,
            "l": location,
            "fromage": "30",
        }
        url = f"{self.BASE}/jobs?{urlencode(params)}"
        log.info(f"[Indeed] Fetching: {url}")

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"]
            )
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                viewport={"width": 1280, "height": 900},
            )
            page = await context.new_page()

            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=45000)
                await page.wait_for_timeout(5000)

                content = await page.content()
                soup = BeautifulSoup(content, "lxml")
                cards = soup.select("div.job_seen_beacon") or soup.select("div[class*='jobsearch-ResultsList'] > li")

                for card in cards[:max_results]:
                    try:
                        title_el = card.select_one("h2.jobTitle span") or card.select_one("[class*='jobTitle']")
                        company_el = card.select_one("[data-testid='company-name']") or card.select_one("span.companyName")
                        location_el = card.select_one("[data-testid='text-location']") or card.select_one("div.companyLocation")
                        salary_el = card.select_one("[class*='salary']") or card.select_one("[data-testid*='salary']")
                        date_el = card.select_one("span.date") or card.select_one("[class*='date']")
                        link_el = card.select_one("h2.jobTitle a") or card.select_one("a[id^='job_']")

                        text_blob = card.get_text(" ", strip=True)
                        href = link_el.get("href", "") if link_el else ""
                        job_url = f"{self.BASE}{href}" if href.startswith("/") else href

                        job = JobListing(
                            title=title_el.get_text(strip=True) if title_el else "",
                            company=company_el.get_text(strip=True) if company_el else "",
                            location=location_el.get_text(strip=True) if location_el else location,
                            salary=salary_el.get_text(strip=True) if salary_el else "",
                            practice_area=extract_practice_area(text_blob),
                            pqe=extract_pqe(text_blob),
                            url=job_url,
                            source="Indeed AU",
                            date_posted=date_el.get_text(strip=True) if date_el else "",
                        )
                        if job.title:
                            jobs.append(job)
                    except Exception as e:
                        log.debug(f"[Indeed] Card error: {e}")

            except Exception as e:
                log.error(f"[Indeed] Page error: {e}")
            finally:
                await browser.close()

        log.info(f"[Indeed AU] Found {len(jobs)} jobs")
        return jobs


# ─────────────────────────────────────────────
# LAWYERS WEEKLY JOBS SCRAPER
# ─────────────────────────────────────────────

class LawyersWeeklyScraper:
    BASE = "https://www.lawyersweekly.com.au"

    async def search_jobs(self, keywords: str, location: str, max_results: int = 25) -> list[JobListing]:
        if not PLAYWRIGHT_AVAILABLE:
            log.warning("[LawyersWeekly] Playwright not available, skipping")
            return []

        jobs = []
        params = {"keywords": keywords, "location": location}
        url = f"{self.BASE}/jobs?{urlencode(params)}"
        log.info(f"[LawyersWeekly] Fetching: {url}")

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"]
            )
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                viewport={"width": 1280, "height": 900},
            )
            page = await context.new_page()

            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=45000)
                await page.wait_for_timeout(5000)

                content = await page.content()
                soup = BeautifulSoup(content, "lxml")
                cards = soup.select(".job-listing") or soup.select("article.job") or soup.select("[class*='job-card']")

                for card in cards[:max_results]:
                    try:
                        title_el = card.select_one("h2") or card.select_one("h3") or card.select_one(".job-title")
                        company_el = card.select_one(".company") or card.select_one("[class*='employer']")
                        location_el = card.select_one(".location") or card.select_one("[class*='location']")
                        salary_el = card.select_one(".salary") or card.select_one("[class*='salary']")
                        link_el = card.select_one("a[href]")

                        text_blob = card.get_text(" ", strip=True)
                        href = link_el.get("href", "") if link_el else ""
                        job_url = f"{self.BASE}{href}" if href.startswith("/") else href

                        job = JobListing(
                            title=title_el.get_text(strip=True) if title_el else "",
                            company=company_el.get_text(strip=True) if company_el else "",
                            location=location_el.get_text(strip=True) if location_el else location,
                            salary=salary_el.get_text(strip=True) if salary_el else "",
                            practice_area=extract_practice_area(text_blob),
                            pqe=extract_pqe(text_blob),
                            url=job_url,
                            source="Lawyers Weekly",
                        )
                        if job.title:
                            jobs.append(job)
                    except Exception as e:
                        log.debug(f"[LawyersWeekly] Card error: {e}")

            except Exception as e:
                log.error(f"[LawyersWeekly] Page error: {e}")
            finally:
                await browser.close()

        log.info(f"[LawyersWeekly] Found {len(jobs)} jobs")
        return jobs


# ─────────────────────────────────────────────
# LAW SOCIETY NSW JOBS BOARD
# ─────────────────────────────────────────────

class LawSocietyNSWScraper:
    BASE = "https://www.lawsociety.com.au"

    async def search_jobs(self, keywords: str, location: str, max_pages: int = 2) -> list[JobListing]:
        if not PLAYWRIGHT_AVAILABLE:
            log.warning("[LawSocietyNSW] Playwright not available, skipping")
            return []

        jobs = []
        url = f"{self.BASE}/legal-profession/career-hub"
        log.info(f"[LawSocietyNSW] Fetching: {url}")

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
            context = await browser.new_context(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
            page = await context.new_page()

            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=45000)
                await page.wait_for_timeout(3000)
                content = await page.content()
                soup = BeautifulSoup(content, "lxml")
                cards = (soup.select(".job-result") or soup.select("[class*='listing']")
                         or soup.select("article") or soup.select(".vacancy"))

                for card in cards:
                    try:
                        title_el = card.select_one("h2, h3, .title, [class*='title']")
                        company_el = card.select_one(".company, .employer, [class*='company']")
                        location_el = card.select_one(".location, [class*='location']")
                        salary_el = card.select_one(".salary, [class*='salary']")
                        link_el = card.select_one("a[href]")

                        text_blob = card.get_text(" ", strip=True)
                        href = link_el.get("href", "") if link_el else ""
                        job_url = f"{self.BASE}{href}" if href.startswith("/") else href

                        job = JobListing(
                            title=title_el.get_text(strip=True) if title_el else "",
                            company=company_el.get_text(strip=True) if company_el else "",
                            location=location_el.get_text(strip=True) if location_el else location,
                            salary=salary_el.get_text(strip=True) if salary_el else "",
                            practice_area=extract_practice_area(text_blob),
                            pqe=extract_pqe(text_blob),
                            url=job_url,
                            source="Law Society NSW",
                        )
                        if job.title:
                            jobs.append(job)
                    except Exception as e:
                        log.debug(f"[LawSocietyNSW] Card error: {e}")
            except Exception as e:
                log.error(f"[LawSocietyNSW] Page error: {e}")
            finally:
                await browser.close()

        log.info(f"[LawSocietyNSW] Found {len(jobs)} jobs")
        return jobs


# ─────────────────────────────────────────────
# LAW INSTITUTE VICTORIA JOBS
# ─────────────────────────────────────────────

class LawInstituteVICScraper:
    BASE = "https://www.liv.asn.au"

    async def search_jobs(self, keywords: str, location: str, max_pages: int = 2) -> list[JobListing]:
        if not PLAYWRIGHT_AVAILABLE:
            log.warning("[LIV] Playwright not available, skipping")
            return []

        jobs = []
        url = f"{self.BASE}/Professional-Development/Career-Hub"
        log.info(f"[LIV] Fetching: {url}")

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
            context = await browser.new_context(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/122.0.0.0 Safari/537.36")
            page = await context.new_page()

            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=45000)
                await page.wait_for_timeout(3000)
                content = await page.content()
                soup = BeautifulSoup(content, "lxml")
                cards = soup.select(".job-listing, .vacancy, article, [class*='position']")

                for card in cards:
                    try:
                        title_el = card.select_one("h2, h3, .title")
                        company_el = card.select_one(".company, .employer, .firm")
                        location_el = card.select_one(".location")
                        link_el = card.select_one("a[href]")

                        text_blob = card.get_text(" ", strip=True)
                        href = link_el.get("href", "") if link_el else ""
                        job_url = f"{self.BASE}{href}" if href.startswith("/") else href

                        job = JobListing(
                            title=title_el.get_text(strip=True) if title_el else "",
                            company=company_el.get_text(strip=True) if company_el else "",
                            location=location_el.get_text(strip=True) if location_el else "Victoria",
                            practice_area=extract_practice_area(text_blob),
                            pqe=extract_pqe(text_blob),
                            url=job_url,
                            source="Law Institute VIC",
                        )
                        if job.title:
                            jobs.append(job)
                    except Exception as e:
                        log.debug(f"[LIV] Card error: {e}")
            except Exception as e:
                log.error(f"[LIV] Page error: {e}")
            finally:
                await browser.close()

        log.info(f"[LIV] Found {len(jobs)} jobs")
        return jobs


# ─────────────────────────────────────────────
# CAREEREONE AU SCRAPER
# ─────────────────────────────────────────────

class CareerOneScraper:
    BASE = "https://www.careerone.com.au"

    def search_jobs(self, keywords: str, location: str, max_pages: int = 2) -> list[JobListing]:
        jobs = []
        params = {"q": keywords, "where": location}
        url = f"{self.BASE}/jobs?{urlencode(params)}"
        log.info(f"[CareerOne] Fetching: {url}")
        resp = safe_get(url)
        if not resp:
            return jobs

        soup = BeautifulSoup(resp.text, "lxml")
        cards = soup.select(".job-result, [class*='job-card'], article.job")

        for card in cards:
            try:
                title_el = card.select_one("h2, h3, .job-title")
                company_el = card.select_one(".company-name, .employer")
                location_el = card.select_one(".job-location, .location")
                salary_el = card.select_one(".salary")
                link_el = card.select_one("a[href]")

                text_blob = card.get_text(" ", strip=True)
                href = link_el.get("href", "") if link_el else ""
                job_url = f"{self.BASE}{href}" if href.startswith("/") else href

                job = JobListing(
                    title=title_el.get_text(strip=True) if title_el else "",
                    company=company_el.get_text(strip=True) if company_el else "",
                    location=location_el.get_text(strip=True) if location_el else location,
                    salary=salary_el.get_text(strip=True) if salary_el else "",
                    practice_area=extract_practice_area(text_blob),
                    pqe=extract_pqe(text_blob),
                    url=job_url,
                    source="CareerOne",
                )
                if job.title:
                    jobs.append(job)
            except Exception as e:
                log.debug(f"[CareerOne] Error: {e}")

        log.info(f"[CareerOne] Found {len(jobs)} jobs")
        return jobs


# ─────────────────────────────────────────────
# LINKEDIN PUBLIC JOBS (no login required)
# Uses Playwright for JS-rendered content
# ─────────────────────────────────────────────

class LinkedInJobsScraper:
    BASE = "https://www.linkedin.com/jobs/search"

    async def search_jobs(self, keywords: str, location: str, max_results: int = 25) -> list[JobListing]:
        if not PLAYWRIGHT_AVAILABLE:
            log.warning("[LinkedIn] Playwright not available, skipping")
            return []

        jobs = []
        params = {
            "keywords": keywords,
            "location": f"{location}, Australia",
            "f_TPR": "r2592000",   # last 30 days
            "f_I": "5",            # Industry: Legal Services
        }
        url = f"{self.BASE}?{urlencode(params)}"
        log.info(f"[LinkedIn] Fetching: {url}")

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"]
            )
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                viewport={"width": 1280, "height": 900},
                locale="en-AU",
            )
            page = await context.new_page()

            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(3000)

                # Scroll to load more jobs
                for _ in range(3):
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    await page.wait_for_timeout(2000)

                content = await page.content()
                soup = BeautifulSoup(content, "lxml")

                cards = (soup.select("div.base-card") or
                         soup.select("li.jobs-search__results-list > div") or
                         soup.select("[class*='job-search-card']"))

                for card in cards[:max_results]:
                    try:
                        title_el = card.select_one("h3.base-search-card__title") or card.select_one("h3")
                        company_el = card.select_one("h4.base-search-card__subtitle") or card.select_one("h4")
                        location_el = card.select_one("span.job-search-card__location") or card.select_one("[class*='location']")
                        date_el = card.select_one("time")
                        link_el = card.select_one("a[href*='/jobs/view/']") or card.select_one("a.base-card__full-link")

                        text_blob = card.get_text(" ", strip=True)

                        job = JobListing(
                            title=title_el.get_text(strip=True) if title_el else "",
                            company=company_el.get_text(strip=True) if company_el else "",
                            location=location_el.get_text(strip=True) if location_el else location,
                            practice_area=extract_practice_area(text_blob),
                            pqe=extract_pqe(text_blob),
                            url=link_el.get("href", "").split("?")[0] if link_el else "",
                            source="LinkedIn",
                            date_posted=date_el.get("datetime", "") if date_el else "",
                        )
                        if job.title:
                            jobs.append(job)
                    except Exception as e:
                        log.debug(f"[LinkedIn] Card error: {e}")

            except Exception as e:
                log.error(f"[LinkedIn] Page error: {e}")
            finally:
                await browser.close()

        log.info(f"[LinkedIn] Found {len(jobs)} jobs")
        return jobs


# ─────────────────────────────────────────────
# CANDIDATE SCRAPER — LinkedIn Public Profiles
# Searches public "People" results (no login)
# ─────────────────────────────────────────────

class LinkedInCandidateScraper:
    BASE = "https://www.linkedin.com/search/results/people"

    async def search_candidates(self, keywords: str, location: str, max_results: int = 20) -> list[CandidateProfile]:
        if not PLAYWRIGHT_AVAILABLE:
            log.warning("[LinkedIn Candidates] Playwright not available, skipping")
            return []

        candidates = []
        params = {
            "keywords": keywords,
            "geoUrn": "",
            "origin": "GLOBAL_SEARCH_HEADER",
        }
        url = f"{self.BASE}?{urlencode(params)}&location={quote_plus(location + ', Australia')}"
        log.info(f"[LinkedIn Candidates] Fetching: {url}")

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-setuid-sandbox"]
            )
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15",
                viewport={"width": 1280, "height": 900},
                locale="en-AU",
            )
            page = await context.new_page()

            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(4000)
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await page.wait_for_timeout(2000)

                content = await page.content()
                soup = BeautifulSoup(content, "lxml")

                # Public people cards
                cards = (soup.select("li.reusable-search__result-container") or
                         soup.select("[class*='search-result--person']") or
                         soup.select("div[data-view-name='search-entity-result-universal-template']"))

                for card in cards[:max_results]:
                    try:
                        name_el = card.select_one("span[aria-hidden='true']") or card.select_one(".actor-name") or card.select_one("h3")
                        title_el = card.select_one("div.entity-result__primary-subtitle") or card.select_one("[class*='subtitle']")
                        location_el = card.select_one("div.entity-result__secondary-subtitle") or card.select_one("[class*='tertiary']")
                        link_el = card.select_one("a[href*='/in/']")

                        text_blob = card.get_text(" ", strip=True)
                        title_text = title_el.get_text(strip=True) if title_el else ""

                        # Split "Title at Company"
                        firm = ""
                        if " at " in title_text:
                            parts = title_text.split(" at ", 1)
                            title_text = parts[0].strip()
                            firm = parts[1].strip()

                        candidate = CandidateProfile(
                            name=name_el.get_text(strip=True) if name_el else "",
                            current_title=title_text,
                            current_firm=firm,
                            location=location_el.get_text(strip=True) if location_el else location,
                            pqe_estimate=extract_pqe(text_blob),
                            practice_areas=[extract_practice_area(text_blob)],
                            profile_url=link_el.get("href", "").split("?")[0] if link_el else "",
                            source="LinkedIn",
                        )
                        if candidate.name:
                            candidates.append(candidate)
                    except Exception as e:
                        log.debug(f"[LinkedIn Candidates] Card error: {e}")

            except Exception as e:
                log.error(f"[LinkedIn Candidates] Page error: {e}")
            finally:
                await browser.close()

        log.info(f"[LinkedIn Candidates] Found {len(candidates)} candidates")
        return candidates


# ─────────────────────────────────────────────
# GRAD AUSTRALIA — graduate roles
# ─────────────────────────────────────────────

class GradAustraliaScraper:
    BASE = "https://gradaustralia.com.au"

    def search_jobs(self, keywords: str, location: str) -> list[JobListing]:
        jobs = []
        params = {"q": keywords, "location": location, "industry": "law"}
        url = f"{self.BASE}/graduate-jobs?{urlencode(params)}"
        log.info(f"[GradAustralia] Fetching: {url}")
        resp = safe_get(url)
        if not resp:
            return jobs

        soup = BeautifulSoup(resp.text, "lxml")
        cards = soup.select(".job-listing, .opportunity-card, [class*='job']")

        for card in cards:
            try:
                title_el = card.select_one("h2, h3, .title")
                company_el = card.select_one(".employer, .company")
                location_el = card.select_one(".location")
                link_el = card.select_one("a[href]")

                href = link_el.get("href", "") if link_el else ""
                job_url = f"{self.BASE}{href}" if href.startswith("/") else href

                job = JobListing(
                    title=title_el.get_text(strip=True) if title_el else "",
                    company=company_el.get_text(strip=True) if company_el else "",
                    location=location_el.get_text(strip=True) if location_el else location,
                    job_type="Graduate",
                    url=job_url,
                    source="GradAustralia",
                )
                if job.title:
                    jobs.append(job)
            except Exception as e:
                log.debug(f"[GradAustralia] Error: {e}")

        log.info(f"[GradAustralia] Found {len(jobs)} jobs")
        return jobs


# ─────────────────────────────────────────────
# ORCHESTRATOR — runs all scrapers concurrently
# ─────────────────────────────────────────────

class LegalRecruitScraper:
    """
    Main entry point. Runs all job/candidate scrapers simultaneously
    using asyncio + threads. Returns deduplicated, merged results.
    """

    def __init__(self):
        self.seek = SeekScraper()
        self.indeed = IndeedAUScraper()
        self.lawyers_weekly = LawyersWeeklyScraper()
        self.law_soc_nsw = LawSocietyNSWScraper()
        self.law_inst_vic = LawInstituteVICScraper()
        self.careerone = CareerOneScraper()
        self.linkedin_jobs = LinkedInJobsScraper()
        self.linkedin_candidates = LinkedInCandidateScraper()
        self.grad_au = GradAustraliaScraper()

    def _run_sync_scrapers(self, keywords: str, location: str) -> list[JobListing]:
        """Run all non-async job scrapers in sequence (fast, static HTML)."""
        all_jobs = []
        scrapers = [
            ("CareerOne", lambda: self.careerone.search_jobs(keywords, location)),
            ("GradAustralia", lambda: self.grad_au.search_jobs(keywords, location)),
        ]
        for name, fn in scrapers:
            try:
                results = fn()
                all_jobs.extend(results)
                log.info(f"✓ {name}: {len(results)} jobs")
            except Exception as e:
                log.error(f"✗ {name} failed: {e}")
        return all_jobs

    def _deduplicate_jobs(self, jobs: list[JobListing]) -> list[JobListing]:
        seen = set()
        unique = []
        for job in jobs:
            key = f"{job.title.lower().strip()}|{job.company.lower().strip()}"
            if key not in seen and job.title:
                seen.add(key)
                unique.append(job)
        return unique

    def _deduplicate_candidates(self, candidates: list[CandidateProfile]) -> list[CandidateProfile]:
        seen = set()
        unique = []
        for c in candidates:
            key = f"{c.name.lower().strip()}|{c.current_firm.lower().strip()}"
            if key not in seen and c.name:
                seen.add(key)
                unique.append(c)
        return unique

    async def scrape_jobs(self, keywords: str, location: str) -> list[JobListing]:
        """Scrape all job sources concurrently."""
        log.info(f"\n{'='*50}")
        log.info(f"Scraping JOBS: '{keywords}' in '{location}'")
        log.info(f"{'='*50}")

        # Run sync scrapers in thread executor
        loop = asyncio.get_event_loop()
        sync_task = loop.run_in_executor(None, self._run_sync_scrapers, keywords, location)

        # Run async scrapers
        async_tasks = [
            self.seek.search_jobs(keywords, location),
            self.indeed.search_jobs(keywords, location),
            self.lawyers_weekly.search_jobs(keywords, location),
            self.linkedin_jobs.search_jobs(keywords, location),
            self.law_soc_nsw.search_jobs(keywords, location),
            self.law_inst_vic.search_jobs(keywords, location),
        ]

        results = await asyncio.gather(sync_task, *async_tasks)
        
        sync_results = results[0]
        async_results = []
        for r in results[1:]:
            async_results.extend(r)

        all_jobs = sync_results + async_results
        unique = self._deduplicate_jobs(all_jobs)

        log.info(f"\n{'='*50}")
        log.info(f"JOBS TOTAL: {len(all_jobs)} found → {len(unique)} unique after dedup")
        log.info(f"{'='*50}\n")
        return unique

    async def scrape_candidates(self, keywords: str, location: str) -> list[CandidateProfile]:
        """Scrape candidate profiles."""
        log.info(f"\n{'='*50}")
        log.info(f"Scraping CANDIDATES: '{keywords}' in '{location}'")
        log.info(f"{'='*50}")

        candidates = await self.linkedin_candidates.search_candidates(keywords, location)
        unique = self._deduplicate_candidates(candidates)

        log.info(f"CANDIDATES TOTAL: {len(unique)} unique profiles")
        return unique

    async def scrape_all(self, keywords: str, location: str) -> dict:
        """Scrape both jobs and candidates simultaneously."""
        jobs_task = self.scrape_jobs(keywords, location)
        candidates_task = self.scrape_candidates(keywords, location)

        jobs, candidates = await asyncio.gather(jobs_task, candidates_task)

        return {
            "jobs": jobs,
            "candidates": candidates,
            "meta": {
                "keywords": keywords,
                "location": location,
                "scraped_at": datetime.now().isoformat(),
                "jobs_count": len(jobs),
                "candidates_count": len(candidates),
            }
        }


# ─────────────────────────────────────────────
# OUTPUT HELPERS
# ─────────────────────────────────────────────

def save_json(data, path: str):
    with open(path, "w", encoding="utf-8") as f:
        if isinstance(data, dict):
            serializable = {
                k: [asdict(i) for i in v] if isinstance(v, list) else v
                for k, v in data.items()
            }
        elif isinstance(data, list):
            serializable = [asdict(i) for i in data]
        else:
            serializable = data
        json.dump(serializable, f, indent=2, ensure_ascii=False)
    log.info(f"Saved JSON → {path}")

def save_csv(items: list, path: str):
    if not items:
        log.warning("No items to save to CSV")
        return
    rows = [asdict(i) for i in items]
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    log.info(f"Saved CSV → {path}")


# ─────────────────────────────────────────────
# PROGRAMMATIC API (for use inside your app)
# ─────────────────────────────────────────────

async def search_jobs(keywords: str, location: str, output_file: Optional[str] = None) -> list[dict]:
    """
    Call this directly from your app:
        from scraper import search_jobs
        jobs = await search_jobs("senior associate", "Sydney")
    Returns list of dicts.
    """
    scraper = LegalRecruitScraper()
    jobs = await scraper.scrape_jobs(keywords, location)
    if output_file:
        save_json(jobs, output_file)
    return [asdict(j) for j in jobs]

async def search_candidates(keywords: str, location: str, output_file: Optional[str] = None) -> list[dict]:
    """
    Call this directly from your app:
        from scraper import search_candidates
        candidates = await search_candidates("commercial lawyer", "Melbourne")
    Returns list of dicts.
    """
    scraper = LegalRecruitScraper()
    candidates = await scraper.scrape_candidates(keywords, location)
    if output_file:
        save_json(candidates, output_file)
    return [asdict(c) for c in candidates]

async def search_all(keywords: str, location: str, output_file: Optional[str] = None) -> dict:
    """
    Call this directly from your app:
        from scraper import search_all
        results = await search_all("family lawyer", "Brisbane")
    Returns {"jobs": [...], "candidates": [...], "meta": {...}}
    """
    scraper = LegalRecruitScraper()
    results = await scraper.scrape_all(keywords, location)
    if output_file:
        save_json(results, output_file)
    return {
        "jobs": [asdict(j) for j in results["jobs"]],
        "candidates": [asdict(c) for c in results["candidates"]],
        "meta": results["meta"],
    }


# ─────────────────────────────────────────────
# CLI ENTRY POINT
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="AU Legal Recruitment Scraper — scrape jobs and candidates from Australian legal job boards"
    )
    parser.add_argument("mode", choices=["jobs", "candidates", "all"],
                        help="What to scrape: jobs, candidates, or all")
    parser.add_argument("--keywords", "-k", default="lawyer", help="Search keywords e.g. 'senior associate commercial'")
    parser.add_argument("--location", "-l", default="Sydney", help="Location e.g. 'Sydney', 'Melbourne', 'Brisbane'")
    parser.add_argument("--output", "-o", default=None, help="Output file path (.json or .csv)")
    parser.add_argument("--format", "-f", choices=["json", "csv"], default="json", help="Output format")
    args = parser.parse_args()

    async def run():
        scraper = LegalRecruitScraper()

        if args.mode == "jobs":
            results = await scraper.scrape_jobs(args.keywords, args.location)
            out_path = args.output or f"jobs_{args.location.lower()}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.{args.format}"
            if args.format == "csv":
                save_csv(results, out_path)
            else:
                save_json(results, out_path)
            print(f"\n✅ {len(results)} jobs saved to {out_path}")

        elif args.mode == "candidates":
            results = await scraper.scrape_candidates(args.keywords, args.location)
            out_path = args.output or f"candidates_{args.location.lower()}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.{args.format}"
            if args.format == "csv":
                save_csv(results, out_path)
            else:
                save_json(results, out_path)
            print(f"\n✅ {len(results)} candidates saved to {out_path}")

        elif args.mode == "all":
            results = await scraper.scrape_all(args.keywords, args.location)
            out_path = args.output or f"results_{args.location.lower()}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            save_json(results, out_path)
            print(f"\n✅ {results['meta']['jobs_count']} jobs + {results['meta']['candidates_count']} candidates saved to {out_path}")

    asyncio.run(run())


if __name__ == "__main__":
    main()
