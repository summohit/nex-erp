import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, TextInput, Modal, ScrollView,
  Alert, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { Search, X, Star, Phone, Mail, FileText, Video, Trash2 } from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { Avatar } from '../../components/PersonSheet';
import { useAuthStore } from '../../store/authStore';
import { theme } from '../../theme/theme';

/**
 * Interviews, as on the web: interviewers see the interviews assigned to them,
 * HR and admins see all. Tap one to rate it and write feedback (the web's
 * quick tags included). HR and admins can also cancel or delete. The server
 * lets an interviewer change only their own interview's outcome.
 */
type Bucket = 'UPCOMING' | 'NEEDS_REVIEW' | 'COMPLETED' | 'CANCELLED';
const BUCKETS: { key: Bucket; label: string; color: string; bg: string }[] = [
  { key: 'UPCOMING', label: 'Scheduled', color: '#1D4ED8', bg: '#EFF6FF' },
  { key: 'NEEDS_REVIEW', label: 'Needs feedback', color: '#B45309', bg: '#FFFBEB' },
  { key: 'COMPLETED', label: 'Completed', color: '#047857', bg: '#ECFDF5' },
  { key: 'CANCELLED', label: 'Cancelled', color: '#64748B', bg: '#F1F5F9' },
];
const TAGS = ['Strong Technical Knowledge', 'Clear Communication', 'Relevant Domain Experience', 'Good Problem Solver', 'Culture & Values Alignment', 'Lacks Core Experience', 'Strong Hire'];
// Same rule as the web: rated or completed = completed; past and unrated = needs feedback.
const bucketOf = (i: any): Bucket =>
  i.status === 'CANCELLED' ? 'CANCELLED' : i.status === 'COMPLETED' || i.rating ? 'COMPLETED' : new Date(i.scheduledAt) >= new Date() ? 'UPCOMING' : 'NEEDS_REVIEW';
const when = (d?: string) => (d ? new Date(d).toLocaleString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
const errMsg = (e: any) => { const m = e?.response?.data?.message; return Array.isArray(m) ? m.join('\n') : m || 'Please try again.'; };
const splitName = (n: string) => { const [firstName, ...r] = (n || '').split(' '); return { firstName, lastName: r.join(' ') }; };

export default function InterviewsScreen() {
  const role = useAuthStore((s) => s.user?.role) || '';
  const isHr = ['SUPERADMIN', 'ADMIN', 'HR'].includes(role);
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [denied, setDenied] = useState(false);
  const [bucket, setBucket] = useState<Bucket>('UPCOMING');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<any | null>(null);
  const [rating, setRating] = useState(0);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/recruitment/applications/my-interviews');
      const rows = data || [];
      setList(rows);
      setDenied(false);
      setBucket((cur) => (rows.some((i: any) => bucketOf(i) === cur) ? cur : rows.some((i: any) => bucketOf(i) === 'NEEDS_REVIEW') ? 'NEEDS_REVIEW' : cur));
    } catch (e: any) {
      if (e?.response?.status === 403) setDenied(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const counts = useMemo(() => Object.fromEntries(BUCKETS.map((b) => [b.key, list.filter((i) => bucketOf(i) === b.key).length])) as Record<Bucket, number>, [list]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = list.filter((i) => bucketOf(i) === bucket &&
      (!q || `${i.application?.fullName || ''} ${i.application?.job?.title || ''} ${i.title} ${i.interviewer?.firstName || ''}`.toLowerCase().includes(q)));
    return bucket === 'UPCOMING' ? rows : [...rows].reverse();
  }, [list, bucket, query]);

  const openOne = (i: any) => { setOpen(i); setRating(i.rating || 0); setNotes(i.feedback || ''); };
  const addTag = (t: string) => setNotes((n) => (n.trim() ? `${n.trim()}\n• ${t}` : `• ${t}`));

  const save = async () => {
    if (!open || !rating) return;
    setSaving(true);
    try {
      await apiClient.put(`/recruitment/applications/interviews/${open.id}`, { rating, feedback: notes, status: 'COMPLETED' });
      setOpen(null);
      load();
    } catch (e) { Alert.alert('Could not save feedback', errMsg(e)); } finally { setSaving(false); }
  };

  const cancel = () => open && Alert.alert('Cancel interview?', `${open.title} with ${open.application?.fullName}`, [
    { text: 'Keep', style: 'cancel' },
    { text: 'Cancel it', style: 'destructive', onPress: async () => {
      try { await apiClient.put(`/recruitment/applications/interviews/${open.id}`, { status: 'CANCELLED' }); setOpen(null); load(); } catch (e) { Alert.alert('Could not cancel', errMsg(e)); }
    } },
  ]);

  const remove = () => open && Alert.alert('Delete interview?', 'It is removed from the candidate too.', [
    { text: 'Keep', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try { await apiClient.delete(`/recruitment/applications/interviews/${open.id}`); setOpen(null); load(); } catch (e) { Alert.alert('Could not delete', errMsg(e)); }
    } },
  ]);

  if (denied) {
    return <AppScreen showBack title="Interviews"><Text style={styles.empty}>Interviews are for interviewers, HR and administrators.</Text></AppScreen>;
  }

  const header = (
    <View style={{ gap: 10, marginBottom: 6 }}>
      <View style={styles.kpis}>
        {BUCKETS.map((b) => (
          <TouchableOpacity key={b.key} style={[styles.kpi, { backgroundColor: b.bg }, bucket === b.key && { borderColor: b.color }]} onPress={() => setBucket(b.key)}>
            <Text style={[styles.kpiNum, { color: b.color }]}>{counts[b.key]}</Text>
            <Text style={[styles.kpiLabel, { color: b.color }]} numberOfLines={1}>{b.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.search}>
        <Search size={16} color="#94A3B8" />
        <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Search candidate, job, interviewer" placeholderTextColor="#94A3B8" autoCorrect={false} clearButtonMode="while-editing" />
      </View>
    </View>
  );

  const a = open?.application;

  return (
    <AppScreen showBack title="Interviews" subtitle={`${counts.UPCOMING} scheduled · ${counts.NEEDS_REVIEW} need feedback`}>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} /> : (
        <FlatList
          data={shown}
          keyExtractor={(i) => String(i.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>Nothing here.</Text>}
          renderItem={({ item: i }) => (
            <TouchableOpacity style={styles.card} onPress={() => openOne(i)} activeOpacity={0.85}>
              <Avatar person={{ id: i.application?.id, ...splitName(i.application?.fullName), avatarUrl: i.application?.photoUrl }} size={42} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name} numberOfLines={1}>{i.application?.fullName}</Text>
                <Text style={styles.sub} numberOfLines={1}>{i.title} · {i.application?.job?.title}</Text>
                <Text style={styles.sub}>{when(i.scheduledAt)} · {i.durationMins || 45} min</Text>
                {isHr && i.interviewer && <Text style={styles.tiny}>with {i.interviewer.firstName} {i.interviewer.lastName || ''}</Text>}
              </View>
              {i.rating ? <Text style={styles.stars}>{'★'.repeat(i.rating)}</Text> : null}
            </TouchableOpacity>
          )}
        />
      )}

      <Modal visible={!!open} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottom}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>{a?.fullName}</Text>
                <Text style={styles.sub}>{open?.title} · {a?.job?.title}</Text>
              </View>
              <TouchableOpacity onPress={() => setOpen(null)}><X size={20} color="#334155" /></TouchableOpacity>
            </View>
            {open && (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
                <Text style={styles.sub}>{when(open.scheduledAt)} · {open.durationMins || 45} min{a?.experienceYears ? ` · ${a.experienceYears} yrs experience` : ''}</Text>
                <View style={styles.contact}>
                  {!!open.locationUrl && <TouchableOpacity style={styles.cBtn} onPress={() => Linking.openURL(open.locationUrl)}><Video size={15} color="#1373E5" /><Text style={styles.cText}>Join</Text></TouchableOpacity>}
                  {!!a?.resumeUrl && <TouchableOpacity style={styles.cBtn} onPress={() => Linking.openURL(a.resumeUrl)}><FileText size={15} color="#4F46E5" /><Text style={styles.cText}>Resume</Text></TouchableOpacity>}
                  {!!a?.phone && <TouchableOpacity style={styles.cBtn} onPress={() => Linking.openURL(`tel:${a.phone}`)}><Phone size={15} color="#059669" /><Text style={styles.cText}>Call</Text></TouchableOpacity>}
                  {!!a?.email && <TouchableOpacity style={styles.cBtn} onPress={() => Linking.openURL(`mailto:${a.email}`)}><Mail size={15} color="#1373E5" /><Text style={styles.cText}>Email</Text></TouchableOpacity>}
                </View>
                {open.status !== 'CANCELLED' && (
                  <>
                    <Text style={styles.section}>RATING</Text>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <TouchableOpacity key={n} onPress={() => setRating(n)}>
                          <Star size={32} color="#F59E0B" fill={n <= rating ? '#F59E0B' : 'transparent'} />
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Text style={styles.section}>FEEDBACK</Text>
                    <View style={styles.tags}>
                      {TAGS.map((t) => (
                        <TouchableOpacity key={t} style={styles.tag} onPress={() => addTag(t)}><Text style={styles.tagText}>+ {t}</Text></TouchableOpacity>
                      ))}
                    </View>
                    <TextInput style={[styles.input, { minHeight: 110, textAlignVertical: 'top' }]} value={notes} onChangeText={setNotes} placeholder="How did it go?" placeholderTextColor="#94A3B8" multiline />
                    <TouchableOpacity style={[styles.submit, (!rating || saving) && { opacity: 0.5 }]} disabled={!rating || saving} onPress={save}>
                      {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save feedback</Text>}
                    </TouchableOpacity>
                  </>
                )}
                {isHr && (
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    {open.status !== 'CANCELLED' && bucketOf(open) !== 'COMPLETED' && (
                      <TouchableOpacity style={[styles.secondary, { flex: 1 }]} onPress={cancel}><Text style={styles.secondaryText}>Cancel interview</Text></TouchableOpacity>
                    )}
                    <TouchableOpacity style={[styles.danger, { flex: 1 }]} onPress={remove}><Trash2 size={15} color="#B91C1C" /><Text style={styles.dangerText}>Delete</Text></TouchableOpacity>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 120, gap: 8 },
  kpis: { flexDirection: 'row', gap: 6 },
  kpi: { flex: 1, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 2, alignItems: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  kpiNum: { fontSize: 18, fontWeight: '800' },
  kpiLabel: { fontSize: 10, fontWeight: '700' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 0 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 12 },
  name: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  sub: { fontSize: 12, color: '#64748B' },
  tiny: { fontSize: 11, color: '#94A3B8' },
  stars: { fontSize: 13, color: '#F59E0B' },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 30, paddingHorizontal: 24 },
  bottom: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '90%', paddingBottom: 30 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  contact: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 36, borderRadius: 10, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' },
  cText: { fontSize: 13, fontWeight: '700', color: '#334155' },
  section: { fontSize: 11, fontWeight: '800', color: '#64748B', letterSpacing: 0.6 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#F1F5F9' },
  tagText: { fontSize: 12, fontWeight: '600', color: '#334155' },
  input: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#0F172A', backgroundColor: '#F8FAFC' },
  submit: { height: 48, borderRadius: 12, backgroundColor: '#1373E5', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  secondary: { height: 44, borderRadius: 12, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#334155', fontWeight: '700' },
  danger: { flexDirection: 'row', gap: 6, height: 44, borderRadius: 12, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', alignItems: 'center', justifyContent: 'center' },
  dangerText: { color: '#B91C1C', fontWeight: '800' },
});
