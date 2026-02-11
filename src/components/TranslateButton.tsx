import React, { useState } from "react";

interface TranslateButtonProps {
  text: string;
  stopPropagation?: boolean;
  className?: string;
}

export const TranslateButton: React.FC<TranslateButtonProps> = ({
  text,
  stopPropagation = false,
  className = "",
}) => {
  const [translated, setTranslated] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTranslate = async (event: React.MouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) event.stopPropagation();
    if (loading || !text.trim()) return;
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
    <div className={`translate-block ${className}`.trim()}>
      <button
        type="button"
        onClick={handleTranslate}
        disabled={loading || !text.trim()}
        className="ui-btn ui-btn--ghost text-[11px]"
      >
        {loading ? "Translating..." : "Translate"}
      </button>

      {error && <div className="translate-error">{error}</div>}
      {translated && (
        <div className="translate-result animate-enter">
          {translated}
        </div>
      )}
    </div>
  );
};
