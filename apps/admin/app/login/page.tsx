'use client';

import { useActionState } from 'react';
import { login } from '../actions';

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, {});
  return (
    <div className="login">
      <div className="card">
        <h1>
          Snap<span style={{ color: 'var(--primary)' }}>Market</span> — Administration
        </h1>
        <form action={action} className="form">
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              defaultValue={state.email}
              required
            />
          </label>
          <label>
            Mot de passe
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button className="btn primary" type="submit" disabled={pending}>
            {pending ? 'Connexion…' : 'Se connecter'}
          </button>
          {state.error && (
            <p className="msg error" role="alert">
              {state.error}
            </p>
          )}
        </form>
        <p className="muted" style={{ fontSize: 12 }}>
          Réservé aux administrateurs et modérateurs. Le premier administrateur se crée avec{' '}
          <code>npm run admin:create</code>.
        </p>
      </div>
    </div>
  );
}
