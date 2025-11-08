import React, { useState } from "react";

interface TranslateButtonProps {
  text: string;
}

export const TranslateButton: React.FC<TranslateButtonProps> = ({ text }) => {
  const [translated, setTranslated] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTranslate = async () => {
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
    <div className="mt-1">
      <button
        onClick={handleTranslate}
        disabled={loading}
        className="text-sm text-blue-400 hover:underline disabled:opacity-50"
      >
        {loading ? "翻訳中..." : "翻訳"}
      </button>

      {error && <div className="text-red-400 text-xs mt-1">{error}</div>}
      {translated && (
        <div className="mt-1 p-2 text-sm bg-gray-800 rounded border border-gray-700">
          {translated}
        </div>
      )}
    </div>
  );
};