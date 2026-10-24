import Link from 'next/link';
import { api, Page, qs } from '@/lib/api';
import { ActionForm } from '@/components/ActionForm';
import { Badge, DateTime, Empty, FilterForm, Pagination } from '@/components/ui';
import { decideSeller } from '../../actions';

interface Row {
  user: { id: string; username: string; email: string; status: string };
  companyName: string | null;
  siret: string | null;
  vatNumber: string | null;
  verificationStatus: string;
  payoutsEnabled: boolean;
  legalAddress: { line1?: string; postalCode?: string; city?: string } | null;
  verificationNote: string | null;
  updatedAt: string;
}

export default async function SellersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const status = sp.verificationStatus ?? 'PENDING';
  const data = await api<Page<Row>>(
    `/admin/sellers${qs({ verificationStatus: status, q: sp.q, page: sp.page })}`,
  );
  return (
    <>
      <h1>Vendeurs professionnels</h1>
      <p className="muted">
        Vérifiez les justificatifs (registre INSEE / extrait Kbis) en dehors de l’application avant
        de valider. Le badge « pro vérifié » n’apparaît qu’après validation.
      </p>
      <FilterForm>
        <label>
          Statut
          <select name="verificationStatus" defaultValue={status}>
            {['PENDING', 'VERIFIED', 'REJECTED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Recherche
          <input name="q" defaultValue={sp.q} placeholder="raison sociale, SIRET, pseudo" />
        </label>
      </FilterForm>
      {data.items.length === 0 ? (
        <Empty>Aucune demande.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Vendeur</th>
              <th>Entreprise</th>
              <th>SIRET / TVA</th>
              <th>Adresse</th>
              <th>Statut</th>
              <th>Décision</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((s) => (
              <tr key={s.user.id}>
                <td>
                  <Link href={`/users/${s.user.id}`}>{s.user.username}</Link>
                  <br />
                  <span className="muted">{s.user.email}</span>
                </td>
                <td>{s.companyName}</td>
                <td>
                  {s.siret}
                  <br />
                  <span className="muted">{s.vatNumber ?? '—'}</span>
                </td>
                <td>
                  {s.legalAddress
                    ? `${s.legalAddress.line1 ?? ''}, ${s.legalAddress.postalCode ?? ''} ${s.legalAddress.city ?? ''}`
                    : '—'}
                </td>
                <td>
                  <Badge value={s.verificationStatus} />
                  <br />
                  <DateTime value={s.updatedAt} />
                </td>
                <td>
                  <ActionForm action={decideSeller} submit="Enregistrer" inline>
                    <input type="hidden" name="userId" value={s.user.id} />
                    <select name="decision" defaultValue="VERIFIED">
                      <option value="VERIFIED">Valider</option>
                      <option value="REJECTED">Refuser</option>
                    </select>
                    <input name="note" placeholder="Note" maxLength={500} />
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination {...data} base="/sellers" params={{ verificationStatus: status, q: sp.q }} />
    </>
  );
}
