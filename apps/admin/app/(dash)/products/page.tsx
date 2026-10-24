import Link from 'next/link';
import { api, Page, qs } from '@/lib/api';
import { ActionForm } from '@/components/ActionForm';
import { Badge, DateTime, Empty, FilterForm, Money, Pagination } from '@/components/ui';
import { moderateContent } from '../../actions';

interface Row {
  id: string;
  title: string;
  priceCents: number;
  status: string;
  moderationStatus: string;
  category: string;
  seller: { id: string; username: string };
  createdAt: string;
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const data = await api<Page<Row>>(
    `/admin/products${qs({ q: sp.q, moderationStatus: sp.moderationStatus, page: sp.page })}`,
  );
  return (
    <>
      <h1>Annonces</h1>
      <FilterForm>
        <label>
          Recherche
          <input name="q" defaultValue={sp.q} placeholder="titre ou id" />
        </label>
        <label>
          Modération
          <select name="moderationStatus" defaultValue={sp.moderationStatus ?? ''}>
            <option value="">Toutes</option>
            <option value="HIDDEN">À valider / masquées</option>
            <option value="VISIBLE">Visibles</option>
            <option value="REMOVED">Retirées</option>
          </select>
        </label>
      </FilterForm>
      {data.items.length === 0 ? (
        <Empty>Aucune annonce.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Titre</th>
              <th>Prix</th>
              <th>Catégorie</th>
              <th>Vendeur</th>
              <th>Statut</th>
              <th>Modération</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.title}
                  <br />
                  <DateTime value={p.createdAt} />
                </td>
                <td>
                  <Money cents={p.priceCents} />
                </td>
                <td>{p.category}</td>
                <td>
                  <Link href={`/users/${p.seller.id}`}>{p.seller.username}</Link>
                </td>
                <td>
                  <Badge value={p.status} />
                </td>
                <td>
                  <Badge value={p.moderationStatus} />
                </td>
                <td>
                  <ActionForm action={moderateContent} submit="OK" inline>
                    <input type="hidden" name="type" value="PRODUCT" />
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="path" value="/products" />
                    <select
                      name="action"
                      defaultValue={p.moderationStatus === 'VISIBLE' ? 'HIDE' : 'APPROVE'}
                    >
                      <option value="APPROVE">Approuver</option>
                      <option value="HIDE">Masquer</option>
                      <option value="REMOVE">Retirer</option>
                      <option value="RESTORE">Rétablir</option>
                    </select>
                    <input name="reason" placeholder="Motif" maxLength={500} />
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination
        {...data}
        base="/products"
        params={{ q: sp.q, moderationStatus: sp.moderationStatus }}
      />
    </>
  );
}
