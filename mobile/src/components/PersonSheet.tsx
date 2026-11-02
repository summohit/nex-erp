import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, Modal, TouchableOpacity, Linking, ActivityIndicator, ScrollView } from 'react-native';
import { X, Mail, Phone, Building2, Briefcase, UserRound, CalendarDays, MapPin } from 'lucide-react-native';
import { create } from 'zustand';
import { apiClient } from '../api/apiClient';

/**
 * Anyone shown on the dashboard (kudos, leave, birthdays, calendar) can be
 * tapped to see who they are. One sheet, mounted once, opened from anywhere.
 */
export interface PersonLite {
  id?: number;
  firstName?: string;
  lastName?: string | null;
  avatarUrl?: string | null;
  designation?: string | { name?: string } | null;
  department?: string | { name?: string } | null;
  employeeCode?: string | null;
}

export const fullName = (p?: PersonLite | null) => `${p?.firstName || ''} ${p?.lastName || ''}`.trim() || 'Team member';
const label = (v: any) => (typeof v === 'string' ? v : v?.name) || null;
const initials = (p?: PersonLite | null) =>
  fullName(p).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const PALETTE = ['#4F46E5', '#0D9488', '#DB2777', '#D97706', '#2563EB', '#7C3AED', '#059669'];
const colorFor = (p?: PersonLite | null) => PALETTE[(p?.id ?? fullName(p).length) % PALETTE.length];

export function Avatar({ person, size = 36 }: { person?: PersonLite | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const r = { width: size, height: size, borderRadius: size / 2 };
  if (person?.avatarUrl && !failed) {
    return <Image source={{ uri: person.avatarUrl }} style={[r, styles.img]} onError={() => setFailed(true)} />;
  }
  return (
    <View style={[r, styles.fallback, { backgroundColor: colorFor(person) + '22' }]}>
      <Text style={[styles.fallbackText, { color: colorFor(person), fontSize: size * 0.38 }]}>{initials(person)}</Text>
    </View>
  );
}

type PersonStore = { person: PersonLite | null; open: (p?: PersonLite | null) => void; close: () => void };
export const usePersonSheet = create<PersonStore>((set) => ({
  person: null,
  open: (p) => p && set({ person: p }),
  close: () => set({ person: null }),
}));

/** Tap target that opens the sheet for this person. */
export function PersonTap({ person, children, style }: { person?: PersonLite | null; children: React.ReactNode; style?: any }) {
  const open = usePersonSheet((s) => s.open);
  return (
    <TouchableOpacity style={style} activeOpacity={0.75} disabled={!person} onPress={() => open(person)}>
      {children}
    </TouchableOpacity>
  );
}

const when = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null;

export function PersonSheetHost() {
  const { person, close } = usePersonSheet();
  const [full, setFull] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setFull(null);
    if (!person?.id) return;
    setLoading(true);
    // Directory details are limited by role on the server; show what we have if refused.
    apiClient.get(`/employees/${person.id}/profile`)
      .then(({ data }) => setFull(data))
      .catch(() => setFull(null))
      .finally(() => setLoading(false));
  }, [person?.id]);

  const p = { ...person, ...(full || {}) } as any;
  const rows = [
    { Icon: Briefcase, text: label(p.designation) },
    { Icon: Building2, text: label(p.department) },
    { Icon: MapPin, text: label(p.branch) },
    { Icon: UserRound, text: p.manager ? `Reports to ${fullName(p.manager)}` : null },
    { Icon: CalendarDays, text: p.joiningDate ? `Joined ${when(p.joiningDate)}` : null },
  ].filter((r) => r.text);
  const email = p.user?.email || p.email || p.workEmail;
  const phone = p.phone || p.phoneNumber || p.mobile;

  return (
    <Modal visible={!!person} transparent animationType="fade" onRequestClose={close}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={close}>
        <TouchableOpacity activeOpacity={1} style={styles.sheet}>
          <TouchableOpacity style={styles.close} onPress={close}><X size={18} color="#334155" /></TouchableOpacity>
          <ScrollView contentContainerStyle={styles.body}>
            <Avatar person={p} size={84} />
            <Text style={styles.name}>{fullName(p)}</Text>
            {!!p.employeeCode && <Text style={styles.code}>#{p.employeeCode}</Text>}
            {loading && <ActivityIndicator color="#1373E5" style={{ marginTop: 8 }} />}
            <View style={styles.rows}>
              {rows.map(({ Icon, text }) => (
                <View key={String(text)} style={styles.row}>
                  <Icon size={16} color="#64748B" />
                  <Text style={styles.rowText}>{text}</Text>
                </View>
              ))}
            </View>
            {(email || phone) && (
              <View style={styles.actions}>
                {!!email && (
                  <TouchableOpacity style={styles.action} onPress={() => Linking.openURL(`mailto:${email}`)}>
                    <Mail size={16} color="#1373E5" />
                    <Text style={styles.actionText} numberOfLines={1}>{email}</Text>
                  </TouchableOpacity>
                )}
                {!!phone && (
                  <TouchableOpacity style={styles.action} onPress={() => Linking.openURL(`tel:${phone}`)}>
                    <Phone size={16} color="#1373E5" />
                    <Text style={styles.actionText}>{phone}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  img: { backgroundColor: '#E2E8F0' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  fallbackText: { fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: '#fff', borderRadius: 22, maxHeight: '80%' },
  close: { position: 'absolute', right: 12, top: 12, zIndex: 2, width: 34, height: 34, borderRadius: 10, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  body: { alignItems: 'center', padding: 22, paddingTop: 28, gap: 4 },
  name: { fontSize: 20, fontWeight: '800', color: '#0F172A', marginTop: 10, textAlign: 'center' },
  code: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  rows: { alignSelf: 'stretch', marginTop: 14, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { flex: 1, fontSize: 14, color: '#334155' },
  actions: { alignSelf: 'stretch', marginTop: 16, gap: 8 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: '#EFF6FF' },
  actionText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1D4ED8' },
});
