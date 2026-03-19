import React, { useEffect, useState } from "react";
import { 
  Mail, 
  Send, 
  Eye, 
  MessageSquare, 
  Clock,
  Filter,
  Search as SearchIcon,
  CheckCircle2,
  Zap,
  X,
  Plus,
  Settings
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { collection, addDoc } from "firebase/firestore";
import { db } from "../firebase";

interface OutreachLog {
  id: number;
  candidate_name: string;
  job_title: string;
  type: string;
  status: string;
  subject: string;
  created_at: string;
}

export default function Outreach() {
  const [logs, setLogs] = useState<OutreachLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewCampaignModal, setShowNewCampaignModal] = useState(false);
  const [newCampaign, setNewCampaign] = useState({
    subject: "",
    recipient: "",
    type: "Email",
    status: "Draft"
  });
  const [adding, setAdding] = useState(false);
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'error'} | null>(null);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    // In a real app, this would fetch from /api/outreach
    // For now, we'll mock some data if the database is empty
    setLogs([
      { id: 1, candidate_name: "Sarah Chen", job_title: "Corporate Counsel", type: "Candidate", status: "Sent", subject: "Opportunity: Corporate Counsel at Atlassian", created_at: new Date().toISOString() },
      { id: 2, candidate_name: "Alex Rivera", job_title: "Senior Litigation Associate", type: "Candidate", status: "Opened", subject: "Senior Litigation Role - Baker McKenzie", created_at: new Date().toISOString() },
      { id: 3, candidate_name: "Sarah Chen", job_title: "Corporate Counsel", type: "Employer", status: "Replied", subject: "Candidate Submission: Sarah Chen", created_at: new Date().toISOString() },
    ]);
    setLoading(false);
  }, []);

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      await addDoc(collection(db, "outreach"), {
        ...newCampaign,
        engagement: "0%",
        sentAt: new Date().toISOString()
      });
      setShowNewCampaignModal(false);
      setNewCampaign({ subject: "", recipient: "", type: "Email", status: "Draft" });
      setNotification({ message: "Campaign created successfully!", type: 'success' });
    } catch (err) {
      console.error("Failed to create campaign:", err);
      setNotification({ message: "Failed to create campaign.", type: 'error' });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Notification Toast */}
      <AnimatePresence>
        {notification && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-8 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-xl font-bold text-sm flex items-center gap-3 ${
              notification.type === 'success' ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
            }`}
          >
            <Zap size={18} fill="currentColor" />
            {notification.message}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Outreach & Communications</h2>
          <p className="text-slate-500">Track email drafts, sends, and engagement.</p>
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            Email Settings
          </button>
          <button 
            onClick={() => setShowNewCampaignModal(true)}
            className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 transition-colors"
          >
            New Campaign
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Open Rate</p>
          <p className="text-2xl font-bold text-indigo-600">68%</p>
          <div className="h-1 bg-slate-100 rounded-full mt-3 overflow-hidden">
            <div className="h-full bg-indigo-500 w-[68%]" />
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Reply Rate</p>
          <p className="text-2xl font-bold text-emerald-600">24%</p>
          <div className="h-1 bg-slate-100 rounded-full mt-3 overflow-hidden">
            <div className="h-full bg-emerald-500 w-[24%]" />
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Pending Drafts</p>
          <p className="text-2xl font-bold text-amber-600">12</p>
          <div className="h-1 bg-slate-100 rounded-full mt-3 overflow-hidden">
            <div className="h-full bg-amber-500 w-[40%]" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex items-center gap-4">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input 
              type="text" 
              placeholder="Search outreach history..." 
              className="w-full pl-9 pr-4 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>
          <button className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            <Filter size={14} />
            Filter
          </button>
        </div>
        <div className="divide-y divide-slate-100">
          {logs.map((log, index) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: index * 0.05 }}
              className="p-4 hover:bg-slate-50 transition-colors flex items-center justify-between group"
            >
              <div className="flex items-center gap-4 flex-1">
                <div className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center",
                  log.status === "Sent" ? "bg-blue-50 text-blue-600" :
                  log.status === "Opened" ? "bg-indigo-50 text-indigo-600" :
                  log.status === "Replied" ? "bg-emerald-50 text-emerald-600" : "bg-slate-50 text-slate-400"
                )}>
                  {log.status === "Sent" ? <Send size={18} /> :
                   log.status === "Opened" ? <Eye size={18} /> :
                   log.status === "Replied" ? <MessageSquare size={18} /> : <Mail size={18} />}
                </div>
                <div>
                  <p className="text-sm font-bold">{log.subject}</p>
                  <p className="text-xs text-slate-500">
                    To: <span className="font-medium text-slate-700">{log.candidate_name}</span> • 
                    Role: <span className="font-medium text-slate-700">{log.job_title}</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <span className={cn(
                    "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
                    log.status === "Replied" ? "bg-emerald-50 text-emerald-700" :
                    log.status === "Opened" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"
                  )}>
                    {log.status}
                  </span>
                  <p className="text-[10px] text-slate-400 mt-1">{new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <button className="p-2 text-slate-300 hover:text-slate-600 transition-colors opacity-0 group-hover:opacity-100">
                  <MoreVertical size={18} />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
      {/* New Campaign Modal */}
      <AnimatePresence>
        {showNewCampaignModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-lg">Create New Campaign</h3>
                <button onClick={() => setShowNewCampaignModal(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleCreateCampaign} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Subject</label>
                  <input 
                    required
                    value={newCampaign.subject}
                    onChange={e => setNewCampaign({...newCampaign, subject: e.target.value})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g. Exciting Opportunity at Atlassian"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Recipient</label>
                  <input 
                    required
                    value={newCampaign.recipient}
                    onChange={e => setNewCampaign({...newCampaign, recipient: e.target.value})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g. Alex Rivera"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Type</label>
                    <select 
                      value={newCampaign.type}
                      onChange={e => setNewCampaign({...newCampaign, type: e.target.value})}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="Email">Email</option>
                      <option value="LinkedIn">LinkedIn</option>
                      <option value="Call">Call</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Initial Status</label>
                    <select 
                      value={newCampaign.status}
                      onChange={e => setNewCampaign({...newCampaign, status: e.target.value})}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="Draft">Draft</option>
                      <option value="Sent">Sent</option>
                    </select>
                  </div>
                </div>
                <button 
                  disabled={adding}
                  className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 disabled:opacity-50"
                >
                  {adding ? "Creating..." : "Create Campaign"}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(" ");
}

function MoreVertical({ size, className }: { size?: number, className?: string }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width={size || 24} 
      height={size || 24} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  );
}
