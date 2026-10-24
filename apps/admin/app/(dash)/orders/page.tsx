import Link from 'next/link';
import { ORDER_STATUS_LABELS } from '@snapmarket/shared';
import { api, Page, qs } from '@/lib/api';
import { Badge, DateTime, Empty, FilterForm, Money, Pagination } from '@/components/ui';

interface Row {
  id: string;
  reference: string;
  status: string;
  deliveryMode: string;
  totalCents: number;
  commissionCents: number;
  transferStatus: string;
  payment: { status: string; refundedCents: number } | null;
  buyer: { id: string; username: string };
  seller: { id: string; username: string };
  product: { id: string; title: string };
  createdAt: string;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const data = await api<Page<Row>>(
    `/admin/orders${qs({ q: sp.q, status: sp.status, page: sp.page })}`,
  );
  return (
    <>
      <h1>Commandes et paiements</h1>
      <FilterForm>
        <label>
          Référence
          <input name="q" defaultValue={sp.q} placeholder="SM-…" />
        </label>
        <label>
          Statut
          <select name="status" defaultValue={sp.status ?? ''}>
            <option value="">Tous</option>
            {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </FilterForm>
      {data.items.length === 0 ? (
        <Empty>Aucune commande.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Référence</th>
              <th>Article</th>
              <th>Acheteur → Vendeur</th>
              <th>Total</th>
              <th>Commission calculée</th>
              <th>Commande</th>
              <th>Paiement</th>
              <th>Transfert</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link href={`/orders/${o.id}`}>{o.reference}</Link>
                  <br />
                  <DateTime value={o.createdAt} />
                </td>
                <td>
                  {o.product.title}
                  <br />
                  <span className="muted">
                    {o.deliveryMode === 'SHIPPING' ? 'Livraison' : 'Main propre'}
                  </span>
                </td>
                <td>
                  {o.buyer.username} → {o.seller.username}
                </td>
                <td>
                  <Money cents={o.totalCents} />
                </td>
                <td>
                  <Money cents={o.commissionCents} />
                </td>
                <td>
                  <Badge value={o.status} />
                </td>
                <td>
                  {o.payment ? (
                    <Badge value={o.payment.status} />
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <Badge value={o.transferStatus} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination {...data} base="/orders" params={{ q: sp.q, status: sp.status }} />
    </>
  );
}
