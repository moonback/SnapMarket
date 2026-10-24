import type { OrderDto } from '@snapmarket/shared';
import { ORDER_STATUS_LABELS } from '@snapmarket/shared';
import { api } from '@/lib/api';
import { ActionForm } from '@/components/ActionForm';
import { Badge, DateTime, Money } from '@/components/ui';
import { refundOrder } from '../../../actions';

interface Detail {
  order: OrderDto;
  ledger: {
    id: string;
    type: string;
    amountCents: number;
    providerRef: string | null;
    note: string | null;
    createdAt: string;
  }[];
  paymentEvents: {
    id: string;
    providerEventId: string;
    type: string;
    processedAt: string | null;
    error: string | null;
    createdAt: string;
  }[];
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ order: o, ledger, paymentEvents }, me] = await Promise.all([
    api<Detail>(`/admin/orders/${id}`),
    api<{ role: string }>('/admin/me'),
  ]);
  return (
    <>
      <h1>Commande {o.reference}</h1>
      <div className="grid2">
        <div className="card">
          <dl className="kv">
            <dt>Statut</dt>
            <dd>
              <Badge value={o.status} /> {ORDER_STATUS_LABELS[o.status]}
            </dd>
            <dt>Article</dt>
            <dd>
              {o.product.title} × {o.quantity}
            </dd>
            <dt>Mode</dt>
            <dd>{o.deliveryMode === 'SHIPPING' ? 'Livraison' : 'Remise en main propre'}</dd>
            <dt>Acheteur</dt>
            <dd>{o.buyer.username}</dd>
            <dt>Vendeur</dt>
            <dd>{o.seller.username}</dd>
            <dt>Articles</dt>
            <dd>
              <Money cents={o.pricing.itemPriceCents} />
            </dd>
            <dt>Livraison</dt>
            <dd>
              <Money cents={o.pricing.shippingFeeCents} />
            </dd>
            <dt>Total payé</dt>
            <dd>
              <Money cents={o.pricing.totalCents} />
            </dd>
            <dt>Commission ({o.pricing.commissionBps / 100} %)</dt>
            <dd>
              <Money cents={o.pricing.commissionCents} /> (retenue au transfert)
            </dd>
            <dt>Dû au vendeur</dt>
            <dd>
              <Money cents={o.pricing.sellerPayoutCents} />
            </dd>
            <dt>Paiement</dt>
            <dd>{o.paymentStatus ? <Badge value={o.paymentStatus} /> : '—'}</dd>
            <dt>Paiement groupé</dt>
            <dd>
              {o.checkout.reference} — {o.checkout.orderCount} commande(s),{' '}
              <Money cents={o.checkout.totalCents} /> au total
            </dd>
            <dt>Transfert</dt>
            <dd>
              <Badge value={o.transferStatus} />
            </dd>
            {o.shipment && (
              <>
                <dt>Transporteur / suivi</dt>
                <dd>
                  {o.shipment.carrier ?? '—'} /{' '}
                  {o.shipment.trackingNumber ?? 'non fourni par le vendeur'}
                </dd>
              </>
            )}
            {o.dispute && (
              <>
                <dt>Litige</dt>
                <dd>
                  <Badge value={o.dispute.status} /> {o.dispute.reason}
                </dd>
              </>
            )}
          </dl>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Historique</h2>
          <table>
            <tbody>
              {o.history.map((h, i) => (
                <tr key={i}>
                  <td>
                    <DateTime value={h.createdAt} />
                  </td>
                  <td>
                    {h.from ?? '∅'} → <b>{h.to}</b>
                  </td>
                  <td>{h.actor}</td>
                  <td className="muted">{h.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {me.role === 'ADMIN' && ['PAID', 'PREPARING', 'READY_FOR_HANDOFF'].includes(o.status) && (
            <>
              <h2>Remboursement intégral</h2>
              <ActionForm
                action={refundOrder}
                submit="Rembourser"
                variant="danger"
                confirm="Rembourser intégralement l’acheteur ?"
              >
                <input type="hidden" name="id" value={o.id} />
                <label>
                  Motif
                  <input name="reason" required maxLength={500} />
                </label>
              </ActionForm>
            </>
          )}
        </div>
      </div>
      <h2>Journal financier (rapprochement)</h2>
      {ledger.length === 0 ? (
        <p className="muted">Aucune écriture.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Montant</th>
              <th>Référence prestataire</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((l) => (
              <tr key={l.id}>
                <td>
                  <DateTime value={l.createdAt} />
                </td>
                <td>
                  <Badge value={l.type} />
                </td>
                <td>
                  <Money cents={l.amountCents} />
                </td>
                <td>
                  <code>{l.providerRef}</code>
                </td>
                <td>{l.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Événements du prestataire</h2>
      {paymentEvents.length === 0 ? (
        <p className="muted">Aucun événement reçu.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Reçu</th>
              <th>Type</th>
              <th>Identifiant</th>
              <th>Traité</th>
              <th>Erreur</th>
            </tr>
          </thead>
          <tbody>
            {paymentEvents.map((e) => (
              <tr key={e.id}>
                <td>
                  <DateTime value={e.createdAt} />
                </td>
                <td>{e.type}</td>
                <td>
                  <code>{e.providerEventId}</code>
                </td>
                <td>
                  <DateTime value={e.processedAt} />
                </td>
                <td className="msg error">{e.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
