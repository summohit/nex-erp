import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useAuthStore } from '../../store/authStore';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { Mail, Phone, FileText, ChevronRight, UserRound, Pencil, History } from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { Avatar } from '../../components/PersonSheet';
import { htmlToText } from '../../utils/htmlText';
import { theme } from '../../theme/theme';

/**
 * Read-only employee profile, the directory's detail page. Tabs follow the
 * web profile: Work, Personal, Contacts, Documents. Bank, passport and other
 * identity numbers stay on the web. When the server refuses the full profile,
 * the directory's own row is shown instead.
 */
type Tab = 'WORK' | 'PERSONAL' | 'CONTACTS' | 'DOCUMENTS' | 'HISTORY';
const TABS: { key: Tab; label: string }[] = [
  { key: 'WORK', label: 'Work' },
  { key: 'PERSONAL', label: 'Personal' },
  { key: 'CONTACTS', label: 'Contacts' },
  { key: 'DOCUMENTS', label: 'Docs' },
  { key: 'HISTORY', label: 'History' },
];

const nameOf = (v: any) => (typeof v === 'string' ? v : v?.name) || null;
const fullName = (p: any) => `${p?.firstName || ''} ${p?.lastName || ''}`.trim();
const date = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null;
const pretty = (v?: string | null) => (v ? String(v).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null);
const tenure = (d?: string | null) => {
  if (!d) return null;
  const months = Math.floor((Date.now() - new Date(d).getTime()) / (30.44 * 86_400_000));
  if (months < 1) return 'Joined this month';
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y && `${y} yr${y > 1 ? 's' : ''}`, m && `${m} mo`].filter(Boolean).join(' ');
};

function Fields({ rows }: { rows: [string, string | number | null | undefined][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!shown.length) return <Text style={styles.none}>Nothing recorded.</Text>;
  return (
    <View style={styles.fields}>
      {shown.map(([k, v]) => (
        <View key={k} style={styles.field}>
          <Text style={styles.fieldKey}>{k}</Text>
          <Text style={styles.fieldVal}>{String(v)}</Text>
        </View>
      ))}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function EmployeeProfileScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { id, person } = route.params || {};
  const [p, setP] = useState<any>(person || null);
  const [limited, setLimited] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('WORK');

  const [history, setHistory] = useState<any[] | null>(null);
  const role = useAuthStore((st) => st.user?.role);

  // Reload on every return, so edits made on the Edit screen show at once.
  useFocusEffect(useCallback(() => {
    apiClient.get(`/employees/${id}/profile`)
      .then(({ data }) => { setP(data); setLimited(false); })
      .catch(() => setLimited(true))
      .finally(() => setLoading(false));
    apiClient.get(`/employees/${id}/history`).then(({ data }) => setHistory(data || [])).catch(() => setHistory(null));
  }, [id]));

  // The server has the final say on every save; this only decides whether to offer Edit.
  const canEdit = !limited && (['SUPERADMIN', 'ADMIN', 'HR'].includes(String(role)) || !!p?.canManageDocuments || !!p?.isOwner);

  const email = p?.user?.email || p?.email;
  const phone = p?.phone;
  const docs: any[] = p?.documents || [];
  const contacts: any[] = p?.emergencyContacts || [];
  const skills: any[] = p?.skills || [];
  const resume: any[] = p?.resumeLines || [];

  return (
    <AppScreen
      showBack
      title={fullName(p) || 'Employee'}
      subtitle={p?.employeeCode ? `#${p.employeeCode}` : 'Profile'}
      right={canEdit ? (
        <TouchableOpacity style={styles.editBtn} onPress={() => navigation.navigate('EmployeeEdit', { employeeId: id })} activeOpacity={0.8}>
          <Pencil size={15} color="#fff" />
          <Text style={styles.editText}>Edit</Text>
        </TouchableOpacity>
      ) : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Avatar person={p} size={88} />
          <Text style={styles.name}>{fullName(p)}</Text>
          <Text style={styles.role}>{[nameOf(p?.designation), nameOf(p?.department)].filter(Boolean).join(' · ') || '—'}</Text>
          <View style={styles.tags}>
            {!!nameOf(p?.branch) && <Text style={styles.tag}>{nameOf(p?.branch)}</Text>}
            {!!p?.joiningDate && <Text style={styles.tag}>{tenure(p.joiningDate)}</Text>}
            {p?.offboardingStatus === 'SEPARATED' && <Text style={[styles.tag, styles.tagGrey]}>Left</Text>}
          </View>
          <View style={styles.actions}>
            {!!email && (
              <TouchableOpacity style={styles.action} onPress={() => Linking.openURL(`mailto:${email}`)}>
                <Mail size={16} color="#1373E5" /><Text style={styles.actionText}>Email</Text>
              </TouchableOpacity>
            )}
            {!!phone && (
              <TouchableOpacity style={styles.action} onPress={() => Linking.openURL(`tel:${phone}`)}>
                <Phone size={16} color="#059669" /><Text style={[styles.actionText, { color: '#047857' }]}>Call</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {loading ? <ActivityIndicator style={{ marginTop: 20 }} color={theme.colors.primary} /> : limited ? (
          <Section title="Profile">
            <Fields rows={[['Email', email], ['Employee code', p?.employeeCode], ['Branch', nameOf(p?.branch)]]} />
            <Text style={styles.note}>Full profiles are visible to HR and admins.</Text>
          </Section>
        ) : (
          <>
            <View style={styles.tabs}>
              {TABS.map((t) => (
                <TouchableOpacity key={t.key} style={[styles.tab, tab === t.key && styles.tabOn]} onPress={() => setTab(t.key)}>
                  <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {tab === 'WORK' && (
              <>
                <Section title="Employment">
                  <Fields rows={[
                    ['Employee code', p?.employeeCode],
                    ['Designation', nameOf(p?.designation)],
                    ['Department', nameOf(p?.department)],
                    ['Branch', nameOf(p?.branch)],
                    ['Work location', p?.workLocation],
                    ['Employment type', pretty(p?.employmentType)],
                    ['Category', pretty(p?.employmentCategory)],
                    ['Role', pretty(p?.user?.role)],
                    ['Joined', date(p?.joiningDate)],
                    ['Probation ends', p?.probationConfirmedAt ? `Confirmed ${date(p.probationConfirmedAt)}` : date(p?.probationEndDate)],
                    ['Shift', p?.shift ? `${p.shift.name}${p.shift.startTime ? ` (${p.shift.startTime}–${p.shift.endTime})` : ''}` : null],
                    ['Onboarding', pretty(p?.onboardingStatus)],
                  ]} />
                </Section>
                {p?.manager && (
                  <Section title="Reports to">
                    <TouchableOpacity style={styles.person} onPress={() => navigation.push('EmployeeProfile', { id: p.manager.id, person: p.manager })}>
                      <Avatar person={p.manager} size={40} />
                      <Text style={styles.personName}>{fullName(p.manager)}</Text>
                      <ChevronRight size={18} color="#94A3B8" />
                    </TouchableOpacity>
                  </Section>
                )}
                {!!p?.about && <Section title="About"><Text style={styles.body}>{htmlToText(p.about)}</Text></Section>}
                {skills.length > 0 && (
                  <Section title="Skills">
                    <View style={styles.skillWrap}>
                      {skills.map((s) => <Text key={s.id} style={styles.skill}>{s.name}{s.level ? ` · ${s.level}` : ''}</Text>)}
                    </View>
                  </Section>
                )}
                {resume.length > 0 && (
                  <Section title="Experience & education">
                    {resume.map((r) => (
                      <View key={r.id} style={styles.resume}>
                        <Text style={styles.resumeTitle}>{r.title}</Text>
                        <Text style={styles.resumeSub}>{[r.organization, r.type].filter(Boolean).join(' · ')}</Text>
                        {(r.startDate || r.endDate) && <Text style={styles.resumeSub}>{r.startDate || '?'} – {r.endDate || 'Present'}</Text>}
                      </View>
                    ))}
                  </Section>
                )}
              </>
            )}

            {tab === 'PERSONAL' && (
              <Section title="Personal">
                <Fields rows={[
                  ['Gender', pretty(p?.gender)],
                  ['Date of birth', date(p?.dateOfBirth)],
                  ['Marital status', pretty(p?.maritalStatus)],
                  ['Nationality', p?.nationality],
                  ['Language', p?.language],
                  ['Education', [p?.educationLevel, p?.fieldOfStudy].filter(Boolean).join(', ') || null],
                  ['City', [p?.city, p?.state, p?.country].filter(Boolean).join(', ') || null],
                  ['Address', p?.address],
                ]} />
              </Section>
            )}

            {tab === 'CONTACTS' && (
              <>
                <Section title="Contact">
                  <Fields rows={[['Work email', email], ['Phone', phone]]} />
                </Section>
                <Section title="Emergency contacts">
                  {contacts.length ? contacts.map((c) => (
                    <View key={c.id} style={styles.person}>
                      <View style={styles.contactIcon}><UserRound size={18} color="#64748B" /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.personName}>{c.name}</Text>
                        <Text style={styles.resumeSub}>{[c.relationship, c.mobile].filter(Boolean).join(' · ')}</Text>
                      </View>
                      {!!c.mobile && (
                        <TouchableOpacity style={styles.iconBtn} onPress={() => Linking.openURL(`tel:${c.mobile}`)}>
                          <Phone size={16} color="#059669" />
                        </TouchableOpacity>
                      )}
                    </View>
                  )) : <Text style={styles.none}>No emergency contacts.</Text>}
                </Section>
              </>
            )}

            {tab === 'HISTORY' && (
              <Section title="Employment history">
                {history?.length ? history.map((h, i) => (
                  <View key={`${h.type}-${i}`} style={styles.event}>
                    <View style={styles.eventDot}><History size={14} color="#4F46E5" /></View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.resumeTitle}>{h.label}</Text>
                      {!!h.detail && <Text style={styles.resumeSub}>{h.detail}</Text>}
                      {(h.facts || []).map((f: any) => (
                        <Text key={f.label} style={styles.fact}>{f.label}: <Text style={styles.factVal}>{f.value}</Text></Text>
                      ))}
                      <Text style={styles.when}>{date(h.at)}</Text>
                    </View>
                  </View>
                )) : <Text style={styles.none}>{history === null ? 'History is visible to HR and admins.' : 'No history yet.'}</Text>}
              </Section>
            )}

            {tab === 'DOCUMENTS' && (
              <Section title={`Documents · ${docs.length}`}>
                {docs.length ? docs.map((d) => (
                  <TouchableOpacity key={d.id} style={styles.doc} onPress={() => Linking.openURL(d.fileUrl)}>
                    <FileText size={18} color="#4F46E5" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.docName} numberOfLines={1}>{d.fileName}</Text>
                      {!!d.documentType && <Text style={styles.resumeSub}>{d.documentType}</Text>}
                    </View>
                    <ChevronRight size={16} color="#94A3B8" />
                  </TouchableOpacity>
                )) : <Text style={styles.none}>No documents, or you cannot see them.</Text>}
              </Section>
            )}
          </>
        )}
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 120, gap: 12 },
  hero: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#E2E8F0', padding: 20, gap: 4 },
  name: { fontSize: 21, fontWeight: '800', color: '#0F172A', marginTop: 10, textAlign: 'center' },
  role: { fontSize: 14, color: '#475569', textAlign: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 6 },
  tag: { fontSize: 12, fontWeight: '700', color: '#1D4ED8', backgroundColor: '#EFF6FF', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  tagGrey: { color: '#64748B', backgroundColor: '#F1F5F9' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, height: 40, borderRadius: 12, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' },
  actionText: { fontSize: 14, fontWeight: '700', color: '#1373E5' },
  tabs: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 14, padding: 4, gap: 4 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10 },
  tabOn: { backgroundColor: '#fff' },
  tabText: { fontSize: 13, fontWeight: '700', color: '#64748B' },
  tabTextOn: { color: '#0F172A' },
  card: { backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  fields: { gap: 10 },
  field: { flexDirection: 'row', gap: 12 },
  fieldKey: { width: 120, fontSize: 13, color: '#64748B' },
  fieldVal: { flex: 1, fontSize: 14, fontWeight: '600', color: '#0F172A' },
  none: { fontSize: 13, color: '#94A3B8' },
  note: { fontSize: 12, color: '#94A3B8', marginTop: 4 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  personName: { flex: 1, fontSize: 15, fontWeight: '700', color: '#0F172A' },
  contactIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' },
  body: { fontSize: 14, lineHeight: 21, color: '#334155' },
  skillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  skill: { fontSize: 12, fontWeight: '600', color: '#4338CA', backgroundColor: '#EEF2FF', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: 'hidden' },
  resume: { paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9', gap: 2 },
  resumeTitle: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  resumeSub: { fontSize: 12, color: '#64748B' },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 38, borderRadius: 12, backgroundColor: '#1373E5' },
  editText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  event: { flexDirection: 'row', gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  eventDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },
  fact: { fontSize: 12, color: '#64748B' },
  factVal: { color: '#0F172A', fontWeight: '600' },
  when: { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  doc: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' },
  docName: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
});
