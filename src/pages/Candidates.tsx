import React, { useEffect, useState } from "react";
import { 
  Users, 
  MapPin, 
  ExternalLink, 
  Plus,
  Filter,
  Search as SearchIcon,
  Building2,
  GraduationCap,
  Globe,
  RefreshCw,
  Zap,
  DollarSign,
  MessageSquare,
  X,
  AlertCircle,
  CheckCircle2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, query, orderBy, addDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { scrapeUrl, findSimilarCandidates, getSalaryBenchmark, generateInterviewQuestions } from "../services/aiService";
import { cn } from "../lib/utils";

interface Candidate {
  id: string;
  name: string;
  email: string;
  location: string;
  currentFirm: string;
  practiceArea: string;
  pqeYears: number;
  status: string;
  createdAt: string;
}

export default function Candidates() {
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [showImport, setShowImport] = useState(false);
  
  // Filtering state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterPracticeArea, setFilterPracticeArea] = useState("All");
  const [filterLocation, setFilterLocation] = useState("All");
  const [filterPQE, setFilterPQE] = useState("All");

  // AI Insight Modal state
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [salaryInfo, setSalaryInfo] = useState<any>(null);
  const [interviewQuestions, setInterviewQuestions] = useState<any[]>([]);
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'error'} | null>(null);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    const q = query(collection(db, "candidates"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const candidatesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Candidate[];
      setCandidates(candidatesData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "candidates");
    });

    return unsubscribe;
  }, []);

  const handleImport = async () => {
    if (!importUrl.trim()) return;
    setImporting(true);
    try {
      const data = await scrapeUrl(importUrl, "Candidate");
      await addDoc(collection(db, "candidates"), {
        ...data,
        profileUrl: importUrl,
        status: "New",
        createdAt: new Date().toISOString()
      });
      setImportUrl("");
      setShowImport(false);
      setNotification({ message: "Candidate profile imported successfully!", type: 'success' });
    } catch (err) {
      console.error("Failed to import candidate:", err);
      setNotification({ message: "Failed to scrape profile. Please check the URL.", type: 'error' });
    } finally {
      setImporting(false);
    }
  };

  const handleFindSimilar = async (candidate: Candidate) => {
    try {
      const insights = await findSimilarCandidates(candidate);
      // Navigate to discovery with the lookalike keywords
      navigate("/discovery", { 
        state: { 
          jobContext: {
            title: `Lookalike: ${candidate.name}`,
            practiceArea: candidate.practiceArea,
            pqe: `${candidate.pqeYears} yrs`,
            description: `Finding candidates similar to ${candidate.name} from ${candidate.currentFirm}. Keywords: ${insights.searchKeywords.join(", ")}. Similar firms: ${insights.similarFirms.join(", ")}.`
          } 
        } 
      });
    } catch (err) {
      console.error("Failed to find similar candidates:", err);
    }
  };

  const showAIInsights = async (candidate: Candidate) => {
    setSelectedCandidate(candidate);
    setAiLoading(true);
    setSalaryInfo(null);
    setInterviewQuestions([]);
    
    try {
      const [salary, questions] = await Promise.all([
        getSalaryBenchmark(candidate.practiceArea, candidate.pqeYears, candidate.location),
        generateInterviewQuestions({ title: "Senior Lawyer", company: "Top Tier Firm", practiceArea: candidate.practiceArea }, candidate)
      ]);
      setSalaryInfo(salary);
      setInterviewQuestions(questions);
    } catch (err) {
      console.error("Failed to fetch AI insights:", err);
    } finally {
      setAiLoading(false);
    }
  };

  const filteredCandidates = candidates.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         c.currentFirm.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPractice = filterPracticeArea === "All" || c.practiceArea === filterPracticeArea;
    const matchesLocation = filterLocation === "All" || c.location.includes(filterLocation);
    const matchesPQE = filterPQE === "All" || 
                      (filterPQE === "0-3" && c.pqeYears <= 3) ||
                      (filterPQE === "4-7" && c.pqeYears > 3 && c.pqeYears <= 7) ||
                      (filterPQE === "8+" && c.pqeYears > 7);
    
    return matchesSearch && matchesPractice && matchesLocation && matchesPQE;
  });

  const practiceAreas = ["All", ...new Set(candidates.map(c => c.practiceArea))];
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
          <h2 className="text-2xl font-bold tracking-tight">Candidates</h2>
          <p className="text-slate-500">Manage and track legal talent pool in Australia.</p>
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
            Add Candidate
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
            <h3 className="font-bold text-sm uppercase tracking-wider">Agentic Profile Scraper</h3>
          </div>
          <div className="flex gap-4">
            <input 
              type="text" 
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="Paste LinkedIn or Law Firm profile URL..."
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
              placeholder="Search candidates, firms, or skills..." 
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
            <select 
              value={filterPQE}
              onChange={(e) => setFilterPQE(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="All">All PQE</option>
              <option value="0-3">Junior (0-3 yrs)</option>
              <option value="4-7">Mid-level (4-7 yrs)</option>
              <option value="8+">Senior (8+ yrs)</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-white rounded-2xl border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : filteredCandidates.length === 0 ? (
        <div className="p-12 bg-white rounded-2xl border border-slate-200 text-center space-y-4">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-400">
            <Users size={32} />
          </div>
          <p className="text-slate-500">No candidates match your filters.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Candidate</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Current Firm</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Practice Area</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">PQE</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCandidates.map((candidate, index) => (
                <motion.tr
                  key={candidate.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.03 }}
                  className="hover:bg-slate-50 transition-colors group"
                >
                  <td className="px-6 py-4 cursor-pointer" onClick={() => showAIInsights(candidate)}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700">
                        {candidate.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <p className="text-sm font-bold group-hover:text-indigo-600 transition-colors">{candidate.name}</p>
                        <p className="text-xs text-slate-500 flex items-center gap-1">
                          <MapPin size={12} />
                          {candidate.location}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Building2 size={14} className="text-slate-400" />
                      {candidate.currentFirm}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 bg-slate-100 rounded text-xs font-medium text-slate-600">
                      {candidate.practiceArea}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      <GraduationCap size={14} className="text-slate-400" />
                      {candidate.pqeYears} yrs
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => handleFindSimilar(candidate)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-indigo-100 transition-colors"
                      >
                        <Zap size={14} />
                        Find Similar
                      </button>
                      <button className="p-2 text-slate-400 hover:text-indigo-600 transition-colors">
                        <ExternalLink size={18} />
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* AI Insights Modal */}
      <AnimatePresence>
        {selectedCandidate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-200">
                    <Zap size={24} fill="currentColor" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">{selectedCandidate.name}</h3>
                    <p className="text-sm text-slate-500">AI-Powered Talent Insights</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedCandidate(null)}
                  className="p-2 hover:bg-slate-200 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-8">
                {aiLoading ? (
                  <div className="flex flex-col items-center justify-center py-12 space-y-4">
                    <RefreshCw size={40} className="text-indigo-600 animate-spin" />
                    <p className="text-slate-500 font-medium">Generating Australian Market Insights...</p>
                  </div>
                ) : (
                  <>
                    {/* Salary Benchmarking */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-indigo-600">
                        <DollarSign size={20} />
                        <h4 className="font-bold uppercase tracking-wider text-sm">Salary Benchmarking (AUD)</h4>
                      </div>
                      {salaryInfo && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Market Median</p>
                            <p className="text-xl font-bold text-slate-900">${(salaryInfo.median / 1000).toFixed(0)}k</p>
                          </div>
                          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Range</p>
                            <p className="text-xl font-bold text-slate-900">${(salaryInfo.lowRange / 1000).toFixed(0)}k - ${(salaryInfo.highRange / 1000).toFixed(0)}k</p>
                          </div>
                          <div className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100">
                            <p className="text-[10px] font-bold text-indigo-400 uppercase">Demand</p>
                            <p className="text-xl font-bold text-indigo-700">High</p>
                          </div>
                          <div className="md:col-span-3 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                            <p className="text-xs text-slate-600 leading-relaxed">{salaryInfo.marketCommentary}</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Interview Questions */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-emerald-600">
                        <MessageSquare size={20} />
                        <h4 className="font-bold uppercase tracking-wider text-sm">Tailored Interview Questions</h4>
                      </div>
                      <div className="space-y-3">
                        {interviewQuestions.map((q, i) => (
                          <div key={i} className="p-4 bg-emerald-50/50 rounded-2xl border border-emerald-100 space-y-2">
                            <p className="text-sm font-bold text-slate-900">{q.question}</p>
                            <p className="text-[10px] text-emerald-700 font-medium italic">Rationale: {q.rationale}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
                <button 
                  onClick={() => handleFindSimilar(selectedCandidate!)}
                  className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center justify-center gap-2"
                >
                  <Zap size={18} fill="currentColor" />
                  Find Lookalikes
                </button>
                <button 
                  onClick={() => setSelectedCandidate(null)}
                  className="px-6 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-all"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
