/**
 * Escapes text interpolated into a Telegram `parse_mode: 'HTML'` message
 * body — including inside an attribute like `href="..."` (`"` is also
 * escaped so untrusted text can't break out of the attribute early).
 */
export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
