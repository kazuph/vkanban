import { memo, useMemo } from 'react';
import { hasAnsi, FancyAnsi } from 'fancy-ansi';
import { clsx } from 'clsx';

interface RawLogTextProps {
  content: string;
  channel?: 'stdout' | 'stderr';
  as?: 'div' | 'span';
  className?: string;
}

// Single shared instance is fine; stateless converter
const ansiConverter = new FancyAnsi();

function linkifyHtml(html: string): string {
  // Guard for non-browser environments
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return html;
  }

  try {
    const parser = new DOMParser();
    // Wrap to preserve multiple top-level nodes
    const doc = parser.parseFromString(`<div id="__wrap">${html}</div>`, 'text/html');
    const container = doc.getElementById('__wrap');
    if (!container) return html;

    const urlRegex = /https?:\/\/[^\s<'"`]+/gi;

    const traverse = (node: Node) => {
      // Skip linkifying inside existing anchors
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.tagName === 'A') return; // don't recurse into links
      }

      // Process text nodes
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue ?? '';
        let match: RegExpExecArray | null;
        urlRegex.lastIndex = 0;
        const frag = doc.createDocumentFragment();
        let lastIndex = 0;

        while ((match = urlRegex.exec(text)) !== null) {
          const full = match[0];
          const start = match.index;
          const end = start + full.length;

          // Flush preceding text
          if (start > lastIndex) {
            frag.appendChild(doc.createTextNode(text.slice(lastIndex, start)));
          }

          // Trim trailing punctuation from display and href
          const m = /^(.*?)([)\],.;:!?]+)$/.exec(full);
          const urlStr = (m ? m[1] : full) || full;
          const trailing = m ? m[2] : '';

          // Only allow http/https
          const safe = /^https?:\/\//i.test(urlStr) ? urlStr : '';
          if (safe) {
            const a = doc.createElement('a');
            a.setAttribute('href', safe);
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer');
            a.setAttribute(
              'class',
              'underline text-blue-600 dark:text-blue-400 hover:opacity-90 break-words'
            );
            a.textContent = urlStr;
            frag.appendChild(a);
            if (trailing) frag.appendChild(doc.createTextNode(trailing));
          } else {
            // Fallback: just append as text
            frag.appendChild(doc.createTextNode(full));
          }

          lastIndex = end;
        }

        // Remainder
        if (lastIndex < text.length) {
          frag.appendChild(doc.createTextNode(text.slice(lastIndex)));
        }

        if (frag.childNodes.length > 0) {
          node.parentNode?.replaceChild(frag, node);
        }

        return;
      }

      // Recurse
      const children = Array.from(node.childNodes);
      for (const child of children) traverse(child);
    };

    traverse(container);
    return container.innerHTML;
  } catch {
    return html; // On any parsing error, return original html
  }
}

const RawLogText = memo(
  ({
    content,
    channel = 'stdout',
    as: Component = 'div',
    className,
  }: RawLogTextProps) => {
    const hasAnsiCodes = hasAnsi(content);
    const shouldApplyStderrFallback = channel === 'stderr' && !hasAnsiCodes;

    const html = useMemo(() => ansiConverter.toHtml(content), [content]);
    const htmlWithLinks = useMemo(() => linkifyHtml(html), [html]);

    return (
      <Component
        className={clsx(
          'font-mono text-xs break-all whitespace-pre-wrap',
          shouldApplyStderrFallback && 'text-destructive',
          className
        )}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: htmlWithLinks }}
      />
    );
  }
);

RawLogText.displayName = 'RawLogText';

export default RawLogText;
