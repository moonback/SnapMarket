import Link from 'next/link';
import { api, Page, qs } from '@/lib/api';
import { ActionForm } from '@/components/ActionForm';
import { DateTime, Empty, Pagination } from '@/components/ui';
import { moderateContent } from '../../actions';

interface Row {
  id: string;
  body: string | null;
  sender: { id: string; username: string } | null;
  conversationId: string;
  createdAt: string;
}

export default async function FlaggedMessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const data = await api<Page<Row>>(`/admin/messages/flagged${qs({ page: sp.page })}`);
  return (
    <>
      <h1>Messages signalés par la détection de spam</h1>
      <p className="muted">
        Messages délivrés mais marqués par les règles automatiques (contacts ou paiements hors
        plateforme).
      </p>
      {data.items.length === 0 ? (
        <Empty>Aucun message signalé.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Expéditeur</th>
              <th>Message</th>
              <th>Date</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.sender ? <Link href={`/users/${m.sender.id}`}>{m.sender.username}</Link> : '—'}
                </td>
                <td>
                  <pre>{m.body}</pre>
                </td>
                <td>
                  <DateTime value={m.createdAt} />
                </td>
                <td>
                  <ActionForm action={moderateContent} submit="Masquer" variant="danger" inline>
                    <input type="hidden" name="type" value="MESSAGE" />
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="action" value="HIDE" />
                    <input type="hidden" name="path" value="/messages" />
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination {...data} base="/messages" params={{}} />
    </>
  );
}
