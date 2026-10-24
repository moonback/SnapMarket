import { api } from '@/lib/api';
import { ActionForm } from '@/components/ActionForm';
import { Badge, DateTime } from '@/components/ui';
import { setUserRole, setUserStatus } from '../../../actions';

interface Detail {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: string;
  status: string;
  emailVerified: boolean;
  createdAt: string;
  lockedUntil: string | null;
  seller: {
    accountType: string;
    companyName: string | null;
    siret: string | null;
    verificationStatus: string;
    payoutsEnabled: boolean;
  } | null;
  counts: { products: number; purchases: number; sales: number; reportsAgainst: number };
  moderationHistory: { id: string; action: string; reason: string | null; createdAt: string }[];
}

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [u, me] = await Promise.all([
    api<Detail>(`/admin/users/${id}`),
    api<{ role: string }>('/admin/me'),
  ]);
  return (
    <>
      <h1>{u.username}</h1>
      <div className="grid2">
        <div className="card">
          <dl className="kv">
            <dt>Email</dt>
            <dd>{u.email}</dd>
            <dt>Nom affiché</dt>
            <dd>{u.displayName ?? '—'}</dd>
            <dt>Rôle</dt>
            <dd>
              <Badge value={u.role} />
            </dd>
            <dt>Statut</dt>
            <dd>
              <Badge value={u.status} />
            </dd>
            <dt>Email vérifié</dt>
            <dd>{u.emailVerified ? 'Oui' : 'Non'}</dd>
            <dt>Inscription</dt>
            <dd>
              <DateTime value={u.createdAt} />
            </dd>
            <dt>Verrouillé jusqu’à</dt>
            <dd>
              <DateTime value={u.lockedUntil} />
            </dd>
            <dt>Annonces / achats / ventes</dt>
            <dd>
              {u.counts.products} / {u.counts.purchases} / {u.counts.sales}
            </dd>
            <dt>Signalements reçus</dt>
            <dd>{u.counts.reportsAgainst}</dd>
            {u.seller && (
              <>
                <dt>Compte vendeur</dt>
                <dd>
                  {u.seller.accountType} {u.seller.companyName ? `— ${u.seller.companyName}` : ''}
                </dd>
                <dt>SIRET</dt>
                <dd>{u.seller.siret ?? '—'}</dd>
                <dt>Vérification</dt>
                <dd>
                  <Badge value={u.seller.verificationStatus} />
                </dd>
                <dt>Versements Stripe</dt>
                <dd>{u.seller.payoutsEnabled ? 'Activés' : 'Non activés'}</dd>
              </>
            )}
          </dl>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Statut du compte</h2>
          <ActionForm
            action={setUserStatus}
            submit="Appliquer"
            variant="danger"
            confirm="Confirmer le changement de statut ?"
          >
            <input type="hidden" name="id" value={u.id} />
            <label>
              Nouveau statut
              <select name="status" defaultValue={u.status === 'DELETED' ? 'ACTIVE' : u.status}>
                <option value="ACTIVE">ACTIVE (réactiver)</option>
                <option value="SUSPENDED">SUSPENDED</option>
                <option value="BANNED">BANNED</option>
              </select>
            </label>
            <label>
              Motif (journalisé)
              <textarea name="reason" rows={2} maxLength={500} />
            </label>
          </ActionForm>
          {me.role === 'ADMIN' && u.role !== 'ADMIN' && (
            <>
              <h2>Rôle</h2>
              <ActionForm action={setUserRole} submit="Modifier le rôle">
                <input type="hidden" name="id" value={u.id} />
                <select name="role" defaultValue={u.role === 'MODERATOR' ? 'MODERATOR' : 'USER'}>
                  <option value="USER">Utilisateur</option>
                  <option value="MODERATOR">Modérateur</option>
                </select>
              </ActionForm>
              <p className="muted" style={{ fontSize: 12 }}>
                Le rôle administrateur ne s’attribue que par la procédure CLI documentée.
              </p>
            </>
          )}
        </div>
      </div>
      <h2>Historique de modération</h2>
      {u.moderationHistory.length === 0 ? (
        <p className="muted">Aucune action.</p>
      ) : (
        <table>
          <tbody>
            {u.moderationHistory.map((m) => (
              <tr key={m.id}>
                <td>
                  <Badge value={m.action} />
                </td>
                <td>{m.reason ?? '—'}</td>
                <td>
                  <DateTime value={m.createdAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
