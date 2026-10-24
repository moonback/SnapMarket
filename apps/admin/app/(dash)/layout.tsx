import Link from 'next/link';
import { api } from '@/lib/api';
import { logout } from '../actions';

export const dynamic = 'force-dynamic';

const LINKS: { href: string; label: string; adminOnly?: boolean }[] = [
  { href: '/', label: 'Tableau de bord' },
  { href: '/reports', label: 'Signalements' },
  { href: '/users', label: 'Utilisateurs' },
  { href: '/sellers', label: 'Vendeurs pro' },
  { href: '/products', label: 'Annonces' },
  { href: '/messages', label: 'Messages signalés (spam)' },
  { href: '/orders', label: 'Commandes & paiements' },
  { href: '/disputes', label: 'Litiges' },
  { href: '/categories', label: 'Catégories' },
  { href: '/audit', label: 'Journal d’audit', adminOnly: true },
  { href: '/settings', label: 'Paramètres métier', adminOnly: true },
];

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const me = await api<{ id: string; role: string }>('/admin/me');
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">
          Snap<span>Market</span>
        </div>
        {LINKS.filter((l) => !l.adminOnly || me.role === 'ADMIN').map((l) => (
          <Link key={l.href} href={l.href}>
            {l.label}
          </Link>
        ))}
        <div className="role">
          Rôle : {me.role === 'ADMIN' ? 'Administrateur' : 'Modérateur'}
          <form action={logout}>
            <button className="btn ghost" type="submit" style={{ marginTop: 8 }}>
              Déconnexion
            </button>
          </form>
        </div>
      </aside>
      <main>{children}</main>
    </div>
  );
}
