import React, { useEffect, useMemo, useState } from "react";

/* ==========================================
   🧩 翻訳ボタン（ターミナル＋未来感）
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
        className={`btn-terminal text-xs ${
          loading ? "opacity-60 cursor-wait" : "hover:glow"
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
   💬 ThreadView 本体（未来端末風）
   ========================================== */
interface Post {
  no: number;
  com?: string;
  name?: string;
  tim?: number;
  ext?: string;
}

type ViewMode = "thread" | "gallery";

export const ThreadView: React.FC<{ board: string; threadId: number }> = ({
  board,
  threadId,
}) => {
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadedThreadIds, setLoadedThreadIds] = useState<number[]>([]);
  const [loadingOlder, setLoadingOlder] = useState<boolean>(false);
  const [noMoreOlder, setNoMoreOlder] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<ViewMode>("thread");
  const [progress, setProgress] = useState<string>("");

  const isElectron = window.location.protocol === "file:";
  const apiBase = isElectron ? "https://a.4cdn.org" : "/api";
  const imgBase = isElectron ? "https://i.4cdn.org" : "/img";

  // --- スレッド取得 ---
  useEffect(() => {
    setLoading(true);
    setError(null);
    setNoMoreOlder(false);
    setViewMode("thread");

    fetch(`${apiBase}/${board}/thread/${threadId}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!data.posts) throw new Error("Invalid thread data");
        setPosts(data.posts);
        setLoadedThreadIds([threadId]);
      })
      .catch((err) => {
        console.error("Failed to load thread:", err);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [board, threadId]);

  // --- 画像リスト ---
  const mediaList = useMemo(
    () =>
      posts
        .filter((p) => p.tim && p.ext)
        .map((p) => ({
          postNo: p.no,
          full: `${imgBase}/${board}/${p.tim}${p.ext}`,
          thumb: `${imgBase}/${board}/${p.tim}s.jpg`,
        })),
    [posts, board, imgBase]
  );

  // --- 過去スレ取得 ---
  const loadOlderThread = async () => {
    try {
      setLoadingOlder(true);
      const archive: number[] = await fetch(
        `${apiBase}/${board}/archive.json`
      ).then((r) => r.json());

      const lastLoadedId = loadedThreadIds[loadedThreadIds.length - 1];
      const idx = archive.indexOf(lastLoadedId);
      if (idx === -1 || idx === archive.length - 1) {
        setNoMoreOlder(true);
        return;
      }

      const nextOldId = archive[idx + 1];
      const olderData = await fetch(
        `${apiBase}/${board}/thread/${nextOldId}.json`
      ).then((r) => r.json());

      const olderPosts: Post[] = olderData.posts || [];
      setPosts((prev) => [...prev, ...olderPosts]);
      setLoadedThreadIds((prev) => [...prev, nextOldId]);
    } catch (e) {
      console.error("Failed to load older thread:", e);
    } finally {
      setLoadingOlder(false);
    }
  };

  // --- 一括画像保存 ---
  const downloadAllMedia = () => {
    if (!mediaList.length) return;
    const electronAPI = (window as any).electron;

    const fileList = mediaList.map((m) => {
      const filename = m.full.split("/").pop();
      return { url: `https://i.4cdn.org/${board}/${filename}`, filename };
    });

    if (electronAPI?.saveImages) {
      const removeProgress = electronAPI.onProgress?.(
        (_: unknown, filename: string) => setProgress(`💾 Saving: ${filename}`)
      );
      const removeComplete = electronAPI.onSaveComplete?.(() => {
        setProgress("✅ すべての画像を保存しました！");
        setTimeout(() => setProgress(""), 4000);
      });
      electronAPI.saveImages(fileList);
      return () => {
        removeProgress?.();
        removeComplete?.();
      };
    }
  };

  /* ===============================
     🎨 UI構成
     =============================== */
  if (loading)
    return (
      <div className="p-4 text-gray-400 bg-[#0b0c0d] font-mono">
        ⏳ Loading thread...
      </div>
    );

  if (error)
    return (
      <div className="p-4 text-red-400 bg-[#0b0c0d] font-mono">
        ⚠ Error loading thread: {error}
      </div>
    );

  return (
    <div className="flex flex-col h-full bg-[#0b0c0d] text-green-300 font-mono">
      {/* --- ツールバー --- */}
      <div className="flex items-center gap-2 p-3 border-b border-gray-800 bg-[#111213] shadow-[0_0_15px_rgba(0,255,200,0.15)]">
        <button
          onClick={() => setViewMode("thread")}
          className={`btn-terminal text-xs ${
            viewMode === "thread" ? "glow text-cyan-300" : "text-green-400"
          }`}
        >
          THREAD
        </button>
        <button
          onClick={() => setViewMode("gallery")}
          className={`btn-terminal text-xs ${
            viewMode === "gallery" ? "glow text-cyan-300" : "text-green-400"
          }`}
        >
          GALLERY ({mediaList.length})
        </button>
        <button
          onClick={downloadAllMedia}
          disabled={!mediaList.length}
          className="ml-auto btn-terminal text-xs disabled:opacity-40 text-green-400 hover:text-cyan-300"
        >
          💾 SAVE ALL
        </button>
      </div>

      {/* --- 保存進捗 --- */}
      {progress && (
        <div className="bg-[#111213] text-cyan-300 text-xs px-3 py-1 border-b border-gray-800 animate-fadeIn tracking-wide">
          {progress}
        </div>
      )}

      {/* --- 本文／ギャラリー --- */}
      <div className="flex-1 overflow-y-auto scroll-fade">
        {viewMode === "thread" ? (
          posts.map((p) => {
            const imageUrl = p.tim ? `${imgBase}/${board}/${p.tim}${p.ext}` : null;
            const thumbUrl = p.tim ? `${imgBase}/${board}/${p.tim}s.jpg` : null;
            const plainText = (p.com || "")
              .replace(/<br\s*\/?>/g, "\n")
              .replace(/<[^>]+>/g, "");

            return (
              <div
                key={p.no}
                className="p-4 border-b border-gray-800 thread-hover transition-colors backdrop-blur-sm"
              >
                <div className="flex justify-between items-center mb-2">
                  <div className="text-xs text-cyan-300 font-semibold">
                    {p.name || "Anonymous"}
                  </div>
                  <div className="text-[11px] text-green-500">No.{p.no}</div>
                </div>

                {imageUrl && (
                  <a
                    href={imageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block mb-2"
                  >
                    <img
                      src={thumbUrl ?? imageUrl}
                      alt="thumbnail"
                      className="max-w-[200px] rounded border border-gray-700 hover:border-cyan-300 shadow-[0_0_10px_rgba(0,255,255,0.2)] transition"
                    />
                  </a>
                )}

                <div
                  className="text-xs leading-relaxed text-green-300 whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{
                    __html: (p.com || "")
                      .replace(/<br\s*\/?>/g, "<br/>")
                      .replace(
                        /&gt;&gt;(\d+)/g,
                        `<span 
                        class='text-[#00ff66] font-semibold cursor-pointer transition-all hover:text-[#66ff99] hover:underline decoration-[#66ff99]/70 decoration-2 glow'
                      >&gt;&gt;$1</span>`
                      )
                      .replace(
                        /<a href="([^"]+)">/g,
                        `<a href="$1" target="_blank" rel="noopener noreferrer" class='text-green-400 underline hover:text-cyan-300'>`
                      ),
                  }}
                />


                {p.com && <TranslateButton text={plainText} />}
              </div>
            );
          })
        ) : (
          <div className="p-4 grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {mediaList.map((m) => (
              <a
                key={m.postNo}
                href={m.full}
                target="_blank"
                rel="noopener noreferrer"
                className="block bg-[#111213] rounded-lg overflow-hidden border border-gray-800 hover:border-cyan-300 hover:shadow-[0_0_15px_rgba(0,255,255,0.15)] transition"
              >
                <img
                  src={m.thumb}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = m.full;
                  }}
                  className="w-full h-40 object-cover"
                />
                <div className="px-2 py-1 text-[11px] text-green-500 text-center">
                  No.{m.postNo}
                </div>
              </a>
            ))}
            {!mediaList.length && (
              <div className="text-gray-400 text-sm col-span-full text-center">
                このスレには画像がありません．
              </div>
            )}
          </div>
        )}
      </div>

      {/* --- 過去スレボタン --- */}
      {!noMoreOlder && (
        <div className="p-3 border-t border-gray-800 bg-[#111213] text-center">
          <button
            onClick={loadOlderThread}
            disabled={loadingOlder}
            className="btn-terminal text-xs disabled:opacity-50 text-green-400 hover:text-cyan-300"
          >
            {loadingOlder ? "⏳ Loading older thread..." : "↳ Load older thread"}
          </button>
        </div>
      )}
    </div>
  );
};
