import ReactMarkdown, { Components } from 'react-markdown';
import { memo, useMemo } from 'react';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  // kept for backward-compat; no longer used for linkification
  repoUrlBase?: string;
}

function MarkdownRenderer({ content, className = '', repoUrlBase }: MarkdownRendererProps) {
  // Note: we intentionally do NOT linkify "#123" to a repo.
  // Different projects may point to different repositories and a global base is not appropriate.
  const components: Components = useMemo(
    () => ({
      a: ({ href, children, ...props }) => (
        <a
          {...props}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-[hsl(var(--info))] hover:opacity-90 break-words"
        >
          {children}
        </a>
      ),
      code: ({ children, ...props }) => (
        <code
          {...props}
          className="bg-background px-1 py-0.5 text-sm font-mono"
        >
          {children}
        </code>
      ),
      strong: ({ children, ...props }) => (
        <span {...props} className="">
          {children}
        </span>
      ),
      em: ({ children, ...props }) => (
        <em {...props} className="italic">
          {children}
        </em>
      ),
      p: ({ children, ...props }) => (
        <p {...props} className="leading-tight">
          {children}
        </p>
      ),
      h1: ({ children, ...props }) => (
        <h1 {...props} className="text-lg leading-tight font-medium">
          {children}
        </h1>
      ),
      h2: ({ children, ...props }) => (
        <h2 {...props} className="text-baseleading-tight font-medium">
          {children}
        </h2>
      ),
      h3: ({ children, ...props }) => (
        <h3 {...props} className="text-sm leading-tight">
          {children}
        </h3>
      ),
      ul: ({ children, ...props }) => (
        <ul
          {...props}
          className="list-disc list-inside flex flex-col gap-1 pl-4"
        >
          {children}
        </ul>
      ),
      ol: ({ children, ...props }) => (
        <ol
          {...props}
          className="list-decimal list-inside flex flex-col gap-1 pl-4"
        >
          {children}
        </ol>
      ),
      li: ({ children, ...props }) => (
        <li {...props} className="leading-tight">
          {children}
        </li>
      ),
    }),
    []
  );
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default memo(MarkdownRenderer);
