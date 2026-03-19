import React, { useEffect, useState } from "react";
import { 
  Building2, 
  Plus, 
  Search as SearchIcon,
  Mail,
  ExternalLink,
  User,
  Zap,
  Loader2,
  X
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { collection, onSnapshot, query, orderBy, addDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { getMarketInsights } from "../services/aiService";
import Markdown from "react-markdown";

interface Client {
  id: string;
  name: string;
  industry: string;
  contact_person: string;
  email: string;
  status: string;
}

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState<{ [key: string]: string }>({});
  const [loadingInsights, setLoadingInsights] = useState<{ [key: string]: boolean }>({});
  const [selectedInsights, setSelectedInsights] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newClient, setNewClient] = useState({
    name: "",
    industry: "Legal",
    contact_person: "",
    email: "",
    status: "Active"
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
    const q = query(collection(db, "clients"), orderBy("name", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const clientsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Client[];
      setClients(clientsData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "clients");
    });

    return unsubscribe;
  }, []);

  const fetchInsights = async (clientName: string) => {
    if (insights[clientName]) {
      setSelectedInsights(insights[clientName]);
      return;
    }

    setLoadingInsights(prev => ({ ...prev, [clientName]: true }));
    try {
      const result = await getMarketInsights(clientName);
      setInsights(prev => ({ ...prev, [clientName]: result }));
      setSelectedInsights(result);
    } catch (err) {
      console.error("Failed to fetch insights:", err);
    } finally {
      setLoadingInsights(prev => ({ ...prev, [clientName]: false }));
    }
  };

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      await addDoc(collection(db, "clients"), {
        ...newClient,
        createdAt: new Date().toISOString()
      });
      setShowAddModal(false);
      setNewClient({ name: "", industry: "Legal", contact_person: "", email: "", status: "Active" });
      setNotification({ message: "Client added successfully!", type: 'success' });
    } catch (err) {
      console.error("Failed to add client:", err);
      setNotification({ message: "Failed to add client.", type: 'error' });
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
          <h2 className="text-2xl font-bold tracking-tight">Clients</h2>
          <p className="text-slate-500">Manage law firms and corporate legal departments.</p>
        </div>
        <button 
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 transition-colors"
        >
          <Plus size={18} />
          Add Client
        </button>
      </div>

      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input 
          type="text" 
          placeholder="Search clients by name or industry..." 
          className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2].map((i) => (
            <div key={i} className="h-48 bg-white rounded-2xl border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <div className="p-12 bg-white rounded-2xl border border-slate-200 text-center space-y-4">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-400">
            <Building2 size={32} />
          </div>
          <div>
            <h3 className="font-bold text-lg">No clients yet</h3>
            <p className="text-slate-500 max-w-xs mx-auto">Add your first client to start managing their hiring needs.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {clients.map((client, index) => (
            <motion.div
              key={client.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.05 }}
              className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow group"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-slate-50 rounded-xl group-hover:bg-indigo-50 transition-colors">
                  <Building2 size={24} className="text-slate-400 group-hover:text-indigo-600 transition-colors" />
                </div>
                <span className="px-2 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-wider rounded">
                  {client.status || 'Active'}
                </span>
              </div>
              <h4 className="font-bold text-lg mb-1">{client.name}</h4>
              <p className="text-sm text-slate-500 mb-6">{client.industry}</p>
              
              <div className="space-y-3 mb-6">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <User size={16} className="text-slate-400" />
                  {client.contact_person}
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Mail size={16} className="text-slate-400" />
                  {client.email}
                </div>
              </div>

              <div className="flex gap-2 pt-4 border-t border-slate-100">
                <button 
                  onClick={() => fetchInsights(client.name)}
                  disabled={loadingInsights[client.name]}
                  className="flex-1 flex items-center justify-center gap-2 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-colors disabled:opacity-50"
                >
                  {loadingInsights[client.name] ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} fill="currentColor" />}
                  Market Insights
                </button>
                <button className="p-2 bg-slate-50 text-slate-400 rounded-lg hover:text-indigo-600 transition-colors">
                  <ExternalLink size={16} />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Insights Modal */}
      <AnimatePresence>
        {selectedInsights && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-indigo-600 text-white">
                <div className="flex items-center gap-3">
                  <Zap size={20} fill="currentColor" />
                  <h3 className="font-bold">AI Market Insights</h3>
                </div>
                <button 
                  onClick={() => setSelectedInsights(null)}
                  className="p-1 hover:bg-white/20 rounded-lg transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-8 overflow-y-auto prose prose-slate max-w-none">
                <div className="markdown-body">
                  <Markdown>{selectedInsights}</Markdown>
                </div>
              </div>
              <div className="p-4 bg-slate-50 border-t border-slate-100 text-center">
                <p className="text-xs text-slate-400">Insights powered by Google Search Grounding</p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Client Modal */}
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
                <h3 className="font-bold text-lg">Add New Client</h3>
                <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleAddClient} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Firm/Company Name</label>
                  <input 
                    required
                    value={newClient.name}
                    onChange={e => setNewClient({...newClient, name: e.target.value})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g. Baker McKenzie"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Industry</label>
                  <select 
                    value={newClient.industry}
                    onChange={e => setNewClient({...newClient, industry: e.target.value})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="Legal">Legal</option>
                    <option value="Tech">Tech</option>
                    <option value="Finance">Finance</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Contact Person</label>
                  <input 
                    required
                    value={newClient.contact_person}
                    onChange={e => setNewClient({...newClient, contact_person: e.target.value})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g. John Smith"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Email Address</label>
                  <input 
                    required
                    type="email"
                    value={newClient.email}
                    onChange={e => setNewClient({...newClient, email: e.target.value})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="john@firm.com"
                  />
                </div>
                <button 
                  disabled={adding}
                  className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 disabled:opacity-50"
                >
                  {adding ? "Adding..." : "Add Client"}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
