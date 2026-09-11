import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Pressable,
  ActivityIndicator, Image, Linking, Share, ScrollView,
} from 'react-native';
import { ShieldCheck, Smartphone, KeyRound, ExternalLink, Share2, ArrowLeft } from 'lucide-react-native';

import { theme } from '../../theme/theme';
import { twoFactorService } from '../../api/twoFactorService';

type Mode = 'VERIFY' | 'ENROL';
type Step = 'verify' | 'enrol' | 'codes';

const DIGITS = 6;
/** The server's wording when a challenge token is stale or unreadable. */
const EXPIRED = /sign-in session has expired/i;

/**
 * The second-factor step of signing in.
 *
 * Rendered inside LoginScreen rather than as its own navigator screen: the
 * unauthenticated stack holds only Login. The challenge token is owned by
 * LoginScreen, which persists it — reading a code means leaving the app, and
 * Android may tear the activity down while it is gone.
 */
export default function TwoFactorPanel({
  challengeToken,
  mode,
  onAuthenticated,
  onCancel,
  onExpired,
}: {
  challengeToken: string;
  mode: Mode;
  /** Called with the real token pair once the challenge is satisfied. */
  onAuthenticated: (tokens: { access_token: string; refresh_token: string }) => void;
  onCancel: () => void;
  /** The challenge is past saving; the caller should drop it and show the form. */
  onExpired?: () => void;
}) {
  const [step, setStep] = useState<Step>(mode === 'ENROL' ? 'enrol' : 'verify');
  const [code, setCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  /** Backup codes are not six digits, so they get their own field rather than
   *  fighting the segmented one for formatting. */
  const [usingBackup, setUsingBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [focused, setFocused] = useState(false);

  const [enrolment, setEnrolment] = useState<{ qrDataUri: string; secret: string; otpauthUri: string } | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [pendingTokens, setPendingTokens] = useState<any>(null);

  const hiddenInput = useRef<React.ComponentRef<typeof TextInput>>(null);
  /** Guards against the auto-submit firing twice for one six-digit entry. */
  const submitting = useRef(false);

  useEffect(() => {
    if (mode !== 'ENROL') return;
    let cancelled = false;

    setBusy(true);
    twoFactorService
      .startChallengeEnrolment(challengeToken)
      .then((res) => { if (!cancelled) setEnrolment(res); })
      .catch((e) => {
        if (cancelled) return;
        const msg = e?.response?.data?.message || 'Could not start setup.';
        if (EXPIRED.test(msg)) { onExpired?.(); return; }
        setError(msg);
      })
      .finally(() => { if (!cancelled) setBusy(false); });

    return () => { cancelled = true; };
  }, [mode, challengeToken, onExpired]);

  /** Groups the base32 secret so it can be read off the screen and typed. */
  const groupedSecret = (enrolment?.secret.match(/.{1,4}/g) || []).join(' ');

  const submit = async (value?: string) => {
    const entered = (value ?? (usingBackup ? backupCode : code)).trim();
    if (!entered) { setError('Enter the code from your authenticator app.'); return; }
    if (submitting.current) return;

    submitting.current = true;
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
      const msg = e?.response?.data?.message || 'That code was not accepted.';
      setCode('');
      setBackupCode('');
      // A dead challenge cannot be retried, so sending the user back to the
      // form beats letting them type into a field that can never succeed.
      if (EXPIRED.test(msg) && onExpired) { onExpired(); return; }
      setError(msg);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  /** Six digits is always the whole code, so waiting for a button press is friction. */
  const onChangeDigits = (raw: string) => {
    const next = raw.replace(/\D/g, '').slice(0, DIGITS);
    setCode(next);
    if (error) setError('');
    if (next.length === DIGITS) submit(next);
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

  // ── Backup codes, shown exactly once after enrolment ───────────────────────
  if (step === 'codes') {
    return (
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.badge}><KeyRound size={26} color={theme.colors.primary} /></View>
        <Text style={styles.title}>Save your backup codes</Text>
        <Text style={styles.subtitle}>
          These are the only way in if you lose your phone. Each works once, and they will not be shown again.
        </Text>

        <View style={styles.codesBox}>
          {backupCodes.map((c) => <Text key={c} style={styles.backupCode}>{c}</Text>)}
        </View>

        <TouchableOpacity style={styles.wideSecondaryBtn} onPress={shareCodes} activeOpacity={0.8}>
          <Share2 size={16} color="#334155" />
          <Text style={styles.secondaryBtnText}>Save or share codes</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.primaryBtn} onPress={() => onAuthenticated(pendingTokens)} activeOpacity={0.85}>
          <Text style={styles.primaryBtnText}>I've saved them — continue</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  const canSubmit = usingBackup ? backupCode.trim().length > 0 : code.length === DIGITS;

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.badge}>
        {step === 'enrol'
          ? <Smartphone size={26} color={theme.colors.primary} />
          : <ShieldCheck size={26} color={theme.colors.primary} />}
      </View>

      <Text style={styles.title}>
        {step === 'enrol' ? 'Set up two-step verification' : 'Enter your code'}
      </Text>
      <Text style={styles.subtitle}>
        {step === 'enrol'
          ? 'Your company requires an authenticator app. Scan this with Google Authenticator, Authy or 1Password.'
          : 'Open your authenticator app and enter the 6-digit code for NEX ERP.'}
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

      {usingBackup ? (
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Backup code</Text>
          <TextInput
            style={styles.backupInput}
            value={backupCode}
            onChangeText={(t) => { setBackupCode(t); if (error) setError(''); }}
            placeholder="XXXX-XXXX"
            placeholderTextColor="#CBD5E1"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={14}
            onSubmitEditing={() => submit()}
            returnKeyType="go"
          />
          <Text style={styles.hint}>One of the ten codes saved when you set up 2FA. Each works once.</Text>
        </View>
      ) : (
        <View style={styles.inputGroup}>
          {/* One real input behind six painted boxes — the standard segmented
              OTP pattern, and it keeps a single caret, one paste target and
              native one-time-code autofill. The boxes are decoration. */}
          <Pressable style={styles.otpRow} onPress={() => hiddenInput.current?.focus()}>
            {Array.from({ length: DIGITS }).map((_, i) => {
              const char = code[i];
              const isActive = focused && i === Math.min(code.length, DIGITS - 1);
              return (
                <View
                  key={i}
                  style={[
                    styles.otpBox,
                    !!char && styles.otpBoxFilled,
                    isActive && styles.otpBoxActive,
                    !!error && styles.otpBoxError,
                  ]}
                >
                  <Text style={styles.otpChar}>{char ?? ''}</Text>
                </View>
              );
            })}
          </Pressable>

          <TextInput
            ref={hiddenInput}
            style={styles.hiddenInput}
            value={code}
            onChangeText={onChangeDigits}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            keyboardType="number-pad"
            maxLength={DIGITS}
            autoFocus
            caretHidden
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
          />

          <Text style={styles.hint}>Your code changes every 30 seconds.</Text>
        </View>
      )}

      {!!error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity
        style={[
          styles.primaryBtn,
          (busy || !canSubmit || (step === 'enrol' && !enrolment)) && styles.primaryBtnDisabled,
        ]}
        onPress={() => submit()}
        disabled={busy || !canSubmit || (step === 'enrol' && !enrolment)}
        activeOpacity={0.85}
      >
        {busy
          ? <ActivityIndicator color="#FFFFFF" size="small" />
          : <Text style={styles.primaryBtnText}>{step === 'enrol' ? 'Confirm & continue' : 'Verify & sign in'}</Text>}
      </TouchableOpacity>

      {step === 'verify' && (
        <TouchableOpacity
          style={styles.linkBtn}
          onPress={() => {
            setUsingBackup((v) => !v);
            setError('');
            setCode('');
            setBackupCode('');
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.linkBtnText}>
            {usingBackup ? 'Use my authenticator app instead' : 'Lost your phone? Use a backup code'}
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.ghostBtn} onPress={onCancel} activeOpacity={0.7}>
        <ArrowLeft size={15} color="#64748B" />
        <Text style={styles.ghostBtnText}>Back to sign in</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 40, alignItems: 'center', flexGrow: 1, justifyContent: 'center' },
  badge: {
    width: 56, height: 56, borderRadius: 18, backgroundColor: '#FFF1EC',
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },
  title: { fontSize: 22, fontWeight: '800', color: '#0F172A', textAlign: 'center', marginBottom: 8 },
  subtitle: {
    fontSize: 13.5, color: '#64748B', textAlign: 'center', lineHeight: 20,
    marginBottom: 26, maxWidth: 300,
  },

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

  inputGroup: { width: '100%', marginTop: 4 },
  label: { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 8 },

  /* Segmented code entry. Sized to fit six boxes on the narrowest phone. */
  otpRow: { flexDirection: 'row', justifyContent: 'center', gap: 9 },
  otpBox: {
    width: 46, height: 56, borderRadius: 12, borderWidth: 1.5,
    borderColor: '#E2E8F0', backgroundColor: '#F8FAFC',
    alignItems: 'center', justifyContent: 'center',
  },
  otpBoxFilled: { borderColor: '#CBD5E1', backgroundColor: '#FFFFFF' },
  otpBoxActive: { borderColor: theme.colors.primary, backgroundColor: '#FFFFFF' },
  otpBoxError: { borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' },
  otpChar: { fontSize: 24, fontWeight: '700', color: '#0F172A' },
  /* Off-screen rather than display:none — a hidden input keeps the keyboard,
     the caret and one-time-code autofill, none of which the boxes can provide. */
  hiddenInput: { position: 'absolute', opacity: 0, height: 1, width: 1 },

  backupInput: {
    height: 52, borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 12,
    backgroundColor: '#F8FAFC', textAlign: 'center', fontSize: 18,
    fontWeight: '700', letterSpacing: 2, color: '#0F172A',
  },

  hint: { fontSize: 12, color: '#94A3B8', marginTop: 12, textAlign: 'center' },
  error: { fontSize: 13, color: '#DC2626', marginTop: 14, textAlign: 'center' },

  primaryBtn: {
    height: 52, borderRadius: 14, backgroundColor: theme.colors.primary,
    alignItems: 'center', justifyContent: 'center', width: '100%', marginTop: 22,
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15.5, fontWeight: '700' },

  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
    borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF',
  },
  wideSecondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    width: '100%', height: 48, borderRadius: 12,
    borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF',
  },
  secondaryBtnText: { fontSize: 13.5, fontWeight: '600', color: '#334155' },

  linkBtn: { marginTop: 18, padding: 6 },
  linkBtnText: { fontSize: 13.5, fontWeight: '600', color: theme.colors.primary, textAlign: 'center' },

  ghostBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, padding: 8 },
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
