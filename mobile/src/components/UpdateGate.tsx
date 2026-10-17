import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Download } from 'lucide-react-native';
import { API_URL } from '../api/apiClient';
import { APP_VERSION_CODE } from '../appVersion';
import { colors } from '../theme/ds';

/**
 * Update check (17 Oct 2026). The server's policy (backend/uploads/app/version.json)
 * says the latest and the minimum build. Below the minimum the app is blocked
 * until updated; below the latest a "Later" prompt is shown once per launch.
 * Checked on start and whenever the app comes back to the foreground.
 */
type Policy = { latestVersion: string | null; latestVersionCode: number; minVersionCode: number; message: string | null; storeUrl: string };

export default function UpdateGate() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    try {
      const res = await fetch(`${API_URL}/app-download/android/policy`);
      if (res.ok) setPolicy(await res.json());
    } catch {
      // Offline: never block on a failed check.
    }
  }, []);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => sub.remove();
  }, [check]);

  if (!policy) return null;
  const forced = APP_VERSION_CODE < policy.minVersionCode;
  const optional = !forced && !dismissed && APP_VERSION_CODE < policy.latestVersionCode;
  if (!forced && !optional) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => { if (!forced) setDismissed(true); }}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.icon}><Download size={24} color={colors.primary} /></View>
          <Text style={styles.title}>{forced ? 'Update required' : 'Update available'}</Text>
          <Text style={styles.body}>
            {forced
              ? 'This version of MIRA is no longer supported. Please update to continue.'
              : `MIRA ${policy.latestVersion ?? ''} is available.`}
          </Text>
          {!!policy.message && <Text style={styles.notes}>{policy.message}</Text>}
          <TouchableOpacity style={styles.primary} onPress={() => Linking.openURL(policy.storeUrl).catch(() => undefined)} activeOpacity={0.85}>
            <Text style={styles.primaryText}>Update now</Text>
          </TouchableOpacity>
          {!forced && (
            <TouchableOpacity style={styles.later} onPress={() => setDismissed(true)}>
              <Text style={styles.laterText}>Later</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, alignItems: 'center' },
  icon: { width: 56, height: 56, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 6 },
  body: { fontSize: 14, color: colors.textBody, textAlign: 'center', lineHeight: 20 },
  notes: { fontSize: 12.5, color: colors.textMuted, textAlign: 'center', lineHeight: 18, marginTop: 10 },
  primary: { alignSelf: 'stretch', height: 48, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  later: { marginTop: 10, padding: 8 },
  laterText: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
});
