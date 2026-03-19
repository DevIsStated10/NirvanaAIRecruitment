import React, { useEffect, useState } from "react";
import { 
  Briefcase, 
  MapPin, 
  ExternalLink, 
  Plus,
  Filter,
  Search as SearchIcon,
  Globe,
  RefreshCw,
  Search,
  AlertCircle,
  CheckCircle2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, query, orderBy, addDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { scrapeUrl } from "../services/aiService";
import { cn } from "../lib/utils";

interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  salary: string;
  practiceArea: string;
  pqe?: string;
  jobUrl: string;
  status: string;
  createdAt: string;
}

export default function Jobs() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [showImport, setShowImport] = useState(false);
  
  // Filtering state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterPracticeArea, setFilterPracticeArea] = useState("All");
  const [filterLocation, setFilterLocation] = useState("All");
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'error'} | null>(null);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    const q = query(collection(db, "jobs"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const jobsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Job[];
      setJobs(jobsData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "jobs");
    });

    return unsubscribe;
  }, []);

  const handleImport = async () => {
    if (!importUrl.trim()) return;
    setImporting(true);
    try {
      const data = await scrapeUrl(importUrl, "Job");
      await addDoc(collection(db, "jobs"), {
        ...data,
        jobUrl: importUrl,
        status: "Active",
        createdAt: new Date().toISOString()
      });
      setImportUrl("");
      setShowImport(false);
      setNotification({ message: "Job details imported successfully!", type: 'success' });
    } catch (err) {
      console.error("Failed to import job:", err);
      setNotification({ message: "Failed to scrape job. Please check the URL.", type: 'error' });
    } finally {
      setImporting(false);
    }
  };

  const findCandidates = (job: Job) => {
    navigate("/discovery", { 
      state: { 
        jobContext: {
          title: job.title,
          practiceArea: job.practiceArea,
          pqe: job.pqe,
          description: job.description
        } 
      } 
    });
  };

  const filteredJobs = jobs.filter(j => {
    const matchesSearch = j.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         j.company.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPractice = filterPracticeArea === "All" || j.practiceArea === filterPracticeArea;
    const matchesLocation = filterLocation === "All" || j.location.includes(filterLocation);
    
    return matchesSearch && matchesPractice && matchesLocation;
  });

  const practiceAreas = ["All", ...new Set(jobs.map(j => j.practiceArea))];
  const locations = ["All", "Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Canberra"];

  return (
    <div className="space-y-8">
      {/* Notification Toast */}
      <AnimatePresence>
        {notification && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={cn(
              "fixed top-8 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-xl font-bold text-sm flex items-center gap-3",
              notification.type === 'success' ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
            )}
          >
            {notification.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            {notification.message}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Active Jobs</h2>
          <p className="text-slate-500">Manage and track legal job openings in Australia.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowImport(!showImport)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-50 transition-colors"
          >
            <Globe size={18} />
            Import via URL
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 transition-colors">
            <Plus size={18} />
            Add Job
          </button>
        </div>
      </div>

      {showImport && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-6 rounded-2xl border border-indigo-100 shadow-sm space-y-4"
        >
          <div className="flex items-center gap-2 text-indigo-600 mb-2">
            <Globe size={18} />
            <h3 className="font-bold text-sm uppercase tracking-wider">Agentic Job Scraper</h3>
          </div>
          <div className="flex gap-4">
            <input 
              type="text" 
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="Paste Law Firm career page or Job board URL..."
              className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
            <button 
              onClick={handleImport}
              disabled={importing || !importUrl.trim()}
              className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {importing ? <RefreshCw size={18} className="animate-spin" /> : <Plus size={18} />}
              {importing ? "Scraping..." : "Import"}
            </button>
          </div>
        </motion.div>
      )}

      {/* Smart Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search jobs, firms, or practice areas..." 
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <select 
              value={filterPracticeArea}
              onChange={(e) => setFilterPracticeArea(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {practiceAreas.map(pa => <option key={pa} value={pa}>{pa}</option>)}
            </select>
            <select 
              value={filterLocation}
              onChange={(e) => setFilterLocation(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 bg-white rounded-2xl border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="p-12 bg-white rounded-2xl border border-slate-200 text-center space-y-4">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-400">
            <Briefcase size={32} />
          </div>
          <p className="text-slate-500">No jobs match your filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredJobs.map((job, index) => (
            <motion.div
              key={job.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.05 }}
              className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow group"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-slate-50 rounded-lg group-hover:bg-indigo-50 transition-colors">
                  <Briefcase size={20} className="text-slate-400 group-hover:text-indigo-600 transition-colors" />
                </div>
                <span className={cn(
                  "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
                  job.status === "Active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                )}>
                  {job.status}
                </span>
              </div>
              <h4 className="font-bold text-lg mb-1 group-hover:text-indigo-600 transition-colors">{job.title}</h4>
              <p className="text-sm font-medium text-slate-600 mb-4">{job.company}</p>
              
              <div className="space-y-2 mb-6">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <MapPin size={14} />
                  {job.location}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 font-medium">{job.practiceArea}</span>
                  {job.salary && <span className="text-slate-400">• {job.salary}</span>}
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                <button 
                  onClick={() => findCandidates(job)}
                  className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-600 uppercase tracking-wider hover:text-indigo-700 transition-colors"
                >
                  <Search size={12} />
                  Find Candidates
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 uppercase font-bold tracking-tight">
                    {job.createdAt ? `Added ${new Date(job.createdAt).toLocaleDateString()}` : "New"}
                  </span>
                  <a 
                    href={job.jobUrl} 
                    target="_blank" 
                    rel="noreferrer"
                    className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
                  >
                    <ExternalLink size={18} />
                  </a>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
