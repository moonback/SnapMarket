import Link from 'next/link';
import { api, Page, qs } from '@/lib/api';
import { ActionForm } from '@/components/ActionForm';
import { Badge, DateTime, Empty, FilterForm, Money, Pagination } from '@/components/ui';
import { resolveDispute } from '../../actions';

interface Row {
  id: string;
  reason: string;
  details: string | null;
  status: string;
  providerDisputeId: string | null;
  resolutionNote: string | null;
  createdAt: string;
  order: {
    id: string;
    reference: string;
    status: string;
    totalCents: number;
    deliveryMode: string;
  };
}

export default async function DisputesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const status = sp.status ?? 'OPEN';
  const [data, me] = await Promise.all([
    api<Page<Row>>(`/admin/disputes${qs({ status, page: sp.page })}`),
    api<{ role: string }>('/admin/me'),
  ]);
  return (
    <>
      <h1>Litiges</h1>
      <FilterForm>
        <label>
          Statut
          <select name="status" defaultValue={status}>
            {['OPEN', 'RESOLVED_REFUND', 'RESOLVED_RELEASE'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </FilterForm>
      {data.items.length === 0 ? (
        <Empty>Aucun litige.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Commande</th>
              <th>Motif</th>
              <th>Montant</th>
              <th>Statut</th>
              <th>Décision</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link href={`/orders/${d.order.id}`}>{d.order.reference}</Link>
                  <br />
                  <DateTime value={d.createdAt} />
                </td>
                <td>
                  <b>{d.reason}</b>
                  {d.providerDisputeId && (
                    <>
                      <br />
                      <span className="muted">Contestation bancaire {d.providerDisputeId}</span>
                    </>
                  )}
                  <pre>{d.details}</pre>
                </td>
                <td>
                  <Money cents={d.order.totalCents} />
                </td>
                <td>
                  <Badge value={d.status} />
                </td>
                <td>
                  {d.status !== 'OPEN' ? (
                    <span className="muted">{d.resolutionNote}</span>
                  ) : me.role !== 'ADMIN' ? (
                    <span className="muted">Résolution réservée aux administrateurs</span>
                  ) : (
                    <ActionForm
                      action={resolveDispute}
                      submit="Résoudre"
                      confirm="Confirmer la résolution (opération financière) ?"
                    >
                      <input type="hidden" name="id" value={d.id} />
                      <select name="resolution" defaultValue="REFUND">
                        <option value="REFUND">Rembourser l’acheteur</option>
                        <option value="RELEASE">Libérer les fonds au vendeur</option>
                      </select>
                      <input
                        name="note"
                        placeholder="Justification (obligatoire)"
                        required
                        maxLength={1000}
                      />
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination {...data} base="/disputes" params={{ status }} />
    </>
  );
}
