import { api } from '@/lib/api';
import { ActionForm } from '@/components/ActionForm';
import { updateSettings } from '../../actions';

interface Settings {
  commissionBps: number;
  storyTtlHours: number;
  offersEnabled: boolean;
  autoHideReportThreshold: number;
}

export default async function SettingsPage() {
  const s = await api<Settings>('/admin/settings');
  return (
    <>
      <h1>Paramètres métier</h1>
      <p className="muted">
        Chaque modification est validée par l’API (bornes strictes) et journalisée. La commission
        s’applique aux nouvelles commandes uniquement.
      </p>
      <div className="card">
        <ActionForm
          action={updateSettings}
          submit="Enregistrer"
          confirm="Enregistrer les nouveaux paramètres ?"
        >
          <label>
            Commission plateforme (%) — base : prix des articles hors livraison
            <input
              name="commissionPercent"
              defaultValue={(s.commissionBps / 100).toString()}
              inputMode="decimal"
              required
            />
          </label>
          <label>
            Durée de vie des stories (heures, 1 à 72)
            <input
              name="storyTtlHours"
              type="number"
              min={1}
              max={72}
              defaultValue={s.storyTtlHours}
              required
            />
          </label>
          <label>
            Seuil de masquage automatique (signalements distincts)
            <input
              name="autoHideReportThreshold"
              type="number"
              min={1}
              max={50}
              defaultValue={s.autoHideReportThreshold}
              required
            />
          </label>
          <label className="check">
            <input type="checkbox" name="offersEnabled" defaultChecked={s.offersEnabled} /> Offres
            de prix activées
          </label>
        </ActionForm>
      </div>
    </>
  );
}
