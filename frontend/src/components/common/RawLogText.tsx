import { memo, useMemo } from 'react';
import { hasAnsi, FancyAnsi } from 'fancy-ansi';
import { clsx } from 'clsx';

interface RawLogTextProps {
  content: string;
  channel?: 'stdout' | 'stderr';
  as?: 'div' | 'span';
  className?: string;
  /**
   * Base GitHub repo URL like "https://github.com/owner/repo".
   * When provided, short refs like "#123" will be linked to PRs
   * ("/pull/123").
   */
  repoUrlBase?: string;
}

// Single shared instance is fine; stateless converter
const ansiConverter = new FancyAnsi();

function linkifyHtml(html: string, repoUrlBase?: string): string {
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
    // Match #123 as a separate token (not part of word), capture number
    const hashRegex = /(^|[^\w])#(\d+)(?=\b)/g;

    const traverse = (node: Node) => {
      // Skip linkifying inside existing anchors
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.tagName === 'A') return; // don't recurse into links
      }

      // Process text nodes
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue ?? '';
        // If repoUrlBase not provided, try to infer from text (first GitHub URL)
        let effectiveRepoBase = repoUrlBase;
        if (!effectiveRepoBase) {
          const m = /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/.exec(text);
          if (m) {
            effectiveRepoBase = `https://github.com/${m[1]}/${m[2]}`;
          }
        }
        let match: RegExpExecArray | null;
        urlRegex.lastIndex = 0;
        const frag = doc.createDocumentFragment();
        let lastIndex = 0;

        const appendHashChunk = (container: DocumentFragment, chunk: string) => {
          if (!effectiveRepoBase) {
            container.appendChild(doc.createTextNode(chunk));
            return;
          }
      let innerLast = 0;
      let innerMatch: RegExpExecArray | null;
      hashRegex.lastIndex = 0;
      while ((innerMatch = hashRegex.exec(chunk)) !== null) {
        const start = innerMatch.index;
        const end = start + innerMatch[0].length;
        const prefix = innerMatch[1] || '';
        const num = innerMatch[2];

        if (start > innerLast) {
          container.appendChild(doc.createTextNode(chunk.slice(innerLast, start)));
        }

        if (prefix) container.appendChild(doc.createTextNode(prefix));

        const a = doc.createElement('a');
        a.setAttribute('href', `${effectiveRepoBase}/pull/${num}`);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        a.setAttribute('class', 'underline text-[hsl(var(--info))] hover:opacity-90 break-words');
        a.textContent = `#${num}`;
        container.appendChild(a);

        innerLast = end;
      }
      if (innerLast < chunk.length) {
        container.appendChild(doc.createTextNode(chunk.slice(innerLast)));
      }
    };

    while ((match = urlRegex.exec(text)) !== null) {
      const full = match[0];
      const start = match.index;
      const end = start + full.length;

      // Flush preceding text
      if (start > lastIndex) {
        const chunk = text.slice(lastIndex, start);
        appendHashChunk(frag, chunk);
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
              'underline text-[hsl(var(--info))] hover:opacity-90 break-words'
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

        // After URLs, also linkify #123 when repoUrlBase is known
        const rest = text.slice(lastIndex);
        if (rest) {
          const innerFrag = doc.createDocumentFragment();
          appendHashChunk(innerFrag, rest);
          frag.appendChild(innerFrag);
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
    repoUrlBase,
  }: RawLogTextProps) => {
    const hasAnsiCodes = hasAnsi(content);
    const shouldApplyStderrFallback = channel === 'stderr' && !hasAnsiCodes;

    const html = useMemo(() => ansiConverter.toHtml(content), [content]);
    const htmlWithLinks = useMemo(() => linkifyHtml(html, repoUrlBase), [html, repoUrlBase]);

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
