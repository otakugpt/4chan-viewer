import React, { useEffect, useState } from "react";

/* ==========================================
   🧩 翻訳ボタン（ネオ・ターミナル風）
   ========================================== */
const TranslateButton: React.FC<{ text: string }> = ({ text }) => {
  const [translated, setTranslated] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTranslate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("http://localhost:4040/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setTranslated(data.translatedText);
    } catch (err: any) {
      console.error(err);
      setError("翻訳に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2">
      <button
        onClick={handleTranslate}
        disabled={loading}
        className={`btn-terminal text-xs font-mono ${
          loading ? "opacity-50 cursor-wait" : "hover:glow"
        }`}
      >
        {loading ? "⌛ Translating..." : "↳ Translate"}
      </button>

      {error && (
        <div className="text-red-400 text-xs mt-1 font-mono">⚠ {error}</div>
      )}

      {translated && (
        <div className="console-output mt-2 animate-fadeIn text-green-300">
          {translated}
        </div>
      )}
    </div>
  );
};

/* ==========================================
   💬 ThreadList 本体（未来端末風リスト）
   ========================================== */
interface Thread {
  no: number;
  com?: string;
  sub?: string;
  replies: number;
  tim?: number;
  ext?: string;
}

export const ThreadList: React.FC<{
  board: string;
  onSelect: (threadNo: number) => void;
}> = ({ board, onSelect }) => {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const isElectron = window.location.protocol === "file:";
  const apiBase = isElectron ? "https://a.4cdn.org" : "/api";
  const imgBase = isElectron ? "https://i.4cdn.org" : "/img";

  useEffect(() => {
    setLoading(true);
    setError(null);

    fetch(`${apiBase}/${board}/catalog.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((pages) => {
        const allThreads = pages.flatMap((page: any) => page.threads || []);
        setThreads(allThreads);
      })
      .catch((err) => {
        console.error("Failed to load threads:", err);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [board]);

  if (loading)
    return (
      <div className="p-4 text-green-400 bg-[#0b0c0d] font-mono">
        ⏳ Fetching threads...
      </div>
    );

  if (error)
    return (
      <div className="p-4 text-red-400 bg-[#0b0c0d] border-b border-gray-800 font-mono">
        ⚠ Error loading threads: {error}
      </div>
    );

  return (
    <div className="overflow-y-auto h-full bg-[#0b0c0d] text-green-300 font-mono">
      {threads.slice(0, 50).map((t) => {
        const thumb = t.tim ? `${imgBase}/${board}/${t.tim}s.jpg` : null;
        const comment = (t.com || "")
          .replace(/<br\s*\/?>/g, "\n")
          .replace(/<[^>]+>/g, "");

        return (
          <div
            key={t.no}
            onClick={() => onSelect(t.no)}
            className="flex gap-3 items-start p-4 border-b border-gray-800 hover:bg-[#111213] hover:shadow-[0_0_12px_rgba(0,255,200,0.15)] transition-colors group"
          >
            {thumb && (
              <img
                src={thumb}
                alt=""
                className="w-16 h-16 object-cover rounded-md border border-gray-700 group-hover:border-cyan-300"
                onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
              />
            )}
            <div className="flex-1">
              <div className="text-sm text-cyan-300 font-semibold mb-1 truncate glow">
                {t.sub || "(no subject)"}
              </div>
              <div className="text-xs text-green-300 whitespace-pre-wrap leading-relaxed">
                {comment}
              </div>

              {/* 🧩 翻訳ボタン */}
              <TranslateButton text={comment} />

              <div className="text-[11px] text-green-500 mt-2 tracking-wide">
                ↳ Replies:{" "}
                <span className="text-cyan-300">{t.replies ?? 0}</span>
              </div>
            </div>
          </div>
        );
      })}

      {!threads.length && (
        <div className="p-4 text-gray-500 text-sm font-mono text-center">
          No threads found.
        </div>
      )}
    </div>
  );
};
