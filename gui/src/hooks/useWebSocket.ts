import { useEffect, useRef } from 'react';

type WSMessage = Record<string, unknown>;

export function useWebSocket(onMessage: (msg: WSMessage) => void) {
  const ws = useRef<WebSocket | null>(null);
  const onMsg = useRef(onMessage);
  onMsg.current = onMessage;

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.hostname}:3333`;
    ws.current = new WebSocket(url);
    ws.current.onmessage = (e) => {
      try { onMsg.current(JSON.parse(e.data)); } catch {}
    };
    return () => ws.current?.close();
  }, []);
}
