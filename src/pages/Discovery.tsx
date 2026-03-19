import React, { useEffect, useState } from "react";
import { 
  Search, 
  Globe, 
  Link as LinkIcon, 
  CheckCircle2, 
  AlertCircle,
  Play,
  RefreshCw,
  ExternalLink,
  Briefcase,
  User,
  Plus,
  Linkedin,
  Loader2,
  Download,
  Trash2,
  ArrowRight
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useLocation } from "react-router-dom";
import { collection, onSnapshot, query, orderBy, addDoc, serverTimestamp, doc, updateDoc, deleteDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { discoverItems } from "../services/aiService";
import { cn } from "../lib/utils";

interface DiscoveredItem {
  id: string;
  type: "Job" | "Candidate";
  title: string;
  company?: string;
  location?: string;
  url: string;
  source?: string;
  confidence: number;
  status: "New" | "Imported" | "Ignored";
  discoveredAt: any;
  metadata?: any;
}

interface ApifyRun {
  id: number;
  status: string;
  results_count: number;
  apify_run_id: string;
  search_params: string;
  started_at: string;
  completed_at: string;
  results?: any[];
}

export default function Discovery() {
  const location = useLocation();
  const jobContext = location.state?.jobContext;

  const [items, setItems] = useState<DiscoveredItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [deepScanning, setDeepScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState(jobContext ? `${jobContext.title} ${jobContext.practiceArea}` : "Corporate Lawyer London");
  const [scanType, setScanType] = useState<"Job" | "Candidate">(jobContext ? "Candidate" : "Job");
  
  // Apify State
  const [showApify, setShowApify] = useState(false);
  const [apifyRuns, setApifyRuns] = useState<ApifyRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<ApifyRun | null>(null);
  const [apifyLoading, setApifyLoading] = useState(false);
  const [apifyForm, setApifyForm] = useState({
    firstname: "",
    lastname: "",
    location: "Australia",
    current_job_title: "Lawyer",
    max_profiles: 10
  });
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'error'} | null>(null);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    const q = query(collection(db, "discovery"), orderBy("discoveredAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const discoveryData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as DiscoveredItem[];
      setItems(discoveryData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "discovery");
    });

    fetchApifyRuns();

    return unsubscribe;
  }, []);

  const fetchApifyRuns = async () => {
    try {
      const res = await fetch("/api/discovery/apify/runs");
      const data = await res.json();
      setApifyRuns(data);
    } catch (err) {
      console.error("Failed to fetch Apify runs:", err);
    }
  };

  const startApifyRun = async () => {
    setApifyLoading(true);
    try {
      const res = await fetch("/api/discovery/apify/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apifyForm)
      });
      const data = await res.json();
      if (data.error) {
        setNotification({ message: data.error, type: 'error' });
      } else if (data.id) {
        setNotification({ message: "Scraper run initiated!", type: 'success' });
        fetchApifyRuns();
        setShowApify(false);
      }
    } catch (err) {
      console.error("Failed to start Apify run:", err);
      setNotification({ message: "Failed to start scraper run.", type: 'error' });
    } finally {
      setApifyLoading(false);
    }
  };

  const viewRunDetails = async (runId: number) => {
    try {
      const res = await fetch(`/api/discovery/apify/runs/${runId}`);
      const data = await res.json();
      setSelectedRun(data);
      if (data.status === "Running") {
        // Poll for updates if still running
        setTimeout(() => viewRunDetails(runId), 5000);
      }
    } catch (err) {
      console.error("Failed to fetch run details:", err);
    }
  };

  const importApifyCandidate = async (candidate: any) => {
    try {
      const res = await fetch("/api/discovery/apify/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate })
      });
      const data = await res.json();
      if (data.success) {
        setNotification({ 
          message: data.message || "Candidate imported successfully!", 
          type: 'success' 
        });
      }
    } catch (err) {
      console.error("Failed to import candidate:", err);
      setNotification({ message: "Failed to import candidate.", type: 'error' });
    }
  };

  const deleteRun = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this run history?")) return;
    try {
      const res = await fetch(`/api/discovery/apify/runs/${id}`, { method: "DELETE" });
      if (res.ok) {
        setApifyRuns(prev => prev.filter(r => r.id !== id));
        if (selectedRun?.id === id) setSelectedRun(null);
        setNotification({ message: "Run deleted.", type: 'success' });
      }
    } catch (err) {
      console.error("Failed to delete run:", err);
    }
  };

  const startScan = async () => {
    if (!searchQuery.trim()) return;
    setScanning(true);
    try {
      const results = await discoverItems(scanType, searchQuery, jobContext);
      
      for (const result of results) {
        await addDoc(collection(db, "discovery"), {
          type: scanType,
          title: result.title,
          company: result.company || "",
          location: result.location || "",
          url: result.url,
          source: "Google Search",
          confidence: result.confidence || 0.85,
          status: "New",
          discoveredAt: serverTimestamp(),
          metadata: result.metadata || {}
        });
      }
    } catch (err) {
      console.error("Discovery scan failed:", err);
      setNotification({ message: "Discovery scan failed.", type: 'error' });
    } finally {
      setScanning(false);
    }
  };

  const startDeepScan = async () => {
    if (!searchQuery.trim()) return;
    setDeepScanning(true);
    try {
      const res = await fetch("/api/discovery/local/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: searchQuery,
          location: "Australia", // Default for local scraper
          type: scanType
        })
      });
      const data = await res.json();
      if (data.status === "success") {
        setNotification({ message: `Deep scan completed! Found ${data.resultsCount} items.`, type: 'success' });
      } else {
        setNotification({ message: data.error || "Deep scan failed.", type: 'error' });
      }
    } catch (err) {
      console.error("Deep discovery scan failed:", err);
      setNotification({ message: "Deep scan failed.", type: 'error' });
    } finally {
      setDeepScanning(false);
    }
  };

  const importItem = async (item: DiscoveredItem) => {
    try {
      if (item.type === "Job") {
        await addDoc(collection(db, "jobs"), {
          title: item.title,
          company: item.company || "Unknown",
          location: item.location || "Remote",
          jobUrl: item.url,
          status: "Active",
          createdAt: new Date().toISOString()
        });
      } else {
        await addDoc(collection(db, "candidates"), {
          name: item.title,
          currentFirm: item.company || "",
          location: item.location || "",
          profileUrl: item.url,
          status: "New",
          createdAt: new Date().toISOString()
        });
      }
      
      // Update discovery status
      await updateDoc(doc(db, "discovery", item.id), {
        status: "Imported"
      });
      setNotification({ message: `${item.type} imported successfully!`, type: 'success' });
    } catch (err) {
      console.error("Failed to import item:", err);
      setNotification({ message: `Failed to import ${item.type.toLowerCase()}.`, type: 'error' });
    }
  };

  const ignoreItem = async (id: string) => {
    try {
      await updateDoc(doc(db, "discovery", id), {
        status: "Ignored"
      });
    } catch (err) {
      console.error("Failed to ignore item:", err);
    }
  };

  const filteredItems = items.filter(item => item.status === "New");

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

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Jobs</h2>
          <p className="text-slate-500">AI-powered web discovery for new roles and talent signals.</p>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setShowApify(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-xl text-xs font-bold hover:bg-indigo-100 transition-all border border-indigo-100"
          >
            <Linkedin size={16} />
            LinkedIn Deep Scrape
          </button>
          
          <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
            <button 
              onClick={() => setScanType("Job")}
              className={cn(
                "px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
                scanType === "Job" ? "bg-indigo-600 text-white shadow-md" : "text-slate-500 hover:bg-slate-50"
              )}
            >
              Find Jobs
            </button>
            <button 
              onClick={() => setScanType("Candidate")}
              className={cn(
                "px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
                scanType === "Candidate" ? "bg-indigo-600 text-white shadow-md" : "text-slate-500 hover:bg-slate-50"
              )}
            >
              Find Talent
            </button>
          </div>
        </div>
      </div>

      {/* Apify Run Modal */}
      <AnimatePresence>
        {showApify && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden"
            >
              <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
                    <Linkedin size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">LinkedIn Scraper</h3>
                    <p className="text-xs text-slate-500">Powered by Apify Actor</p>
                  </div>
                </div>
                <button onClick={() => setShowApify(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400">
                  <Trash2 size={20} />
                </button>
              </div>
              
              <div className="p-8 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">First Name</label>
                    <input 
                      type="text" 
                      value={apifyForm.firstname}
                      onChange={(e) => setApifyForm({...apifyForm, firstname: e.target.value})}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Last Name</label>
                    <input 
                      type="text" 
                      value={apifyForm.lastname}
                      onChange={(e) => setApifyForm({...apifyForm, lastname: e.target.value})}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Location</label>
                  <input 
                    type="text" 
                    value={apifyForm.location}
                    onChange={(e) => setApifyForm({...apifyForm, location: e.target.value})}
                    placeholder="e.g. Sydney, Australia"
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Job Title</label>
                  <input 
                    type="text" 
                    value={apifyForm.current_job_title}
                    onChange={(e) => setApifyForm({...apifyForm, current_job_title: e.target.value})}
                    placeholder="e.g. M&A Partner"
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Max Profiles</label>
                  <input 
                    type="number" 
                    value={apifyForm.max_profiles}
                    onChange={(e) => setApifyForm({...apifyForm, max_profiles: parseInt(e.target.value)})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
              
              <div className="p-8 bg-slate-50 flex gap-4">
                <button 
                  onClick={startApifyRun}
                  disabled={apifyLoading}
                  className="flex-1 py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center justify-center gap-2"
                >
                  {apifyLoading ? <Loader2 className="animate-spin" size={20} /> : <Play size={20} fill="currentColor" />}
                  {apifyLoading ? "Starting Run..." : "Launch Scraper"}
                </button>
                <button 
                  onClick={() => setShowApify(false)}
                  className="px-8 py-3 bg-white border border-slate-200 text-slate-600 rounded-2xl font-bold hover:bg-slate-50 transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Apify Results Modal */}
      <AnimatePresence>
        {selectedRun && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="bg-white w-full max-w-4xl max-h-[80vh] rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
            >
              <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold">Scraper Results</h3>
                  <p className="text-xs text-slate-500">Run ID: {selectedRun.apify_run_id} • Status: {selectedRun.status}</p>
                </div>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => viewRunDetails(selectedRun.id)}
                    className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-full transition-all"
                    title="Refresh Status"
                  >
                    <RefreshCw size={20} className={selectedRun.status === "Running" ? "animate-spin" : ""} />
                  </button>
                  <button onClick={() => setSelectedRun(null)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400">
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8">
                {selectedRun.status === "Running" ? (
                  <div className="flex flex-col items-center justify-center h-64 space-y-4">
                    <Loader2 className="animate-spin text-indigo-600" size={48} />
                    <p className="text-slate-500 font-medium">Scraping LinkedIn profiles... this may take a few minutes.</p>
                  </div>
                ) : selectedRun.results && selectedRun.results.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selectedRun.results.map((candidate: any, i: number) => (
                      <div key={i} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center font-bold text-indigo-600 border border-slate-200">
                            {(candidate.fullName || candidate.name || "?")[0]}
                          </div>
                          <div>
                            <p className="font-bold text-sm">{candidate.fullName || candidate.name}</p>
                            <p className="text-[10px] text-slate-500 truncate max-w-[150px]">{candidate.currentCompany || candidate.headline}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <a href={candidate.url || candidate.profileUrl} target="_blank" rel="noreferrer" className="p-2 text-slate-400 hover:text-blue-600">
                            <ExternalLink size={16} />
                          </a>
                          <button 
                            onClick={() => importApifyCandidate(candidate)}
                            className="p-2 bg-white text-indigo-600 rounded-lg border border-slate-200 hover:bg-indigo-50"
                          >
                            <Download size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-slate-500">No results found for this run.</p>
                  </div>
                )}
              </div>
              
              <div className="p-8 bg-slate-50 border-t border-slate-100 flex justify-end">
                <button 
                  onClick={() => setSelectedRun(null)}
                  className="px-8 py-3 bg-white border border-slate-200 text-slate-600 rounded-2xl font-bold hover:bg-slate-50 transition-all"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={scanType === "Job" ? "e.g. Associate Lawyer Tech London" : "e.g. Senior Litigation Partner New York"}
              className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>
          <button 
            onClick={startScan}
            disabled={scanning || deepScanning || !searchQuery.trim()}
            className="flex items-center justify-center gap-2 px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 disabled:opacity-50"
          >
            {scanning ? <RefreshCw size={20} className="animate-spin" /> : <Play size={20} fill="currentColor" />}
            {scanning ? "AI Scanning..." : "Run Discovery"}
          </button>
          <button 
            onClick={startDeepScan}
            disabled={scanning || deepScanning || !searchQuery.trim()}
            className="flex items-center justify-center gap-2 px-8 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg shadow-slate-100 disabled:opacity-50"
          >
            {deepScanning ? <RefreshCw size={20} className="animate-spin" /> : <Globe size={20} />}
            {deepScanning ? "Deep Scraping..." : "Deep Scrape"}
          </button>
        </div>
        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest text-center">
          Using Gemini 3 Flash with Google Search Grounding
        </p>
      </div>

      {/* Apify Runs List */}
      {apifyRuns.length > 0 && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold">Active Scrapers</h3>
            <button onClick={fetchApifyRuns} className="p-2 text-slate-400 hover:text-indigo-600">
              <RefreshCw size={16} />
            </button>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
            {apifyRuns.map((run) => (
              <button 
                key={run.id}
                onClick={() => viewRunDetails(run.id)}
                className="flex-shrink-0 w-64 p-4 bg-slate-50 rounded-2xl border border-slate-100 text-left hover:border-indigo-300 transition-all group"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className={cn(
                    "px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider",
                    run.status === "Completed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                  )}>
                    {run.status}
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        viewRunDetails(run.id);
                      }}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-lg transition-all"
                    >
                      <RefreshCw size={14} />
                    </button>
                    <button 
                      onClick={(e) => deleteRun(e, run.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-white rounded-lg transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <p className="text-xs font-bold text-slate-900 truncate">
                  {JSON.parse(run.search_params).firstname} {JSON.parse(run.search_params).lastname}
                </p>
                <p className="text-[10px] text-slate-500 truncate">
                  {JSON.parse(run.search_params).current_job_title} in {JSON.parse(run.search_params).location}
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-indigo-600">{run.results_count || 0} Results</span>
                  <ArrowRight size={14} className="text-slate-300 group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-indigo-50 rounded-xl text-indigo-600">
            <Globe size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase">New Signals</p>
            <p className="text-xl font-bold text-slate-900">{filteredItems.length}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600">
            <CheckCircle2 size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase">Imported</p>
            <p className="text-xl font-bold text-slate-900">{items.filter(i => i.status === "Imported").length}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-slate-50 rounded-xl text-slate-600">
            <AlertCircle size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase">Total Discovered</p>
            <p className="text-xl font-bold text-slate-900">{items.length}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-bold">Discovery Feed</h3>
          <span className="text-xs text-slate-400 font-medium">Showing new signals only</span>
        </div>
        <div className="divide-y divide-slate-100">
          {filteredItems.length === 0 ? (
            <div className="p-12 text-center space-y-4">
              <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-300">
                <Search size={32} />
              </div>
              <p className="text-slate-500 max-w-xs mx-auto">No new discovery results. Run a scan to find new jobs or candidates on the web.</p>
            </div>
          ) : (
            filteredItems.map((item, index) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="p-6 hover:bg-slate-50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 group"
              >
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0",
                    item.type === "Job" ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600"
                  )}>
                    {item.type === "Job" ? <Briefcase size={24} /> : <User size={24} />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-base font-bold text-slate-900">{item.title}</p>
                      <span className={cn(
                        "px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider",
                        item.type === "Job" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"
                      )}>
                        {item.type}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                      {item.company && (
                        <p className="text-sm font-medium text-slate-600">{item.company}</p>
                      )}
                      {item.location && (
                        <p className="text-xs text-slate-400 flex items-center gap-1">
                          <Globe size={12} />
                          {item.location}
                        </p>
                      )}
                      {item.metadata?.practiceArea && (
                        <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[10px] font-bold uppercase tracking-wider">
                          {item.metadata.practiceArea}
                        </span>
                      )}
                      {item.metadata?.pqe && (
                        <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold uppercase tracking-wider">
                          {item.metadata.pqe}
                        </span>
                      )}
                      <p className="text-xs text-slate-400 flex items-center gap-1">
                        <LinkIcon size={12} />
                        {item.source || "Web Signal"}
                      </p>
                    </div>
                    {item.metadata?.skills && item.metadata.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {item.metadata.skills.map((skill: string, i: number) => (
                          <span key={i} className="text-[9px] text-slate-400 border border-slate-200 px-1 rounded">
                            {skill}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 self-end md:self-center">
                  <div className="text-right hidden sm:block">
                    <p className="text-xs font-bold text-emerald-600">{(item.confidence * 100).toFixed(0)}% Confidence</p>
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                      {item.discoveredAt?.toDate ? item.discoveredAt.toDate().toLocaleDateString() : "Just now"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => importItem(item)}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100"
                    >
                      <Plus size={16} />
                      Import
                    </button>
                    <button 
                      onClick={() => ignoreItem(item.id)}
                      className="px-4 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl text-xs font-bold hover:bg-slate-50 transition-all"
                    >
                      Ignore
                    </button>
                    <a 
                      href={item.url} 
                      target="_blank" 
                      rel="noreferrer" 
                      className="p-2 text-slate-300 hover:text-indigo-600 transition-colors"
                    >
                      <ExternalLink size={20} />
                    </a>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
