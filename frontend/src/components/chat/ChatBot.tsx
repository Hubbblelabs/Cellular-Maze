"use client";

import { ArrowLeft, Bot, Send, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { TelecomMode } from "@/src/types/route";

type Step = {
  id: string;
  question: string;
  options: string[];
  inputPlaceholder?: string;
};

function buildSteps(detectedProvider: string): Step[] {
  const ispOptions =
    detectedProvider && detectedProvider !== "unknown"
      ? [`Continue with ${detectedProvider}`, "Jio", "Airtel", "Vi", "Other"]
      : ["Jio", "Airtel", "Vi", "Any network"];

  return [
    {
      id: "source",
      question: "Where are you starting from?",
      options: [],
      inputPlaceholder: "e.g. Electronic City, Koramangala...",
    },
    {
      id: "destination",
      question: "Where do you want to go?",
      options: [],
      inputPlaceholder: "e.g. Whitefield, MG Road...",
    },
    {
      id: "use_case",
      question: "What will you mainly use your internet for on the way?",
      options: [
        "On a call / Video call",
        "Streaming music or video",
        "Uploading or downloading files",
        "Browsing / Social media",
        "Everything / All of the above",
      ],
    },
    {
      id: "isp",
      question: `Which network do you use?${detectedProvider && detectedProvider !== "unknown" ? ` (Detected: ${detectedProvider})` : ""}`,
      options: ispOptions,
    },
    {
      id: "confirm",
      question: "",
      options: [],
    },
  ];
}

type Message = {
  role: "bot" | "user";
  text: string;
};

type ChatAnswers = {
  source: string;
  destination: string;
  use_case: string;
  isp: string;
};

const USE_CASE_MAP: Record<string, { preference: number; label: string }> = {
  "On a call / Video call":         { preference: 90, label: "call reliability" },
  "Streaming music or video":        { preference: 82, label: "streaming stability" },
  "Uploading or downloading files":  { preference: 75, label: "data throughput" },
  "Browsing / Social media":         { preference: 50, label: "balanced browsing" },
  "Everything / All of the above":   { preference: 85, label: "all-round connectivity" },
};

function answersToParams(answers: ChatAnswers): {
  source: string;
  destination: string;
  preference: number;
  telecom: TelecomMode;
  summary: string;
} {
  const mapped = USE_CASE_MAP[answers.use_case] ?? { preference: 60, label: "optimised connectivity" };
  const preference = mapped.preference;

  let telecom: TelecomMode = "all";
  const ispLower = answers.isp.toLowerCase();
  if (ispLower.includes("jio")) telecom = "jio";
  else if (ispLower.includes("airtel")) telecom = "airtel";
  else if (ispLower.includes("vi")) telecom = "vi";

  const summary = `Optimising route from ${answers.source} to ${answers.destination} for ${mapped.label}${telecom !== "all" ? ` on ${telecom.charAt(0).toUpperCase() + telecom.slice(1)}` : ""}.`;

  return { source: answers.source, destination: answers.destination, preference, telecom, summary };
}

type Props = {
  onClose: () => void;
  onApply: (source: string, destination: string, preference: number, telecom: TelecomMode) => void;
  detectedNetwork: string;
};

export function ChatBot({ onClose, onApply, detectedNetwork }: Props) {
  // Steps are fixed for the lifetime of a conversation
  const [steps] = useState(() => buildSteps(detectedNetwork));
  const [messages, setMessages] = useState<Message[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Partial<ChatAnswers>>({});
  const [inputValue, setInputValue] = useState("");
  // Starts "typing" while the greeting is on its way
  const [isTyping, setIsTyping] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  useEffect(() => {
    const t = setTimeout(() => {
      setMessages([
        {
          role: "bot",
          text: "Hi! I'll help you find the best route. Let me ask a few questions. 🚗",
        },
        { role: "bot", text: steps[0].question },
      ]);
      setIsTyping(false);
    }, 600);
    return () => clearTimeout(t);
  }, [steps]);

  const addBotMessage = useCallback((text: string) => {
    setIsTyping(true);
    setTimeout(() => {
      setMessages((prev) => [...prev, { role: "bot", text }]);
      setIsTyping(false);
    }, 400);
  }, []);

  const advanceStep = useCallback(
    (answer: string) => {
      const currentStep = steps[stepIndex];
      const newAnswers = { ...answers, [currentStep.id]: answer };
      setAnswers(newAnswers);

      setMessages((prev) => [...prev, { role: "user", text: answer }]);

      const nextIndex = stepIndex + 1;

      if (nextIndex >= steps.length - 1) {
        const result = answersToParams(newAnswers as ChatAnswers);
        addBotMessage(result.summary);
        setTimeout(() => {
          addBotMessage(`Click "Analyze & Find Route" to see your suggested route. ✨`);
        }, 800);
        setStepIndex(nextIndex);
      } else {
        addBotMessage(steps[nextIndex].question);
        setStepIndex(nextIndex);
      }
    },
    [stepIndex, answers, steps, addBotMessage],
  );

  const handleSend = useCallback(() => {
    const val = inputValue.trim();
    if (!val) return;
    setInputValue("");
    advanceStep(val);
  }, [inputValue, advanceStep]);

  const isComplete = stepIndex >= steps.length - 1;
  const currentStepData = steps[stepIndex];
  const result = isComplete ? answersToParams(answers as ChatAnswers) : null;

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-zinc-900 border-b border-white/10 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 hover:bg-slate-700 rounded-full cursor-pointer transition-colors"
        >
          <ArrowLeft size={16} className="text-white/60" />
        </button>
        <div className="w-8 h-8 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
          <Bot size={15} className="text-cyan-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white">Route Assistant</h3>
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] text-white/40">Online</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-black">
        <AnimatePresence>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.22 }}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "bot" && (
                <div className="w-6 h-6 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center mr-2 mt-1 shrink-0">
                  <Sparkles size={11} className="text-cyan-400" />
                </div>
              )}
              <div
                className={`max-w-[80%] px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-cyan-500 text-white rounded-2xl rounded-br-md shadow-md shadow-cyan-500/20"
                    : "bg-zinc-900 text-white/85 rounded-2xl rounded-bl-md border border-white/10"
                }`}
              >
                {msg.text}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Typing indicator */}
        {isTyping && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2"
          >
            <div className="w-6 h-6 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center shrink-0">
              <Sparkles size={11} className="text-cyan-400" />
            </div>
            <div className="bg-zinc-900 border border-white/10 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Options / Input */}
      <div className="px-4 py-3 bg-zinc-900 border-t border-white/10 shrink-0">
        {isComplete ? (
          <motion.button
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            type="button"
            onClick={() => {
              if (result) onApply(result.source, result.destination, result.preference, result.telecom);
            }}
            className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-sm font-semibold rounded-xl cursor-pointer transition-all shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2"
          >
            <Sparkles size={16} />
            Analyze &amp; Find Route
          </motion.button>
        ) : (
          <>
            {/* Quick-select options */}
            {currentStepData.options.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {currentStepData.options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => advanceStep(opt)}
                    className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-cyan-500/20 text-white/70 hover:text-cyan-300 rounded-lg cursor-pointer transition-all border border-white/10 hover:border-cyan-500/40"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}

            {/* Free text input */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSend();
                }}
                placeholder={currentStepData.inputPlaceholder ?? "Type your answer..."}
                className="flex-1 text-sm text-white placeholder-white/30 outline-none bg-zinc-800 px-4 py-2.5 rounded-xl border border-white/10 focus:border-cyan-500/50 transition-all"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!inputValue.trim()}
                className="p-2.5 bg-cyan-500 hover:bg-cyan-400 text-white rounded-xl cursor-pointer disabled:opacity-30 disabled:cursor-default transition-all"
              >
                <Send size={16} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
