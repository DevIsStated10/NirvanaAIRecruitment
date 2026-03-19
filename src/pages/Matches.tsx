import React, { useEffect, useState } from "react";
import { 
  Zap, 
  CheckCircle2, 
  Clock,
  ChevronRight,
  User,
  Briefcase,
  RefreshCw,
  TrendingUp,
  Target,
  ArrowUpRight,
  XCircle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { useLocation } from "react-router-dom";
import { getMarketSentiment } from "../services/aiService";
import { cn } from "../lib/utils";

interface Match {
  id: string;
  jobId: string;
  candidateId: string;
  baselineScore: number;
  llmScore: number;
  matchReasons: any;
  matchSummary: string;
  status: string;
  createdAt: string;
  jobTitle: string;
  jobCompany: string;
  candidateName: string;
  practiceArea?: string;
  pqe?: string;
}

export default function Matches() {
  const location = useLocation();
  const staffMember = location.state?.staffMember;
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);
  const [marketSentiment, setMarketSentiment] = useState<any>(null);
  const [outreachDraft, setOutreachDraft] = useState<{subject: string, body: string} | null>(null);

  useEffect(() => {
    const q = query(collection(db, "matches"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const matchesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Match[];
      
      // Filter if staffMember context is provided
      const filteredMatches = staffMember 
        ? matchesData.filter(m => m.candidateName === staffMember.name) // Simple name match for demo
        : matchesData;

      setMatches(filteredMatches);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "matches");
    });

    // Fetch market sentiment
    const fetchSentiment = async () => {
      try {
        setMarketSentiment(null);
        const sentiment = await getMarketSentiment();
        setMarketSentiment(sentiment);
      } catch (err) {
        console.error("Failed to fetch market sentiment:", err);
      }
    };
    fetchSentiment();

    return unsubscribe;
  }, [staffMember]);

  const scoreMatch = async (id: string) => {
    try {
      const res = await fetch(`/api/matches/${id}/score`, { method: "POST" });
      await res.json();
    } catch (err) {
      console.error("Failed to score match:", err);
    }
  };

  const generateOutreachDraft = async (id: string) => {
    try {
      const res = await fetch(`/api/matches/${id}/outreach`, { method: "POST" });
      const data = await res.json();
      setOutreachDraft(data);
    } catch (err) {
      console.error("Failed to generate outreach:", err);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {staffMember ? `Internal Mobility: ${staffMember.name}` : "AI Match Engine"}
          </h2>
          <p className="text-slate-500">
            {staffMember 
              ? `Finding the best internal opportunities for ${staffMember.name}.`
              : "Intelligent scoring for the Australian legal market."}
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-full text-[10px] font-bold uppercase tracking-wider">
          <Zap size={14} fill="currentColor" />
          Powered by Gemini 3.1
        </div>
      </div>

      {/* Market Sentiment Widget */}
      {marketSentiment && !staffMember && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-indigo-600 p-6 rounded-2xl text-white shadow-xl shadow-indigo-100 relative overflow-hidden"
        >
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <TrendingUp size={20} className="text-indigo-200" />
                <h3 className="font-bold text-sm uppercase tracking-widest">Market Sentiment Update</h3>
              </div>
              <button 
                onClick={async () => {
                  setMarketSentiment(null);
                  const s = await getMarketSentiment();
                  setMarketSentiment(s);
                }}
                className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-all"
              >
                <RefreshCw size={14} />
              </button>
            </div>
            <p className="text-lg font-medium mb-6 leading-relaxed max-w-2xl">
              {marketSentiment.summary}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white/10 p-4 rounded-xl backdrop-blur-sm">
                <div className="flex items-center gap-2 mb-2">
                  <Target size={16} className="text-indigo-200" />
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-100">Trending Areas</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {marketSentiment.trendingAreas.map((area: string) => (
                    <span key={area} className="px-2 py-1 bg-white/20 rounded text-[10px] font-bold">
                      {area}
                    </span>
                  ))}
                </div>
              </div>
              <div className="bg-white/10 p-4 rounded-xl backdrop-blur-sm">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowUpRight size={16} className="text-indigo-200" />
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-100">High Demand PQE</span>
                </div>
                <p className="text-sm font-bold">{marketSentiment.averagePqeDemand}</p>
              </div>
            </div>
          </div>
          <Zap size={200} className="absolute -right-20 -bottom-20 text-white/5 rotate-12" fill="currentColor" />
        </motion.div>
      )}

      {/* Outreach Draft Modal */}
      <AnimatePresence>
        {outreachDraft && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden"
            >
              <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
                    <Zap size={24} />
                  </div>
                  <h3 className="text-xl font-bold">AI Outreach Draft</h3>
                </div>
                <button onClick={() => setOutreachDraft(null)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400">
                  <XCircle size={20} />
                </button>
              </div>
              <div className="p-8 space-y-6 max-h-[60vh] overflow-y-auto">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Subject Line</label>
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl font-medium">
                    {outreachDraft.subject}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Email Body</label>
                  <div className="p-6 bg-slate-50 border border-slate-200 rounded-xl text-sm leading-relaxed whitespace-pre-wrap">
                    {outreachDraft.body}
                  </div>
                </div>
              </div>
              <div className="p-8 bg-slate-50 flex gap-4">
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(`Subject: ${outreachDraft.subject}\n\n${outreachDraft.body}`);
                    setOutreachDraft(null);
                  }}
                  className="flex-1 py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                >
                  Copy to Clipboard
                </button>
                <button 
                  onClick={() => setOutreachDraft(null)}
                  className="px-8 py-3 bg-white border border-slate-200 text-slate-600 rounded-2xl font-bold hover:bg-slate-50 transition-all"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-40 bg-white rounded-2xl border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : matches.length === 0 ? (
        <div className="p-12 bg-white rounded-2xl border border-slate-200 text-center space-y-4">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-400">
            <Zap size={32} />
          </div>
          <div>
            <h3 className="font-bold text-lg">No matches yet</h3>
            <p className="text-slate-500 max-w-xs mx-auto">
              {staffMember 
                ? "No internal roles currently match this staff member's profile."
                : "Run the orchestrator to generate matches based on your current pool."}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {matches.map((match, index) => (
            <motion.div
              key={match.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className={cn(
                "bg-white rounded-2xl border shadow-sm overflow-hidden transition-all duration-300",
                expandedMatch === match.id ? "border-indigo-400 ring-1 ring-indigo-100" : "border-slate-200 hover:border-indigo-300"
              )}
            >
              <div className="p-6 flex flex-col md:flex-row gap-8">
                {/* Score Circle */}
                <div className="flex flex-col items-center justify-center gap-2">
                  <div className="relative w-24 h-24 flex items-center justify-center">
                    <svg className="w-full h-full -rotate-90">
                      <circle
                        cx="48"
                        cy="48"
                        r="42"
                        fill="none"
                        stroke="#f1f5f9"
                        strokeWidth="10"
                      />
                      <circle
                        cx="48"
                        cy="48"
                        r="42"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="10"
                        strokeDasharray={264}
                        strokeDashoffset={264 - (264 * (match.llmScore || match.baselineScore)) / 10}
                        className={cn(
                          (match.llmScore || match.baselineScore) >= 8 ? "text-emerald-500" : 
                          (match.llmScore || match.baselineScore) >= 6 ? "text-amber-500" : "text-slate-400"
                        )}
                      />
                    </svg>
                    <div className="absolute flex flex-col items-center">
                      <span className="text-2xl font-black">{(match.llmScore || match.baselineScore).toFixed(1)}</span>
                      <span className="text-[8px] font-bold text-slate-400 uppercase">/ 10</span>
                    </div>
                  </div>
                </div>

                {/* Match Details */}
                <div className="flex-1 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold">
                        {match.candidateName[0]}
                      </div>
                      <div>
                        <p className="font-bold text-slate-900">{match.candidateName}</p>
                        <p className="text-xs text-slate-500">{match.practiceArea || "Legal Professional"}</p>
                      </div>
                    </div>
                    <ChevronRight size={20} className="text-slate-300 hidden md:block" />
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-600 font-bold">
                        <Briefcase size={20} />
                      </div>
                      <div>
                        <p className="font-bold text-slate-900">{match.jobTitle}</p>
                        <p className="text-xs text-slate-500">at {match.jobCompany}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <div className="flex items-start gap-3">
                      <Zap size={16} className="text-indigo-600 mt-1 shrink-0" />
                      <p className="text-sm text-slate-700 leading-relaxed">
                        <span className="font-bold text-indigo-700">AI Summary: </span>
                        {match.matchSummary}
                      </p>
                    </div>
                  </div>

                  {expandedMatch === match.id && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      className="pt-4 border-t border-slate-100 space-y-4"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Key Match Reasons</h4>
                          <ul className="space-y-2">
                            {typeof match.matchReasons === 'string' ? (
                              match.matchReasons.split('\n').filter(r => r.trim()).map((reason, i) => (
                                <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
                                  <CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                                  {reason.replace(/^[*-]\s*/, '')}
                                </li>
                              ))
                            ) : (
                              Object.entries(match.matchReasons || {}).map(([key, val]: [string, any], i) => (
                                <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
                                  <CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                                  <span className="font-bold uppercase text-[8px] text-slate-400 mr-1">{key.replace('_', ' ')}:</span> 
                                  <span>{val.detail || val.score || JSON.stringify(val)}</span>
                                </li>
                              ))
                            )}
                          </ul>
                        </div>
                        <div className="space-y-2">
                          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Market Alignment</h4>
                          <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100/50">
                            <p className="text-xs text-indigo-700 leading-relaxed">
                              This candidate aligns with the <strong>{match.jobCompany}</strong> firm culture and the <strong>{match.practiceArea}</strong> market demand in Australia. 
                              The PQE level is optimal for the current seniority requirements.
                            </p>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  <div className="flex items-center gap-4 pt-2">
                    <button 
                      onClick={() => generateOutreachDraft(match.id)}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold text-xs hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                    >
                      {staffMember ? "Notify Staff Member" : "Generate Outreach"}
                    </button>
                    <button 
                      onClick={() => setExpandedMatch(expandedMatch === match.id ? null : match.id)}
                      className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-50 transition-all"
                    >
                      {expandedMatch === match.id ? "Hide Details" : "View AI Breakdown"}
                    </button>
                    <button 
                      onClick={() => scoreMatch(match.id)}
                      className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
                      title="Recalculate Score"
                    >
                      <RefreshCw size={18} />
                    </button>
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Status:</span>
                      <span className="flex items-center gap-1 text-xs font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">
                        <Clock size={14} />
                        {match.status}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
