import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Image, Share, Linking, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ShieldCheck, ShieldAlert, Info, Share2, ExternalLink, RefreshCw } from 'lucide-react-native';

import AppScreen from '../../components/AppScreen';
import { theme } from '../../theme/theme';
import { twoFactorService, TwoFactorStatus, EnrolmentPayload } from '../../api/twoFactorService';

type Step = 'idle' | 'password' | 'enrol' | 'codes';
type Intent = 'enable' | 'disable' | 'regenerate';

export default function SecurityScreen() {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [step, setStep] = useState<Step>('idle');
  const [intent, setIntent] = useState<Intent>('enable');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  const [enrolment, setEnrolment] = useState<EnrolmentPayload | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    twoFactorService
      .getStatus()
      .then(setStatus)
      .catch(() => setError('Could not load your security settings.'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const reset = () => {
    setStep('idle');
    setPassword('');
    setCode('');
    setEnrolment(null);
    setError('');
  };

  const ask = (next: Intent) => {
    setIntent(next);
    setPassword('');
    setCode('');
    setError('');
    setStep('password');
  };

  const submitPassword = async () => {
    if (!password) { setError('Enter your password to continue.'); return; }
    setBusy(true);
    setError('');
    try {
      if (intent === 'enable') {
        setEnrolment(await twoFactorService.setup(password));
        setPassword('');
        setStep('enrol');
        return;
      }

      if (!code.trim()) { setError('Enter a current code from your app.'); return; }
      const res = intent === 'disable'
        ? await twoFactorService.disable(password, code.trim())
        : await twoFactorService.regenerateBackupCodes(password, code.trim());

      setPassword('');
      setCode('');
      if (res.backupCodes?.length) {
        setBackupCodes(res.backupCodes);
        setStep('codes');
      } else {
        reset();
      }
      load();
    } catch (e: any) {
      setCode('');
      setError(e?.response?.data?.message || 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const confirmEnrolment = async () => {
    if (!code.trim()) { setError('Enter the 6-digit code from your app.'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await twoFactorService.enable(code.trim());
      setCode('');
      setBackupCodes(res.backupCodes || []);
      setStep('codes');
      load();
    } catch (e: any) {
      setCode('');
      setError(e?.response?.data?.message || 'That code was not accepted.');
    } finally {
      setBusy(false);
    }
  };

  const groupedSecret = (enrolment?.secret.match(/.{1,4}/g) || []).join(' ');
  const shareCodes = () =>
    Share.share({ message: `NEX ERP backup codes\nEach code works once.\n\n${backupCodes.join('\n')}` });

  const openAuthenticator = async () => {
    if (!enrolment) return;
    try { await Linking.openURL(enrolment.otpauthUri); }
    catch { setError('No authenticator app found. Install one, then scan the QR or enter the key.'); }
  };

  return (
    <AppScreen title="Security" subtitle="Two-factor authentication" crumbs={[{ label: 'Security' }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} colors={[theme.colors.primary]} />}
      >
        {loading && !status ? (
          <ActivityIndicator style={styles.loader} color={theme.colors.primary} />
        ) : (
          <>
            {/* Current state */}
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <View style={[styles.iconWrap, status?.enabled && styles.iconWrapOn]}>
                  {status?.enabled
                    ? <ShieldCheck size={20} color="#059669" />
                    : <ShieldAlert size={20} color="#D97706" />}
                </View>
                <View style={styles.cardTitleGroup}>
                  <Text style={styles.cardTitle}>
                    {status?.enabled ? 'Two-factor is on' : 'Two-factor is off'}
                  </Text>
                  <Text style={styles.cardSubtitle}>
                    {status?.enabled
                      ? `${status.backupCodesRemaining} backup code${status.backupCodesRemaining === 1 ? '' : 's'} left`
                      : 'Your account is protected by your password alone.'}
                  </Text>
                </View>
              </View>

              {status?.companyRequires && (
                <View style={styles.note}>
                  <Info size={14} color="#64748B" />
                  <Text style={styles.noteText}>
                    Your company requires two-factor authentication, so it cannot be turned off.
                  </Text>
                </View>
              )}

              {step === 'idle' && (
                <View style={styles.actions}>
                  {!status?.enabled && (
                    <TouchableOpacity style={styles.primaryBtn} onPress={() => ask('enable')} activeOpacity={0.85}>
                      <Text style={styles.primaryBtnText}>Set up authenticator</Text>
                    </TouchableOpacity>
                  )}
                  {status?.enabled && (
                    <TouchableOpacity style={styles.secondaryBtn} onPress={() => ask('regenerate')} activeOpacity={0.8}>
                      <RefreshCw size={15} color="#334155" />
                      <Text style={styles.secondaryBtnText}>New backup codes</Text>
                    </TouchableOpacity>
                  )}
                  {status?.enabled && status.canDisable && (
                    <TouchableOpacity style={styles.dangerBtn} onPress={() => ask('disable')} activeOpacity={0.8}>
                      <Text style={styles.dangerBtnText}>Turn off</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            {/* Re-authenticate */}
            {step === 'password' && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Confirm it's you</Text>
                <Text style={styles.cardSubtitle}>
                  {intent === 'enable'
                    ? 'Enter your password to start setup.'
                    : 'Enter your password and a current code.'}
                </Text>

                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  placeholderTextColor="#CBD5E1"
                />

                {intent !== 'enable' && (
                  <>
                    <Text style={styles.label}>Current code</Text>
                    <TextInput
                      style={[styles.input, styles.codeInput]}
                      value={code}
                      onChangeText={setCode}
                      placeholder="000000"
                      placeholderTextColor="#CBD5E1"
                      keyboardType="number-pad"
                      maxLength={14}
                    />
                  </>
                )}

                {!!error && <Text style={styles.error}>{error}</Text>}

                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.primaryBtn, busy && styles.btnDisabled]}
                    onPress={submitPassword}
                    disabled={busy}
                    activeOpacity={0.85}
                  >
                    {busy ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={styles.primaryBtnText}>Continue</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.ghostBtn} onPress={reset} activeOpacity={0.7}>
                    <Text style={styles.ghostBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Enrolment */}
            {step === 'enrol' && enrolment && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Scan with your authenticator</Text>
                <Text style={styles.cardSubtitle}>
                  Google Authenticator, Authy, Microsoft Authenticator or 1Password all work.
                </Text>

                <View style={styles.qrWrap}>
                  <Image source={{ uri: enrolment.qrDataUri }} style={styles.qr} />
                  <Text style={styles.secretLabel}>Can't scan? Enter this key</Text>
                  <Text style={styles.secretValue} selectable>{groupedSecret}</Text>

                  <View style={styles.inlineActions}>
                    <TouchableOpacity
                      style={styles.secondaryBtn}
                      onPress={() => Share.share({ message: enrolment.secret })}
                      activeOpacity={0.8}
                    >
                      <Share2 size={15} color="#334155" />
                      <Text style={styles.secondaryBtnText}>Share key</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.secondaryBtn} onPress={openAuthenticator} activeOpacity={0.8}>
                      <ExternalLink size={15} color="#334155" />
                      <Text style={styles.secondaryBtnText}>Open app</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <Text style={styles.label}>Enter the 6-digit code</Text>
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  value={code}
                  onChangeText={setCode}
                  placeholder="000000"
                  placeholderTextColor="#CBD5E1"
                  keyboardType="number-pad"
                  maxLength={6}
                />

                {!!error && <Text style={styles.error}>{error}</Text>}

                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.primaryBtn, busy && styles.btnDisabled]}
                    onPress={confirmEnrolment}
                    disabled={busy}
                    activeOpacity={0.85}
                  >
                    {busy ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={styles.primaryBtnText}>Turn on</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.ghostBtn} onPress={reset} activeOpacity={0.7}>
                    <Text style={styles.ghostBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Backup codes — shown exactly once */}
            {step === 'codes' && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Save your backup codes</Text>
                <Text style={styles.cardSubtitle}>
                  The only way in if you lose your phone. Each works once, and they will not be shown again.
                </Text>

                <View style={styles.codesBox}>
                  {backupCodes.map((c) => <Text key={c} style={styles.backupCode}>{c}</Text>)}
                </View>

                <View style={styles.actions}>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={shareCodes} activeOpacity={0.8}>
                    <Share2 size={15} color="#334155" />
                    <Text style={styles.secondaryBtnText}>Save or share</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.primaryBtn} onPress={reset} activeOpacity={0.85}>
                    <Text style={styles.primaryBtnText}>I've saved them</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },
  loader: { marginTop: 40 },

  card: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 18,
    borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 14,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconWrap: {
    width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A',
  },
  iconWrapOn: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  cardTitleGroup: { flex: 1 },
  cardTitle: { fontSize: 15.5, fontWeight: '700', color: '#0F172A', marginBottom: 3 },
  cardSubtitle: { fontSize: 13, color: '#64748B', lineHeight: 19 },

  note: {
    flexDirection: 'row', gap: 8, marginTop: 14, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: '#F1F5F9',
  },
  noteText: { flex: 1, fontSize: 12.5, color: '#64748B', lineHeight: 18 },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16, alignItems: 'center' },

  primaryBtn: {
    backgroundColor: theme.colors.primary, borderRadius: 10,
    paddingHorizontal: 18, paddingVertical: 11, alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },

  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
  },
  secondaryBtnText: { fontSize: 13, fontWeight: '600', color: '#334155' },

  dangerBtn: {
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#FECACA',
    borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10,
  },
  dangerBtnText: { fontSize: 13, fontWeight: '600', color: '#B91C1C' },

  ghostBtn: { paddingHorizontal: 10, paddingVertical: 10 },
  ghostBtnText: { fontSize: 13, fontWeight: '600', color: '#64748B' },

  label: { fontSize: 12.5, fontWeight: '600', color: '#334155', marginTop: 14, marginBottom: 6 },
  input: {
    height: 46, borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 10,
    backgroundColor: '#F8FAFC', paddingHorizontal: 14, fontSize: 14.5, color: '#0F172A',
  },
  codeInput: { textAlign: 'center', fontSize: 19, fontWeight: '700', letterSpacing: 6 },
  error: { fontSize: 12.5, color: '#DC2626', marginTop: 10 },

  qrWrap: { alignItems: 'center', marginTop: 16 },
  qr: { width: 170, height: 170, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFF' },
  secretLabel: {
    fontSize: 10.5, fontWeight: '700', color: '#94A3B8',
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12,
  },
  secretValue: {
    fontFamily: 'Menlo', fontSize: 13.5, fontWeight: '700', color: '#0F172A',
    backgroundColor: '#F1F5F9', paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 8, marginTop: 5, letterSpacing: 1,
  },
  inlineActions: { flexDirection: 'row', gap: 10, marginTop: 12 },

  codesBox: {
    backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1',
    borderStyle: 'dashed', borderRadius: 12, padding: 14, marginTop: 14,
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
  },
  backupCode: {
    fontFamily: 'Menlo', fontSize: 13.5, fontWeight: '700',
    color: '#0F172A', width: '48%', paddingVertical: 4, textAlign: 'center',
  },
});
