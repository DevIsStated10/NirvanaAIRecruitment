/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Jobs from "./pages/Jobs";
import Candidates from "./pages/Candidates";
import Matches from "./pages/Matches";
import Pipeline from "./pages/Pipeline";
import Clients from "./pages/Clients";
import Outreach from "./pages/Outreach";
import Discovery from "./pages/Discovery";
import Staff from "./pages/Staff";
import Settings from "./pages/Settings";
import Analytics from "./pages/Analytics";
import LocalAI from "./pages/LocalAI";
import { useAuth } from "./components/AuthContext";
import { LogIn, Zap } from "lucide-react";

// Placeholder components for other routes
const Placeholder = ({ name }: { name: string }) => (
  <div className="p-8 bg-white rounded-2xl border border-slate-200 shadow-sm">
    <h2 className="text-2xl font-bold mb-4">{name}</h2>
    <p className="text-slate-500">This page is currently under development.</p>
  </div>
);

const Login = () => {
  const { signIn } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-xl p-8 text-center">
        <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 text-white shadow-lg shadow-indigo-200">
          <Zap size={32} fill="currentColor" />
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-2">NirvanaAI</h1>
        <p className="text-slate-500 mb-8">The intelligent legal recruitment platform.</p>
        <button
          onClick={signIn}
          className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition-all shadow-sm"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
          Sign in with Google
        </button>
      </div>
    </div>
  );
};

const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <Router>
      <ScrollToTop />
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/candidates" element={<Candidates />} />
          <Route path="/matches" element={<Matches />} />
          <Route path="/outreach" element={<Outreach />} />
          <Route path="/discovery" element={<Discovery />} />
          <Route path="/staff" element={<Staff />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/meetings" element={<Placeholder name="Meetings" />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/local-ai" element={<LocalAI />} />
          <Route path="/runlog" element={<Placeholder name="Run Log" />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </Router>
  );
}

