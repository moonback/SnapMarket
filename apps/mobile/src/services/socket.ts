import { io, Socket } from 'socket.io-client';
import { WS_URL } from '../config';
import { api } from './api';

let socket: Socket | null = null;

/**
 * Connexion temps réel authentifiée. Le jeton courant est fourni à chaque (re)connexion ;
 * en cas de refus, le jeton est renouvelé puis la connexion relancée.
 * Après une reconnexion, les écrans rechargent l'historique via l'API REST.
 */
export function getSocket(): Socket {
  if (socket) return socket;
  socket = io(WS_URL, {
    transports: ['websocket'],
    auth: (cb) => cb({ token: api.getAccessToken() ?? '' }),
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });
  socket.on('auth_error', async () => {
    if (await api.refresh()) socket?.connect();
  });
  socket.on('disconnect', (reason) => {
    // Déconnexion à l'initiative du serveur (jeton refusé) : renouvellement puis reconnexion.
    if (reason === 'io server disconnect') {
      void api.refresh().then((ok) => ok && socket?.connect());
    }
  });
  return socket;
}

export function disconnectSocket(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}

export interface Ack<T> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
}

export function emitWithAck<T>(event: string, payload: unknown, timeoutMs = 8000): Promise<Ack<T>> {
  return new Promise((resolve) => {
    getSocket()
      .timeout(timeoutMs)
      .emit(event, payload, (err: Error | null, res: Ack<T>) => {
        resolve(err ? { ok: false, error: 'Délai dépassé' } : res);
      });
  });
}
