import React, { useEffect, useState } from "react";
import { 
  FileText, 
  ArrowRight, 
  MoreVertical,
  User,
  Building2,
  Briefcase
} from "lucide-react";
import { motion } from "motion/react";

const stages = ["Applied", "Screening", "Interview", "Offer", "Placed"];

interface PipelineItem {
  id: number;
  candidate_id: string;
  job_id: string;
  stage: string;
  candidate_name: string;
  job_title: string;
  job_company: string;
  updated_at: string;
}

export default function Pipeline() {
  const [pipeline, setPipeline] = useState<PipelineItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/pipeline")
      .then((res) => res.json())
      .then((data) => {
        setPipeline(data);
        setLoading(false);
      });
  }, []);

  const updateStage = async (id: number, newStage: string) => {
    try {
      await fetch(`/api/pipeline/${id}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStage })
      });
      setPipeline(prev => prev.map(item => item.id === id ? { ...item, stage: newStage } : item));
    } catch (err) {
      console.error("Failed to update stage:", err);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Recruitment Pipeline</h2>
        <p className="text-slate-500">Track candidates through the hiring process.</p>
      </div>

      <div className="flex gap-6 overflow-x-auto pb-4 min-h-[600px]">
        {stages.map((stage) => (
          <div key={stage} className="flex-shrink-0 w-80 space-y-4">
            <div className="flex items-center justify-between px-2">
              <h3 className="font-bold text-sm uppercase tracking-wider text-slate-500 flex items-center gap-2">
                {stage}
                <span className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-[10px] text-slate-600">
                  {pipeline.filter(item => item.stage === stage).length}
                </span>
              </h3>
            </div>

            <div className="bg-slate-100/50 p-2 rounded-2xl min-h-[500px] space-y-3">
              {pipeline
                .filter((item) => item.stage === stage)
                .map((item) => (
                  <motion.div
                    layoutId={String(item.id)}
                    key={item.id}
                    className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow group"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700">
                        {item.candidate_name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <button className="text-slate-400 hover:text-slate-600">
                        <MoreVertical size={16} />
                      </button>
                    </div>
                    
                    <p className="font-bold text-sm mb-1">{item.candidate_name}</p>
                    <div className="flex items-center gap-1 text-xs text-slate-500 mb-4">
                      <Briefcase size={12} />
                      {item.job_title}
                    </div>

                    <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold uppercase mb-4">
                      <Building2 size={12} />
                      {item.job_company}
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                      <span className="text-[10px] text-slate-400">Updated {new Date(item.updated_at).toLocaleDateString()}</span>
                      <div className="flex gap-1">
                        {stage !== "Placed" && (
                          <button 
                            onClick={() => updateStage(item.id, stages[stages.indexOf(stage) + 1])}
                            className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"
                          >
                            <ArrowRight size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
