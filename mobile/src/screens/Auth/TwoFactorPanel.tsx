import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Image, Linking, Share, ScrollView,
} from 'react-native';
import { ShieldCheck, Smartphone, KeyRound, ExternalLink, Share2 } from 'lucide-react-native';

import { theme } from '../../theme/theme';
import { twoFactorService } from '../../api/twoFactorService';

type Mode = 'VERIFY' | 'ENROL';
type Step = 'verify' | 'enrol' | 'codes';

/**
 * The second-factor step of signing in.
 *
 * Rendered inside LoginScreen rather than as its own navigator screen: the
 * unauthenticated stack holds only Login, and keeping the challenge token in
 * component state guarantees it never reaches AsyncStorage or the auth store —
 * which is what would flip the app into its signed-in state.
 */
export default function TwoFactorPanel({
  challengeToken,
  mode,
  onAuthenticated,
  onCancel,
}: {
  challengeToken: string;
  mode: Mode;
  /** Called with the real token pair once the challenge is satisfied. */
  onAuthenticated: (tokens: { access_token: string; refresh_token: string }) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>(mode === 'ENROL' ? 'enrol' : 'verify');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [enrolment, setEnrolment] = useState<{ qrDataUri: string; secret: string; otpauthUri: string } | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [pendingTokens, setPendingTokens] = useState<any>(null);

  useEffect(() => {
    if (mode !== 'ENROL') return;
    let cancelled = false;

    setBusy(true);
    twoFactorService
      .startChallengeEnrolment(challengeToken)
      .then((res) => { if (!cancelled) setEnrolment(res); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || 'Could not start setup.'); })
      .finally(() => { if (!cancelled) setBusy(false); });

    return () => { cancelled = true; };
  }, [mode, challengeToken]);

  /** Groups the base32 secret so it can be read off the screen and typed. */
  const groupedSecret = (enrolment?.secret.match(/.{1,4}/g) || []).join(' ');

  const submit = async () => {
    const entered = code.trim();
    if (!entered) { setError('Enter the code from your authenticator app.'); return; }

    setBusy(true);
    setError('');
    try {
      const res = step === 'enrol'
        ? await twoFactorService.confirmChallengeEnrolment(challengeToken, entered)
        : await twoFactorService.verifyChallenge(challengeToken, entered);

      if (res.backupCodes?.length) {
        // Enrolment: the codes are visible exactly once, so hold the session
        // until they have been acknowledged.
        setBackupCodes(res.backupCodes);
        setPendingTokens(res);
        setStep('codes');
        return;
      }
      onAuthenticated(res);
    } catch (e: any) {
      setCode('');
      setError(e?.response?.data?.message || 'That code was not accepted.');
    } finally {
      setBusy(false);
    }
  };

  const openAuthenticator = async () => {
    if (!enrolment) return;
    try {
      await Linking.openURL(enrolment.otpauthUri);
    } catch {
      // Custom schemes are unopenable when no authenticator is installed, and
      // iOS refuses undeclared ones outright — neither is an error worth a
      // scary message, so point at the manual path instead.
      setError('No authenticator app found. Install one, then scan the QR or enter the key above.');
    }
  };

  // No clipboard module is available in this project, so sharing is the copy
  // path. Share.share puts the value on the system sheet, which includes Copy.
  const shareSecret = () => enrolment && Share.share({ message: enrolment.secret });
  const shareCodes = () =>
    Share.share({ message: `NEX ERP backup codes\nEach code works once.\n\n${backupCodes.join('\n')}` });

  if (step === 'codes') {
    return (
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.badge}><KeyRound size={30} color={theme.colors.primary} /></View>
        <Text style={styles.title}>Save your backup codes</Text>
        <Text style={styles.subtitle}>
          These are the only way in if you lose your phone. Each works once, and they will not be shown again.
        </Text>

        <View style={styles.codesBox}>
          {backupCodes.map((c) => <Text key={c} style={styles.backupCode}>{c}</Text>)}
        </View>

        <TouchableOpacity style={styles.secondaryBtn} onPress={shareCodes} activeOpacity={0.8}>
          <Share2 size={16} color="#334155" />
          <Text style={styles.secondaryBtnText}>Save or share codes</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.primaryBtn} onPress={() => onAuthenticated(pendingTokens)} activeOpacity={0.85}>
          <Text style={styles.primaryBtnText}>I've saved them — continue</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.badge}>
        {step === 'enrol'
          ? <Smartphone size={30} color={theme.colors.primary} />
          : <ShieldCheck size={30} color={theme.colors.primary} />}
      </View>

      <Text style={styles.title}>
        {step === 'enrol' ? 'Set up two-step verification' : 'Two-step verification'}
      </Text>
      <Text style={styles.subtitle}>
        {step === 'enrol'
          ? 'Your company requires an authenticator app. Scan this with Google Authenticator, Authy or 1Password.'
          : 'Enter the 6-digit code from your authenticator app.'}
      </Text>

      {step === 'enrol' && (
        <View style={styles.enrolBlock}>
          {enrolment ? (
            <>
              <Image source={{ uri: enrolment.qrDataUri }} style={styles.qr} />
              <Text style={styles.secretLabel}>Can't scan? Enter this key</Text>
              <Text style={styles.secretValue} selectable>{groupedSecret}</Text>

              <View style={styles.enrolActions}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={shareSecret} activeOpacity={0.8}>
                  <Share2 size={15} color="#334155" />
                  <Text style={styles.secondaryBtnText}>Share key</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryBtn} onPress={openAuthenticator} activeOpacity={0.8}>
                  <ExternalLink size={15} color="#334155" />
                  <Text style={styles.secondaryBtnText}>Open app</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={styles.qrPlaceholder}><ActivityIndicator color={theme.colors.primary} /></View>
          )}
        </View>
      )}

      <View style={styles.inputGroup}>
        <Text style={styles.label}>
          {step === 'enrol' ? 'Enter the 6-digit code to confirm' : 'Verification code'}
        </Text>
        <TextInput
          style={styles.codeInput}
          value={code}
          onChangeText={(t) => { setCode(t); setError(''); }}
          placeholder="000000"
          placeholderTextColor="#CBD5E1"
          keyboardType="number-pad"
          maxLength={step === 'enrol' ? 6 : 14}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
        />
        {step === 'verify' && (
          <Text style={styles.hint}>Lost your phone? Enter a backup code instead.</Text>
        )}
      </View>

      {!!error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity
        style={[styles.primaryBtn, (busy || (step === 'enrol' && !enrolment)) && styles.primaryBtnDisabled]}
        onPress={submit}
        disabled={busy || (step === 'enrol' && !enrolment)}
        activeOpacity={0.85}
      >
        {busy
          ? <ActivityIndicator color="#FFFFFF" size="small" />
          : <Text style={styles.primaryBtnText}>{step === 'enrol' ? 'Confirm & continue' : 'Verify & sign in'}</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={styles.ghostBtn} onPress={onCancel} activeOpacity={0.7}>
        <Text style={styles.ghostBtnText}>Back to sign in</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, alignItems: 'center' },
  badge: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFF1EC',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  title: { fontSize: 20, fontWeight: '800', color: '#0F172A', textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 13, color: '#64748B', textAlign: 'center', lineHeight: 20, marginBottom: 22 },

  enrolBlock: { alignItems: 'center', marginBottom: 8, width: '100%' },
  qr: {
    width: 180, height: 180, borderRadius: 12, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  qrPlaceholder: { height: 180, justifyContent: 'center' },
  secretLabel: {
    fontSize: 11, fontWeight: '700', color: '#94A3B8',
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14,
  },
  secretValue: {
    fontFamily: 'Menlo', fontSize: 14, fontWeight: '700', color: '#0F172A',
    backgroundColor: '#F1F5F9', paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8, marginTop: 6, letterSpacing: 1, textAlign: 'center',
  },
  enrolActions: { flexDirection: 'row', gap: 10, marginTop: 12, marginBottom: 6 },

  inputGroup: { width: '100%', marginTop: 14 },
  label: { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 8 },
  codeInput: {
    height: 52, borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 12,
    backgroundColor: '#F8FAFC', textAlign: 'center', fontSize: 22,
    fontWeight: '700', letterSpacing: 8, color: '#0F172A',
  },
  hint: { fontSize: 11.5, color: '#94A3B8', marginTop: 8, textAlign: 'center' },
  error: { fontSize: 13, color: '#DC2626', marginTop: 12, textAlign: 'center' },

  primaryBtn: {
    height: 50, borderRadius: 25, backgroundColor: theme.colors.primary,
    alignItems: 'center', justifyContent: 'center', width: '100%', marginTop: 18,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },

  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
    borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF',
  },
  secondaryBtnText: { fontSize: 13, fontWeight: '600', color: '#334155' },

  ghostBtn: { marginTop: 14, padding: 8 },
  ghostBtnText: { fontSize: 13.5, fontWeight: '600', color: '#64748B' },

  codesBox: {
    width: '100%', backgroundColor: '#F8FAFC', borderWidth: 1,
    borderColor: '#CBD5E1', borderStyle: 'dashed', borderRadius: 12,
    padding: 16, marginBottom: 16, flexDirection: 'row',
    flexWrap: 'wrap', justifyContent: 'space-between',
  },
  backupCode: {
    fontFamily: 'Menlo', fontSize: 14, fontWeight: '700',
    color: '#0F172A', width: '48%', paddingVertical: 4, textAlign: 'center',
  },
});
