import React, { useState, useEffect, useRef } from "react";
import { Send, Bot, User, Loader2, Settings, RefreshCw, AlertCircle, Cpu } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { streamChat, checkOllama, getModels, Message } from "../services/ollamaService";
import ReactMarkdown from "react-markdown";

export default function LocalAI() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: 'You are a helpful recruitment assistant running locally via Ollama. You specialize in analyzing resumes and drafting job descriptions.' }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isOllamaRunning, setIsOllamaRunning] = useState<boolean | null>(null);
  const [models, setModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState("qwen");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const init = async () => {
      const running = await checkOllama();
      setIsOllamaRunning(running);
      if (running) {
        const availableModels = await getModels();
        setModels(availableModels);
        if (availableModels.length > 0 && !availableModels.some((m: any) => m.name === selectedModel)) {
          setSelectedModel(availableModels[0].name);
        }
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    const assistantMsg: Message = { role: 'assistant', content: "" };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      let fullContent = "";
      for await (const chunk of streamChat([...messages, userMsg], { model: selectedModel })) {
        fullContent += chunk;
        setMessages(prev => {
          const newMsgs = [...prev];
          newMsgs[newMsgs.length - 1] = { role: 'assistant', content: fullContent };
          return newMsgs;
        });
      }
    } catch (err) {
      console.error("Chat error:", err);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: "Error: Could not connect to Ollama. Please ensure it is running locally on port 11434." }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  if (isOllamaRunning === false) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6 text-center">
        <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center">
          <AlertCircle size={40} />
        </div>
        <div className="max-w-md space-y-2">
          <h2 className="text-2xl font-bold text-slate-900">Ollama Not Detected</h2>
          <p className="text-slate-500">
            To use local AI models like Qwen, please ensure Ollama is installed and running on your machine at <code className="bg-slate-100 px-1 rounded">http://127.0.0.1:11434</code>.
          </p>
        </div>
        <button 
          onClick={() => window.location.reload()}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all"
        >
          <RefreshCw size={18} />
          Retry Connection
        </button>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-12rem)] flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Cpu className="text-indigo-600" />
            Local AI Studio
          </h2>
          <p className="text-slate-500">Powered by Ollama & Qwen</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600">
            <Settings size={14} />
            <select 
              value={selectedModel} 
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-transparent border-none focus:ring-0 cursor-pointer"
            >
              {models.map((m: any) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
              {models.length === 0 && <option value="qwen">qwen (default)</option>}
            </select>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold uppercase tracking-wider">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            Connected
          </div>
        </div>
      </div>

      <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.filter(m => m.role !== 'system').map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`flex gap-4 max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                  msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}>
                  {msg.role === 'user' ? <User size={20} /> : <Bot size={20} />}
                </div>
                <div className={`p-4 rounded-3xl ${
                  msg.role === 'user' 
                    ? 'bg-indigo-600 text-white rounded-tr-none' 
                    : 'bg-slate-50 text-slate-800 rounded-tl-none border border-slate-100'
                }`}>
                  <div className="prose prose-sm max-w-none prose-p:leading-relaxed">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
          {isLoading && messages[messages.length - 1].content === "" && (
            <div className="flex justify-start">
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center animate-pulse">
                  <Bot size={20} className="text-slate-400" />
                </div>
                <div className="bg-slate-50 p-4 rounded-3xl rounded-tl-none border border-slate-100 flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin text-slate-400" />
                  <span className="text-sm text-slate-400 italic">Qwen is thinking...</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100">
          <div className="relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask local AI to analyze a candidate or draft an email..."
              className="w-full pl-6 pr-16 py-4 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none shadow-sm"
              rows={1}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={20} />
            </button>
          </div>
          <p className="mt-2 text-[10px] text-center text-slate-400 uppercase tracking-widest font-bold">
            All data stays on your machine • Private & Secure
          </p>
        </div>
      </div>
    </div>
  );
}
