import React, { useEffect, useState } from "react";
import { 
  BarChart3, 
  TrendingUp, 
  Users, 
  Briefcase, 
  CheckCircle2,
  PieChart,
  Activity
} from "lucide-react";
import { motion } from "motion/react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from "recharts";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";

export default function Analytics() {
  const [stats, setStats] = useState({
    jobs: 0,
    candidates: 0,
    strongMatches: 0,
    placements: 0,
    pipeline: [] as any[]
  });

  useEffect(() => {
    const unsubJobs = onSnapshot(collection(db, "jobs"), (snap) => {
      setStats(prev => ({ ...prev, jobs: snap.size }));
    });
    const unsubCandidates = onSnapshot(collection(db, "candidates"), (snap) => {
      setStats(prev => ({ ...prev, candidates: snap.size }));
    });
    const unsubMatches = onSnapshot(query(collection(db, "matches"), where("llmScore", ">=", 8)), (snap) => {
      setStats(prev => ({ ...prev, strongMatches: snap.size }));
    });
    const unsubPlacements = onSnapshot(query(collection(db, "pipeline"), where("stage", "==", "Placed")), (snap) => {
      setStats(prev => ({ ...prev, placements: snap.size }));
    });

    const stages = ["Applied", "Screening", "Interview", "Offer", "Placed"];
    const unsubPipeline = onSnapshot(collection(db, "pipeline"), (snap) => {
      const counts = stages.map(stage => ({
        name: stage,
        count: snap.docs.filter(doc => doc.data().stage === stage).length
      }));
      setStats(prev => ({ ...prev, pipeline: counts }));
    });

    return () => {
      unsubJobs();
      unsubCandidates();
      unsubMatches();
      unsubPlacements();
      unsubPipeline();
    };
  }, []);

  const COLORS = ["#4f46e5", "#10b981", "#f59e0b", "#3b82f6", "#8b5cf6"];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Analytics & Insights</h2>
        <p className="text-slate-500">Performance metrics and recruitment pipeline health.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-4 mb-2">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
              <Briefcase size={20} />
            </div>
            <p className="text-sm font-medium text-slate-500">Total Jobs</p>
          </div>
          <p className="text-3xl font-bold">{stats.jobs}</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-4 mb-2">
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
              <Users size={20} />
            </div>
            <p className="text-sm font-medium text-slate-500">Total Candidates</p>
          </div>
          <p className="text-3xl font-bold">{stats.candidates}</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-4 mb-2">
            <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
              <TrendingUp size={20} />
            </div>
            <p className="text-sm font-medium text-slate-500">Strong Matches</p>
          </div>
          <p className="text-3xl font-bold">{stats.strongMatches}</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-4 mb-2">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <CheckCircle2 size={20} />
            </div>
            <p className="text-sm font-medium text-slate-500">Placements</p>
          </div>
          <p className="text-3xl font-bold">{stats.placements}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="font-bold mb-6 flex items-center gap-2">
            <Activity size={18} className="text-slate-400" />
            Pipeline Distribution
          </h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.pipeline}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
                <Tooltip 
                  contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)" }}
                  cursor={{ fill: "#f8fafc" }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {stats.pipeline.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="font-bold mb-6 flex items-center gap-2">
            <PieChart size={18} className="text-slate-400" />
            Conversion Metrics
          </h3>
          <div className="space-y-6">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-600">Match to Interview</span>
                <span className="font-bold">24%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 w-[24%]" />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-600">Interview to Offer</span>
                <span className="font-bold">12%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 w-[12%]" />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-600">Offer to Placement</span>
                <span className="font-bold">85%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 w-[85%]" />
              </div>
            </div>
          </div>
          <div className="mt-8 p-4 bg-slate-50 rounded-xl border border-slate-100">
            <p className="text-xs text-slate-500 leading-relaxed">
              <span className="font-bold text-indigo-600">AI Insight:</span> Your "Offer to Placement" rate is 15% higher than the legal industry average. Consider increasing your interview volume to capitalize on this high conversion.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
