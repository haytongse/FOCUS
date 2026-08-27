type Listener = (data?: any) => void;
const listeners: Record<string, Listener[]> = {};

export const tabEvents = {
  on(tab: string, fn: Listener): () => void {
    if (!listeners[tab]) listeners[tab] = [];
    listeners[tab].push(fn);
    return () => {
      listeners[tab] = listeners[tab].filter(l => l !== fn);
    };
  },
  emit(tab: string, data?: any) {
    listeners[tab]?.forEach(fn => fn(data));
  },
};
