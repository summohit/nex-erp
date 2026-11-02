import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, TextInput, Modal, ScrollView,
  Alert, KeyboardAvoidingView, Platform, Linking, Image,
} from 'react-native';
import { Search, X, Phone, Mail, FileText, Link2, CalendarPlus, Check, Sparkles, ShieldCheck, UserPlus } from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { Avatar } from '../../components/PersonSheet';
import { useAuthStore } from '../../store/authStore';
import { theme } from '../../theme/theme';

/**
 * The candidate pipeline (ATS) for a phone: stage tabs with counts, search and
 * a job filter; each candidate opens to their details, interviews, a stage
 * move (with offer salary / rejection reason), salary-approval decisions,
 * interview scheduling and onboarding once hired. Offer letters and salary
 * annexures stay on the web. The server allows this only with the
 * recruitment/candidates permission and enforces the stage rules.
 */
const STAGES = ['APPLIED', 'PHONE_SCREENING', 'INTERVIEW', 'NEGOTIATION', 'OFFERED', 'HIRED', 'ONBOARDED', 'ON_HOLD', 'REJECTED'];
const LABEL: Record<string, string> = {
  APPLIED: 'Applied', PHONE_SCREENING: 'Screening', INTERVIEW: 'Interview', NEGOTIATION: 'Negotiation', OFFERED: 'Offered',
  HIRED: 'Hired', ONBOARDED: 'Onboarded', ON_HOLD: 'On hold', REJECTED: 'Rejected',
};
const TONE: Record<string, string> = {
  APPLIED: '#64748B', PHONE_SCREENING: '#0891B2', INTERVIEW: '#4F46E5', NEGOTIATION: '#D97706', OFFERED: '#7C3AED',
  HIRED: '#059669', ONBOARDED: '#047857', ON_HOLD: '#94A3B8', REJECTED: '#DC2626',
};
// Retired statuses mapped onto the current stages, as the server does.
const stageOf = (s?: string) => (s === 'NEW' ? 'APPLIED' : s === 'REVIEWING' || s === 'SHORTLISTED' ? 'PHONE_SCREENING' : s === 'INTERVIEWING' ? 'INTERVIEW' : s || 'APPLIED');
// Candidates often type CTC in lakhs ("11"); full rupee amounts are shown as they are.
const money = (n?: number | null) => {
  if (!n) return '—';
  const v = Number(n);
  return v < 1000 ? `₹${v} L` : v >= 100000 ? `₹${(v / 100000).toFixed(v % 100000 ? 1 : 0)} L` : `₹${v.toLocaleString('en-IN')}`;
};
const when = (d?: string) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
const errMsg = (e: any) => { const m = e?.response?.data?.message; return Array.isArray(m) ? m.join('\n') : m || 'Please try again.'; };
const splitName = (n: string) => { const [firstName, ...r] = (n || '').split(' '); return { firstName, lastName: r.join(' ') }; };

export default function CandidatesScreen() {
  const route = useRoute<any>();
  const role = useAuthStore((s) => s.user?.role) || '';
  const [apps, setApps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [denied, setDenied] = useState(false);
  // Start on All, so the count shown on the job matches what opens here.
  const [stage, setStage] = useState('ALL');
  const [query, setQuery] = useState('');
  const [jobId, setJobId] = useState<number | null>(route.params?.jobId ?? null);
  const [open, setOpen] = useState<any | null>(null);
  const [interviews, setInterviews] = useState<any[] | null>(null);
  const [move, setMove] = useState<{ to: string; salary: string; reason: string; joining: string; approvalReason: string } | null>(null);
  const [schedule, setSchedule] = useState<{ title: string; date: string; time: string; duration: string; interviewerId?: number; link: string } | null>(null);
  const [people, setPeople] = useState<any[]>([]);
  const [pickPerson, setPickPerson] = useState(false);
  const [pq, setPq] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/recruitment/applications');
      setApps(data || []);
      setDenied(false);
    } catch (e: any) {
      if (e?.response?.status === 403) setDenied(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const jobs = useMemo(() => {
    const m = new Map<number, string>();
    for (const a of apps) if (a.jobId) m.set(a.jobId, a.job?.title || `Job ${a.jobId}`);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [apps]);
  const inJob = useMemo(() => apps.filter((a) => !jobId || a.jobId === jobId), [apps, jobId]);
  const counts = useMemo(() => Object.fromEntries(STAGES.map((s) => [s, inJob.filter((a) => stageOf(a.status) === s).length])), [inJob]);
  const pendingApproval = inJob.filter((a) => a.approvalStatus === 'PENDING_APPROVAL').length;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inJob.filter((a) => (stage === 'ALL' ? true : stage === 'APPROVAL' ? a.approvalStatus === 'PENDING_APPROVAL' : stageOf(a.status) === stage) &&
      (!q || `${a.fullName} ${a.email || ''} ${a.phone || ''} ${a.job?.title || ''} ${a.skills || ''} ${a.currentLocation || ''}`.toLowerCase().includes(q)));
  }, [inJob, stage, query]);

  const openCandidate = (a: any) => {
    setOpen(a);
    setInterviews(null);
    apiClient.get(`/recruitment/applications/${a.id}/interviews`).then((r) => setInterviews(r.data || [])).catch(() => setInterviews([]));
  };

  const refreshOpen = async (id: number) => {
    await load();
    const { data } = await apiClient.get(`/recruitment/applications/${id}`).catch(() => ({ data: null }));
    if (data) setOpen(data);
  };

  const doMove = async () => {
    if (!open || !move) return;
    const body: any = { status: move.to };
    if (move.to === 'OFFERED' && move.salary) body.offeredSalary = Number(move.salary);
    if (move.to === 'REJECTED') body.rejectionReason = move.reason.trim();
    if ((move.to === 'OFFERED' || move.to === 'HIRED') && move.joining) body.joiningDate = move.joining;
    if (move.approvalReason.trim()) body.approvalReason = move.approvalReason.trim();
    try {
      const { data } = await apiClient.put(`/recruitment/applications/${open.id}/status`, body);
      setMove(null);
      if (data?.approvalStatus === 'PENDING_APPROVAL') Alert.alert('Sent for approval', 'The offer is above budget and waits for salary approval.');
      refreshOpen(open.id);
    } catch (e) { Alert.alert('Could not move candidate', errMsg(e)); }
  };

  const decideSalary = async (approve: boolean) => {
    if (!open) return;
    try {
      await apiClient.post(`/recruitment/applications/${open.id}/${approve ? 'approve' : 'reject'}-salary`, {});
      refreshOpen(open.id);
    } catch (e) { Alert.alert('Could not save', errMsg(e)); }
  };

  const onboard = () => open && Alert.alert('Onboard candidate?', `Creates an employee account for ${open.fullName} and starts onboarding.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Onboard', onPress: async () => {
      try { await apiClient.post(`/recruitment/applications/${open.id}/onboard`, {}); refreshOpen(open.id); Alert.alert('Onboarded', `${open.fullName} now has an employee account.`); }
      catch (e) { Alert.alert('Could not onboard', errMsg(e)); }
    } },
  ]);

  const openSchedule = async () => {
    const t = new Date(Date.now() + 86_400_000);
    setSchedule({ title: 'Technical interview', date: t.toISOString().slice(0, 10), time: '11:00', duration: '45', link: '' });
    if (!people.length) {
      const { data } = await apiClient.get('/employees/basic-list').catch(() => ({ data: [] }));
      setPeople(data || []);
    }
  };

  const doSchedule = async () => {
    if (!open || !schedule) return;
    try {
      await apiClient.post(`/recruitment/applications/${open.id}/interviews`, {
        title: schedule.title.trim(), scheduledAt: `${schedule.date}T${schedule.time}`, durationMins: Number(schedule.duration) || 45,
        interviewerId: schedule.interviewerId, locationUrl: schedule.link.trim() || undefined,
      });
      setSchedule(null);
      openCandidate(open);
    } catch (e) { Alert.alert('Could not schedule', errMsg(e)); }
  };

  if (denied) {
    return <AppScreen showBack title="Candidates"><Text style={styles.empty}>Candidates are managed by HR and administrators.</Text></AppScreen>;
  }

  const header = (
    <View style={{ gap: 10, marginBottom: 6 }}>
      <View style={styles.search}>
        <Search size={16} color="#94A3B8" />
        <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Search name, email, phone, skills" placeholderTextColor="#94A3B8" autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        <TouchableOpacity style={[styles.chip, !jobId && styles.chipOn]} onPress={() => { setJobId(null); setStage('ALL'); }}>
          <Text style={[styles.chipText, !jobId && styles.chipTextOn]}>All jobs</Text>
        </TouchableOpacity>
        {[...jobs].sort((x, y) => Number(y[0] === jobId) - Number(x[0] === jobId)).map(([id, title]) => (
          <TouchableOpacity key={id} style={[styles.chip, jobId === id && styles.chipOn]} onPress={() => { setJobId(id); setStage('ALL'); }}>
            <Text style={[styles.chipText, jobId === id && styles.chipTextOn]} numberOfLines={1}>{title}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {pendingApproval > 0 && (
          <TouchableOpacity style={[styles.stageTab, stage === 'APPROVAL' && { backgroundColor: '#B45309', borderColor: '#B45309' }]} onPress={() => setStage('APPROVAL')}>
            <Text style={[styles.stageText, stage === 'APPROVAL' && { color: '#fff' }]}>Needs approval {pendingApproval}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.stageTab, stage === 'ALL' && { backgroundColor: '#0F172A', borderColor: '#0F172A' }]} onPress={() => setStage('ALL')}>
          <Text style={[styles.stageText, stage === 'ALL' && { color: '#fff' }]}>All {inJob.length}</Text>
        </TouchableOpacity>
        {STAGES.map((s) => {
          const n = counts[s] || 0;
          return (
            <TouchableOpacity
              key={s}
              disabled={!n}
              style={[styles.stageTab, !n && styles.stageEmpty, stage === s && { backgroundColor: TONE[s], borderColor: TONE[s] }]}
              onPress={() => setStage(s)}
            >
              <Text style={[styles.stageText, !n && styles.stageTextEmpty, stage === s && { color: '#fff' }]}>{LABEL[s]} {n}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );

  const cur = open ? stageOf(open.status) : '';

  return (
    <AppScreen showBack title="Candidates" subtitle={`${inJob.length} candidates${route.params?.jobTitle && jobId === route.params?.jobId ? ` · ${route.params.jobTitle}` : ''}`}>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} /> : (
        <FlatList
          data={shown}
          keyExtractor={(a) => String(a.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>No candidates here.</Text>}
          renderItem={({ item: a }) => (
            <TouchableOpacity style={styles.card} onPress={() => openCandidate(a)} activeOpacity={0.85}>
              <Avatar person={{ id: a.id, ...splitName(a.fullName), avatarUrl: a.photoUrl }} size={42} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name} numberOfLines={1}>{a.fullName}</Text>
                <Text style={styles.sub} numberOfLines={1}>{a.job?.title}{a.experienceYears ? ` · ${a.experienceYears} yrs` : ''}{a.currentLocation ? ` · ${a.currentLocation}` : ''}</Text>
                <Text style={styles.sub} numberOfLines={1}>Expects {money(a.expectedCtc)}{a.noticePeriod ? ` · notice ${a.noticePeriod}` : ''}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                {a.isAiScored && a.aiScore != null && <View style={styles.ai}><Sparkles size={10} color="#7C3AED" /><Text style={styles.aiText}>{a.aiScore}</Text></View>}
                {a.approvalStatus === 'PENDING_APPROVAL' && <Text style={styles.warn}>Approval</Text>}
                {stage === 'ALL' && (
                  <Text style={[styles.stagePill, { color: TONE[stageOf(a.status)], backgroundColor: TONE[stageOf(a.status)] + '1A' }]}>{LABEL[stageOf(a.status)]}</Text>
                )}
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Candidate detail */}
      <Modal visible={!!open && !move && !schedule} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <View style={styles.bottom}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              {open?.photoUrl ? <Image source={{ uri: open.photoUrl }} style={styles.photo} /> : <Avatar person={open ? { id: open.id, ...splitName(open.fullName) } : null} size={44} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>{open?.fullName}</Text>
                <Text style={styles.sub}>{open?.job?.title}</Text>
              </View>
              <TouchableOpacity onPress={() => setOpen(null)}><X size={20} color="#334155" /></TouchableOpacity>
            </View>
            {open && (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[styles.pill, { backgroundColor: TONE[cur] + '22', color: TONE[cur] }]}>{LABEL[cur]}</Text>
                  {open.approvalStatus && open.approvalStatus !== 'NONE' && <Text style={styles.sub}>Salary: {String(open.approvalStatus).replace(/_/g, ' ').toLowerCase()}</Text>}
                </View>
                <View style={styles.contact}>
                  {!!open.phone && <TouchableOpacity style={styles.cBtn} onPress={() => Linking.openURL(`tel:${open.phone}`)}><Phone size={15} color="#059669" /><Text style={styles.cText}>Call</Text></TouchableOpacity>}
                  {!!open.email && <TouchableOpacity style={styles.cBtn} onPress={() => Linking.openURL(`mailto:${open.email}`)}><Mail size={15} color="#1373E5" /><Text style={styles.cText}>Email</Text></TouchableOpacity>}
                  {!!open.resumeUrl && <TouchableOpacity style={styles.cBtn} onPress={() => Linking.openURL(open.resumeUrl)}><FileText size={15} color="#4F46E5" /><Text style={styles.cText}>Resume</Text></TouchableOpacity>}
                  {!!open.linkedinUrl && <TouchableOpacity style={styles.cBtn} onPress={() => Linking.openURL(open.linkedinUrl)}><Link2 size={15} color="#0A66C2" /><Text style={styles.cText}>LinkedIn</Text></TouchableOpacity>}
                </View>
                {[
                  ['Email', open.email], ['Phone', open.phone], ['Experience', open.experienceYears && `${open.experienceYears} yrs`],
                  ['Current CTC', open.currentCtc && money(open.currentCtc)], ['Expected CTC', open.expectedCtc && money(open.expectedCtc)],
                  ['Offered', open.offeredSalary && money(open.offeredSalary)], ['Notice', open.noticePeriod], ['Location', open.currentLocation],
                  ['Skills', open.skills], ['Source', open.source], ['Joining', open.joiningDate && String(open.joiningDate).slice(0, 10)],
                  ['Rejected because', open.rejectionReason],
                ].filter(([, v]) => v).map(([k, v]) => (
                  <View key={k as string} style={styles.field}><Text style={styles.fKey}>{k}</Text><Text style={styles.fVal}>{String(v)}</Text></View>
                ))}
                {!!open.aiSummary && <Text style={styles.summary}><Text style={{ fontWeight: '800' }}>AI summary: </Text>{open.aiSummary}</Text>}

                {open.approvalStatus === 'PENDING_APPROVAL' && (
                  <View style={styles.approval}>
                    <ShieldCheck size={16} color="#B45309" />
                    <Text style={[styles.sub, { flex: 1, color: '#92400E' }]}>Offer of {money(open.offeredSalary)} is above budget{open.approvalReason ? `: ${open.approvalReason}` : ''}.</Text>
                    <TouchableOpacity onPress={() => decideSalary(false)}><Text style={[styles.link, { color: '#B91C1C' }]}>Reject</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => decideSalary(true)}><Text style={styles.link}>Approve</Text></TouchableOpacity>
                  </View>
                )}

                <Text style={styles.section}>MOVE TO</Text>
                <View style={styles.wrap}>
                  {STAGES.filter((s) => s !== cur && s !== 'ONBOARDED').map((s) => (
                    <TouchableOpacity key={s} style={[styles.moveChip, { borderColor: TONE[s] }]} onPress={() => setMove({ to: s, salary: open.offeredSalary ? String(open.offeredSalary) : '', reason: '', joining: open.joiningDate ? String(open.joiningDate).slice(0, 10) : '', approvalReason: '' })}>
                      <Text style={[styles.moveText, { color: TONE[s] }]}>{LABEL[s]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {cur === 'HIRED' && (
                  <TouchableOpacity style={styles.submit} onPress={onboard}><UserPlus size={16} color="#fff" /><Text style={styles.primaryText}>Onboard as employee</Text></TouchableOpacity>
                )}

                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[styles.section, { flex: 1 }]}>INTERVIEWS</Text>
                  <TouchableOpacity style={styles.addBtn} onPress={openSchedule}><CalendarPlus size={14} color="#1373E5" /><Text style={styles.link}>Schedule</Text></TouchableOpacity>
                </View>
                {interviews === null ? <ActivityIndicator color={theme.colors.primary} /> : interviews.length ? interviews.map((iv) => (
                  <View key={iv.id} style={styles.iv}>
                    <Text style={styles.name}>{iv.title}</Text>
                    <Text style={styles.sub}>{when(iv.scheduledAt)} · {iv.durationMins || 45} min · {iv.interviewer ? `${iv.interviewer.firstName} ${iv.interviewer.lastName || ''}` : 'No interviewer'}</Text>
                    <Text style={styles.sub}>{String(iv.status).toLowerCase()}{iv.rating ? ` · ${'★'.repeat(iv.rating)}` : ''}</Text>
                    {!!iv.feedback && <Text style={styles.summary}>{iv.feedback}</Text>}
                  </View>
                )) : <Text style={styles.sub}>No interviews yet.</Text>}
                <Text style={styles.tiny}>Offer letters and salary annexures are prepared on the web.</Text>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Stage move */}
      <Modal visible={!!move} transparent animationType="fade" onRequestClose={() => setMove(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.center}>
          <View style={styles.dialog}>
            <Text style={styles.sheetTitle}>Move to {move ? LABEL[move.to] : ''}</Text>
            {move?.to === 'OFFERED' && (
              <>
                <TextInput style={styles.input} value={move.salary} onChangeText={(v) => setMove((m) => (m ? { ...m, salary: v.replace(/[^0-9]/g, '') } : m))} placeholder="Offered annual CTC ₹" keyboardType="number-pad" placeholderTextColor="#94A3B8" />
                <TextInput style={styles.input} value={move.approvalReason} onChangeText={(v) => setMove((m) => (m ? { ...m, approvalReason: v } : m))} placeholder="Why, if above budget (optional)" placeholderTextColor="#94A3B8" />
              </>
            )}
            {(move?.to === 'OFFERED' || move?.to === 'HIRED') && (
              <TextInput style={styles.input} value={move.joining} onChangeText={(v) => setMove((m) => (m ? { ...m, joining: v } : m))} placeholder="Joining date YYYY-MM-DD" placeholderTextColor="#94A3B8" autoCapitalize="none" />
            )}
            {move?.to === 'REJECTED' && (
              <TextInput style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} value={move.reason} onChangeText={(v) => setMove((m) => (m ? { ...m, reason: v } : m))} placeholder="Reason" placeholderTextColor="#94A3B8" multiline />
            )}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={[styles.secondary, { flex: 1 }]} onPress={() => setMove(null)}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity
                style={[styles.submit, { flex: 1, marginTop: 0 }, ((move?.to === 'REJECTED' && !move.reason.trim()) || (move?.to === 'OFFERED' && !move.salary)) && { opacity: 0.5 }]}
                disabled={(move?.to === 'REJECTED' && !move.reason.trim()) || (move?.to === 'OFFERED' && !move.salary)}
                onPress={doMove}
              >
                <Text style={styles.primaryText}>Move</Text>
              </TouchableOpacity>
            </View>
            {role !== 'SUPERADMIN' && open?.offerLetter?.status === 'ACCEPTED' && (move?.to === 'ON_HOLD' || move?.to === 'REJECTED') && (
              <Text style={[styles.tiny, { color: '#B91C1C' }]}>The offer is signed: only a Super Admin can do this.</Text>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Schedule interview */}
      <Modal visible={!!schedule} transparent animationType="slide" onRequestClose={() => setSchedule(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottom}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={[styles.sheetTitle, { flex: 1 }]}>Schedule interview</Text>
              <TouchableOpacity onPress={() => setSchedule(null)}><X size={20} color="#334155" /></TouchableOpacity>
            </View>
            {schedule && (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
                <TextInput style={styles.input} value={schedule.title} onChangeText={(v) => setSchedule((s) => (s ? { ...s, title: v } : s))} placeholder="Title" placeholderTextColor="#94A3B8" />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput style={[styles.input, { flex: 1.3 }]} value={schedule.date} onChangeText={(v) => setSchedule((s) => (s ? { ...s, date: v } : s))} placeholder="YYYY-MM-DD" placeholderTextColor="#94A3B8" autoCapitalize="none" />
                  <TextInput style={[styles.input, { flex: 1 }]} value={schedule.time} onChangeText={(v) => setSchedule((s) => (s ? { ...s, time: v } : s))} placeholder="HH:mm" placeholderTextColor="#94A3B8" autoCapitalize="none" />
                  <TextInput style={[styles.input, { flex: 0.8 }]} value={schedule.duration} onChangeText={(v) => setSchedule((s) => (s ? { ...s, duration: v.replace(/[^0-9]/g, '') } : s))} placeholder="Min" keyboardType="number-pad" placeholderTextColor="#94A3B8" />
                </View>
                <TouchableOpacity style={styles.input} onPress={() => setPickPerson(true)}>
                  <Text style={{ fontSize: 14, color: schedule.interviewerId ? '#0F172A' : '#94A3B8' }}>
                    {(() => { const p = people.find((x) => x.id === schedule.interviewerId); return p ? `${p.firstName} ${p.lastName || ''}` : 'Interviewer'; })()}
                  </Text>
                </TouchableOpacity>
                <TextInput style={styles.input} value={schedule.link} onChangeText={(v) => setSchedule((s) => (s ? { ...s, link: v } : s))} placeholder="Meeting link or room (optional)" placeholderTextColor="#94A3B8" autoCapitalize="none" />
                <Text style={styles.tiny}>Time is India time (IST).</Text>
                <TouchableOpacity style={[styles.submit, !schedule.title.trim() && { opacity: 0.5 }]} disabled={!schedule.title.trim()} onPress={doSchedule}>
                  <Text style={styles.primaryText}>Schedule</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
        <Modal visible={pickPerson} transparent animationType="slide" onRequestClose={() => setPickPerson(false)}>
          <TouchableOpacity style={styles.bottom} activeOpacity={1} onPress={() => setPickPerson(false)}>
            <TouchableOpacity activeOpacity={1} style={[styles.sheet, { maxHeight: '75%' }]}>
              <View style={[styles.search, { margin: 12 }]}>
                <Search size={16} color="#94A3B8" />
                <TextInput style={styles.searchInput} value={pq} onChangeText={setPq} placeholder="Find interviewer" placeholderTextColor="#94A3B8" autoCorrect={false} />
              </View>
              <ScrollView keyboardShouldPersistTaps="handled">
                {people.filter((p) => !pq.trim() || `${p.firstName} ${p.lastName || ''}`.toLowerCase().includes(pq.trim().toLowerCase()))
                  .map((p) => (
                    <TouchableOpacity key={p.id} style={styles.option} onPress={() => { setSchedule((s) => (s ? { ...s, interviewerId: p.id } : s)); setPickPerson(false); setPq(''); }}>
                      <Avatar person={p} size={30} />
                      <Text style={[styles.name, { flex: 1, fontWeight: '600' }]}>{p.firstName} {p.lastName || ''}</Text>
                      {schedule?.interviewerId === p.id && <Check size={16} color="#1373E5" />}
                    </TouchableOpacity>
                  ))}
              </ScrollView>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </Modal>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 120, gap: 8 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 0 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', maxWidth: 200 },
  chipOn: { backgroundColor: '#0F172A', borderColor: '#0F172A' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  chipTextOn: { color: '#fff' },
  stageTab: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  stageEmpty: { backgroundColor: '#F8FAFC', borderStyle: 'dashed' },
  stageTextEmpty: { color: '#CBD5E1' },
  stageText: { fontSize: 12, fontWeight: '800', color: '#334155' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 12 },
  name: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  sub: { fontSize: 12, color: '#64748B' },
  tiny: { fontSize: 11, color: '#94A3B8' },
  ai: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#F5F3FF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  aiText: { fontSize: 11, fontWeight: '800', color: '#7C3AED' },
  stagePill: { fontSize: 10, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  warn: { fontSize: 10, fontWeight: '800', color: '#B45309', backgroundColor: '#FEF3C7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 30, paddingHorizontal: 24 },
  bottom: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '90%', paddingBottom: 30 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  photo: { width: 44, height: 44, borderRadius: 22 },
  pill: { fontSize: 12, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  contact: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 36, borderRadius: 10, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' },
  cText: { fontSize: 13, fontWeight: '700', color: '#334155' },
  field: { flexDirection: 'row', gap: 10 },
  fKey: { width: 110, fontSize: 12, color: '#64748B' },
  fVal: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0F172A' },
  summary: { fontSize: 13, lineHeight: 19, color: '#334155' },
  approval: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A' },
  link: { fontSize: 13, fontWeight: '800', color: '#047857' },
  section: { fontSize: 11, fontWeight: '800', color: '#64748B', letterSpacing: 0.6, marginTop: 4 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  moveChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5, backgroundColor: '#fff' },
  moveText: { fontSize: 12, fontWeight: '800' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iv: { padding: 12, borderRadius: 12, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', gap: 2 },
  center: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 20 },
  dialog: { backgroundColor: '#fff', borderRadius: 20, padding: 18, gap: 12 },
  input: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#0F172A', backgroundColor: '#F8FAFC', justifyContent: 'center' },
  submit: { flexDirection: 'row', gap: 6, height: 48, borderRadius: 12, backgroundColor: '#1373E5', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  secondary: { height: 48, borderRadius: 12, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#334155', fontWeight: '700' },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
});
