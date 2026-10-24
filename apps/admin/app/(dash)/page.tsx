import Link from 'next/link';
import { ORDER_STATUS_LABELS, OrderStatus } from '@snapmarket/shared';
import { api } from '@/lib/api';
import { Money } from '@/components/ui';

interface Dashboard {
  users: number;
  activeProducts: number;
  ordersByStatus: Partial<Record<OrderStatus, number>>;
  openReports: number;
  openDisputes: number;
  pendingSellers: number;
  completedGmvCents: number;
  retainedCommissionCents: number;
  failedTransfers: number;
  webhookErrors: number;
}

export default async function DashboardPage() {
  const [d, status] = await Promise.all([
    api<Dashboard>('/admin/dashboard'),
    api<{ paymentsAvailable: boolean; mediaStorageConfigured: boolean; emailConfigured: boolean }>(
      '/status',
    ),
  ]);
  return (
    <>
      <h1>Tableau de bord</h1>
      {!status.paymentsAvailable && (
        <p className="notice">
          Paiement en ligne indisponible : Stripe n’est pas configuré sur l’API (aucune commande ne
          peut être payée).
        </p>
      )}
      {!status.emailConfigured && (
        <p className="notice">SMTP non configuré : aucun email n’est envoyé.</p>
      )}
      <div className="cards">
        <Stat label="Utilisateurs" value={d.users} />
        <Stat label="Annonces actives" value={d.activeProducts} />
        <Stat label="Signalements ouverts" value={d.openReports} href="/reports" />
        <Stat label="Litiges ouverts" value={d.openDisputes} href="/disputes" />
        <Stat
          label="Vendeurs pro à vérifier"
          value={d.pendingSellers}
          href="/sellers?verificationStatus=PENDING"
        />
        <Stat label="Transferts en échec" value={d.failedTransfers} href="/orders" />
        <Stat label="Webhooks en erreur" value={d.webhookErrors} />
        <div className="card">
          <div className="label">Volume des commandes terminées</div>
          <div className="value">
            <Money cents={d.completedGmvCents} />
          </div>
        </div>
        <div className="card">
          <div className="label">Commission effectivement retenue</div>
          <div className="value">
            <Money cents={d.retainedCommissionCents} />
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            Après transferts vendeurs réussis uniquement
          </div>
        </div>
      </div>
      <h2>Commandes par statut</h2>
      <table>
        <tbody>
          {(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((s) => (
            <tr key={s}>
              <td>
                <Link href={`/orders?status=${s}`}>{ORDER_STATUS_LABELS[s]}</Link>
              </td>
              <td>{d.ordersByStatus[s] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <div className="card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
  return href ? (
    <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
      {body}
    </Link>
  ) : (
    body
  );
}
