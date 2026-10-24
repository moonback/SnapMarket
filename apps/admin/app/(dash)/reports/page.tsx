import { REPORT_REASON_LABELS, ReportReason } from '@snapmarket/shared';
import { api, Page, qs } from '@/lib/api';
import { ActionForm } from '@/components/ActionForm';
import { Badge, DateTime, Empty, FilterForm, Pagination } from '@/components/ui';
import { resolveReport } from '../../actions';

interface Row {
  id: string;
  targetType: string;
  targetId: string;
  reason: ReportReason;
  details: string | null;
  status: string;
  reporter: { username: string };
  createdAt: string;
  target: Record<string, unknown> | null;
}

function preview(t: Record<string, unknown> | null): string {
  if (!t) return 'Contenu introuvable';
  return String(t.title ?? t.body ?? t.caption ?? t.comment ?? t.username ?? t.id);
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const data = await api<Page<Row>>(
    `/admin/reports${qs({ status: sp.status, targetType: sp.targetType, page: sp.page })}`,
  );
  return (
    <>
      <h1>Signalements</h1>
      <FilterForm>
        <label>
          Statut
          <select name="status" defaultValue={sp.status ?? ''}>
            <option value="">Ouverts</option>
            {['RESOLVED', 'DISMISSED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select name="targetType" defaultValue={sp.targetType ?? ''}>
            <option value="">Tous</option>
            {['USER', 'PRODUCT', 'MESSAGE', 'STORY', 'REVIEW'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </FilterForm>
      {data.items.length === 0 ? (
        <Empty>Aucun signalement.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Contenu</th>
              <th>Motif</th>
              <th>Signalé par</th>
              <th>Statut</th>
              <th>Décision</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((r) => (
              <tr key={r.id}>
                <td>
                  <Badge value={r.targetType} />{' '}
                  {r.target && 'moderationStatus' in r.target ? (
                    <Badge value={String(r.target.moderationStatus)} />
                  ) : null}
                  <pre>{preview(r.target)}</pre>
                </td>
                <td>
                  {REPORT_REASON_LABELS[r.reason]}
                  <pre>{r.details}</pre>
                </td>
                <td>
                  {r.reporter.username}
                  <br />
                  <DateTime value={r.createdAt} />
                </td>
                <td>
                  <Badge value={r.status} />
                </td>
                <td>
                  {['RESOLVED', 'DISMISSED'].includes(r.status) ? (
                    '—'
                  ) : (
                    <ActionForm action={resolveReport} submit="Traiter">
                      <input type="hidden" name="id" value={r.id} />
                      <select name="status" defaultValue="RESOLVED">
                        <option value="RESOLVED">Fondé</option>
                        <option value="DISMISSED">Sans suite</option>
                      </select>
                      {r.targetType !== 'USER' && (
                        <select name="contentAction" defaultValue="">
                          <option value="">Aucune action sur le contenu</option>
                          <option value="HIDE">Masquer le contenu</option>
                          <option value="REMOVE">Retirer le contenu</option>
                        </select>
                      )}
                      <input name="note" placeholder="Note" maxLength={1000} />
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination
        {...data}
        base="/reports"
        params={{ status: sp.status, targetType: sp.targetType }}
      />
    </>
  );
}
