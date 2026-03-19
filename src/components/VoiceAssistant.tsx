import React, { useState, useEffect, useRef } from "react";
import { Mic, MicOff, Volume2, VolumeX, Zap, Loader2, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";

export default function VoiceAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [transcription, setTranscription] = useState<string>("");
  const [aiTranscription, setAiTranscription] = useState<string>("");
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const toggleAssistant = () => {
    if (isOpen) {
      stopSession();
      setIsOpen(false);
    } else {
      setIsOpen(true);
      startSession();
    }
  };

  const startSession = async () => {
    setIsConnecting(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      
      const session = await ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setIsConnecting(false);
            startAudioCapture();
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
              playAudio(message.serverContent.modelTurn.parts[0].inlineData.data);
            }
            if (message.serverContent?.modelTurn?.parts[0]?.text) {
              setAiTranscription(prev => prev + " " + message.serverContent?.modelTurn?.parts[0]?.text);
            }
          },
          onclose: () => {
            setIsConnected(false);
            stopAudioCapture();
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            setIsConnecting(false);
            stopSession();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: "You are NirvanaAI, a helpful legal recruitment assistant. You help recruiters find candidates, analyze market trends, and prepare for interviews. Keep your responses concise and professional.",
        },
      });
      
      sessionRef.current = session;
    } catch (err) {
      console.error("Failed to connect to Live API:", err);
      setIsConnecting(false);
    }
  };

  const stopSession = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    stopAudioCapture();
    setIsConnected(false);
    setTranscription("");
    setAiTranscription("");
  };

  const startAudioCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      const source = audioContextRef.current.createMediaStreamSource(stream);
      const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
      
      processor.onaudioprocess = (e) => {
        if (isMuted) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmData = convertFloat32ToPcm(inputData);
        const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
        
        if (sessionRef.current) {
          sessionRef.current.sendRealtimeInput({
            media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
          });
        }
      };
      
      source.connect(processor);
      processor.connect(audioContextRef.current.destination);
      processorRef.current = processor;
    } catch (err) {
      console.error("Error capturing audio:", err);
    }
  };

  const stopAudioCapture = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  const convertFloat32ToPcm = (buffer: Float32Array) => {
    const pcm = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      pcm[i] = Math.max(-1, Math.min(1, buffer[i])) * 0x7FFF;
    }
    return pcm;
  };

  const playAudio = async (base64Data: string) => {
    if (!audioContextRef.current) return;
    
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const pcmData = new Int16Array(bytes.buffer);
    const floatData = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      floatData[i] = pcmData[i] / 0x7FFF;
    }
    
    const buffer = audioContextRef.current.createBuffer(1, floatData.length, 24000);
    buffer.getChannelData(0).set(floatData);
    
    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    source.start();
  };

  return (
    <>
      <button 
        onClick={toggleAssistant}
        className="fixed bottom-8 right-8 w-16 h-16 bg-indigo-600 text-white rounded-full shadow-2xl flex items-center justify-center hover:scale-110 transition-all z-40 group"
      >
        <Zap size={28} fill={isOpen ? "white" : "none"} className="group-hover:animate-pulse" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="fixed bottom-28 right-8 w-96 bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden z-50 flex flex-col"
          >
            <div className="p-6 bg-indigo-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                  <Zap size={20} fill="currentColor" />
                </div>
                <div>
                  <h3 className="font-bold">NirvanaAI Voice</h3>
                  <p className="text-[10px] text-indigo-100 uppercase tracking-widest font-bold">Live Session</p>
                </div>
              </div>
              <button onClick={toggleAssistant} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 p-8 min-h-[300px] flex flex-col items-center justify-center text-center space-y-8">
              {isConnecting ? (
                <div className="space-y-4">
                  <Loader2 size={48} className="text-indigo-600 animate-spin mx-auto" />
                  <p className="text-slate-500 font-medium">Connecting to AI...</p>
                </div>
              ) : isConnected ? (
                <>
                  <div className="relative">
                    <div className="absolute inset-0 bg-indigo-100 rounded-full animate-ping opacity-20" />
                    <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 relative z-10">
                      {isMuted ? <MicOff size={40} /> : <Mic size={40} />}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-lg font-bold text-slate-900">Listening...</p>
                    <p className="text-sm text-slate-500 max-w-[200px]">Ask me about candidates or market trends.</p>
                  </div>
                  <div className="w-full h-24 bg-slate-50 rounded-2xl p-4 overflow-y-auto text-left text-xs text-slate-600 italic">
                    {aiTranscription || "AI responses will appear here..."}
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <p className="text-slate-500">Session ended.</p>
                  <button 
                    onClick={startSession}
                    className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 transition-colors"
                  >
                    Reconnect
                  </button>
                </div>
              )}
            </div>

            <div className="p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-center gap-4">
              <button 
                onClick={() => setIsMuted(!isMuted)}
                className={`p-4 rounded-2xl transition-all ${isMuted ? 'bg-red-50 text-red-600' : 'bg-white text-slate-600 hover:bg-slate-100 shadow-sm'}`}
              >
                {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
              </button>
              <button 
                onClick={stopSession}
                className="px-8 py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-200"
              >
                End Session
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
