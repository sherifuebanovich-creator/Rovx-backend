/** Escapes text interpolated into a Telegram `parse_mode: 'HTML'` message body. */
export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
