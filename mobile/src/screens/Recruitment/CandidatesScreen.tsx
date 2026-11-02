import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Modal,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Linking,
  Image,
} from 'react-native';
import {
  Search,
  X,
  Phone,
  Mail,
  FileText,
  Link2,
  CalendarPlus,
  Check,
  Sparkles,
  ShieldCheck,
  UserPlus,
  Briefcase,
  MapPin,
  Clock,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Award,
  Calendar,
  ThumbsUp,
  UserCheck,
  Video,
  Globe,
  Laptop,
  Users,
} from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { Avatar } from '../../components/PersonSheet';
import { useAuthStore } from '../../store/authStore';
import { theme } from '../../theme/theme';

/**
 * Candidate Pipeline (ATS) Management Screen.
 * Provides:
 * - Stage-by-stage pipeline filters with counts.
 * - Live candidate search and job filter.
 * - Rich Candidate Cards with parsed AI scores and stage pills.
 * - Candidate Detail View featuring parsed AI Candidate Intelligence (score, strengths, matched skills, skill gaps, recommendation).
 * - Stage progression, salary approval decisions, interview scheduling, and 1-tap onboarding.
 */
const STAGES = [
  'APPLIED',
  'PHONE_SCREENING',
  'INTERVIEW',
  'NEGOTIATION',
  'OFFERED',
  'HIRED',
  'ONBOARDED',
  'ON_HOLD',
  'REJECTED',
];

const LABEL: Record<string, string> = {
  APPLIED: 'Applied',
  PHONE_SCREENING: 'Screening',
  INTERVIEW: 'Interview',
  NEGOTIATION: 'Negotiation',
  OFFERED: 'Offered',
  HIRED: 'Hired',
  ONBOARDED: 'Onboarded',
  ON_HOLD: 'On hold',
  REJECTED: 'Rejected',
};

const TONE: Record<string, { bg: string; text: string; border: string }> = {
  APPLIED: { bg: '#F1F5F9', text: '#475569', border: '#CBD5E1' },
  PHONE_SCREENING: { bg: '#E0F2FE', text: '#0284C7', border: '#BAE6FD' },
  INTERVIEW: { bg: '#EEF2FF', text: '#4F46E5', border: '#C7D2FE' },
  NEGOTIATION: { bg: '#FEF3C7', text: '#D97706', border: '#FDE68A' },
  OFFERED: { bg: '#F3E8FF', text: '#7C3AED', border: '#DDD6FE' },
  HIRED: { bg: '#ECFDF5', text: '#059669', border: '#A7F3D0' },
  ONBOARDED: { bg: '#D1FAE5', text: '#047857', border: '#6EE7B7' },
  ON_HOLD: { bg: '#F8FAFC', text: '#64748B', border: '#E2E8F0' },
  REJECTED: { bg: '#FEF2F2', text: '#DC2626', border: '#FECACA' },
};

const stageOf = (s?: string) =>
  s === 'NEW'
    ? 'APPLIED'
    : s === 'REVIEWING' || s === 'SHORTLISTED'
    ? 'PHONE_SCREENING'
    : s === 'INTERVIEWING'
    ? 'INTERVIEW'
    : s || 'APPLIED';

const money = (n?: number | null) => {
  if (!n) return '—';
  const v = Number(n);
  return v < 1000
    ? `₹${v} L`
    : v >= 100000
    ? `₹${(v / 100000).toFixed(v % 100000 ? 1 : 0)} L`
    : `₹${v.toLocaleString('en-IN')}`;
};

const formatExp = (exp?: string | null) => {
  if (!exp) return '';
  const clean = exp.replace(/\s*(years|yrs)$/i, '').trim();
  return `${clean} yrs exp`;
};

const when = (d?: string) =>
  d
    ? new Date(d).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      })
    : '';

const errMsg = (e: any) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join('\n') : m || 'Please try again.';
};

const splitName = (n: string) => {
  const [firstName, ...r] = (n || '').split(' ');
  return { firstName, lastName: r.join(' ') };
};

const cleanExp = (exp?: string | number | null) => {
  if (!exp) return 'Fresher';
  const s = String(exp).trim();
  const cleaned = s.replace(/\s*(years|yrs)$/i, '');
  return `${cleaned} yrs exp`;
};

const INTERVIEW_ROUND_PRESETS = [
  'Screening',
  'Technical Round 1',
  'Technical Round 2',
  'System Design',
  'HR Discussion',
  'Final / Leadership',
];

const DURATION_PRESETS = [
  { label: '30m', mins: '30' },
  { label: '45m', mins: '45' },
  { label: '60m', mins: '60' },
  { label: '90m', mins: '90' },
];

const TIME_PRESETS = [
  { label: '10:00 AM', val: '10:00' },
  { label: '11:30 AM', val: '11:30' },
  { label: '02:00 PM', val: '14:00' },
  { label: '04:00 PM', val: '16:00' },
];

const VENUE_PRESETS = [
  { label: 'Google Meet', val: 'Google Meet (link to be generated)' },
  { label: 'Zoom Meeting', val: 'Zoom Meeting' },
  { label: 'Room 1 (HQ)', val: 'Conference Room 1 (Noida HQ)' },
  { label: 'In-Person (HQ)', val: 'In-Person (Head Office)' },
];

const formatReadableDate = (dStr?: string) => {
  if (!dStr) return '';
  const parts = dStr.split('-');
  if (parts.length !== 3) return '';
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

const getTomorrowDateStr = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getDaysAheadDateStr = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getNextMondayDateStr = () => {
  const d = new Date();
  const day = d.getDay();
  const diff = (8 - day) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Helper to parse AI summary from either raw JSON or plain text
type ParsedAiSummary = {
  score?: number;
  matchingSkills?: string[];
  missingSkills?: string[];
  strengths?: string;
  recommendation?: string;
  isStructured: boolean;
  rawText?: string;
};

const parseAiSummary = (raw?: string | null): ParsedAiSummary | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      return {
        score: parsed.score,
        matchingSkills: Array.isArray(parsed.matchingSkills) ? parsed.matchingSkills : [],
        missingSkills: Array.isArray(parsed.missingSkills) ? parsed.missingSkills : [],
        strengths: typeof parsed.strengths === 'string' ? parsed.strengths : '',
        recommendation: typeof parsed.recommendation === 'string' ? parsed.recommendation : '',
        isStructured: true,
      };
    } catch {
      // Fallback to text if JSON parsing fails
    }
  }
  return { isStructured: false, rawText: trimmed };
};

export default function CandidatesScreen() {
  const route = useRoute<any>();
  const role = useAuthStore((s) => s.user?.role) || '';
  const [apps, setApps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [denied, setDenied] = useState(false);

  const [stage, setStage] = useState('ALL');
  const [query, setQuery] = useState('');
  const [jobId, setJobId] = useState<number | null>(route.params?.jobId ?? null);

  const [open, setOpen] = useState<any | null>(null);
  const [interviews, setInterviews] = useState<any[] | null>(null);
  const [move, setMove] = useState<{
    to: string;
    salary: string;
    reason: string;
    joining: string;
    approvalReason: string;
  } | null>(null);
  const [schedule, setSchedule] = useState<{
    title: string;
    date: string;
    time: string;
    duration: string;
    interviewerId?: number;
    link: string;
  } | null>(null);
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
    for (const a of apps) {
      if (a.jobId) m.set(a.jobId, a.job?.title || `Job ${a.jobId}`);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [apps]);

  const inJob = useMemo(() => apps.filter((a) => !jobId || a.jobId === jobId), [apps, jobId]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        STAGES.map((s) => [s, inJob.filter((a) => stageOf(a.status) === s).length])
      ),
    [inJob]
  );

  const pendingApproval = inJob.filter((a) => a.approvalStatus === 'PENDING_APPROVAL').length;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inJob.filter((a) => {
      const matchStage =
        stage === 'ALL'
          ? true
          : stage === 'APPROVAL'
          ? a.approvalStatus === 'PENDING_APPROVAL'
          : stageOf(a.status) === stage;

      if (!matchStage) return false;
      if (!q) return true;

      return `${a.fullName} ${a.email || ''} ${a.phone || ''} ${a.job?.title || ''} ${
        a.skills || ''
      } ${a.currentLocation || ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [inJob, stage, query]);

  const openCandidate = (a: any) => {
    setOpen(a);
    setInterviews(null);
    apiClient
      .get(`/recruitment/applications/${a.id}/interviews`)
      .then((r) => setInterviews(r.data || []))
      .catch(() => setInterviews([]));
  };

  const refreshOpen = async (id: number) => {
    await load();
    const { data } = await apiClient
      .get(`/recruitment/applications/${id}`)
      .catch(() => ({ data: null }));
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
      if (data?.approvalStatus === 'PENDING_APPROVAL') {
        Alert.alert('Sent for approval', 'The offer is above budget and waits for salary approval.');
      }
      refreshOpen(open.id);
    } catch (e) {
      Alert.alert('Could not move candidate', errMsg(e));
    }
  };

  const decideSalary = async (approve: boolean) => {
    if (!open) return;
    try {
      await apiClient.post(
        `/recruitment/applications/${open.id}/${approve ? 'approve' : 'reject'}-salary`,
        {}
      );
      refreshOpen(open.id);
    } catch (e) {
      Alert.alert('Could not save', errMsg(e));
    }
  };

  const onboard = () =>
    open &&
    Alert.alert(
      'Onboard candidate?',
      `Creates an employee account for ${open.fullName} and starts onboarding.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Onboard',
          onPress: async () => {
            try {
              await apiClient.post(`/recruitment/applications/${open.id}/onboard`, {});
              refreshOpen(open.id);
              Alert.alert('Onboarded', `${open.fullName} now has an employee account.`);
            } catch (e) {
              Alert.alert('Could not onboard', errMsg(e));
            }
          },
        },
      ]
    );

  const openSchedule = async () => {
    const t = new Date(Date.now() + 86_400_000);
    setSchedule({
      title: 'Technical Round 1',
      date: t.toISOString().slice(0, 10),
      time: '11:00',
      duration: '45',
      link: '',
    });
    if (!people.length) {
      const { data } = await apiClient.get('/employees/basic-list').catch(() => ({ data: [] }));
      setPeople(data || []);
    }
  };

  const doSchedule = async () => {
    if (!open || !schedule) return;
    try {
      await apiClient.post(`/recruitment/applications/${open.id}/interviews`, {
        title: schedule.title.trim(),
        scheduledAt: `${schedule.date}T${schedule.time}`,
        durationMins: Number(schedule.duration) || 45,
        interviewerId: schedule.interviewerId,
        locationUrl: schedule.link.trim() || undefined,
      });
      setSchedule(null);
      openCandidate(open);
    } catch (e) {
      Alert.alert('Could not schedule', errMsg(e));
    }
  };

  if (denied) {
    return (
      <AppScreen showBack title="Candidates">
        <Text style={styles.empty}>Candidates are managed by HR and administrators.</Text>
      </AppScreen>
    );
  }

  const cur = open ? stageOf(open.status) : '';
  const parsedAi = open ? parseAiSummary(open.aiSummary) : null;

  const header = (
    <View style={styles.headerDeck}>
      {/* Search Input */}
      <View style={styles.search}>
        <Search size={16} color="#94A3B8" strokeWidth={2.2} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search name, email, phone, skills..."
          placeholderTextColor="#94A3B8"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <X size={14} color="#64748B" />
          </TouchableOpacity>
        )}
      </View>

      {/* Jobs Filter Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterScroll}
      >
        <TouchableOpacity
          style={[styles.jobChip, !jobId && styles.jobChipActive]}
          onPress={() => {
            setJobId(null);
            setStage('ALL');
          }}
          activeOpacity={0.8}
        >
          <Text style={[styles.jobChipText, !jobId && styles.jobChipTextActive]}>All Jobs</Text>
        </TouchableOpacity>

        {[...jobs]
          .sort((x, y) => Number(y[0] === jobId) - Number(x[0] === jobId))
          .map(([id, title]) => {
            const isSelected = jobId === id;
            return (
              <TouchableOpacity
                key={id}
                style={[styles.jobChip, isSelected && styles.jobChipActive]}
                onPress={() => {
                  setJobId(id);
                  setStage('ALL');
                }}
                activeOpacity={0.8}
              >
                <Text
                  style={[styles.jobChipText, isSelected && styles.jobChipTextActive]}
                  numberOfLines={1}
                >
                  {title}
                </Text>
              </TouchableOpacity>
            );
          })}
      </ScrollView>

      {/* Pipeline Stage Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.stageTabsScroll}
      >
        {pendingApproval > 0 && (
          <TouchableOpacity
            style={[
              styles.stageTab,
              { backgroundColor: '#FFFBEB', borderColor: '#F59E0B' },
              stage === 'APPROVAL' && { backgroundColor: '#B45309', borderColor: '#B45309' },
            ]}
            onPress={() => setStage('APPROVAL')}
            activeOpacity={0.8}
          >
            <ShieldCheck
              size={12}
              color={stage === 'APPROVAL' ? '#FFFFFF' : '#B45309'}
              strokeWidth={2.4}
            />
            <Text
              style={[
                styles.stageText,
                { color: stage === 'APPROVAL' ? '#FFFFFF' : '#B45309' },
              ]}
            >
              Needs Approval ({pendingApproval})
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[
            styles.stageTab,
            stage === 'ALL' && { backgroundColor: '#0F172A', borderColor: '#0F172A' },
          ]}
          onPress={() => setStage('ALL')}
          activeOpacity={0.8}
        >
          <Text style={[styles.stageText, stage === 'ALL' && { color: '#FFFFFF' }]}>
            All ({inJob.length})
          </Text>
        </TouchableOpacity>

        {STAGES.map((s) => {
          const n = counts[s] || 0;
          const tone = TONE[s] || TONE.APPLIED;
          const isSelected = stage === s;
          return (
            <TouchableOpacity
              key={s}
              disabled={!n}
              style={[
                styles.stageTab,
                !n && styles.stageEmpty,
                isSelected && { backgroundColor: tone.text, borderColor: tone.text },
              ]}
              onPress={() => setStage(s)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.stageText,
                  !n && styles.stageTextEmpty,
                  isSelected && { color: '#FFFFFF' },
                ]}
              >
                {LABEL[s]} ({n})
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <AppScreen
      showBack
      title="Candidates"
      subtitle={`${inJob.length} candidates${
        route.params?.jobTitle && jobId === route.params?.jobId
          ? ` · ${route.params.jobTitle}`
          : ''
      }`}
    >
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} size="large" />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(a) => String(a.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <UserCheck size={36} color="#CBD5E1" />
              <Text style={styles.empty}>No candidates found in this stage.</Text>
            </View>
          }
          renderItem={({ item: a }) => {
            const currentStageKey = stageOf(a.status);
            const tone = TONE[currentStageKey] || TONE.APPLIED;
            const expText = formatExp(a.experienceYears);

            return (
              <TouchableOpacity
                style={styles.card}
                onPress={() => openCandidate(a)}
                activeOpacity={0.85}
              >
                <Avatar
                  person={{ id: a.id, ...splitName(a.fullName), avatarUrl: a.photoUrl }}
                  size={46}
                />

                <View style={styles.cardBody}>
                  <View style={styles.cardHeaderRow}>
                    <Text style={styles.name} numberOfLines={1}>
                      {a.fullName}
                    </Text>

                    {/* AI Score Badge */}
                    {a.isAiScored && a.aiScore != null && (
                      <View style={styles.aiBadge}>
                        <Sparkles size={11} color="#7C3AED" strokeWidth={2.4} />
                        <Text style={styles.aiBadgeText}>{a.aiScore}</Text>
                      </View>
                    )}
                  </View>

                  {/* Target Job Title & Experience */}
                  <View style={styles.metaRow}>
                    <Text style={styles.jobTitleText} numberOfLines={1}>
                      {a.job?.title || 'Applicant'}
                    </Text>
                    {!!expText && <Text style={styles.expDotText}>· {expText}</Text>}
                  </View>

                  {/* Salary & Notice Period */}
                  <View style={styles.metaRow}>
                    <Text style={styles.salaryMetaText}>Expects {money(a.expectedCtc)}</Text>
                    {!!a.noticePeriod && (
                      <Text style={styles.noticeMetaText}>· notice {a.noticePeriod}</Text>
                    )}
                  </View>
                </View>

                {/* Status Column */}
                <View style={styles.cardStatusCol}>
                  <View
                    style={[
                      styles.stagePill,
                      { backgroundColor: tone.bg, borderColor: tone.border },
                    ]}
                  >
                    <Text style={[styles.stagePillText, { color: tone.text }]}>
                      {LABEL[currentStageKey]}
                    </Text>
                  </View>

                  {a.approvalStatus === 'PENDING_APPROVAL' && (
                    <View style={styles.warnBadge}>
                      <ShieldCheck size={10} color="#B45309" />
                      <Text style={styles.warnText}>Approval</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* CANDIDATE DETAIL MODAL */}
      <Modal
        visible={!!open && !move && !schedule}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            {/* Modal Header */}
            <View style={styles.sheetHead}>
              {open?.photoUrl ? (
                <Image source={{ uri: open.photoUrl }} style={styles.photo} />
              ) : (
                <Avatar
                  person={open ? { id: open.id, ...splitName(open.fullName) } : null}
                  size={50}
                />
              )}

              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.sheetTitle}>{open?.fullName}</Text>
                <Text style={styles.sheetSubtitle}>{open?.job?.title || 'Applicant'}</Text>
              </View>

              <TouchableOpacity onPress={() => setOpen(null)} style={styles.closeBtn}>
                <X size={20} color="#334155" />
              </TouchableOpacity>
            </View>

            {open && (
              <ScrollView
                contentContainerStyle={styles.detailScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {/* Stage & Salary Status Badges */}
                <View style={styles.statusBannerRow}>
                  <View
                    style={[
                      styles.detailStagePill,
                      {
                        backgroundColor: (TONE[cur] || TONE.APPLIED).bg,
                        borderColor: (TONE[cur] || TONE.APPLIED).border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.detailStageText,
                        { color: (TONE[cur] || TONE.APPLIED).text },
                      ]}
                    >
                      {LABEL[cur]}
                    </Text>
                  </View>

                  {open.approvalStatus && open.approvalStatus !== 'NONE' && (
                    <View style={styles.salaryApprovalPill}>
                      <ShieldCheck size={12} color="#4338CA" />
                      <Text style={styles.salaryApprovalText}>
                        Salary: {String(open.approvalStatus).replace(/_/g, ' ').toLowerCase()}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Quick Contact Buttons Row */}
                <View style={styles.contactRow}>
                  {!!open.phone && (
                    <TouchableOpacity
                      style={[styles.contactBtn, { backgroundColor: '#ECFDF5' }]}
                      onPress={() => Linking.openURL(`tel:${open.phone}`)}
                      activeOpacity={0.75}
                    >
                      <Phone size={15} color="#059669" strokeWidth={2.4} />
                      <Text style={[styles.contactBtnText, { color: '#059669' }]}>Call</Text>
                    </TouchableOpacity>
                  )}
                  {!!open.email && (
                    <TouchableOpacity
                      style={[styles.contactBtn, { backgroundColor: '#EFF6FF' }]}
                      onPress={() => Linking.openURL(`mailto:${open.email}`)}
                      activeOpacity={0.75}
                    >
                      <Mail size={15} color="#1373E5" strokeWidth={2.4} />
                      <Text style={[styles.contactBtnText, { color: '#1373E5' }]}>Email</Text>
                    </TouchableOpacity>
                  )}
                  {!!open.resumeUrl && (
                    <TouchableOpacity
                      style={[styles.contactBtn, { backgroundColor: '#EEF2FF' }]}
                      onPress={() => Linking.openURL(open.resumeUrl)}
                      activeOpacity={0.75}
                    >
                      <FileText size={15} color="#4F46E5" strokeWidth={2.4} />
                      <Text style={[styles.contactBtnText, { color: '#4F46E5' }]}>Resume</Text>
                    </TouchableOpacity>
                  )}
                  {!!open.linkedinUrl && (
                    <TouchableOpacity
                      style={[styles.contactBtn, { backgroundColor: '#F0F9FF' }]}
                      onPress={() => Linking.openURL(open.linkedinUrl)}
                      activeOpacity={0.75}
                    >
                      <Link2 size={15} color="#0A66C2" strokeWidth={2.4} />
                      <Text style={[styles.contactBtnText, { color: '#0A66C2' }]}>LinkedIn</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Structured Candidate Details Table */}
                <View style={styles.detailsCard}>
                  <Text style={styles.sectionHeading}>Application Profile</Text>

                  {[
                    ['Email', open.email],
                    ['Phone', open.phone],
                    ['Experience', formatExp(open.experienceYears)],
                    ['Current CTC', open.currentCtc && money(open.currentCtc)],
                    ['Expected CTC', open.expectedCtc && money(open.expectedCtc)],
                    ['Offered', open.offeredSalary && money(open.offeredSalary)],
                    ['Notice Period', open.noticePeriod],
                    ['Location', open.currentLocation],
                    ['Skills', open.skills],
                    ['Source', open.source],
                    [
                      'Target Joining',
                      open.joiningDate && String(open.joiningDate).slice(0, 10),
                    ],
                    ['Rejection Reason', open.rejectionReason],
                  ]
                    .filter(([, v]) => !!v)
                    .map(([label, val]) => (
                      <View key={label as string} style={styles.detailRow}>
                        <Text style={styles.detailKey}>{label}</Text>
                        <Text style={styles.detailValue}>{String(val)}</Text>
                      </View>
                    ))}
                </View>

                {/* ✨ PARSED AI CANDIDATE INTELLIGENCE CARD ✨ */}
                {parsedAi && (
                  <View style={styles.aiIntelligenceCard}>
                    {/* Header */}
                    <View style={styles.aiHeaderRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Sparkles size={16} color="#7C3AED" strokeWidth={2.4} />
                        <Text style={styles.aiCardTitle}>AI Candidate Intelligence</Text>
                      </View>

                      {parsedAi.score != null && (
                        <View style={styles.aiScorePill}>
                          <Text style={styles.aiScoreText}>{parsedAi.score}% Match</Text>
                        </View>
                      )}
                    </View>

                    {/* Recommendation Pill */}
                    {!!parsedAi.recommendation && (
                      <View style={styles.recommendationBox}>
                        <Award size={14} color="#059669" strokeWidth={2.2} />
                        <Text style={styles.recommendationText}>
                          Recommendation:{' '}
                          <Text style={{ fontWeight: '800' }}>
                            {parsedAi.recommendation.replace(/_/g, ' ')}
                          </Text>
                        </Text>
                      </View>
                    )}

                    {/* Strengths Synthesis */}
                    {!!parsedAi.strengths && (
                      <View style={styles.strengthsBox}>
                        <Text style={styles.strengthsHeading}>Key Strengths</Text>
                        <Text style={styles.strengthsText}>{parsedAi.strengths}</Text>
                      </View>
                    )}

                    {/* Matching Skills Badges */}
                    {!!parsedAi.matchingSkills?.length && (
                      <View style={{ gap: 6 }}>
                        <Text style={styles.skillsHeading}>Matching Skills</Text>
                        <View style={styles.skillsTagWrap}>
                          {parsedAi.matchingSkills.map((s) => (
                            <View key={s} style={styles.matchingSkillPill}>
                              <CheckCircle2 size={11} color="#047857" strokeWidth={2.4} />
                              <Text style={styles.matchingSkillText}>{s}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}

                    {/* Missing Skills / Gaps */}
                    {!!parsedAi.missingSkills?.length && (
                      <View style={{ gap: 6 }}>
                        <Text style={styles.skillsGapsHeading}>Skill Gaps to Verify</Text>
                        <View style={styles.skillsTagWrap}>
                          {parsedAi.missingSkills.map((s) => (
                            <View key={s} style={styles.missingSkillPill}>
                              <AlertTriangle size={11} color="#C2410C" strokeWidth={2.4} />
                              <Text style={styles.missingSkillText}>{s}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}

                    {/* Fallback raw text if non-structured */}
                    {!parsedAi.isStructured && !!parsedAi.rawText && (
                      <Text style={styles.rawAiText}>{parsedAi.rawText}</Text>
                    )}
                  </View>
                )}

                {/* Salary Approval Warning Card */}
                {open.approvalStatus === 'PENDING_APPROVAL' && (
                  <View style={styles.approvalCard}>
                    <ShieldCheck size={18} color="#B45309" strokeWidth={2.2} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.approvalTitle}>Salary Approval Required</Text>
                      <Text style={styles.approvalDesc}>
                        Offer of {money(open.offeredSalary)} exceeds budget
                        {open.approvalReason ? `: ${open.approvalReason}` : '.'}
                      </Text>
                    </View>
                    <View style={styles.approvalActions}>
                      <TouchableOpacity
                        style={styles.approvalRejectBtn}
                        onPress={() => decideSalary(false)}
                      >
                        <Text style={styles.approvalRejectText}>Reject</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.approvalApproveBtn}
                        onPress={() => decideSalary(true)}
                      >
                        <Text style={styles.approvalApproveText}>Approve</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* Stage Progression Action Strip */}
                <View style={styles.stageMoveCard}>
                  <Text style={styles.sectionHeading}>Move Candidate To</Text>
                  <View style={styles.stageMoveWrap}>
                    {STAGES.filter((s) => s !== cur && s !== 'ONBOARDED').map((s) => {
                      const tone = TONE[s] || TONE.APPLIED;
                      return (
                        <TouchableOpacity
                          key={s}
                          style={[
                            styles.moveChip,
                            { backgroundColor: tone.bg, borderColor: tone.border },
                          ]}
                          onPress={() =>
                            setMove({
                              to: s,
                              salary: open.offeredSalary ? String(open.offeredSalary) : '',
                              reason: '',
                              joining: open.joiningDate
                                ? String(open.joiningDate).slice(0, 10)
                                : '',
                              approvalReason: '',
                            })
                          }
                          activeOpacity={0.75}
                        >
                          <Text style={[styles.moveText, { color: tone.text }]}>
                            {LABEL[s]}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* 1-Tap Onboard as Employee Button (if Hired) */}
                {cur === 'HIRED' && (
                  <TouchableOpacity
                    style={styles.onboardBtn}
                    onPress={onboard}
                    activeOpacity={0.8}
                  >
                    <UserPlus size={16} color="#FFFFFF" strokeWidth={2.4} />
                    <Text style={styles.onboardBtnText}>Onboard as Employee</Text>
                  </TouchableOpacity>
                )}

                {/* Interviews Section */}
                <View style={styles.interviewsCard}>
                  <View style={styles.interviewsHeader}>
                    <Text style={styles.sectionHeading}>Scheduled Interviews</Text>
                    <TouchableOpacity
                      style={styles.scheduleLinkBtn}
                      onPress={openSchedule}
                      activeOpacity={0.75}
                    >
                      <CalendarPlus size={13} color="#1373E5" strokeWidth={2.2} />
                      <Text style={styles.scheduleLinkText}>Schedule</Text>
                    </TouchableOpacity>
                  </View>

                  {interviews === null ? (
                    <ActivityIndicator color={theme.colors.primary} />
                  ) : interviews.length ? (
                    interviews.map((iv) => (
                      <View key={iv.id} style={styles.interviewItem}>
                        <Text style={styles.interviewTitle}>{iv.title}</Text>
                        <Text style={styles.interviewMeta}>
                          {when(iv.scheduledAt)} · {iv.durationMins || 45} mins ·{' '}
                          {iv.interviewer
                            ? `${iv.interviewer.firstName} ${iv.interviewer.lastName || ''}`
                            : 'Unassigned'}
                        </Text>
                        <Text style={styles.interviewStatus}>
                          Status: {String(iv.status).toLowerCase()}
                          {iv.rating ? ` · ${'★'.repeat(iv.rating)}` : ''}
                        </Text>
                        {!!iv.feedback && (
                          <Text style={styles.interviewFeedback}>{iv.feedback}</Text>
                        )}
                      </View>
                    ))
                  ) : (
                    <Text style={styles.noInterviewsText}>No interviews scheduled yet.</Text>
                  )}
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* STAGE MOVE DIALOG */}
      <Modal visible={!!move} transparent animationType="fade" onRequestClose={() => setMove(null)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.dialogBackdrop}
        >
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitle}>Move to {move ? LABEL[move.to] : ''}</Text>

            {move?.to === 'OFFERED' && (
              <>
                <View style={styles.fieldGroup}>
                  <Text style={styles.inputLabel}>Offered Annual CTC (₹)</Text>
                  <TextInput
                    style={styles.dialogInput}
                    value={move.salary}
                    onChangeText={(v) =>
                      setMove((m) => (m ? { ...m, salary: v.replace(/[^0-9]/g, '') } : m))
                    }
                    placeholder="e.g. 500000"
                    keyboardType="number-pad"
                    placeholderTextColor="#94A3B8"
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.inputLabel}>Budget Exception Justification</Text>
                  <TextInput
                    style={styles.dialogInput}
                    value={move.approvalReason}
                    onChangeText={(v) =>
                      setMove((m) => (m ? { ...m, approvalReason: v } : m))
                    }
                    placeholder="Why above budget (optional)"
                    placeholderTextColor="#94A3B8"
                  />
                </View>
              </>
            )}

            {(move?.to === 'OFFERED' || move?.to === 'HIRED') && (
              <View style={styles.fieldGroup}>
                <Text style={styles.inputLabel}>Expected Joining Date</Text>
                <TextInput
                  style={styles.dialogInput}
                  value={move.joining}
                  onChangeText={(v) => setMove((m) => (m ? { ...m, joining: v } : m))}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#94A3B8"
                />
              </View>
            )}

            {move?.to === 'REJECTED' && (
              <View style={styles.fieldGroup}>
                <Text style={styles.inputLabel}>Reason for Rejection</Text>
                <TextInput
                  style={[styles.dialogInput, { minHeight: 80, textAlignVertical: 'top' }]}
                  value={move.reason}
                  onChangeText={(v) => setMove((m) => (m ? { ...m, reason: v } : m))}
                  placeholder="Explain why the candidate was not selected"
                  placeholderTextColor="#94A3B8"
                  multiline
                />
              </View>
            )}

            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={styles.dialogCancelBtn}
                onPress={() => setMove(null)}
              >
                <Text style={styles.dialogCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dialogConfirmBtn} onPress={doMove}>
                <Text style={styles.dialogConfirmText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* SCHEDULE INTERVIEW DIALOG */}
      <Modal
        visible={!!schedule}
        transparent
        animationType="slide"
        onRequestClose={() => setSchedule(null)}
      >
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ width: '100%', justifyContent: 'flex-end' }}
          >
            <View style={[styles.sheet, { maxHeight: '92%' }]}>
            <View style={styles.sheetHandle} />

            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Schedule Interview</Text>
                <Text style={styles.sheetSubtitle}>
                  {open?.fullName ? `For ${open.fullName}` : 'Candidate interview setup'}
                  {open?.job?.title ? ` · ${open.job.title}` : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setSchedule(null)} style={styles.closeBtn}>
                <X size={20} color="#334155" />
              </TouchableOpacity>
            </View>

            {schedule && (
              <ScrollView
                contentContainerStyle={styles.schedFormScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {/* Candidate Quick Context Card */}
                {open && (
                  <View style={styles.candidateMiniCard}>
                    <Avatar
                      person={{ id: open.id, ...splitName(open.fullName) }}
                      size={40}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.candidateMiniName}>{open.fullName}</Text>
                      <Text style={styles.candidateMiniJob} numberOfLines={1}>
                        {open.job?.title || 'Applicant'} · {cleanExp(open.experienceYears)}
                      </Text>
                    </View>
                    <View style={styles.roundPillBadge}>
                      <Text style={styles.roundPillBadgeText}>New Round</Text>
                    </View>
                  </View>
                )}

                {/* Section 1: Round Title & Presets */}
                <View style={styles.schedSection}>
                  <Text style={styles.schedSectionLabel}>Interview Round</Text>
                  <View style={styles.inputWithIcon}>
                    <Laptop size={16} color="#6366F1" />
                    <TextInput
                      style={styles.inputWithIconText}
                      value={schedule.title}
                      onChangeText={(v) => setSchedule((s) => (s ? { ...s, title: v } : s))}
                      placeholder="e.g. Technical Round 1"
                      placeholderTextColor="#94A3B8"
                    />
                  </View>

                  {/* Preset Pills */}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.chipScroll}
                  >
                    {INTERVIEW_ROUND_PRESETS.map((preset) => {
                      const active = schedule.title.trim().toLowerCase() === preset.toLowerCase();
                      return (
                        <TouchableOpacity
                          key={preset}
                          style={[styles.quickChip, active && styles.quickChipActive]}
                          onPress={() => setSchedule((s) => (s ? { ...s, title: preset } : s))}
                        >
                          <Text
                            style={[
                              styles.quickChipText,
                              active && styles.quickChipTextActive,
                            ]}
                          >
                            {preset}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>

                {/* Section 2: Date & Time Schedule */}
                <View style={styles.schedSection}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.schedSectionLabel}>Date & Time (IST)</Text>
                    {schedule.date ? (
                      <Text style={styles.schedDateHuman}>{formatReadableDate(schedule.date)}</Text>
                    ) : null}
                  </View>

                  {/* Date Input with icon */}
                  <View style={styles.inputWithIcon}>
                    <Calendar size={16} color="#1373E5" />
                    <TextInput
                      style={styles.inputWithIconText}
                      value={schedule.date}
                      onChangeText={(v) => setSchedule((s) => (s ? { ...s, date: v } : s))}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#94A3B8"
                    />
                  </View>

                  {/* Quick Date Shortcuts */}
                  <View style={styles.quickDateRow}>
                    <TouchableOpacity
                      style={styles.dateShortcutBtn}
                      onPress={() => setSchedule((s) => (s ? { ...s, date: getTomorrowDateStr() } : s))}
                    >
                      <Text style={styles.dateShortcutText}>Tomorrow</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.dateShortcutBtn}
                      onPress={() => setSchedule((s) => (s ? { ...s, date: getDaysAheadDateStr(2) } : s))}
                    >
                      <Text style={styles.dateShortcutText}>In 2 Days</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.dateShortcutBtn}
                      onPress={() => setSchedule((s) => (s ? { ...s, date: getNextMondayDateStr() } : s))}
                    >
                      <Text style={styles.dateShortcutText}>Next Monday</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Time & Duration Row */}
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                    {/* Time */}
                    <View style={{ flex: 1.2, gap: 5 }}>
                      <Text style={styles.schedSubLabel}>Start Time (HH:mm)</Text>
                      <View style={styles.inputWithIcon}>
                        <Clock size={16} color="#0EA5E9" />
                        <TextInput
                          style={styles.inputWithIconText}
                          value={schedule.time}
                          onChangeText={(v) => setSchedule((s) => (s ? { ...s, time: v } : s))}
                          placeholder="11:00"
                          placeholderTextColor="#94A3B8"
                        />
                      </View>
                    </View>

                    {/* Duration */}
                    <View style={{ flex: 1, gap: 5 }}>
                      <Text style={styles.schedSubLabel}>Duration (mins)</Text>
                      <View style={styles.inputWithIcon}>
                        <Clock size={16} color="#8B5CF6" />
                        <TextInput
                          style={styles.inputWithIconText}
                          value={schedule.duration}
                          onChangeText={(v) =>
                            setSchedule((s) =>
                              s ? { ...s, duration: v.replace(/[^0-9]/g, '') } : s
                            )
                          }
                          placeholder="45"
                          keyboardType="number-pad"
                          placeholderTextColor="#94A3B8"
                        />
                      </View>
                    </View>
                  </View>

                  {/* Quick Time Pills */}
                  <View style={{ gap: 4 }}>
                    <Text style={styles.schedSubLabel}>Quick Time</Text>
                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                      {TIME_PRESETS.map((t) => {
                        const active = schedule.time === t.val;
                        return (
                          <TouchableOpacity
                            key={t.val}
                            style={[styles.smallPill, active && styles.smallPillActive]}
                            onPress={() => setSchedule((s) => (s ? { ...s, time: t.val } : s))}
                          >
                            <Text style={[styles.smallPillText, active && styles.smallPillTextActive]}>
                              {t.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>

                  {/* Duration Presets */}
                  <View style={{ gap: 4 }}>
                    <Text style={styles.schedSubLabel}>Quick Duration</Text>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {DURATION_PRESETS.map((d) => {
                        const active = schedule.duration === d.mins;
                        return (
                          <TouchableOpacity
                            key={d.mins}
                            style={[styles.smallPill, active && styles.smallPillActive]}
                            onPress={() => setSchedule((s) => (s ? { ...s, duration: d.mins } : s))}
                          >
                            <Text style={[styles.smallPillText, active && styles.smallPillTextActive]}>
                              {d.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                </View>

                {/* Section 3: Assigned Interviewer */}
                <View style={styles.schedSection}>
                  <Text style={styles.schedSectionLabel}>Assigned Interviewer</Text>
                  {(() => {
                    const selected = people.find((p) => p.id === schedule.interviewerId);
                    if (selected) {
                      return (
                        <View style={styles.interviewerCard}>
                          <Avatar person={selected} size={38} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.interviewerName}>
                              {selected.firstName} {selected.lastName || ''}
                            </Text>
                            <Text style={styles.interviewerRole} numberOfLines={1}>
                              {[selected.designation, selected.department].filter(Boolean).join(' · ') ||
                                'Interviewer'}
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={styles.interviewerChangeBtn}
                            onPress={() => setPickPerson(true)}
                          >
                            <Text style={styles.interviewerChangeText}>Change</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    }
                    return (
                      <TouchableOpacity
                        style={[styles.interviewerCard, styles.interviewerCardEmpty]}
                        onPress={() => setPickPerson(true)}
                      >
                        <View style={styles.pickerAvatarEmpty}>
                          <UserPlus size={18} color="#1373E5" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.interviewerSelectText}>Select Interviewer from team</Text>
                          <Text style={styles.interviewerRole}>Assign team lead or interviewer</Text>
                        </View>
                        <ChevronRight size={18} color="#94A3B8" />
                      </TouchableOpacity>
                    );
                  })()}
                </View>

                {/* Section 4: Meeting Link / Room */}
                <View style={styles.schedSection}>
                  <Text style={styles.schedSectionLabel}>Meeting Link or Venue</Text>
                  <View style={styles.inputWithIcon}>
                    <Video size={16} color="#059669" />
                    <TextInput
                      style={styles.inputWithIconText}
                      value={schedule.link}
                      onChangeText={(v) => setSchedule((s) => (s ? { ...s, link: v } : s))}
                      placeholder="e.g. Google Meet link or Room 1"
                      placeholderTextColor="#94A3B8"
                      autoCapitalize="none"
                    />
                  </View>

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.chipScroll}
                  >
                    {VENUE_PRESETS.map((vp) => (
                      <TouchableOpacity
                        key={vp.label}
                        style={styles.quickChip}
                        onPress={() => setSchedule((s) => (s ? { ...s, link: vp.val } : s))}
                      >
                        <Text style={styles.quickChipText}>{vp.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                {/* Timezone Info Banner */}
                <View style={styles.tzBanner}>
                  <Globe size={16} color="#0369A1" />
                  <Text style={styles.tzText}>
                    All times are in Indian Standard Time (IST, UTC+5:30). Meeting invitations will be sent automatically.
                  </Text>
                </View>

                {/* Action Buttons */}
                <TouchableOpacity
                  style={[
                    styles.submitBtn,
                    !schedule.title.trim() && { opacity: 0.5 },
                  ]}
                  disabled={!schedule.title.trim()}
                  onPress={doSchedule}
                  activeOpacity={0.8}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <CalendarPlus size={18} color="#FFFFFF" />
                    <Text style={styles.submitBtnText}>Schedule Interview</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.schedCancelBtn}
                  onPress={() => setSchedule(null)}
                >
                  <Text style={styles.schedCancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>

      {/* INTERVIEWER PICKER MODAL */}
      <Modal
        visible={pickPerson}
        transparent
        animationType="slide"
        onRequestClose={() => setPickPerson(false)}
      >
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ width: '100%', justifyContent: 'flex-end' }}
          >
            <View style={[styles.sheet, { maxHeight: '82%' }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Select Interviewer</Text>
                <Text style={styles.sheetSubtitle}>Choose team member to conduct this interview</Text>
              </View>
              <TouchableOpacity onPress={() => setPickPerson(false)} style={styles.closeBtn}>
                <X size={20} color="#334155" />
              </TouchableOpacity>
            </View>

            <View style={styles.pickerSearchBox}>
              <Search size={16} color="#94A3B8" />
              <TextInput
                style={styles.pickerSearchInput}
                value={pq}
                onChangeText={setPq}
                placeholder="Search by name, role, department..."
                placeholderTextColor="#94A3B8"
                autoCorrect={false}
              />
              {pq.length > 0 && (
                <TouchableOpacity onPress={() => setPq('')}>
                  <X size={16} color="#94A3B8" />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
              {/* Option to clear interviewer */}
              <TouchableOpacity
                style={styles.pickerItem}
                onPress={() => {
                  setSchedule((s) => (s ? { ...s, interviewerId: undefined } : s));
                  setPickPerson(false);
                }}
              >
                <View style={styles.pickerAvatarEmpty}>
                  <Users size={16} color="#64748B" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.pickerName, { color: '#64748B' }]}>Unassigned (Assign later)</Text>
                  <Text style={styles.pickerSub}>No specific interviewer set</Text>
                </View>
                {!schedule?.interviewerId && <Check size={18} color="#1373E5" />}
              </TouchableOpacity>

              {people
                .filter((p) => {
                  if (!pq.trim()) return true;
                  const full = `${p.firstName} ${p.lastName || ''} ${p.designation || ''} ${p.department || ''}`.toLowerCase();
                  return full.includes(pq.trim().toLowerCase());
                })
                .map((p) => {
                  const isSelected = schedule?.interviewerId === p.id;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.pickerItem, isSelected && styles.pickerItemSelected]}
                      onPress={() => {
                        setSchedule((s) => (s ? { ...s, interviewerId: p.id } : s));
                        setPickPerson(false);
                        setPq('');
                      }}
                    >
                      <Avatar person={p} size={36} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.pickerName, isSelected && { color: '#1373E5' }]}>
                          {p.firstName} {p.lastName || ''}
                        </Text>
                        <Text style={styles.pickerSub} numberOfLines={1}>
                          {[p.designation, p.department].filter(Boolean).join(' · ') || 'Employee'}
                        </Text>
                      </View>
                      {isSelected && <Check size={18} color="#1373E5" />}
                    </TouchableOpacity>
                  );
                })}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: 16,
    paddingBottom: 120,
    gap: 12,
  },
  headerDeck: {
    gap: 12,
    marginBottom: 6,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 44,
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOpacity: 0.03,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    paddingVertical: 0,
  },
  filterScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  jobChip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  jobChipActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  jobChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  jobChipTextActive: {
    color: '#FFFFFF',
  },
  stageTabsScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stageTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  stageEmpty: {
    opacity: 0.45,
  },
  stageText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  stageTextEmpty: {
    color: '#94A3B8',
  },

  // Candidate Card
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOpacity: 0.04,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 2 },
      },
      android: {
        elevation: 1.5,
      },
    }),
  },
  cardBody: {
    flex: 1,
    gap: 3,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  name: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
    flex: 1,
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#F3E8FF',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  aiBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#7C3AED',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  jobTitleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  expDotText: {
    fontSize: 11,
    color: '#64748B',
  },
  salaryMetaText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  noticeMetaText: {
    fontSize: 11,
    color: '#94A3B8',
  },
  cardStatusCol: {
    alignItems: 'flex-end',
    gap: 5,
  },
  stagePill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  stagePillText: {
    fontSize: 10,
    fontWeight: '800',
  },
  warnBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  warnText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#B45309',
  },

  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 20,
  },
  empty: {
    textAlign: 'center',
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },

  // -------------------------------------------------------------
  // CANDIDATE DETAIL MODAL
  // -------------------------------------------------------------
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    paddingBottom: 30,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  photo: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  sheetSubtitle: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  closeBtn: {
    padding: 6,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
  },
  detailScroll: {
    padding: 16,
    gap: 14,
  },
  statusBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailStagePill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  detailStageText: {
    fontSize: 12,
    fontWeight: '800',
  },
  salaryApprovalPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  salaryApprovalText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4338CA',
  },

  // Contact Actions
  contactRow: {
    flexDirection: 'row',
    gap: 8,
  },
  contactBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
  },
  contactBtnText: {
    fontSize: 12,
    fontWeight: '800',
  },

  // Details Card
  detailsCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    gap: 10,
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  detailKey: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    maxWidth: '65%',
    textAlign: 'right',
  },

  // ✨ AI CANDIDATE INTELLIGENCE CARD ✨
  aiIntelligenceCard: {
    backgroundColor: '#FAF5FF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    padding: 14,
    gap: 12,
  },
  aiHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  aiCardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#6B21A8',
  },
  aiScorePill: {
    backgroundColor: '#7C3AED',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  aiScoreText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 11,
  },
  recommendationBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  recommendationText: {
    fontSize: 12,
    color: '#047857',
    fontWeight: '600',
  },
  strengthsBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F3E8FF',
    gap: 4,
  },
  strengthsHeading: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6B21A8',
    textTransform: 'uppercase',
  },
  strengthsText: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 18,
  },
  skillsHeading: {
    fontSize: 11,
    fontWeight: '800',
    color: '#047857',
    textTransform: 'uppercase',
  },
  skillsGapsHeading: {
    fontSize: 11,
    fontWeight: '800',
    color: '#C2410C',
    textTransform: 'uppercase',
  },
  skillsTagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  matchingSkillPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  matchingSkillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#047857',
  },
  missingSkillPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  missingSkillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#C2410C',
  },
  rawAiText: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 18,
  },

  // Salary Approval Card
  approvalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFBEB',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  approvalTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#92400E',
  },
  approvalDesc: {
    fontSize: 11,
    color: '#B45309',
  },
  approvalActions: {
    flexDirection: 'row',
    gap: 6,
  },
  approvalRejectBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#FEF2F2',
  },
  approvalRejectText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#B91C1C',
  },
  approvalApproveBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#ECFDF5',
  },
  approvalApproveText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#047857',
  },

  // Stage Move Card
  stageMoveCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    gap: 10,
  },
  stageMoveWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  moveChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  moveText: {
    fontSize: 12,
    fontWeight: '800',
  },

  // 1-Tap Onboard Button
  onboardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1373E5',
    height: 48,
    borderRadius: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#1373E5',
        shadowOpacity: 0.25,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  onboardBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },

  // Interviews Section
  interviewsCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    gap: 10,
  },
  interviewsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scheduleLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  scheduleLinkText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1373E5',
  },
  interviewItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    gap: 3,
  },
  interviewTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  interviewMeta: {
    fontSize: 11,
    color: '#64748B',
  },
  interviewStatus: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  interviewFeedback: {
    fontSize: 11,
    color: '#334155',
    fontStyle: 'italic',
    marginTop: 2,
  },
  noInterviewsText: {
    fontSize: 12,
    color: '#94A3B8',
    fontStyle: 'italic',
  },

  // Dialog Styles
  dialogBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  dialogCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    gap: 14,
  },
  dialogTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  fieldGroup: {
    gap: 5,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  dialogInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 6,
  },
  dialogCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  dialogCancelText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  dialogConfirmBtn: {
    backgroundColor: '#1373E5',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  dialogConfirmText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  formScroll: {
    padding: 16,
    gap: 12,
  },
  submitBtn: {
    height: 48,
    borderRadius: 14,
    backgroundColor: '#1373E5',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },

  // -------------------------------------------------------------
  // SCHEDULE INTERVIEW SHEET STYLES
  // -------------------------------------------------------------
  sheetHandle: {
    width: 38,
    height: 4,
    backgroundColor: '#CBD5E1',
    borderRadius: 999,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 2,
  },
  schedFormScroll: {
    padding: 16,
    gap: 12,
    paddingBottom: 36,
  },
  candidateMiniCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  candidateMiniName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  candidateMiniJob: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 2,
  },
  roundPillBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  roundPillBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1373E5',
  },
  schedSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    gap: 8,
  },
  schedSectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  schedDateHuman: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1373E5',
  },
  schedSubLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  inputWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F8FAFC',
  },
  inputWithIconText: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    padding: 0,
  },
  chipScroll: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  quickChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  quickChipActive: {
    backgroundColor: '#EEF2FF',
    borderColor: '#6366F1',
  },
  quickChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  quickChipTextActive: {
    color: '#4F46E5',
    fontWeight: '800',
  },
  quickDateRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },
  dateShortcutBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  dateShortcutText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  smallPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  smallPillActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#1373E5',
  },
  smallPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  smallPillTextActive: {
    color: '#1373E5',
    fontWeight: '800',
  },
  interviewerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  interviewerCardEmpty: {
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
    backgroundColor: '#FAFAFC',
  },
  interviewerName: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  interviewerRole: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 1,
  },
  interviewerSelectText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1373E5',
  },
  interviewerChangeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  interviewerChangeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1373E5',
  },
  tzBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 12,
    padding: 12,
    marginTop: 2,
  },
  tzText: {
    flex: 1,
    fontSize: 11,
    color: '#0369A1',
    fontWeight: '600',
    lineHeight: 16,
  },
  schedCancelBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 14,
  },
  schedCancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },

  // -------------------------------------------------------------
  // INTERVIEWER PICKER MODAL STYLES
  // -------------------------------------------------------------
  pickerSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  pickerSearchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    padding: 0,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  pickerItemSelected: {
    backgroundColor: '#EFF6FF',
  },
  pickerAvatarEmpty: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  pickerName: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  pickerSub: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 1,
  },
});
