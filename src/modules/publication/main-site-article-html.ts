function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function inlineHtml(value: string): string {
  let rendered = escapeHtml(value);
  rendered = rendered.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) => {
    const normalizedHref = safeHref(href);
    return normalizedHref ? `<a href="${escapeHtml(normalizedHref)}" rel="noopener noreferrer">${label}</a>` : label;
  });
  rendered = rendered.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  rendered = rendered.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return rendered;
}

function paragraphHtml(lines: string[]): string {
  return `<p>${lines.map(inlineHtml).join('<br>')}</p>`;
}

export function renderMainSiteArticleHtml(markdown: string): string {
  const lines = markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const blocks: string[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index]!.trim();
    if (!line) { index += 1; continue; }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length === 1 ? 2 : heading[1]!.length;
      blocks.push(`<h${level}>${inlineHtml(heading[2]!)}</h${level}>`);
      index += 1;
      continue;
    }

    const unordered = /^[-*]\s+(.+)$/.exec(line);
    if (unordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = /^[-*]\s+(.+)$/.exec(lines[index]!.trim());
        if (!item) break;
        items.push(`<li>${inlineHtml(item[1]!)}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    if (ordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = /^\d+\.\s+(.+)$/.exec(lines[index]!.trim());
        if (!item) break;
        items.push(`<li>${inlineHtml(item[1]!)}</li>`);
        index += 1;
      }
      blocks.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    const quote = /^>\s?(.+)$/.exec(line);
    if (quote) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const item = /^>\s?(.+)$/.exec(lines[index]!.trim());
        if (!item) break;
        quoteLines.push(item[1]!);
        index += 1;
      }
      blocks.push(`<blockquote>${paragraphHtml(quoteLines)}</blockquote>`);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index]!.trim()) {
      paragraph.push(lines[index]!.trim());
      index += 1;
    }
    blocks.push(paragraphHtml(paragraph));
  }

  return blocks.join('\n');
}
