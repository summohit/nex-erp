import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useAuthStore } from '../../store/authStore';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import {
  Mail,
  Phone,
  FileText,
  ChevronRight,
  UserRound,
  Pencil,
  History,
  Settings2,
  MapPin,
  Calendar,
  Briefcase,
  Building2,
  Clock,
  Shield,
  GraduationCap,
  Sparkles,
} from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { Avatar } from '../../components/PersonSheet';
import { htmlToText } from '../../utils/htmlText';
import { theme } from '../../theme/theme';

/**
 * Read-only employee profile, the directory's detail page. Tabs follow the
 * web profile: Work, Personal, Contacts, Documents, History.
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
const pretty = (v?: string | null) =>
  v ? String(v).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null;

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
      {shown.map(([k, v], idx) => (
        <View key={k} style={[styles.fieldRow, idx < shown.length - 1 && styles.fieldRowBorder]}>
          <Text style={styles.fieldKey}>{k}</Text>
          <Text style={styles.fieldVal} numberOfLines={2}>
            {String(v)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon?: any; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        {Icon && (
          <View style={styles.cardHeaderIcon}>
            <Icon size={15} color="#1373E5" strokeWidth={2.4} />
          </View>
        )}
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
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

  useFocusEffect(
    useCallback(() => {
      apiClient
        .get(`/employees/${id}/profile`)
        .then(({ data }) => {
          setP(data);
          setLimited(false);
        })
        .catch(() => setLimited(true))
        .finally(() => setLoading(false));

      apiClient
        .get(`/employees/${id}/history`)
        .then(({ data }) => setHistory(data || []))
        .catch(() => setHistory(null));
    }, [id])
  );

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
      headerAvatar={<Avatar person={p} size={38} />}
      title={fullName(p) || 'Employee'}
      subtitle={p?.employeeCode ? `#${p.employeeCode}` : 'Profile'}
      right={
        canEdit ? (
          <TouchableOpacity
            style={styles.headerEditBtn}
            onPress={() => navigation.navigate('EmployeeEdit', { employeeId: id })}
            activeOpacity={0.8}
            accessibilityLabel="Edit employee"
          >
            <Pencil size={14} color="#FFFFFF" strokeWidth={2.4} />
            <Text style={styles.headerEditText}>Edit</Text>
          </TouchableOpacity>
        ) : undefined
      }
    >
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Profile Hero Card */}
        <View style={styles.heroCard}>
          <View style={styles.avatarWrapper}>
            <Avatar person={p} size={92} />
          </View>

          <Text style={styles.heroName}>{fullName(p)}</Text>
          <Text style={styles.heroRole}>
            {[nameOf(p?.designation), nameOf(p?.department)].filter(Boolean).join(' · ') || '—'}
          </Text>

          {/* Badges Strip */}
          <View style={styles.tagsRow}>
            {!!nameOf(p?.branch) && (
              <View style={styles.tagPill}>
                <MapPin size={11} color="#1D4ED8" strokeWidth={2.4} />
                <Text style={styles.tagPillText}>{nameOf(p?.branch)}</Text>
              </View>
            )}
            {!!p?.joiningDate && (
              <View style={[styles.tagPill, styles.tagPillIndigo]}>
                <Calendar size={11} color="#4338CA" strokeWidth={2.4} />
                <Text style={[styles.tagPillText, styles.tagPillIndigoText]}>{tenure(p.joiningDate)}</Text>
              </View>
            )}
            {p?.offboardingStatus === 'SEPARATED' && (
              <View style={[styles.tagPill, styles.tagPillGrey]}>
                <Text style={[styles.tagPillText, styles.tagPillGreyText]}>Left</Text>
              </View>
            )}
            {String(p?.user?.status).toUpperCase() === 'SUSPENDED' && (
              <View style={[styles.tagPill, styles.tagPillRed]}>
                <Text style={[styles.tagPillText, styles.tagPillRedText]}>Deactivated</Text>
              </View>
            )}
          </View>

          {/* Admin / HR Role Management Card Action */}
          {['SUPERADMIN', 'ADMIN', 'HR'].includes(String(role)) && !limited && (
            <TouchableOpacity
              style={styles.manageCardBtn}
              onPress={() => navigation.navigate('EmployeeManage', { id })}
              activeOpacity={0.8}
            >
              <View style={styles.manageCardIcon}>
                <Settings2 size={16} color="#1373E5" strokeWidth={2.4} />
              </View>
              <View style={styles.manageCardBody}>
                <Text style={styles.manageCardTitle}>Manage role, manager, shift & access</Text>
              </View>
              <ChevronRight size={16} color="#1373E5" strokeWidth={2.4} />
            </TouchableOpacity>
          )}

          {/* Direct Communication Buttons */}
          <View style={styles.actionsRow}>
            {!!email && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.emailBtn]}
                onPress={() => Linking.openURL(`mailto:${email}`)}
                activeOpacity={0.75}
              >
                <Mail size={16} color="#1373E5" strokeWidth={2.4} />
                <Text style={styles.emailBtnText}>Email</Text>
              </TouchableOpacity>
            )}
            {!!phone && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.callBtn]}
                onPress={() => Linking.openURL(`tel:${phone}`)}
                activeOpacity={0.75}
              >
                <Phone size={16} color="#059669" strokeWidth={2.4} />
                <Text style={styles.callBtnText}>Call</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={theme.colors.primary} size="large" />
        ) : limited ? (
          <Section title="Basic Profile" icon={Briefcase}>
            <Fields
              rows={[
                ['Email', email],
                ['Employee code', p?.employeeCode],
                ['Branch', nameOf(p?.branch)],
              ]}
            />
            <Text style={styles.note}>Full profiles are visible to HR and admins.</Text>
          </Section>
        ) : (
          <>
            {/* Segmented Control Tabs */}
            <View style={styles.tabsContainer}>
              {TABS.map((t) => {
                const isActive = tab === t.key;
                return (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.tabItem, isActive && styles.tabItemActive]}
                    onPress={() => setTab(t.key)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{t.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* WORK TAB */}
            {tab === 'WORK' && (
              <>
                <Section title="Employment" icon={Briefcase}>
                  <Fields
                    rows={[
                      ['Employee code', p?.employeeCode ? `#${p.employeeCode}` : null],
                      ['Designation', nameOf(p?.designation)],
                      ['Department', nameOf(p?.department)],
                      ['Branch', nameOf(p?.branch)],
                      ['Work location', p?.workLocation],
                      ['Employment type', pretty(p?.employmentType)],
                      ['Category', pretty(p?.employmentCategory)],
                      ['Role', pretty(p?.user?.role)],
                      ['Joined', date(p?.joiningDate)],
                      [
                        'Probation',
                        p?.probationConfirmedAt
                          ? `Confirmed (${date(p.probationConfirmedAt)})`
                          : date(p?.probationEndDate),
                      ],
                      [
                        'Shift',
                        p?.shift
                          ? `${p.shift.name}${p.shift.startTime ? ` (${p.shift.startTime}–${p.shift.endTime})` : ''}`
                          : null,
                      ],
                      ['Onboarding', pretty(p?.onboardingStatus)],
                    ]}
                  />
                </Section>

                {/* Reporting Manager */}
                {p?.manager && (
                  <Section title="Reporting Manager" icon={UserRound}>
                    <TouchableOpacity
                      style={styles.managerCard}
                      onPress={() => navigation.push('EmployeeProfile', { id: p.manager.id, person: p.manager })}
                      activeOpacity={0.75}
                    >
                      <Avatar person={p.manager} size={44} />
                      <View style={styles.managerMeta}>
                        <Text style={styles.managerName}>{fullName(p.manager)}</Text>
                        <Text style={styles.managerSub}>
                          {[nameOf(p.manager.designation), nameOf(p.manager.department)].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      <ChevronRight size={18} color="#94A3B8" strokeWidth={2.4} />
                    </TouchableOpacity>
                  </Section>
                )}

                {/* About Bio */}
                {!!p?.about && (
                  <Section title="About" icon={Sparkles}>
                    <Text style={styles.body}>{htmlToText(p.about)}</Text>
                  </Section>
                )}

                {/* Skills */}
                {skills.length > 0 && (
                  <Section title="Skills" icon={Sparkles}>
                    <View style={styles.skillWrap}>
                      {skills.map((s) => (
                        <View key={s.id} style={styles.skillPill}>
                          <Text style={styles.skillText}>
                            {s.name}
                            {s.level ? ` · ${s.level}` : ''}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </Section>
                )}

                {/* Experience & Education */}
                {resume.length > 0 && (
                  <Section title="Experience & Education" icon={GraduationCap}>
                    {resume.map((r, i) => (
                      <View key={r.id || i} style={[styles.resumeRow, i > 0 && styles.resumeRowBorder]}>
                        <Text style={styles.resumeTitle}>{r.title}</Text>
                        <Text style={styles.resumeSub}>
                          {[r.organization, r.type].filter(Boolean).join(' · ')}
                        </Text>
                        {(r.startDate || r.endDate) && (
                          <Text style={styles.resumeDates}>
                            {r.startDate || '?'} – {r.endDate || 'Present'}
                          </Text>
                        )}
                      </View>
                    ))}
                  </Section>
                )}
              </>
            )}

            {/* PERSONAL TAB */}
            {tab === 'PERSONAL' && (
              <Section title="Personal Information" icon={UserRound}>
                <Fields
                  rows={[
                    ['Gender', pretty(p?.gender)],
                    ['Date of birth', date(p?.dateOfBirth)],
                    ['Marital status', pretty(p?.maritalStatus)],
                    ['Nationality', p?.nationality],
                    ['Language', p?.language],
                    ['Education', [p?.educationLevel, p?.fieldOfStudy].filter(Boolean).join(', ') || null],
                    ['City', [p?.city, p?.state, p?.country].filter(Boolean).join(', ') || null],
                    ['Address', p?.address],
                  ]}
                />
              </Section>
            )}

            {/* CONTACTS TAB */}
            {tab === 'CONTACTS' && (
              <>
                <Section title="Work Contact" icon={Mail}>
                  <Fields
                    rows={[
                      ['Work email', email],
                      ['Phone number', phone],
                    ]}
                  />
                </Section>

                <Section title="Emergency Contacts" icon={Phone}>
                  {contacts.length ? (
                    contacts.map((c, idx) => (
                      <View key={c.id || idx} style={[styles.contactCard, idx > 0 && styles.contactCardBorder]}>
                        <View style={styles.contactIconCircle}>
                          <UserRound size={17} color="#475569" strokeWidth={2.4} />
                        </View>
                        <View style={styles.contactDetails}>
                          <Text style={styles.contactName}>{c.name}</Text>
                          <Text style={styles.contactRelationship}>
                            {[c.relationship, c.mobile].filter(Boolean).join(' · ')}
                          </Text>
                        </View>
                        {!!c.mobile && (
                          <TouchableOpacity
                            style={styles.contactCallBtn}
                            onPress={() => Linking.openURL(`tel:${c.mobile}`)}
                            activeOpacity={0.7}
                            accessibilityLabel={`Call ${c.name}`}
                          >
                            <Phone size={15} color="#059669" strokeWidth={2.2} />
                          </TouchableOpacity>
                        )}
                      </View>
                    ))
                  ) : (
                    <Text style={styles.none}>No emergency contacts recorded.</Text>
                  )}
                </Section>
              </>
            )}

            {/* HISTORY TAB */}
            {tab === 'HISTORY' && (
              <Section title="Employment History" icon={History}>
                {history?.length ? (
                  history.map((h, i) => (
                    <View key={`${h.type}-${i}`} style={[styles.timelineItem, i > 0 && styles.timelineItemBorder]}>
                      <View style={styles.timelineDot}>
                        <History size={13} color="#4F46E5" strokeWidth={2.4} />
                      </View>
                      <View style={styles.timelineContent}>
                        <Text style={styles.timelineTitle}>{h.label}</Text>
                        {!!h.detail && <Text style={styles.timelineDetail}>{h.detail}</Text>}
                        {(h.facts || []).map((f: any) => (
                          <Text key={f.label} style={styles.timelineFact}>
                            {f.label}: <Text style={styles.timelineFactVal}>{f.value}</Text>
                          </Text>
                        ))}
                        <Text style={styles.timelineDate}>{date(h.at)}</Text>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.none}>
                    {history === null ? 'History is visible to HR and admins.' : 'No employment history recorded yet.'}
                  </Text>
                )}
              </Section>
            )}

            {/* DOCUMENTS TAB */}
            {tab === 'DOCUMENTS' && (
              <Section title={`Documents · ${docs.length}`} icon={FileText}>
                {docs.length ? (
                  docs.map((d) => (
                    <TouchableOpacity
                      key={d.id}
                      style={styles.docCard}
                      onPress={() => Linking.openURL(d.fileUrl)}
                      activeOpacity={0.75}
                    >
                      <View style={styles.docIconBox}>
                        <FileText size={18} color="#4F46E5" strokeWidth={2.2} />
                      </View>
                      <View style={styles.docInfo}>
                        <Text style={styles.docName} numberOfLines={1}>{d.fileName}</Text>
                        {!!d.documentType && (
                          <Text style={styles.docType}>{d.documentType}</Text>
                        )}
                      </View>
                      <ChevronRight size={16} color="#94A3B8" strokeWidth={2.4} />
                    </TouchableOpacity>
                  ))
                ) : (
                  <Text style={styles.none}>No documents uploaded, or you do not have permission to view them.</Text>
                )}
              </Section>
            )}
          </>
        )}
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: 16,
    paddingBottom: 130,
    gap: 14,
  },

  // Header Edit Button
  headerEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 13,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#1373E5',
    shadowColor: '#1373E5',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  headerEditText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },

  // Hero Card
  heroCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 20,
    gap: 6,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  avatarWrapper: {
    padding: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  heroName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 8,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  heroRole: {
    fontSize: 13.5,
    color: '#475569',
    textAlign: 'center',
    fontWeight: '500',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: 6,
  },
  tagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 4.5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  tagPillText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  tagPillIndigo: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
  },
  tagPillIndigoText: {
    color: '#4338CA',
  },
  tagPillGrey: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
  },
  tagPillGreyText: {
    color: '#64748B',
  },
  tagPillRed: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  tagPillRedText: {
    color: '#DC2626',
  },

  // Admin Manage Card Button
  manageCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    width: '100%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  manageCardIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#E0F2FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageCardBody: {
    flex: 1,
  },
  manageCardTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#0284C7',
  },

  // Communication Action Buttons
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    width: '100%',
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
  },
  emailBtn: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  emailBtnText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#1373E5',
  },
  callBtn: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  callBtnText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#047857',
  },

  // Segmented Control Tabs
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    padding: 4,
    gap: 3,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 10,
  },
  tabItemActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  tabLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#64748B',
  },
  tabLabelActive: {
    color: '#0F172A',
    fontWeight: '800',
  },

  // Information Cards & Fields
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    gap: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardHeaderIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  fields: {
    gap: 8,
  },
  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  fieldRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  fieldKey: {
    width: 120,
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  fieldVal: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'right',
  },
  none: {
    fontSize: 13,
    color: '#94A3B8',
    paddingVertical: 4,
  },
  note: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 4,
  },

  // Reporting Manager Card
  managerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  managerMeta: {
    flex: 1,
    gap: 2,
  },
  managerName: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  managerSub: {
    fontSize: 12,
    color: '#64748B',
  },

  // Body Text
  body: {
    fontSize: 13.5,
    lineHeight: 20,
    color: '#334155',
  },

  // Skills
  skillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  skillPill: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  skillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4338CA',
  },

  // Experience & Education
  resumeRow: {
    gap: 2,
    paddingTop: 8,
  },
  resumeRowBorder: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  resumeTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  resumeSub: {
    fontSize: 12,
    color: '#64748B',
  },
  resumeDates: {
    fontSize: 11.5,
    color: '#94A3B8',
    fontWeight: '600',
  },

  // Contacts
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  contactCardBorder: {
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
  },
  contactIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactDetails: {
    flex: 1,
    gap: 2,
  },
  contactName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  contactRelationship: {
    fontSize: 12,
    color: '#64748B',
  },
  contactCallBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Timeline (History)
  timelineItem: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 10,
  },
  timelineItemBorder: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  timelineDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineContent: {
    flex: 1,
    gap: 2,
  },
  timelineTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  timelineDetail: {
    fontSize: 12,
    color: '#475569',
  },
  timelineFact: {
    fontSize: 11.5,
    color: '#64748B',
  },
  timelineFactVal: {
    color: '#0F172A',
    fontWeight: '700',
  },
  timelineDate: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
    fontWeight: '600',
  },

  // Documents
  docCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  docIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  docInfo: {
    flex: 1,
    gap: 2,
  },
  docName: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  docType: {
    fontSize: 11.5,
    color: '#64748B',
  },
});
