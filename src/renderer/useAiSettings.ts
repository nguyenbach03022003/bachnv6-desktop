import { useEffect, useState } from 'react';
import { DEFAULT_AI_SETTINGS, type AiSettings } from '../shared/ai-settings-types';

export function useAiSettings() {
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const bridge = window.dashboard?.aiSettings;
    if (!bridge) return;
    let mounted = true;
    let received = false;
    const unsubscribe = bridge.onChanged(next => {
      received = true;
      if (mounted) { setSettings(next); setError(null); }
    });
    void bridge.get().then(next => { if (mounted && !received) { setSettings(next); setError(null); } })
      .catch((reason: unknown) => { if (mounted && !received) setError(String(reason)); });
    return () => { mounted = false; unsubscribe(); };
  }, []);
  return { settings, error };
}
