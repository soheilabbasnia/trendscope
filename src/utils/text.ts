/**
 * Utility functions for text cleaning and decoding HTML entities.
 */

export function decodeHtmlEntities(text?: string | null): string {
  if (!text) return '';

  return text
    // Strip CDATA wrapper if present
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    // Numeric decimal entities like &#8217; &#39; &#160;
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return !isNaN(code) && code > 0 ? String.fromCodePoint(code) : '';
    })
    // Numeric hexadecimal entities like &#x2019; &#x27;
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return !isNaN(code) && code > 0 ? String.fromCodePoint(code) : '';
    })
    // Named entities
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&sbquo;/g, '‚')
    .replace(/&bdquo;/g, '„')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&hellip;/g, '…')
    .replace(/&bull;/g, '•')
    .replace(/&middot;/g, '·')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}
