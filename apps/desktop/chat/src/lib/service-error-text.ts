/** Display service failures without exposing internal model/provider identifiers. */
export function serviceErrorText(message: string): string {
  if (/\b(?:gpt[-\w.]*|o[134](?:[-\w.]+)?|codex|claude[-\w.]*|gemini[-\w.]*|openai|anthropic|deepseek[-\w.]*|qwen[-\w.]*)\b/i.test(message)) {
    return '剪辑服务暂时不可用，请稍后重试。';
  }
  return message;
}
