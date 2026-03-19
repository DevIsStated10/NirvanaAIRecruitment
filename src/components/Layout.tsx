import React from "react";
import { Link, useLocation } from "react-router-dom";
import { 
  Briefcase, 
  Users, 
  UserCheck,
  Zap, 
  Mail, 
  Search, 
  LayoutDashboard, 
  Settings, 
  BarChart3, 
  Building2, 
  Calendar,
  FileText,
  History,
  Cpu
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import VoiceAssistant from "./VoiceAssistant";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Active Jobs", href: "/jobs", icon: Briefcase },
  { name: "Candidates", href: "/candidates", icon: Users },
  { name: "Staff (Incumbents)", href: "/staff", icon: UserCheck },
  { name: "Matches", href: "/matches", icon: Zap },
  { name: "Outreach", href: "/outreach", icon: Mail },
  { name: "Jobs", href: "/discovery", icon: Search },
  { name: "Pipeline", href: "/pipeline", icon: FileText },
  { name: "Meetings", href: "/meetings", icon: Calendar },
  { name: "Clients", href: "/clients", icon: Building2 },
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
  { name: "Local AI", href: "/local-ai", icon: Cpu },
  { name: "Run Log", href: "/runlog", icon: History },
  { name: "Settings", href: "/settings", icon: Settings },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-6 border-b border-slate-200">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
              <Zap size={20} fill="currentColor" />
            </div>
            NirvanaAI
          </h1>
        </div>
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.name}
                to={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-indigo-50 text-indigo-700" 
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                <item.icon size={18} className={isActive ? "text-indigo-600" : "text-slate-400"} />
                {item.name}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-200">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">
              EA
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">Emily Anderson</p>
              <p className="text-xs text-slate-500 truncate">Recruiter</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-8">
          {children}
        </div>
      </main>
      <VoiceAssistant />
    </div>
  );
}
