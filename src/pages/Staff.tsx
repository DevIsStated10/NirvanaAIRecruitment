import React, { useEffect, useState } from "react";
import { 
  UserCheck, 
  Search, 
  MapPin, 
  Briefcase, 
  Plus, 
  Filter,
  Zap,
  ArrowRight,
  UserPlus,
  TrendingUp,
  Award,
  X
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { collection, onSnapshot, query, orderBy, addDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { useNavigate } from "react-router-dom";
import { findSimilarCandidates } from "../services/aiService";
import { cn } from "../lib/utils";

interface StaffMember {
  id: string;
  name: string;
  role: string;
  practiceArea: string;
  pqe: string;
  location: string;
  firm: string;
  performanceRating?: string;
  tenure?: string;
  skills: string[];
}

export default function Staff() {
  const navigate = useNavigate();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterPracticeArea, setFilterPracticeArea] = useState("All");
  const [showAddModal, setShowAddModal] = useState(false);
  const [newStaff, setNewStaff] = useState({
    name: "",
    role: "Senior Associate",
    practiceArea: "Litigation",
    location: "Sydney, NSW",
    firm: "NirvanaAI",
    pqe: "5 Years",
    skills: [] as string[]
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
    // Assuming a 'staff' collection exists for incumbents
    const q = query(collection(db, "staff"), orderBy("name", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const staffData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as StaffMember[];
      setStaff(staffData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "staff");
    });

    return unsubscribe;
  }, []);

  const handleFindLookalike = async (member: StaffMember) => {
    try {
      // Use the candidate lookalike logic for staff too
      const lookalikeData = await findSimilarCandidates({
        name: member.name,
        currentRole: member.role,
        practiceArea: member.practiceArea,
        pqe: member.pqe,
        location: member.location,
        experience: member.skills.join(", ")
      });

      // Navigate to discovery with these keywords
      navigate("/discovery", { 
        state: { 
          searchQuery: lookalikeData.searchKeywords.join(" "),
          scanType: "Candidate"
        } 
      });
    } catch (err) {
      console.error("Failed to find lookalike:", err);
    }
  };

  const filteredStaff = staff.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         s.role.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPractice = filterPracticeArea === "All" || s.practiceArea === filterPracticeArea;
    return matchesSearch && matchesPractice;
  });

  const practiceAreas = ["All", ...new Set(staff.map(s => s.practiceArea))];

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      await addDoc(collection(db, "staff"), {
        ...newStaff,
        createdAt: new Date().toISOString()
      });
      setShowAddModal(false);
      setNewStaff({ name: "", role: "Senior Associate", practiceArea: "Litigation", location: "Sydney, NSW", firm: "NirvanaAI", pqe: "5 Years", skills: [] });
      setNotification({ message: "Staff member added successfully!", type: 'success' });
    } catch (err) {
      console.error("Failed to add staff member:", err);
      setNotification({ message: "Failed to add staff member.", type: 'error' });
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
          <h2 className="text-2xl font-bold tracking-tight">Staff (Incumbents)</h2>
          <p className="text-slate-500">Manage internal talent and plan for succession or expansion.</p>
        </div>
        <button 
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 transition-colors"
        >
          <Plus size={18} />
          Add Staff Member
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
              <UserCheck size={20} />
            </div>
            <span className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Staff</span>
          </div>
          <div className="text-3xl font-bold">{staff.length}</div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600">
              <TrendingUp size={20} />
            </div>
            <span className="text-sm font-bold text-slate-500 uppercase tracking-wider">Retention Health</span>
          </div>
          <div className="text-3xl font-bold text-emerald-600">94%</div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-amber-50 rounded-lg text-amber-600">
              <Award size={20} />
            </div>
            <span className="text-sm font-bold text-slate-500 uppercase tracking-wider">High Performers</span>
          </div>
          <div className="text-3xl font-bold text-amber-600">12</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search staff by name or role..." 
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
          />
        </div>
        <select 
          value={filterPracticeArea}
          onChange={(e) => setFilterPracticeArea(e.target.value)}
          className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {practiceAreas.map(pa => <option key={pa} value={pa}>{pa}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-48 bg-white rounded-2xl border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : filteredStaff.length === 0 ? (
        <div className="p-12 bg-white rounded-2xl border border-slate-200 text-center">
          <p className="text-slate-500">No staff members found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredStaff.map((member) => (
            <motion.div
              key={member.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all group"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-lg font-bold text-slate-600">
                    {member.name.split(" ").map(n => n[0]).join("")}
                  </div>
                  <div>
                    <h4 className="font-bold text-lg">{member.name}</h4>
                    <p className="text-sm text-slate-500">{member.role} • {member.pqe}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded text-[10px] font-bold uppercase tracking-wider">
                    {member.practiceArea}
                  </span>
                  {member.performanceRating && (
                    <span className="text-[10px] font-bold text-amber-600 uppercase">
                      Rating: {member.performanceRating}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 mb-6">
                {member.skills.slice(0, 4).map(skill => (
                  <span key={skill} className="px-2 py-1 bg-slate-50 text-slate-600 rounded-md text-[10px] font-medium border border-slate-100">
                    {skill}
                  </span>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-4 border-t border-slate-100">
                <button 
                  onClick={() => handleFindLookalike(member)}
                  className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-xl text-xs font-bold hover:bg-indigo-100 transition-colors"
                >
                  <UserPlus size={14} />
                  Find Lookalike
                </button>
                <button 
                  onClick={() => navigate("/matches", { state: { staffMember: member } })}
                  className="flex items-center justify-center gap-2 px-4 py-2 bg-slate-50 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-100 transition-colors"
                >
                  <Zap size={14} />
                  Internal Mobility
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
      {/* Add Staff Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-lg">Add New Staff Member</h3>
                <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleAddStaff} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Full Name</label>
                  <input 
                    required
                    value={newStaff.name}
                    onChange={e => setNewStaff({...newStaff, name: e.target.value})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g. Jane Doe"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Role/Title</label>
                  <input 
                    required
                    value={newStaff.role}
                    onChange={e => setNewStaff({...newStaff, role: e.target.value})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g. Senior Associate"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Practice Area</label>
                  <select 
                    value={newStaff.practiceArea}
                    onChange={e => setNewStaff({...newStaff, practiceArea: e.target.value})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="Litigation">Litigation</option>
                    <option value="Corporate">Corporate</option>
                    <option value="Employment">Employment</option>
                    <option value="Banking">Banking</option>
                    <option value="IP">IP</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">PQE</label>
                    <input 
                      required
                      value={newStaff.pqe}
                      onChange={e => setNewStaff({...newStaff, pqe: e.target.value})}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="e.g. 5 Years"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Location</label>
                    <input 
                      required
                      value={newStaff.location}
                      onChange={e => setNewStaff({...newStaff, location: e.target.value})}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="e.g. Sydney, NSW"
                    />
                  </div>
                </div>
                <button 
                  disabled={adding}
                  className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 disabled:opacity-50"
                >
                  {adding ? "Adding..." : "Add Staff Member"}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
