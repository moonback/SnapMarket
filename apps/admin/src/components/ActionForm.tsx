'use client';

import { ReactNode, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionState } from '../../app/actions';

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

function Submit({ label, variant }: { label: string; variant?: 'danger' | 'primary' | 'ghost' }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn ${variant ?? 'primary'}`} disabled={pending}>
      {pending ? '…' : label}
    </button>
  );
}

/** Formulaire relié à une action serveur, avec retour d'erreur explicite. */
export function ActionForm({
  action,
  children,
  submit,
  variant,
  confirm,
  inline,
}: {
  action: Action;
  children?: ReactNode;
  submit: string;
  variant?: 'danger' | 'primary' | 'ghost';
  confirm?: string;
  inline?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form
      action={formAction}
      className={inline ? 'form-inline' : 'form'}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <Submit label={submit} variant={variant} />
      {state.error && (
        <p className="msg error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && <p className="msg ok">{state.ok}</p>}
    </form>
  );
}
