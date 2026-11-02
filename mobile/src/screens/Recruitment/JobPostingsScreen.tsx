import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, TextInput, Modal, ScrollView,
  Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Search, X, Plus, Briefcase, Users, MapPin, Trash2, ChevronRight } from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { htmlToText } from '../../utils/htmlText';
import { theme } from '../../theme/theme';

/**
 * Job postings, as on the web: list with status filters and applicant counts,
 * create / edit / open / close / delete, and a jump to each job's candidates.
 * The server allows changes only to people with the recruitment/jobs permission.
 */
type Job = {
  id: number; title: string; status: string; type: string; workLocationType?: string; experienceYears?: string;
  minSalary?: number | null; maxSalary?: number | null; totalOpenings?: number; endDate?: string | null; descriptionHtml?: string | null;
  departmentId?: number | null; designationId?: number | null; branchId?: number | null;
  department?: { name: string } | null; branch?: { name: string } | null; _count?: { applications: number }; applicants?: number;
};
const STATUSES = ['Open', 'Draft', 'Closed'];
const TYPES = ['Full Time', 'Part Time', 'Internship', 'Trainee', 'Contractual', 'Freelancer', 'Other'];
const PLACES = ['On-site', 'Remote', 'Hybrid'];
const TONE: Record<string, { bg: string; text: string }> = {
  Open: { bg: '#ECFDF5', text: '#047857' }, Draft: { bg: '#F1F5F9', text: '#475569' }, Closed: { bg: '#FEF2F2', text: '#B91C1C' },
};
const lakh = (n?: number | null) => (n ? (n >= 100000 ? `${(n / 100000).toFixed(n % 100000 ? 1 : 0)}L` : `${Math.round(n / 1000)}k`) : '');
const errMsg = (e: any) => { const m = e?.response?.data?.message; return Array.isArray(m) ? m.join('\n') : m || 'Please try again.'; };
const BLANK = { title: '', status: 'Draft', type: 'Full Time', workLocationType: 'On-site', experienceYears: '', minSalary: '', maxSalary: '', totalOpenings: '1', endDate: '', departmentId: null as number | null, branchId: null as number | null, descriptionHtml: '' };

export default function JobPostingsScreen() {
  const navigation = useNavigation<any>();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [denied, setDenied] = useState(false);
  const [status, setStatus] = useState('Open');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<(typeof BLANK & { id?: number }) | null>(null);
  const [masters, setMasters] = useState<{ departments: any[]; branches: any[] }>({ departments: [], branches: [] });

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/recruitment/jobs');
      setJobs(data || []);
      setDenied(false);
    } catch (e: any) {
      if (e?.response?.status === 403) setDenied(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const count = (j: Job) => j._count?.applications ?? j.applicants ?? 0;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((j) => (!status || j.status === status) &&
      (!q || `${j.title} ${j.department?.name || ''} ${j.branch?.name || ''} ${j.type}`.toLowerCase().includes(q)));
  }, [jobs, status, query]);

  const openForm = async (j?: Job) => {
    setForm(j ? {
      id: j.id, title: j.title, status: j.status, type: j.type, workLocationType: j.workLocationType || 'On-site',
      experienceYears: j.experienceYears || '', minSalary: j.minSalary ? String(j.minSalary) : '', maxSalary: j.maxSalary ? String(j.maxSalary) : '',
      totalOpenings: String(j.totalOpenings ?? 1), endDate: j.endDate ? String(j.endDate).slice(0, 10) : '',
      departmentId: j.departmentId ?? null, branchId: j.branchId ?? null, descriptionHtml: htmlToText(j.descriptionHtml),
    } : { ...BLANK });
    if (!masters.departments.length) {
      const [d, b] = await Promise.all([
        apiClient.get('/master-data/departments').then((r) => r.data || []).catch(() => []),
        apiClient.get('/master-data/branches').then((r) => r.data || []).catch(() => []),
      ]);
      setMasters({ departments: d, branches: b });
    }
  };

  const save = async () => {
    if (!form || !form.title.trim()) return;
    const body: any = {
      title: form.title.trim(), status: form.status, type: form.type, workLocationType: form.workLocationType,
      experienceYears: form.experienceYears || null, minSalary: form.minSalary || null, maxSalary: form.maxSalary || null,
      totalOpenings: form.totalOpenings || '1', endDate: form.endDate || null,
      departmentId: form.departmentId, branchId: form.branchId,
      // Plain text from the phone, kept as paragraphs for the web's rich-text view.
      descriptionHtml: form.descriptionHtml.trim() ? form.descriptionHtml.trim().split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('') : null,
    };
    try {
      if (form.id) await apiClient.put(`/recruitment/jobs/${form.id}`, body);
      else await apiClient.post('/recruitment/jobs', body);
      setForm(null);
      load();
    } catch (e) { Alert.alert('Could not save job', errMsg(e)); }
  };

  const setJobStatus = async (j: Job, next: string) => {
    try { await apiClient.put(`/recruitment/jobs/${j.id}`, { status: next }); load(); } catch (e) { Alert.alert('Could not update', errMsg(e)); }
  };

  const remove = (j: Job) => Alert.alert('Delete job?', `${j.title}${count(j) ? ` has ${count(j)} applicants.` : ''}`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try { await apiClient.delete(`/recruitment/jobs/${j.id}`); setForm(null); load(); } catch (e) { Alert.alert('Could not delete', errMsg(e)); }
    } },
  ]);

  if (denied) {
    return <AppScreen showBack title="Job Postings"><Text style={styles.empty}>Job postings are managed by HR and administrators.</Text></AppScreen>;
  }

  const header = (
    <View style={{ gap: 10, marginBottom: 6 }}>
      <View style={styles.kpis}>
        {STATUSES.map((s) => (
          <TouchableOpacity key={s} style={[styles.kpi, { backgroundColor: TONE[s].bg }, status === s && { borderColor: TONE[s].text }]} onPress={() => setStatus(status === s ? '' : s)}>
            <Text style={[styles.kpiNum, { color: TONE[s].text }]}>{jobs.filter((j) => j.status === s).length}</Text>
            <Text style={[styles.kpiLabel, { color: TONE[s].text }]}>{s}</Text>
          </TouchableOpacity>
        ))}
        <View style={[styles.kpi, { backgroundColor: '#EEF2FF' }]}>
          <Text style={[styles.kpiNum, { color: '#4338CA' }]}>{jobs.reduce((s, j) => s + count(j), 0)}</Text>
          <Text style={[styles.kpiLabel, { color: '#4338CA' }]}>Applicants</Text>
        </View>
      </View>
      <View style={styles.search}>
        <Search size={16} color="#94A3B8" />
        <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Search title, department, branch" placeholderTextColor="#94A3B8" autoCorrect={false} clearButtonMode="while-editing" />
      </View>
    </View>
  );

  return (
    <AppScreen
      showBack
      title="Job Postings"
      subtitle={`${jobs.filter((j) => j.status === 'Open').length} open · ${jobs.length} total`}
      right={<TouchableOpacity style={styles.primaryBtn} onPress={() => openForm()}><Plus size={15} color="#fff" /><Text style={styles.primaryText}>New</Text></TouchableOpacity>}
    >
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} /> : (
        <FlatList
          data={shown}
          keyExtractor={(j) => String(j.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>No {status ? status.toLowerCase() + ' ' : ''}jobs.</Text>}
          renderItem={({ item: j }) => {
            const tone = TONE[j.status] || TONE.Draft;
            const closing = j.endDate && j.status === 'Open' ? Math.ceil((new Date(j.endDate).getTime() - Date.now()) / 86_400_000) : null;
            return (
              <View style={styles.card}>
                <TouchableOpacity style={styles.cardTop} onPress={() => openForm(j)} activeOpacity={0.8}>
                  <View style={styles.icon}><Briefcase size={18} color="#4338CA" /></View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.name} numberOfLines={1}>{j.title}</Text>
                    <Text style={styles.sub} numberOfLines={1}>{[j.department?.name, j.type, j.experienceYears && `${j.experienceYears} yrs`].filter(Boolean).join(' · ')}</Text>
                    <Text style={styles.sub} numberOfLines={1}>
                      <MapPin size={11} color="#64748B" /> {[j.branch?.name, j.workLocationType].filter(Boolean).join(' · ') || '—'}
                      {j.minSalary || j.maxSalary ? `  ·  ₹${lakh(j.minSalary)}–${lakh(j.maxSalary)}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.pill, { backgroundColor: tone.bg, color: tone.text }]}>{j.status}</Text>
                </TouchableOpacity>
                <View style={styles.cardFoot}>
                  <TouchableOpacity style={styles.applicants} onPress={() => navigation.navigate('Candidates', { jobId: j.id, jobTitle: j.title })}>
                    <Users size={14} color="#1373E5" /><Text style={styles.applicantsText}>{count(j)} applicants</Text><ChevronRight size={14} color="#1373E5" />
                  </TouchableOpacity>
                  {closing !== null && <Text style={[styles.tiny, closing <= 3 && { color: '#B91C1C', fontWeight: '700' }]}>{closing < 0 ? 'Past end date' : `Closes in ${closing}d`}</Text>}
                  {j.status !== 'Open'
                    ? <TouchableOpacity onPress={() => setJobStatus(j, 'Open')}><Text style={styles.link}>Open</Text></TouchableOpacity>
                    : <TouchableOpacity onPress={() => setJobStatus(j, 'Closed')}><Text style={[styles.link, { color: '#B91C1C' }]}>Close</Text></TouchableOpacity>}
                </View>
              </View>
            );
          }}
        />
      )}

      <Modal visible={!!form} transparent animationType="slide" onRequestClose={() => setForm(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottom}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={[styles.sheetTitle, { flex: 1 }]}>{form?.id ? 'Edit job' : 'New job'}</Text>
              <TouchableOpacity onPress={() => setForm(null)}><X size={20} color="#334155" /></TouchableOpacity>
            </View>
            {form && (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
                <TextInput style={styles.input} value={form.title} onChangeText={(v) => setForm((f) => (f ? { ...f, title: v } : f))} placeholder="Job title *" placeholderTextColor="#94A3B8" />
                <Chips label="Status" options={STATUSES} value={form.status} onChange={(v) => setForm((f) => (f ? { ...f, status: v } : f))} />
                <Chips label="Type" options={TYPES} value={form.type} onChange={(v) => setForm((f) => (f ? { ...f, type: v } : f))} />
                <Chips label="Work location" options={PLACES} value={form.workLocationType} onChange={(v) => setForm((f) => (f ? { ...f, workLocationType: v } : f))} />
                <Chips label="Department" options={masters.departments.map((d) => d.name)} value={masters.departments.find((d) => d.id === form.departmentId)?.name || ''}
                  onChange={(v) => setForm((f) => (f ? { ...f, departmentId: masters.departments.find((d) => d.name === v)?.id ?? null } : f))} />
                <Chips label="Branch" options={masters.branches.map((b) => b.name)} value={masters.branches.find((b) => b.id === form.branchId)?.name || ''}
                  onChange={(v) => setForm((f) => (f ? { ...f, branchId: masters.branches.find((b) => b.name === v)?.id ?? null } : f))} />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput style={[styles.input, { flex: 1 }]} value={form.experienceYears} onChangeText={(v) => setForm((f) => (f ? { ...f, experienceYears: v } : f))} placeholder="Experience (e.g. 2-4)" placeholderTextColor="#94A3B8" />
                  <TextInput style={[styles.input, { flex: 1 }]} value={form.totalOpenings} onChangeText={(v) => setForm((f) => (f ? { ...f, totalOpenings: v.replace(/[^0-9]/g, '') } : f))} placeholder="Openings" keyboardType="number-pad" placeholderTextColor="#94A3B8" />
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput style={[styles.input, { flex: 1 }]} value={form.minSalary} onChangeText={(v) => setForm((f) => (f ? { ...f, minSalary: v.replace(/[^0-9]/g, '') } : f))} placeholder="Min CTC ₹/yr" keyboardType="number-pad" placeholderTextColor="#94A3B8" />
                  <TextInput style={[styles.input, { flex: 1 }]} value={form.maxSalary} onChangeText={(v) => setForm((f) => (f ? { ...f, maxSalary: v.replace(/[^0-9]/g, '') } : f))} placeholder="Max CTC ₹/yr" keyboardType="number-pad" placeholderTextColor="#94A3B8" />
                </View>
                <TextInput style={styles.input} value={form.endDate} onChangeText={(v) => setForm((f) => (f ? { ...f, endDate: v } : f))} placeholder="Closing date (YYYY-MM-DD, optional)" placeholderTextColor="#94A3B8" autoCapitalize="none" />
                <TextInput style={[styles.input, { minHeight: 120, textAlignVertical: 'top' }]} value={form.descriptionHtml} onChangeText={(v) => setForm((f) => (f ? { ...f, descriptionHtml: v } : f))} placeholder="Job description" placeholderTextColor="#94A3B8" multiline />
                <TouchableOpacity style={[styles.submit, !form.title.trim() && { opacity: 0.5 }]} disabled={!form.title.trim()} onPress={save}>
                  <Text style={styles.primaryText}>{form.id ? 'Save changes' : 'Create job'}</Text>
                </TouchableOpacity>
                {!!form.id && (
                  <TouchableOpacity style={styles.danger} onPress={() => { const j = jobs.find((x) => x.id === form.id); if (j) remove(j); }}>
                    <Trash2 size={16} color="#B91C1C" /><Text style={styles.dangerText}>Delete job</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </AppScreen>
  );
}

function Chips({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  if (!options.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {options.map((o) => (
          <TouchableOpacity key={o} style={[styles.chip, value === o && styles.chipOn]} onPress={() => onChange(o)}>
            <Text style={[styles.chipText, value === o && styles.chipTextOn]}>{o}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 120, gap: 10 },
  kpis: { flexDirection: 'row', gap: 6 },
  kpi: { flex: 1, borderRadius: 12, paddingVertical: 9, alignItems: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  kpiNum: { fontSize: 18, fontWeight: '800' },
  kpiLabel: { fontSize: 10, fontWeight: '700' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 0 },
  card: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  sub: { fontSize: 12, color: '#64748B' },
  tiny: { fontSize: 11, color: '#94A3B8', flex: 1, textAlign: 'right' },
  pill: { fontSize: 11, fontWeight: '800', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  applicants: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  applicantsText: { fontSize: 13, fontWeight: '700', color: '#1373E5' },
  link: { fontSize: 13, fontWeight: '800', color: '#047857' },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 30, paddingHorizontal: 24 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 38, borderRadius: 12, backgroundColor: '#1373E5' },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  bottom: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '92%', paddingBottom: 30 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  label: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  input: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#0F172A', backgroundColor: '#F8FAFC' },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  chipOn: { backgroundColor: '#1373E5', borderColor: '#1373E5' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  chipTextOn: { color: '#fff' },
  submit: { height: 48, borderRadius: 12, backgroundColor: '#1373E5', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  danger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: 12, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
  dangerText: { color: '#B91C1C', fontWeight: '800' },
});
