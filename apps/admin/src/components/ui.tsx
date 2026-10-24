import Link from 'next/link';
import { formatCents } from '@snapmarket/shared';

export function Badge({ value }: { value: string }) {
  const tone = /ACTIVE|VISIBLE|VERIFIED|COMPLETED|SUCCEEDED|RESOLVED|PAID/.test(value)
    ? 'success'
    : /PENDING|OPEN|HIDDEN|PROCESSING|IN_REVIEW|PREPARING|SHIPPED|READY/.test(value)
      ? 'warning'
      : /BANNED|SUSPENDED|REMOVED|FAILED|REJECTED|DISPUTED|CANCELLED|REFUNDED|REVERSED/.test(value)
        ? 'danger'
        : 'neutral';
  return <span className={`badge ${tone}`}>{value}</span>;
}

export function Money({ cents }: { cents: number }) {
  return <span className="money">{formatCents(cents)}</span>;
}

export function DateTime({ value }: { value: string | Date | null | undefined }) {
  if (!value) return <span className="muted">—</span>;
  return (
    <time dateTime={new Date(value).toISOString()}>
      {new Date(value).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}
    </time>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  base,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  base: string;
  params: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const link = (p: number) => {
    const q = new URLSearchParams(
      Object.entries({ ...params, page: String(p) }).filter(([, v]) => v) as [string, string][],
    );
    return `${base}?${q.toString()}`;
  };
  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="muted">
        {total} résultat(s) — page {page}/{pages}
      </span>
      {page > 1 && <Link href={link(page - 1)}>← Précédent</Link>}
      {page < pages && <Link href={link(page + 1)}>Suivant →</Link>}
    </nav>
  );
}

export function FilterForm({ children }: { children: React.ReactNode }) {
  return (
    <form className="filters" method="get">
      {children}
      <button className="btn ghost" type="submit">
        Filtrer
      </button>
    </form>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}
