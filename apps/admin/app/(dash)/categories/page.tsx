import type { CategoryDto } from '@snapmarket/shared';
import { api } from '@/lib/api';
import { ActionForm } from '@/components/ActionForm';
import { createCategory, updateCategory } from '../../actions';

export default async function CategoriesPage() {
  const [categories, me] = await Promise.all([
    api<CategoryDto[]>('/admin/categories'),
    api<{ role: string }>('/admin/me'),
  ]);
  const admin = me.role === 'ADMIN';
  return (
    <>
      <h1>Catégories</h1>
      {!admin && (
        <p className="notice">
          Lecture seule : la gestion des catégories est réservée aux administrateurs.
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>Nom</th>
            <th>Slug</th>
            <th>Ordre</th>
            <th>Active</th>
            <th>Validation manuelle</th>
            {admin && <th />}
          </tr>
        </thead>
        <tbody>
          {categories.map((c) =>
            admin ? (
              <tr key={c.id}>
                <td colSpan={6}>
                  <ActionForm action={updateCategory} submit="Enregistrer" inline>
                    <input type="hidden" name="id" value={c.id} />
                    <input name="name" defaultValue={c.name} aria-label="Nom" />
                    <code>{c.slug}</code>
                    <input
                      name="position"
                      type="number"
                      min={0}
                      defaultValue={c.position}
                      style={{ width: 70 }}
                      aria-label="Ordre"
                    />
                    <label className="check">
                      <input type="checkbox" name="isActive" defaultChecked={c.isActive} /> Active
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        name="requiresReview"
                        defaultChecked={c.requiresReview}
                      />{' '}
                      Validation manuelle
                    </label>
                  </ActionForm>
                </td>
              </tr>
            ) : (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>
                  <code>{c.slug}</code>
                </td>
                <td>{c.position}</td>
                <td>{c.isActive ? 'Oui' : 'Non'}</td>
                <td>{c.requiresReview ? 'Oui' : 'Non'}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      {admin && (
        <>
          <h2>Nouvelle catégorie</h2>
          <ActionForm action={createCategory} submit="Créer">
            <label>
              Nom
              <input name="name" required maxLength={60} />
            </label>
            <label>
              Slug
              <input name="slug" required pattern="[a-z0-9-]{2,50}" />
            </label>
            <label>
              Icône (nom Lucide)
              <input name="icon" maxLength={40} />
            </label>
            <label>
              Ordre
              <input name="position" type="number" min={0} />
            </label>
            <label className="check">
              <input type="checkbox" name="requiresReview" /> Annonces soumises à validation
            </label>
          </ActionForm>
        </>
      )}
    </>
  );
}
