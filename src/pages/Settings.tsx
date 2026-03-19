import React, { useEffect, useState } from "react";
import { 
  Settings as SettingsIcon, 
  Database, 
  Mail, 
  Cpu, 
  Shield, 
  Save,
  CheckCircle2
} from "lucide-react";
import { motion } from "motion/react";

export default function Settings() {
  const [settings, setSettings] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then(res => res.json())
      .then(data => setSettings(data))
      .catch(err => console.error("Failed to fetch settings:", err));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <div className="p-8 text-center text-slate-500">Loading settings...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-slate-500">Configure your NirvanaAI recruitment environment.</p>
      </div>

      <div className="grid grid-cols-1 gap-8">
        {/* AI Backend */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center gap-3">
            <Cpu className="text-indigo-600" size={20} />
            <h3 className="font-bold">AI Backend Configuration</h3>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Active AI Provider</label>
              <select 
                className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                value={settings.aiBackend}
                onChange={(e) => setSettings({ ...settings, aiBackend: e.target.value })}
              >
                <option value="gemini">Google Gemini (Cloud)</option>
                <option value="ollama">Ollama (Local)</option>
                <option value="hybrid">Hybrid (Local first, Cloud fallback)</option>
              </select>
              <p className="mt-2 text-xs text-slate-500">
                Gemini provides higher quality reasoning. Ollama is faster for simple tasks and runs locally.
              </p>
            </div>
          </div>
        </section>

        {/* Data Backend */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center gap-3">
            <Database className="text-blue-600" size={20} />
            <h3 className="font-bold">Data Storage</h3>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Primary Database</label>
              <select 
                className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                value={settings.dataBackend}
                disabled
              >
                <option value="sqlite">Local SQLite (Default)</option>
                <option value="airtable">Airtable Sync</option>
              </select>
            </div>
          </div>
        </section>

        {/* Email Backend */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center gap-3">
            <Mail className="text-emerald-600" size={20} />
            <h3 className="font-bold">Email & Outreach</h3>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email Delivery Mode</label>
              <select 
                className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                value={settings.emailBackend}
                onChange={(e) => setSettings({ ...settings, emailBackend: e.target.value })}
              >
                <option value="local">Local Sandbox (Drafts only)</option>
                <option value="gmail">Gmail API Integration</option>
                <option value="smtp">Custom SMTP</option>
              </select>
            </div>
          </div>
        </section>

        {/* Security */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center gap-3">
            <Shield className="text-amber-600" size={20} />
            <h3 className="font-bold">Security & Access</h3>
          </div>
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-900">Encryption Key</p>
                <p className="text-xs text-slate-500">Used for encrypting third-party API credentials.</p>
              </div>
              <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-mono">••••••••••••</span>
            </div>
          </div>
        </section>
      </div>

      <div className="flex items-center justify-end gap-4">
        {saved && (
          <motion.div 
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2 text-emerald-600 font-bold text-sm"
          >
            <CheckCircle2 size={16} />
            Settings saved
          </motion.div>
        )}
        <button 
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 disabled:opacity-50"
        >
          <Save size={18} />
          {saving ? "Saving..." : "Save Configuration"}
        </button>
      </div>
    </div>
  );
}
