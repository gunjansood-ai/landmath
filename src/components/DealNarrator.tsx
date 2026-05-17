"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, Send, Loader2, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import type { AnalysisResult } from "@/store/useStore";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface DealNarratorProps {
  analysis: AnalysisResult;
  onNarrativeReady?: (narrative: string) => void;
}

const SUGGESTED_QUESTIONS = [
  "What's the biggest risk with this deal?",
  "How does this compare to a typical deal in this area?",
  "What happens if construction costs run 20% over?",
  "Is the timeline realistic for this strategy?",
  "What should I verify before making an offer?",
];

export default function DealNarrator({ analysis, onNarrativeReady }: DealNarratorProps) {
  const [narrative, setNarrative] = useState<string>("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-generate narrative on mount
  useEffect(() => {
    generateNarrative();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  async function generateNarrative() {
    setLoading(true);
    setError(null);
    setNarrative("");
    setChat([]);
    try {
      const res = await fetch("/api/ai/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to generate analysis");
        return;
      }
      setNarrative(data.narrative);
      onNarrativeReady?.(data.narrative);
    } catch {
      setError("Network error — check your connection");
    } finally {
      setLoading(false);
    }
  }

  async function askQuestion(q: string) {
    if (!q.trim()) return;
    const trimmed = q.trim();
    setQuestion("");
    setChatLoading(true);

    const newHistory: ChatMessage[] = [...chat, { role: "user", content: trimmed }];
    setChat(newHistory);

    try {
      const res = await fetch("/api/ai/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis,
          question: trimmed,
          history: chat.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChat((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${data.error ?? "Failed to get response"}` },
        ]);
        return;
      }
      setChat((prev) => [...prev, { role: "assistant", content: data.narrative }]);
    } catch {
      setChat((prev) => [
        ...prev,
        { role: "assistant", content: "Network error — please try again." },
      ]);
    } finally {
      setChatLoading(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="rounded-xl border border-green-200 dark:border-green-800/40 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 hover:brightness-95 transition-all"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-green-600" />
          <span className="text-sm font-semibold text-green-900 dark:text-green-300">
            AI Deal Analyst
          </span>
          <span className="text-xs text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/40 px-2 py-0.5 rounded-full font-medium">
            Powered by Claude
          </span>
        </div>
        {expanded ? <ChevronUp size={15} className="text-green-600" /> : <ChevronDown size={15} className="text-green-600" />}
      </button>

      {expanded && (
        <div className="p-4 space-y-4">
          {/* Narrative */}
          <div className="relative">
            {loading ? (
              <div className="flex items-center gap-3 py-6 justify-center">
                <Loader2 size={18} className="animate-spin text-green-600" />
                <span className="text-sm text-gray-500">Analyzing deal…</span>
              </div>
            ) : error ? (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                {error.includes("ANTHROPIC_API_KEY") && (
                  <p className="text-xs text-red-500 mt-1">
                    Add <code className="bg-red-100 px-1 rounded">ANTHROPIC_API_KEY=sk-ant-...</code> to your{" "}
                    <code className="bg-red-100 px-1 rounded">.env.local</code> and restart.
                  </p>
                )}
                <button
                  onClick={generateNarrative}
                  className="mt-2 text-xs text-red-600 underline flex items-center gap-1"
                >
                  <RefreshCw size={11} /> Retry
                </button>
              </div>
            ) : narrative ? (
              <div className="relative group">
                <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">
                  {narrative}
                </div>
                <button
                  onClick={generateNarrative}
                  className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity text-xs text-gray-400 hover:text-green-600 flex items-center gap-1"
                  title="Regenerate analysis"
                >
                  <RefreshCw size={11} />
                </button>
              </div>
            ) : null}
          </div>

          {/* Chat thread */}
          {chat.length > 0 && (
            <div className="space-y-3 border-t border-gray-100 dark:border-slate-700 pt-3">
              {chat.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-green-600 text-white rounded-br-sm"
                        : "bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 rounded-bl-sm"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 dark:bg-slate-800 rounded-xl rounded-bl-sm px-3 py-2">
                    <Loader2 size={14} className="animate-spin text-green-600" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}

          {/* Suggested questions (show only before any chat) */}
          {chat.length === 0 && narrative && !loading && (
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => askQuestion(q)}
                  disabled={chatLoading}
                  className="text-xs px-3 py-1.5 rounded-full border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Chat input */}
          {narrative && !loading && (
            <div className="flex gap-2 border-t border-gray-100 dark:border-slate-700 pt-3">
              <input
                ref={inputRef}
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    askQuestion(question);
                  }
                }}
                placeholder="Ask anything about this deal…"
                disabled={chatLoading}
                className="flex-1 text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
              />
              <button
                onClick={() => askQuestion(question)}
                disabled={!question.trim() || chatLoading}
                className="px-3 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {chatLoading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
