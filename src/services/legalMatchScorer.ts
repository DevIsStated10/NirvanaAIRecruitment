/**
 * legalMatchScorer.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * NirvanaAI — Deterministic Legal Matching Engine
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// TAXONOMY
// ─────────────────────────────────────────────────────────────────────────────

export interface PracticeArea {
  canonical: string;
  keywords: string[];
  group: string;
  adjacent: string[];
}

export const PRACTICE_AREAS: PracticeArea[] = [
  {
    canonical: 'corporate_commercial',
    keywords: [
      'corporate', 'commercial', 'm&a', 'mergers', 'acquisitions',
      'joint venture', 'shareholders', 'corporate advisory', 'corporate law',
      'business law', 'transactional',
    ],
    group: 'transactional',
    adjacent: ['banking_finance', 'ip_technology', 'insolvency'],
  },
  {
    canonical: 'banking_finance',
    keywords: [
      'banking', 'finance', 'financial services', 'funds', 'capital markets',
      'debt', 'credit', 'lending', 'securitisation', 'structured finance',
      'project finance', 'asset finance',
    ],
    group: 'transactional',
    adjacent: ['corporate_commercial', 'insolvency'],
  },
  {
    canonical: 'litigation',
    keywords: [
      'litigation', 'dispute', 'disputes', 'court', 'trial', 'arbitration',
      'mediation', 'contentious', 'advocate', 'barrister', 'solicitor advocate',
      'commercial litigation', 'civil litigation',
    ],
    group: 'disputes',
    adjacent: ['employment', 'insurance', 'construction'],
  },
  {
    canonical: 'employment',
    keywords: [
      'employment', 'industrial relations', 'ir', 'workplace', 'fair work',
      'fwc', 'enterprise agreement', 'unfair dismissal', 'hr law',
      'workforce', 'labour', 'labor', 'discrimination', 'harassment',
      'work health', 'whs', 'workers compensation',
    ],
    group: 'disputes',
    adjacent: ['litigation', 'government'],
  },
  {
    canonical: 'property',
    keywords: [
      'property', 'real estate', 'conveyancing', 'leasing', 'lease',
      'landlord', 'tenant', 'strata', 'development', 'property development',
      'acquisitions', // context-sensitive — combined with property keywords
      'real property',
    ],
    group: 'property',
    adjacent: ['planning_environment', 'construction'],
  },
  {
    canonical: 'planning_environment',
    keywords: [
      'planning', 'environment', 'environmental', 'land use', 'zoning',
      'development approval', 'heritage', 'climate', 'epa', 'sustainability',
      'native title', 'compulsory acquisition',
    ],
    group: 'property',
    adjacent: ['property', 'government'],
  },
  {
    canonical: 'construction',
    keywords: [
      'construction', 'infrastructure', 'engineering', 'building', 'contractor',
      'subcontractor', 'defects', 'adjudication', 'security of payment',
      'procurement', 'epc',
    ],
    group: 'property',
    adjacent: ['property', 'litigation'],
  },
  {
    canonical: 'tax',
    keywords: [
      'tax', 'taxation', 'gst', 'stamp duty', 'revenue', 'duty',
      'income tax', 'transfer pricing', 'international tax', 'indirect tax',
      'tax advisory', 'tax controversy',
    ],
    group: 'advisory',
    adjacent: ['corporate_commercial', 'banking_finance'],
  },
  {
    canonical: 'ip_technology',
    keywords: [
      'ip', 'intellectual property', 'technology', 'tech', 'privacy',
      'data', 'cyber', 'fintech', 'regtech', 'ai law', 'software',
      'patents', 'trade marks', 'trademarks', 'copyright', 'licensing',
      'data protection', 'gdpr', 'apps',
    ],
    group: 'advisory',
    adjacent: ['corporate_commercial', 'litigation'],
  },
  {
    canonical: 'family',
    keywords: [
      'family', 'family law', 'divorce', 'custody', 'parenting',
      'matrimonial', 'de facto', 'property settlement', 'child support',
      'intervention order', 'avo', 'dvo',
    ],
    group: 'private_client',
    adjacent: ['criminal'],
  },
  {
    canonical: 'criminal',
    keywords: [
      'criminal', 'crime', 'defence', 'defense', 'prosecution',
      'magistrate', 'district court', 'supreme court', 'bail',
      'dui', 'drug', 'fraud', 'white collar',
    ],
    group: 'private_client',
    adjacent: ['family', 'litigation'],
  },
  {
    canonical: 'immigration',
    keywords: [
      'immigration', 'migration', 'visa', 'citizenship', 'border',
      'skilled migration', 'temporary visa', 'permanent residency',
      'refugee', 'protection visa', 'department of home affairs',
    ],
    group: 'government',
    adjacent: ['government', 'employment'],
  },
  {
    canonical: 'government',
    keywords: [
      'government', 'public law', 'administrative', 'constitutional',
      'regulatory', 'compliance', 'aba', 'public sector', 'local government',
      'judicial review', 'acat', 'aat', 'vcat', 'ncat', 'qcat', 'wasat',
    ],
    group: 'government',
    adjacent: ['litigation', 'immigration', 'planning_environment'],
  },
  {
    canonical: 'insolvency',
    keywords: [
      'insolvency', 'restructuring', 'liquidation', 'bankruptcy',
      'administration', 'receivership', 'turnaround', 'creditor',
      'voluntary administration', 'deed of company arrangement', 'doca',
    ],
    group: 'transactional',
    adjacent: ['corporate_commercial', 'banking_finance', 'litigation'],
  },
  {
    canonical: 'insurance',
    keywords: [
      'insurance', 'indemnity', 'liability', 'tpd', 'life insurance',
      'professional indemnity', 'pi', 'public liability', 'product liability',
      'insurer', 'reinsurance',
    ],
    group: 'disputes',
    adjacent: ['litigation', 'employment'],
  },
  {
    canonical: 'health',
    keywords: [
      'health', 'medical', 'hospital', 'pharmaceutical', 'healthcare',
      'aged care', 'disability', 'mental health', 'ndis', 'ahpra',
      'medical negligence',
    ],
    group: 'advisory',
    adjacent: ['insurance', 'litigation', 'government'],
  },
  {
    canonical: 'general_practice',
    keywords: [
      'general practice', 'general', 'all areas', 'multi-area',
    ],
    group: 'general',
    adjacent: [], // matches anything at reduced score
  },
];

export interface SeniorityBand {
  band: string;
  pqeMin: number;
  pqeMax: number;
  label: string;
}

export const SENIORITY_BANDS: SeniorityBand[] = [
  { band: 'graduate',       pqeMin: 0,  pqeMax: 0,  label: 'Graduate / Seasonal Clerk' },
  { band: 'junior',         pqeMin: 1,  pqeMax: 3,  label: 'Junior Associate (1–3 PQE)' },
  { band: 'mid',            pqeMin: 4,  pqeMax: 6,  label: 'Mid Associate (4–6 PQE)' },
  { band: 'senior',         pqeMin: 7,  pqeMax: 10, label: 'Senior Associate (7–10 PQE)' },
  { band: 'special_counsel',pqeMin: 8,  pqeMax: 15, label: 'Special Counsel' },
  { band: 'partner',        pqeMin: 10, pqeMax: 99, label: 'Partner / Principal' },
  { band: 'in_house',       pqeMin: 0,  pqeMax: 99, label: 'In-House Counsel' },
];

export const BAND_ADJACENCY: Record<string, string[]> = {
  graduate:        ['junior'],
  junior:          ['graduate', 'mid'],
  mid:             ['junior', 'senior'],
  senior:          ['mid', 'special_counsel', 'partner'],
  special_counsel: ['senior', 'partner'],
  partner:         ['senior', 'special_counsel'],
  in_house:        ['junior', 'mid', 'senior', 'special_counsel'],
};

export const TITLE_TO_BAND = [
  { band: 'graduate',        keywords: ['graduate', 'seasonal clerk', 'paralegal', 'law clerk', 'trainee'] },
  { band: 'junior',          keywords: ['associate', 'junior associate', 'junior lawyer', 'solicitor', 'lawyer'] },
  { band: 'mid',             keywords: ['associate', 'lawyer'] },
  { band: 'senior',          keywords: ['senior associate', 'senior lawyer', 'senior solicitor'] },
  { band: 'special_counsel', keywords: ['special counsel', 'of counsel', 'senior counsel'] },
  { band: 'partner',         keywords: ['partner', 'principal', 'director', 'managing partner', 'equity partner'] },
  { band: 'in_house',        keywords: ['in-house', 'in house', 'general counsel', 'gc', 'legal counsel', 'legal officer', 'company secretary'] },
];

export interface LocationInfo {
  state: string | null;
  city: string | null;
  isRemote: boolean;
}

export const AU_LOCATIONS: Record<string, { state: string; city: string | null }> = {
  sydney:      { state: 'NSW', city: 'Sydney' },
  nsw:         { state: 'NSW', city: null },
  'new south wales': { state: 'NSW', city: null },
  'north sydney':   { state: 'NSW', city: 'Sydney' },
  parramatta:  { state: 'NSW', city: 'Sydney' },
  newcastle:   { state: 'NSW', city: 'Newcastle' },
  wollongong:  { state: 'NSW', city: 'Wollongong' },
  melbourne:   { state: 'VIC', city: 'Melbourne' },
  vic:         { state: 'VIC', city: null },
  victoria:    { state: 'VIC', city: null },
  geelong:     { state: 'VIC', city: 'Geelong' },
  brisbane:    { state: 'QLD', city: 'Brisbane' },
  qld:         { state: 'QLD', city: null },
  queensland:  { state: 'QLD', city: null },
  'gold coast':{ state: 'QLD', city: 'Gold Coast' },
  'sunshine coast': { state: 'QLD', city: 'Sunshine Coast' },
  cairns:      { state: 'QLD', city: 'Cairns' },
  townsville:  { state: 'QLD', city: 'Townsville' },
  perth:       { state: 'WA', city: 'Perth' },
  wa:          { state: 'WA', city: null },
  'western australia': { state: 'WA', city: null },
  adelaide:    { state: 'SA', city: 'Adelaide' },
  sa:          { state: 'SA', city: null },
  'south australia': { state: 'SA', city: null },
  canberra:    { state: 'ACT', city: 'Canberra' },
  act:         { state: 'ACT', city: null },
  hobart:      { state: 'TAS', city: 'Hobart' },
  tas:         { state: 'TAS', city: null },
  tasmania:    { state: 'TAS', city: null },
  darwin:      { state: 'NT', city: 'Darwin' },
  nt:          { state: 'NT', city: null },
  'northern territory': { state: 'NT', city: null },
};

const REMOTE_KEYWORDS = ['remote', 'work from home', 'wfh', 'flexible', 'nationwide', 'australia wide', 'any location'];

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function normaliseText(str: any): string {
  if (!str) return '';
  return String(str).toLowerCase().trim().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
}

export function parseLocation(locationStr: string): LocationInfo | null {
  const s = normaliseText(locationStr);
  if (!s) return null;

  const isRemote = REMOTE_KEYWORDS.some(kw => s.includes(kw));

  const sortedKeys = Object.keys(AU_LOCATIONS).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (s.includes(key)) {
      return { ...AU_LOCATIONS[key], isRemote };
    }
  }

  return { state: null, city: null, isRemote };
}

function scoreLocation(candidateLoc: LocationInfo | null, jobLoc: LocationInfo | null) {
  if (!candidateLoc && !jobLoc) return { score: 5, detail: 'both_unknown' };

  const c = candidateLoc || { state: null, city: null, isRemote: false };
  const j = jobLoc || { state: null, city: null, isRemote: false };

  if (j.isRemote) return { score: 9, detail: 'job_is_remote' };
  if (c.isRemote) return { score: 8, detail: 'candidate_open_to_remote' };

  if (c.state && j.state) {
    if (c.state !== j.state) {
      return { score: 0, detail: `state_mismatch:${c.state}_vs_${j.state}` };
    }
    if (c.city && j.city) {
      if (c.city === j.city) return { score: 10, detail: 'city_exact_match' };
      return { score: 6, detail: `same_state_diff_city:${c.city}_vs_${j.city}` };
    }
    return { score: 8, detail: 'same_state_city_unknown' };
  }

  return { score: 4, detail: 'partial_location_info' };
}

export interface PQERange {
  min: number;
  max: number;
}

export function parsePQE(text: string | null): PQERange | null {
  if (!text) return null;
  const s = normaliseText(text);

  let m = s.match(/(\d+)\s*(?:-|to|–)\s*(\d+)\s*(?:years?|yrs?)?(?:\s*pqe)?/);
  if (m) return { min: parseInt(m[1]), max: parseInt(m[2]) };

  m = s.match(/(\d+)\s*\+|minimum\s+(\d+)|(\d+)\s+(?:or\s+more)/);
  if (m) {
    const v = parseInt(m[1] || m[2] || m[3]);
    return { min: v, max: 99 };
  }

  m = s.match(/(\d+)\s*(?:years?|yrs?)?\s*(?:pqe|post.qualified)/);
  if (!m) m = s.match(/pqe[:\s]+(\d+)/);
  if (m) {
    const v = parseInt(m[1]);
    return { min: v, max: v };
  }

  return null;
}

function scorePQE(candidatePQE: PQERange | null, jobPQE: PQERange | null) {
  if (!candidatePQE && !jobPQE) return { score: 7, detail: 'pqe_not_specified', in_range: null, adjacent: null };
  if (!jobPQE) return { score: 8, detail: 'job_no_pqe_requirement', in_range: true, adjacent: null };
  if (!candidatePQE) return { score: 5, detail: 'candidate_pqe_unknown', in_range: null, adjacent: null };

  const cMin = candidatePQE.min;
  const cMax = candidatePQE.max;
  const jMin = jobPQE.min;
  const jMax = jobPQE.max;

  const cMid = cMin === cMax ? cMin : Math.round((cMin + cMax) / 2);

  const overlap = cMin <= jMax && cMax >= jMin;
  if (overlap) return { score: 10, detail: `pqe_in_range:c${cMin}-${cMax}_j${jMin}-${jMax}`, in_range: true, adjacent: false };

  const gap = cMid < jMin ? jMin - cMid : cMid - jMax;
  if (gap <= 1) return { score: 7, detail: `pqe_adjacent:gap${gap}yr`, in_range: false, adjacent: true };
  if (gap <= 2) return { score: 4, detail: `pqe_close:gap${gap}yr`, in_range: false, adjacent: false };

  if (cMin > jMax) {
    const overGap = cMin - jMax;
    if (overGap <= 3) return { score: 3, detail: `pqe_overqualified:${overGap}yr`, in_range: false, adjacent: false };
    return { score: 1, detail: `pqe_very_overqualified:${overGap}yr`, in_range: false, adjacent: false };
  }

  if (cMax < jMin) {
    const underGap = jMin - cMax;
    if (underGap <= 2) return { score: 2, detail: `pqe_underqualified:${underGap}yr`, in_range: false, adjacent: false };
    return { score: 0, detail: `pqe_too_junior:${underGap}yr`, in_range: false, adjacent: false };
  }

  return { score: 3, detail: 'pqe_outside_range', in_range: false, adjacent: false };
}

export function extractPracticeAreas(texts: string | string[]): string[] {
  const combined = normaliseText(Array.isArray(texts) ? texts.join(' ') : String(texts || ''));
  const found = new Set<string>();

  const allKeywords: { kw: string; canonical: string }[] = [];
  for (const pa of PRACTICE_AREAS) {
    for (const kw of pa.keywords) {
      allKeywords.push({ kw, canonical: pa.canonical });
    }
  }
  allKeywords.sort((a, b) => b.kw.length - a.kw.length);

  for (const { kw, canonical } of allKeywords) {
    if (combined.includes(kw)) {
      found.add(canonical);
    }
  }

  return [...found];
}

function scorePracticeArea(candidateAreas: string[], jobAreas: string[]) {
  if (!candidateAreas.length && !jobAreas.length) {
    return { score: 5, detail: 'both_unknown', match_type: 'unknown' };
  }
  if (!jobAreas.length) {
    return { score: 7, detail: 'job_area_unspecified', match_type: 'unknown' };
  }
  if (!candidateAreas.length) {
    return { score: 4, detail: 'candidate_area_unknown', match_type: 'unknown' };
  }

  if (candidateAreas.includes('general_practice') || jobAreas.includes('general_practice')) {
    return { score: 6, detail: 'general_practice_match', match_type: 'general' };
  }

  const exactMatch = candidateAreas.find(ca => jobAreas.includes(ca));
  if (exactMatch) {
    return { score: 10, detail: `exact:${exactMatch}`, match_type: 'exact' };
  }

  const candidatePAs = PRACTICE_AREAS.filter(pa => candidateAreas.includes(pa.canonical));
  const jobPAs = PRACTICE_AREAS.filter(pa => jobAreas.includes(pa.canonical));

  const sameGroupPair = candidatePAs.find(cpa =>
    jobPAs.some(jpa => cpa.group === jpa.group && cpa.group !== 'general')
  );
  if (sameGroupPair) {
    const jpa = jobPAs.find(j => j.group === sameGroupPair.group);
    return {
      score: 7,
      detail: `same_group:${sameGroupPair.group}(${sameGroupPair.canonical}_vs_${jpa?.canonical})`,
      match_type: 'group',
    };
  }

  const adjacentPair = candidatePAs.find(cpa =>
    jobPAs.some(jpa => cpa.adjacent.includes(jpa.canonical))
  );
  if (adjacentPair) {
    const jpa = jobPAs.find(j => adjacentPair.adjacent.includes(j.canonical));
    return {
      score: 4,
      detail: `adjacent:${adjacentPair.canonical}_near_${jpa?.canonical}`,
      match_type: 'adjacent',
    };
  }

  const cLabels = candidateAreas.join(',');
  const jLabels = jobAreas.join(',');
  return { score: 0, detail: `mismatch:candidate[${cLabels}]_job[${jLabels}]`, match_type: 'mismatch' };
}

export function extractBand(titleText: string | null, pqeData: PQERange | null): string | null {
  const s = normaliseText(titleText || '');

  const allTitleKws: { kw: string; band: string }[] = [];
  for (const { band, keywords } of TITLE_TO_BAND) {
    for (const kw of keywords) {
      allTitleKws.push({ kw, band });
    }
  }
  allTitleKws.sort((a, b) => b.kw.length - a.kw.length);

  for (const { kw, band } of allTitleKws) {
    if (s.includes(kw)) {
      if ((kw === 'associate' || kw === 'lawyer' || kw === 'solicitor') && pqeData) {
        const mid = pqeData.min === pqeData.max ? pqeData.min : Math.round((pqeData.min + pqeData.max) / 2);
        if (mid >= 7) return 'senior';
        if (mid >= 4) return 'mid';
        return 'junior';
      }
      return band;
    }
  }

  if (pqeData) {
    const mid = pqeData.min === pqeData.max ? pqeData.min : Math.round((pqeData.min + pqeData.max) / 2);
    for (const b of [...SENIORITY_BANDS].reverse()) {
      if (mid >= b.pqeMin && mid <= b.pqeMax) return b.band;
    }
  }

  return null;
}

function scoreSeniority(candidateBand: string | null, jobBand: string | null) {
  if (!candidateBand || !jobBand) return { score: 6, detail: 'band_unknown' };
  if (candidateBand === jobBand) return { score: 10, detail: `exact_band:${candidateBand}` };

  const adjacent = BAND_ADJACENCY[candidateBand] || [];
  if (adjacent.includes(jobBand)) return { score: 7, detail: `adjacent_band:${candidateBand}_for_${jobBand}` };

  const oneStepAway = adjacent.flatMap(b => BAND_ADJACENCY[b] || []);
  if (oneStepAway.includes(jobBand)) return { score: 3, detail: `two_bands_away:${candidateBand}_for_${jobBand}` };

  return { score: 0, detail: `incompatible_bands:${candidateBand}_for_${jobBand}` };
}

function scoreWorkType(candidateWorkType: string | null, jobWorkType: string | null) {
  if (!candidateWorkType || !jobWorkType) return { score: 7, detail: 'work_type_unknown' };

  const norm = (s: string | null) => normaliseText(s || '');
  const c = norm(candidateWorkType);
  const j = norm(jobWorkType);

  const isFullTime = (s: string) => ['full', 'full-time', 'ft', 'permanent'].some(k => s.includes(k));
  const isPartTime = (s: string) => ['part', 'part-time', 'pt', 'casual'].some(k => s.includes(k));
  const isContract = (s: string) => ['contract', 'temp', 'temporary', 'fixed term', 'locum'].some(k => s.includes(k));

  if (isFullTime(c) && isFullTime(j)) return { score: 10, detail: 'full_time_match' };
  if (isPartTime(c) && isPartTime(j)) return { score: 10, detail: 'part_time_match' };
  if (isContract(c) && isContract(j)) return { score: 10, detail: 'contract_match' };

  if (isFullTime(c) && isPartTime(j)) return { score: 4, detail: 'ft_candidate_pt_job' };
  if (isPartTime(c) && isFullTime(j)) return { score: 5, detail: 'pt_candidate_ft_job' };

  if (isContract(j)) return { score: 6, detail: 'contract_job_flexible' };

  return { score: 7, detail: 'work_type_compatible' };
}

function getCandidateFields(candidate: any) {
  const c = candidate || {};
  return {
    locationStr:   c.location || c.candidate_location || c.city || '',
    titleStr:      c.current_role || c.title || c.job_title || c.current_title || c.name || '',
    practiceTexts: [
      c.practice_area || '',
      c.practice_areas || '',
      c.specialisation || '',
      c.specialization || '',
      c.skills || '',
      c.summary || '',
      c.bio || '',
      c.current_role || '',
      c.title || '',
    ],
    pqeStr:        c.years_experience || c.pqe || c.years_pqe || c.experience_years || c.pqe_estimate || '',
    workTypeStr:   c.work_type || c.employment_type || c.preferred_work_type || '',
    remoteOk:      c.remote_ok || c.open_to_remote || false,
  };
}

function getJobFields(job: any) {
  const j = job || {};
  return {
    locationStr:   j.location || j.job_location || j.city || '',
    titleStr:      j.title || j.job_title || j.role || '',
    practiceTexts: [
      j.practice_area || '',
      j.specialisation || '',
      j.specialization || '',
      j.description || '',
      j.title || '',
      j.role || '',
    ],
    pqeStr:        j.pqe_required || j.pqe || j.years_experience || j.experience_required || '',
    workTypeStr:   j.work_type || j.employment_type || j.job_type || '',
  };
}

const WEIGHTS = {
  location:      0.20,
  practice_area: 0.35,
  pqe:           0.20,
  seniority:     0.15,
  work_type:     0.10,
};

const HARD_FILTER = {
  location_min_score:      1,
  practice_area_min_score: 1,
  pqe_min_score:           1,
};

export function scoreMatch(candidate: any, job: any) {
  const cf = getCandidateFields(candidate);
  const jf = getJobFields(job);

  let cLoc = parseLocation(cf.locationStr);
  if (cf.remoteOk) cLoc = { ...(cLoc || { state: null, city: null, isRemote: true }), isRemote: true };

  const jLoc = parseLocation(jf.locationStr);

  const cPQE = parsePQE(cf.pqeStr);
  const jPQE = parsePQE(jf.pqeStr);

  const cAreas = extractPracticeAreas(cf.practiceTexts);
  const jAreas = extractPracticeAreas(jf.practiceTexts);

  const cBand = extractBand(cf.titleStr, cPQE);
  const jBand = extractBand(jf.titleStr, jPQE);

  const locResult  = scoreLocation(cLoc, jLoc);
  const paResult   = scorePracticeArea(cAreas, jAreas);
  const pqeResult  = scorePQE(cPQE, jPQE);
  const senResult  = scoreSeniority(cBand, jBand);
  const wtResult   = scoreWorkType(cf.workTypeStr, jf.workTypeStr);

  const hardFilterReasons: string[] = [];

  if (locResult.score < HARD_FILTER.location_min_score) {
    hardFilterReasons.push(`location_excluded:${locResult.detail}`);
  }
  if (paResult.score < HARD_FILTER.practice_area_min_score) {
    hardFilterReasons.push(`practice_area_excluded:${paResult.detail}`);
  }
  if (pqeResult.score < HARD_FILTER.pqe_min_score) {
    hardFilterReasons.push(`pqe_excluded:${pqeResult.detail}`);
  }

  const hardFilterPass = hardFilterReasons.length === 0;

  const rawScore =
    locResult.score  * WEIGHTS.location +
    paResult.score   * WEIGHTS.practice_area +
    pqeResult.score  * WEIGHTS.pqe +
    senResult.score  * WEIGHTS.seniority +
    wtResult.score   * WEIGHTS.work_type;

  const finalScore = hardFilterPass ? Math.round(rawScore * 10) / 10 : 0;

  return {
    score_10:          finalScore,
    hard_filter_pass:  hardFilterPass,
    excluded_reason:   hardFilterPass ? null : hardFilterReasons.join(' | '),

    breakdown: {
      location: {
        score:  locResult.score,
        weight: WEIGHTS.location,
        detail: locResult.detail,
      },
      practice_area: {
        score:      paResult.score,
        weight:     WEIGHTS.practice_area,
        detail:     paResult.detail,
        match_type: paResult.match_type,
        candidate_areas: cAreas,
        job_areas:       jAreas,
      },
      pqe: {
        score:      pqeResult.score,
        weight:     WEIGHTS.pqe,
        detail:     pqeResult.detail,
        in_range:   pqeResult.in_range,
        adjacent:   pqeResult.adjacent,
        candidate_pqe: cPQE,
        job_pqe:       jPQE,
      },
      seniority: {
        score:           senResult.score,
        weight:          WEIGHTS.seniority,
        detail:          senResult.detail,
        candidate_band:  cBand,
        job_band:        jBand,
      },
      work_type: {
        score:  wtResult.score,
        weight: WEIGHTS.work_type,
        detail: wtResult.detail,
      },
    },

    match_flags: {
      location_match:        locResult.score >= 6,
      practice_area_match:   paResult.match_type === 'exact' || paResult.match_type === 'group',
      practice_area_exact:   paResult.match_type === 'exact',
      pqe_in_range:          pqeResult.in_range === true,
      pqe_adjacent:          pqeResult.adjacent === true,
      seniority_compatible:  senResult.score >= 7,
      work_type_compatible:  wtResult.score >= 7,
    },

    _parsed: {
      candidate_location: cLoc,
      job_location:       jLoc,
      candidate_pqe:      cPQE,
      job_pqe:            jPQE,
      candidate_areas:    cAreas,
      job_areas:          jAreas,
      candidate_band:     cBand,
      job_band:           jBand,
    },
  };
}

export interface BatchScoreOptions {
  minScore?: number;
  topN?: number | null;
  includeDebug?: boolean;
}

export function batchScore(candidates: any[], jobs: any[], options: BatchScoreOptions = {}) {
  const { minScore = 0, topN = null, includeDebug = false } = options;
  const results: any[] = [];

  for (const job of jobs) {
    const jobResults: any[] = [];

    for (const candidate of candidates) {
      const result = scoreMatch(candidate, job);

      if (!result.hard_filter_pass) continue;
      if (result.score_10 < minScore) continue;

      const entry: any = {
        candidate_id:  candidate.id || candidate.candidate_id,
        candidate_name: candidate.name || candidate.candidate_name,
        job_id:        job.id || job.job_id,
        job_title:     job.title || job.job_title,
        company:       job.company,
        score_10:      result.score_10,
        hard_filter_pass: result.hard_filter_pass,
        excluded_reason:  result.excluded_reason,
        breakdown:     result.breakdown,
        match_flags:   result.match_flags,
      };

      if (includeDebug) entry._parsed = result._parsed;
      jobResults.push(entry);
    }

    jobResults.sort((a, b) => b.score_10 - a.score_10);

    const limited = topN ? jobResults.slice(0, topN) : jobResults;
    results.push(...limited);
  }

  results.sort((a, b) => b.score_10 - a.score_10);
  return results;
}
