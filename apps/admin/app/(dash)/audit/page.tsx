import { api, Page, qs } from '@/lib/api';
import { DateTime, Empty, FilterForm, Pagination } from '@/components/ui';

interface Row {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  ip: string | null;
  createdAt: string;
  actor: { id: string; username: string } | null;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const data = await api<Page<Row>>(
    `/admin/audit-logs${qs({ action: sp.action, entityType: sp.entityType, actorId: sp.actorId, page: sp.page })}`,
  );
  return (
    <>
      <h1>Journal d’audit</h1>
      <FilterForm>
        <label>
          Action (préfixe)
          <input name="action" defaultValue={sp.action} placeholder="admin., auth., order." />
        </label>
        <label>
          Entité
          <input name="entityType" defaultValue={sp.entityType} placeholder="User, Order…" />
        </label>
        <label>
          Acteur (id)
          <input name="actorId" defaultValue={sp.actorId} />
        </label>
      </FilterForm>
      {data.items.length === 0 ? (
        <Empty>Aucune entrée.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Acteur</th>
              <th>Action</th>
              <th>Entité</th>
              <th>Détails</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((a) => (
              <tr key={a.id}>
                <td>
                  <DateTime value={a.createdAt} />
                  <br />
                  <span className="muted">{a.ip}</span>
                </td>
                <td>{a.actor?.username ?? 'système'}</td>
                <td>
                  <code>{a.action}</code>
                </td>
                <td>
                  {a.entityType}
                  <br />
                  <span className="muted">{a.entityId}</span>
                </td>
                <td>
                  <pre>{a.metadata ? JSON.stringify(a.metadata, null, 1) : ''}</pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination
        {...data}
        base="/audit"
        params={{ action: sp.action, entityType: sp.entityType, actorId: sp.actorId }}
      />
    </>
  );
}
