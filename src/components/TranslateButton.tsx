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
    setTranslated(null);

    try {
      if (!window.electron?.translate) throw new Error("翻訳は Electron アプリで利用できます。");
      const data = await window.electron.translate(text);
      if ("error" in data) throw new Error(data.error);
      setTranslated(data.translatedText);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "翻訳に失敗しました";
      setError(message);
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