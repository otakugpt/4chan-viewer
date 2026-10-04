export function plainText(html: string): string {
  const text = html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "");
  const decoder = document.createElement("textarea");
  decoder.innerHTML = text;
  return decoder.value;
}
