import { useEffect } from 'react';
import { getSocket } from '../services/socket';
import { keys, queryClient } from './queries';

/** Événements temps réel globaux : notifications et mises à jour de conversations. */
export function useRealtime(): void {
  useEffect(() => {
    const socket = getSocket();
    const onNotification = () => {
      void queryClient.invalidateQueries({ queryKey: keys.notifications });
    };
    const onConversation = () => {
      void queryClient.invalidateQueries({ queryKey: keys.conversations });
      void queryClient.invalidateQueries({ queryKey: keys.unread });
    };
    const onReconnect = () => {
      // Après une coupure, on resynchronise via l'API REST.
      onConversation();
      onNotification();
    };
    socket.on('notification', onNotification);
    socket.on('conversation:updated', onConversation);
    socket.io.on('reconnect', onReconnect);
    return () => {
      socket.off('notification', onNotification);
      socket.off('conversation:updated', onConversation);
      socket.io.off('reconnect', onReconnect);
    };
  }, []);
}
