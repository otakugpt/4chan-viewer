import React, { useEffect, useState } from "react";

interface Board {
  board: string;
  title: string;
}

export const BoardList: React.FC<{ onSelect: (board: string) => void }> = ({
  onSelect,
}) => {
  const [boards, setBoards] = useState<Board[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // --- Electron / 開発モード両対応 ---
  const isElectron = window.location.protocol === "file:";
  const apiBase = isElectron ? "https://a.4cdn.org" : "/api";

  useEffect(() => {
    setLoading(true);
    setError(null);

    fetch(`${apiBase}/boards.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!data.boards || !Array.isArray(data.boards)) {
          throw new Error("Invalid response structure");
        }
        setBoards(data.boards);
      })
      .catch((err) => {
        console.error("Failed to load boards:", err);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, []);

  // --- ローディング表示 ---
  if (loading)
    return (
      <div className="p-4 text-green-400 bg-[#0b0c0d] font-mono">
        ⏳ Loading boards...
      </div>
    );

  // --- エラー表示 ---
  if (error)
    return (
      <div className="p-4 text-red-400 bg-[#0b0c0d] border-b border-gray-800 font-mono">
        ⚠ Error loading boards: {error}
      </div>
    );

  // --- コンテンツ ---
  return (
    <div className="overflow-y-auto h-full border-r border-gray-800 bg-[#0b0c0d] text-green-300 font-mono">
      <div className="section-header px-4 py-2 border-b border-gray-800 text-cyan-300 uppercase tracking-wider">
        Boards
      </div>

      {boards.map((b) => (
        <div
          key={b.board}
          onClick={() => onSelect(b.board)}
          className="p-2.5 border-b border-gray-900 hover:bg-[#111213] hover:shadow-[0_0_8px_rgba(0,255,180,0.1)] cursor-pointer transition-all"
        >
          <span className="text-cyan-300 font-semibold glow">
            /{b.board}/
          </span>{" "}
          <span className="text-green-300">{b.title}</span>
        </div>
      ))}

      {!boards.length && (
        <div className="p-4 text-gray-500 text-sm text-center">
          No boards available.
        </div>
      )}
    </div>
  );
};
