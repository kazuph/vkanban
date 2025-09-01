import { ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Crumb = { label: ReactNode; to?: string };

type BreadcrumbProps = {
  items: Crumb[];
  className?: string;
};

export function Breadcrumb({ items, className = '' }: BreadcrumbProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={`text-xs sm:text-sm text-muted-foreground ${className}`}
    >
      <ol className="flex items-center gap-1 sm:gap-2 flex-wrap">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          const content = item.to ? (
            <Link to={item.to} className="hover:underline">
              {item.label}
            </Link>
          ) : (
            <span className={isLast ? 'text-foreground' : ''}>{item.label}</span>
          );

          return (
            <li key={idx} className="flex items-center gap-1 sm:gap-2">
              {content}
              {!isLast && <span className="opacity-50">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

