import React, { useEffect, useState } from "react";
import { 
  Briefcase, 
  Users, 
  Zap, 
  Mail, 
  TrendingUp,
  Clock,
  RefreshCw,
  ArrowUpRight,
  Target
} from "lucide-react";
import { motion } from "motion/react";
import { cn } from "../lib/utils";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, query, limit, orderBy, where } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { getMarketSentiment } from "../services/aiService";

export default function Dashboard() {
  const navigate = useNavigate();
  const [running, setRunning] = React.useState(false);
  const [stats, setStats] = useState({ jobs: 0, candidates: 0, matches: 0, placements: 0 });
  const [recentMatches, setRecentMatches] = useState<any[]>([]);
  const [marketSentiment, setMarketSentiment] = useState<any>(null);
  const [loadingSentiment, setLoadingSentiment] = useState(true);

  useEffect(() => {
    // Real-time stats
    const unsubJobs = onSnapshot(collection(db, "jobs"), (snap) => {
      setStats(prev => ({ ...prev, jobs: snap.size }));
    });
    const unsubCandidates = onSnapshot(collection(db, "candidates"), (snap) => {
      setStats(prev => ({ ...prev, candidates: snap.size }));
    });
    const unsubMatches = onSnapshot(collection(db, "matches"), (snap) => {
      setStats(prev => ({ ...prev, matches: snap.size }));
    });
    const unsubPipeline = onSnapshot(query(collection(db, "pipeline"), where("stage", "==", "Placed")), (snap) => {
      setStats(prev => ({ ...prev, placements: snap.size }));
    });

    // Recent matches
    const qMatches = query(collection(db, "matches"), orderBy("createdAt", "desc"), limit(5));
    const unsubRecent = onSnapshot(qMatches, (snap) => {
      setRecentMatches(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => handleFirestoreError(err, OperationType.LIST, "matches"));

    // Fetch Market Sentiment
    const fetchSentiment = async () => {
      try {
        const sentiment = await getMarketSentiment();
        setMarketSentiment(sentiment);
      } catch (err) {
        console.error("Failed to fetch market sentiment:", err);
      } finally {
        setLoadingSentiment(false);
      }
    };
    fetchSentiment();

    return () => {
      unsubJobs();
      unsubCandidates();
      unsubMatches();
      unsubPipeline();
      unsubRecent();
    };
  }, []);

  const dashboardStats = [
    { name: "Active Jobs", value: String(stats.jobs), icon: Briefcase, color: "text-blue-600", bg: "bg-blue-50" },
    { name: "New Candidates", value: String(stats.candidates), icon: Users, color: "text-emerald-600", bg: "bg-emerald-50" },
    { name: "Strong Matches", value: String(stats.matches), icon: Zap, iconFill: true, color: "text-amber-600", bg: "bg-amber-50" },
    { name: "Placements", value: String(stats.placements), icon: Mail, color: "text-indigo-600", bg: "bg-indigo-50" },
  ];

  const runOrchestrator = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/orchestrator/run", { method: "POST" });
      const data = await res.json();
      if (data.status === "success") {
        window.location.reload();
      }
    } catch (err) {
      console.error("Failed to run orchestrator:", err);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-slate-500">Welcome back, Emily. Here's what's happening today.</p>
        </div>
        <button 
          onClick={runOrchestrator}
          disabled={running}
          className={cn(
            "flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed",
            running && "animate-pulse"
          )}
        >
          <Zap size={18} fill="currentColor" />
          {running ? "Running..." : "Run Orchestrator"}
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {dashboardStats.map((stat, index) => (
          <motion.div
            key={stat.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"
          >
            <div className="flex items-center gap-4">
              <div className={cn("p-3 rounded-xl", stat.bg)}>
                <stat.icon size={24} className={stat.color} fill={stat.iconFill ? "currentColor" : "none"} />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500">{stat.name}</p>
                <p className="text-2xl font-bold">{stat.value}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Activity */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2">
                <Clock size={18} className="text-slate-400" />
                Recent Matches
              </h3>
              <button 
                onClick={() => navigate("/matches")}
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                View all
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {recentMatches.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-sm italic">No recent matches found.</div>
              ) : recentMatches.map((match, i) => (
                <div key={match.id} className="p-4 hover:bg-slate-50 transition-colors flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-600">
                      {match.candidateName?.substring(0, 2).toUpperCase() || "C"}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{match.candidateName} matched with {match.jobTitle}</p>
                      <p className="text-xs text-slate-500">
                        {match.createdAt ? new Date(match.createdAt).toLocaleDateString() : "Just now"} • {match.llmScore || match.baselineScore}/10 Score
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded",
                      (match.llmScore || match.baselineScore) >= 8 ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-700"
                    )}>
                      {(match.llmScore || match.baselineScore) >= 8 ? "Strong Match" : "Reviewed"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Quick Actions / Insights */}
        <div className="space-y-6">
          <div className="bg-indigo-600 rounded-2xl p-6 text-white shadow-lg shadow-indigo-200">
            <h3 className="font-bold text-lg mb-2">AI Insights</h3>
            <p className="text-indigo-100 text-sm mb-4">
              We found 3 new candidates that match your "Corporate Counsel" job with over 90% confidence.
            </p>
            <button 
              onClick={() => navigate("/matches")}
              className="w-full py-2 bg-white text-indigo-600 rounded-xl font-bold text-sm hover:bg-indigo-50 transition-colors"
            >
              Review Matches
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2">
                <TrendingUp size={18} className="text-indigo-600" />
                Market Sentiment
              </h3>
              {marketSentiment && (
                <span className={cn(
                  "px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full",
                  marketSentiment.sentiment === "Bullish" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                )}>
                  {marketSentiment.sentiment}
                </span>
              )}
            </div>
            
            {loadingSentiment ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-4 bg-slate-100 rounded w-full" />
                <div className="h-4 bg-slate-100 rounded w-3/4" />
                <div className="h-12 bg-slate-50 rounded w-full" />
              </div>
            ) : marketSentiment ? (
              <div className="space-y-4">
                <p className="text-xs text-slate-600 leading-relaxed italic">
                  "{marketSentiment.summary}"
                </p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    <span>Trending Practice Areas</span>
                    <ArrowUpRight size={12} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {marketSentiment.trendingAreas.map((area: string) => (
                      <span key={area} className="px-2 py-1 bg-slate-100 text-slate-600 text-[10px] font-medium rounded-lg">
                        {area}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="pt-2 border-t border-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Target size={14} className="text-indigo-500" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Target PQE</span>
                  </div>
                  <span className="text-xs font-bold text-slate-700">{marketSentiment.averagePqeDemand}</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Failed to load market insights.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
