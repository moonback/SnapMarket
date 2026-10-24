import Link from 'next/link';
import { api, Page, qs } from '@/lib/api';
import { Badge, DateTime, Empty, FilterForm, Pagination } from '@/components/ui';

interface Row {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
  emailVerified: boolean;
  createdAt: string;
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const data = await api<Page<Row>>(
    `/admin/users${qs({ q: sp.q, status: sp.status, role: sp.role, page: sp.page })}`,
  );
  return (
    <>
      <h1>Utilisateurs</h1>
      <FilterForm>
        <label>
          Recherche
          <input name="q" defaultValue={sp.q} placeholder="email, pseudo, id" />
        </label>
        <label>
          Statut
          <select name="status" defaultValue={sp.status ?? ''}>
            <option value="">Tous</option>
            {['ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Rôle
          <select name="role" defaultValue={sp.role ?? ''}>
            <option value="">Tous</option>
            {['USER', 'PRO_SELLER', 'MODERATOR', 'ADMIN'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </FilterForm>
      {data.items.length === 0 ? (
        <Empty>Aucun utilisateur.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Pseudo</th>
              <th>Email</th>
              <th>Rôle</th>
              <th>Statut</th>
              <th>Email vérifié</th>
              <th>Inscription</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((u) => (
              <tr key={u.id}>
                <td>
                  <Link href={`/users/${u.id}`}>{u.username}</Link>
                </td>
                <td>{u.email}</td>
                <td>
                  <Badge value={u.role} />
                </td>
                <td>
                  <Badge value={u.status} />
                </td>
                <td>{u.emailVerified ? 'Oui' : 'Non'}</td>
                <td>
                  <DateTime value={u.createdAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination {...data} base="/users" params={{ q: sp.q, status: sp.status, role: sp.role }} />
    </>
  );
}
