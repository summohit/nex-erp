import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
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
} from 'react-native';
import {
  Search,
  X,
  Plus,
  Briefcase,
  Users,
  MapPin,
  Trash2,
  ChevronRight,
  Calendar,
  Building2,
  Clock,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Eye,
  SlidersHorizontal,
} from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { htmlToText } from '../../utils/htmlText';
import { theme } from '../../theme/theme';

/**
 * Job Postings Management Screen.
 * Provides a mobile-first ATS job board:
 * - Summary KPI metrics (Open, Draft, Closed, Total Applicants).
 * - Rich job cards with department, work mode, salary range, applicant count, and closing timeline.
 * - Comprehensive creation & editing modal with grouped sections and currency helpers.
 */
type Job = {
  id: number;
  title: string;
  status: string;
  type: string;
  workLocationType?: string;
  experienceYears?: string;
  minSalary?: number | null;
  maxSalary?: number | null;
  totalOpenings?: number;
  endDate?: string | null;
  descriptionHtml?: string | null;
  departmentId?: number | null;
  designationId?: number | null;
  branchId?: number | null;
  department?: { name: string } | null;
  branch?: { name: string } | null;
  _count?: { applications: number };
  applicants?: number;
};

const STATUSES = ['Open', 'Draft', 'Closed'];
const TYPES = ['Full Time', 'Part Time', 'Internship', 'Trainee', 'Contractual', 'Freelancer', 'Other'];
const PLACES = ['On-site', 'Remote', 'Hybrid'];

const TONE: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  Open: { bg: '#ECFDF5', text: '#047857', border: '#A7F3D0', dot: '#10B981' },
  Draft: { bg: '#F1F5F9', text: '#475569', border: '#CBD5E1', dot: '#94A3B8' },
  Closed: { bg: '#FEF2F2', text: '#B91C1C', border: '#FECACA', dot: '#EF4444' },
};

const formatLakh = (n?: number | null) => {
  if (!n) return '';
  const val = Number(n);
  if (val >= 100000) {
    const l = val / 100000;
    return `₹${l.toFixed(val % 100000 ? 1 : 0)}L`;
  }
  return `₹${Math.round(val / 1000)}k`;
};

const formatSalaryHelper = (raw: string) => {
  const num = parseInt(raw.replace(/[^0-9]/g, ''), 10);
  if (!num || isNaN(num)) return '';
  if (num >= 100000) {
    const lakhs = (num / 100000).toFixed(num % 100000 ? 2 : 1);
    return `₹${lakhs} Lakhs/year`;
  }
  return `₹${num.toLocaleString('en-IN')}/year`;
};

const errMsg = (e: any) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join('\n') : m || 'Please try again.';
};

const BLANK = {
  title: '',
  status: 'Draft',
  type: 'Full Time',
  workLocationType: 'On-site',
  experienceYears: '',
  minSalary: '',
  maxSalary: '',
  totalOpenings: '1',
  endDate: '',
  departmentId: null as number | null,
  branchId: null as number | null,
  descriptionHtml: '',
};

export default function JobPostingsScreen() {
  const navigation = useNavigation<any>();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [denied, setDenied] = useState(false);
  const [status, setStatus] = useState<string>('Open');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<(typeof BLANK & { id?: number }) | null>(null);
  const [masters, setMasters] = useState<{ departments: any[]; branches: any[] }>({
    departments: [],
    branches: [],
  });

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
    return jobs.filter((j) => {
      if (status && j.status !== status) return false;
      if (!q) return true;
      return `${j.title} ${j.department?.name || ''} ${j.branch?.name || ''} ${j.type}`
        .toLowerCase()
        .includes(q);
    });
  }, [jobs, status, query]);

  const openForm = async (j?: Job) => {
    setForm(
      j
        ? {
            id: j.id,
            title: j.title,
            status: j.status,
            type: j.type,
            workLocationType: j.workLocationType || 'On-site',
            experienceYears: j.experienceYears || '',
            minSalary: j.minSalary ? String(j.minSalary) : '',
            maxSalary: j.maxSalary ? String(j.maxSalary) : '',
            totalOpenings: String(j.totalOpenings ?? 1),
            endDate: j.endDate ? String(j.endDate).slice(0, 10) : '',
            departmentId: j.departmentId ?? null,
            branchId: j.branchId ?? null,
            descriptionHtml: htmlToText(j.descriptionHtml),
          }
        : { ...BLANK }
    );
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
      title: form.title.trim(),
      status: form.status,
      type: form.type,
      workLocationType: form.workLocationType,
      experienceYears: form.experienceYears.trim() || null,
      minSalary: form.minSalary ? Number(form.minSalary) : null,
      maxSalary: form.maxSalary ? Number(form.maxSalary) : null,
      totalOpenings: Number(form.totalOpenings) || 1,
      endDate: form.endDate ? form.endDate : null,
      departmentId: form.departmentId,
      branchId: form.branchId,
      descriptionHtml: form.descriptionHtml.trim()
        ? form.descriptionHtml
            .trim()
            .split(/\n{2,}/)
            .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
            .join('')
        : null,
    };
    try {
      if (form.id) await apiClient.put(`/recruitment/jobs/${form.id}`, body);
      else await apiClient.post('/recruitment/jobs', body);
      setForm(null);
      load();
    } catch (e) {
      Alert.alert('Could not save job', errMsg(e));
    }
  };

  const setJobStatus = async (j: Job, next: string) => {
    try {
      await apiClient.put(`/recruitment/jobs/${j.id}`, { status: next });
      load();
    } catch (e) {
      Alert.alert('Could not update', errMsg(e));
    }
  };

  const remove = (j: Job) =>
    Alert.alert('Delete job posting?', `${j.title}${count(j) ? ` has ${count(j)} applicants.` : ''}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.delete(`/recruitment/jobs/${j.id}`);
            setForm(null);
            load();
          } catch (e) {
            Alert.alert('Could not delete', errMsg(e));
          }
        },
      },
    ]);

  if (denied) {
    return (
      <AppScreen showBack title="Job Postings">
        <Text style={styles.empty}>Job postings are managed by HR and administrators.</Text>
      </AppScreen>
    );
  }

  const openCount = jobs.filter((j) => j.status === 'Open').length;
  const draftCount = jobs.filter((j) => j.status === 'Draft').length;
  const closedCount = jobs.filter((j) => j.status === 'Closed').length;
  const totalApplicants = jobs.reduce((s, j) => s + count(j), 0);

  const header = (
    <View style={styles.headerDeck}>
      {/* KPI Cards Row */}
      <View style={styles.kpis}>
        <TouchableOpacity
          style={[
            styles.kpi,
            { backgroundColor: '#ECFDF5', borderColor: status === 'Open' ? '#047857' : 'transparent' },
          ]}
          onPress={() => setStatus(status === 'Open' ? '' : 'Open')}
          activeOpacity={0.75}
        >
          <Text style={[styles.kpiNum, { color: '#047857' }]}>{openCount}</Text>
          <Text style={[styles.kpiLabel, { color: '#047857' }]}>Open</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.kpi,
            { backgroundColor: '#F8FAFC', borderColor: status === 'Draft' ? '#475569' : 'transparent' },
          ]}
          onPress={() => setStatus(status === 'Draft' ? '' : 'Draft')}
          activeOpacity={0.75}
        >
          <Text style={[styles.kpiNum, { color: '#475569' }]}>{draftCount}</Text>
          <Text style={[styles.kpiLabel, { color: '#475569' }]}>Draft</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.kpi,
            { backgroundColor: '#FEF2F2', borderColor: status === 'Closed' ? '#B91C1C' : 'transparent' },
          ]}
          onPress={() => setStatus(status === 'Closed' ? '' : 'Closed')}
          activeOpacity={0.75}
        >
          <Text style={[styles.kpiNum, { color: '#B91C1C' }]}>{closedCount}</Text>
          <Text style={[styles.kpiLabel, { color: '#B91C1C' }]}>Closed</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.kpi,
            { backgroundColor: '#EEF2FF', borderColor: status === '' ? '#4338CA' : 'transparent' },
          ]}
          onPress={() => setStatus('')}
          activeOpacity={0.75}
        >
          <Text style={[styles.kpiNum, { color: '#4338CA' }]}>{totalApplicants}</Text>
          <Text style={[styles.kpiLabel, { color: '#4338CA' }]}>Applicants</Text>
        </TouchableOpacity>
      </View>

      {/* Search Input Bar */}
      <View style={styles.search}>
        <Search size={16} color="#94A3B8" strokeWidth={2.2} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search title, department, branch..."
          placeholderTextColor="#94A3B8"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <X size={14} color="#64748B" />
          </TouchableOpacity>
        )}
      </View>

      {/* Section Header with In-Screen New Job Action */}
      <View style={styles.sectionHeaderRow}>
        <View style={{ gap: 2 }}>
          <Text style={styles.sectionTitle}>
            {status ? `${status} Postings` : 'All Postings'} ({shown.length})
          </Text>
          <Text style={styles.sectionSub}>Tap any card to edit details or candidates</Text>
        </View>

        <TouchableOpacity style={styles.createBtn} onPress={() => openForm()} activeOpacity={0.8}>
          <Plus size={14} color="#FFFFFF" strokeWidth={2.4} />
          <Text style={styles.createBtnText}>New Job</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <AppScreen
      showBack
      title="Job Postings"
      subtitle={`${openCount} open · ${jobs.length} total`}
    >
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} size="large" />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(j) => String(j.id)}
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
              <Briefcase size={36} color="#CBD5E1" />
              <Text style={styles.empty}>No {status ? status.toLowerCase() + ' ' : ''}jobs match your criteria.</Text>
            </View>
          }
          renderItem={({ item: j }) => {
            const tone = TONE[j.status] || TONE.Draft;
            const closing =
              j.endDate && j.status === 'Open'
                ? Math.ceil((new Date(j.endDate).getTime() - Date.now()) / 86_400_000)
                : null;
            const cleanExp = j.experienceYears
              ? j.experienceYears.replace(/\s*(years|yrs)$/i, '').trim() + ' yrs exp'
              : null;
            const salaryRange =
              j.minSalary || j.maxSalary
                ? `${formatLakh(j.minSalary)}–${formatLakh(j.maxSalary)}`
                : null;

            return (
              <View style={styles.card}>
                <TouchableOpacity
                  style={styles.cardTop}
                  onPress={() => openForm(j)}
                  activeOpacity={0.8}
                >
                  <View style={styles.iconBox}>
                    <Briefcase size={20} color="#4338CA" strokeWidth={2.2} />
                  </View>

                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={styles.cardTitleRow}>
                      <Text style={styles.name} numberOfLines={1}>
                        {j.title}
                      </Text>
                      <View
                        style={[
                          styles.statusPill,
                          { backgroundColor: tone.bg, borderColor: tone.border },
                        ]}
                      >
                        <View style={[styles.statusDot, { backgroundColor: tone.dot }]} />
                        <Text style={[styles.statusText, { color: tone.text }]}>{j.status}</Text>
                      </View>
                    </View>

                    {/* Metadata Badges */}
                    <View style={styles.tagsRow}>
                      {!!j.department?.name && (
                        <View style={styles.tagPill}>
                          <Text style={styles.tagPillText} numberOfLines={1}>
                            {j.department.name}
                          </Text>
                        </View>
                      )}
                      <View style={styles.tagPill}>
                        <Text style={styles.tagPillText}>{j.type}</Text>
                      </View>
                      {!!cleanExp && (
                        <View style={styles.tagPill}>
                          <Text style={styles.tagPillText}>{cleanExp}</Text>
                        </View>
                      )}
                      {Number(j.totalOpenings) > 1 && (
                        <View style={styles.tagPill}>
                          <Text style={styles.tagPillText}>{j.totalOpenings} openings</Text>
                        </View>
                      )}
                    </View>

                    {/* Location & Salary Info */}
                    <View style={styles.metaRow}>
                      <View style={styles.metaItem}>
                        <MapPin size={12} color="#64748B" />
                        <Text style={styles.metaText} numberOfLines={1}>
                          {[j.branch?.name, j.workLocationType].filter(Boolean).join(' · ') || '—'}
                        </Text>
                      </View>

                      {salaryRange && (
                        <View style={styles.salaryBadge}>
                          <Text style={styles.salaryBadgeText}>{salaryRange} / yr</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </TouchableOpacity>

                {/* Card Footer with Applicants & Quick Actions */}
                <View style={styles.cardFoot}>
                  <TouchableOpacity
                    style={styles.applicantsPill}
                    onPress={() =>
                      navigation.navigate('Candidates', { jobId: j.id, jobTitle: j.title })
                    }
                    activeOpacity={0.75}
                  >
                    <Users size={13} color="#1373E5" strokeWidth={2.4} />
                    <Text style={styles.applicantsText}>
                      {count(j)} {count(j) === 1 ? 'applicant' : 'applicants'}
                    </Text>
                    <ChevronRight size={13} color="#1373E5" />
                  </TouchableOpacity>

                  {closing !== null && (
                    <View style={styles.closingBadge}>
                      <Clock size={11} color={closing <= 3 ? '#B91C1C' : '#64748B'} />
                      <Text
                        style={[
                          styles.closingText,
                          closing <= 3 && { color: '#B91C1C', fontWeight: '800' },
                        ]}
                      >
                        {closing < 0 ? 'Expired' : `Closes in ${closing}d`}
                      </Text>
                    </View>
                  )}

                  <View style={{ flex: 1 }} />

                  {j.status !== 'Open' ? (
                    <TouchableOpacity
                      style={styles.actionPillOpen}
                      onPress={() => setJobStatus(j, 'Open')}
                    >
                      <Text style={styles.actionPillOpenText}>Reopen</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.actionPillClose}
                      onPress={() => setJobStatus(j, 'Closed')}
                    >
                      <Text style={styles.actionPillCloseText}>Close</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          }}
        />
      )}

      {/* CREATE & EDIT JOB MODAL */}
      <Modal visible={!!form} transparent animationType="slide" onRequestClose={() => setForm(null)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.sheetTitle}>{form?.id ? 'Edit Job Posting' : 'Create Job Posting'}</Text>
                <Text style={styles.sheetSubtitle}>
                  {form?.id ? `Job #${form.id}` : 'Fill job specifications'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setForm(null)} style={styles.closeBtn}>
                <X size={20} color="#334155" />
              </TouchableOpacity>
            </View>

            {form && (
              <ScrollView
                contentContainerStyle={styles.formScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {/* 1. Basic Info Section */}
                <View style={styles.formSection}>
                  <Text style={styles.sectionHeading}>Basic Information</Text>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.inputLabel}>Job Title *</Text>
                    <TextInput
                      style={styles.input}
                      value={form.title}
                      onChangeText={(v) => setForm((f) => (f ? { ...f, title: v } : f))}
                      placeholder="e.g. Senior Backend Engineer"
                      placeholderTextColor="#94A3B8"
                    />
                  </View>

                  <Chips
                    label="Status"
                    options={STATUSES}
                    value={form.status}
                    onChange={(v) => setForm((f) => (f ? { ...f, status: v } : f))}
                  />

                  <Chips
                    label="Employment Type"
                    options={TYPES}
                    value={form.type}
                    onChange={(v) => setForm((f) => (f ? { ...f, type: v } : f))}
                  />

                  <Chips
                    label="Work Mode"
                    options={PLACES}
                    value={form.workLocationType}
                    onChange={(v) => setForm((f) => (f ? { ...f, workLocationType: v } : f))}
                  />
                </View>

                {/* 2. Placement Section */}
                <View style={styles.formSection}>
                  <Text style={styles.sectionHeading}>Department & Location</Text>

                  <Chips
                    label="Department"
                    options={masters.departments.map((d) => d.name)}
                    value={
                      masters.departments.find((d) => d.id === form.departmentId)?.name || ''
                    }
                    onChange={(v) =>
                      setForm((f) =>
                        f
                          ? {
                              ...f,
                              departmentId: masters.departments.find((d) => d.name === v)?.id ?? null,
                            }
                          : f
                      )
                    }
                  />

                  <Chips
                    label="Office Branch"
                    options={masters.branches.map((b) => b.name)}
                    value={masters.branches.find((b) => b.id === form.branchId)?.name || ''}
                    onChange={(v) =>
                      setForm((f) =>
                        f
                          ? {
                              ...f,
                              branchId: masters.branches.find((b) => b.name === v)?.id ?? null,
                            }
                          : f
                      )
                    }
                  />
                </View>

                {/* 3. Openings & Experience */}
                <View style={styles.formSection}>
                  <Text style={styles.sectionHeading}>Experience & Openings</Text>

                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={styles.inputLabel}>Experience</Text>
                      <TextInput
                        style={styles.input}
                        value={form.experienceYears}
                        onChangeText={(v) => setForm((f) => (f ? { ...f, experienceYears: v } : f))}
                        placeholder="e.g. 2-4 Years"
                        placeholderTextColor="#94A3B8"
                      />
                    </View>

                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={styles.inputLabel}>Vacancies</Text>
                      <TextInput
                        style={styles.input}
                        value={form.totalOpenings}
                        onChangeText={(v) =>
                          setForm((f) =>
                            f ? { ...f, totalOpenings: v.replace(/[^0-9]/g, '') } : f
                          )
                        }
                        placeholder="e.g. 3"
                        keyboardType="number-pad"
                        placeholderTextColor="#94A3B8"
                      />
                    </View>
                  </View>
                </View>

                {/* 4. Compensation Range */}
                <View style={styles.formSection}>
                  <Text style={styles.sectionHeading}>Compensation (Annual CTC)</Text>

                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={styles.inputLabel}>Min Salary (₹/yr)</Text>
                      <TextInput
                        style={styles.input}
                        value={form.minSalary}
                        onChangeText={(v) =>
                          setForm((f) =>
                            f ? { ...f, minSalary: v.replace(/[^0-9]/g, '') } : f
                          )
                        }
                        placeholder="e.g. 300000"
                        keyboardType="number-pad"
                        placeholderTextColor="#94A3B8"
                      />
                      {!!form.minSalary && (
                        <Text style={styles.salaryHelper}>
                          {formatSalaryHelper(form.minSalary)}
                        </Text>
                      )}
                    </View>

                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={styles.inputLabel}>Max Salary (₹/yr)</Text>
                      <TextInput
                        style={styles.input}
                        value={form.maxSalary}
                        onChangeText={(v) =>
                          setForm((f) =>
                            f ? { ...f, maxSalary: v.replace(/[^0-9]/g, '') } : f
                          )
                        }
                        placeholder="e.g. 600000"
                        keyboardType="number-pad"
                        placeholderTextColor="#94A3B8"
                      />
                      {!!form.maxSalary && (
                        <Text style={styles.salaryHelper}>
                          {formatSalaryHelper(form.maxSalary)}
                        </Text>
                      )}
                    </View>
                  </View>

                  <View style={[styles.fieldGroup, { marginTop: 4 }]}>
                    <Text style={styles.inputLabel}>Application Closing Date</Text>
                    <TextInput
                      style={styles.input}
                      value={form.endDate}
                      onChangeText={(v) => setForm((f) => (f ? { ...f, endDate: v } : f))}
                      placeholder="YYYY-MM-DD (optional)"
                      placeholderTextColor="#94A3B8"
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                {/* 5. Job Description */}
                <View style={styles.formSection}>
                  <Text style={styles.sectionHeading}>Job Description</Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={form.descriptionHtml}
                    onChangeText={(v) => setForm((f) => (f ? { ...f, descriptionHtml: v } : f))}
                    placeholder="Enter responsibilities, requirements, qualifications..."
                    placeholderTextColor="#94A3B8"
                    multiline
                  />
                </View>

                {/* Action Buttons */}
                <TouchableOpacity
                  style={[styles.submitBtn, !form.title.trim() && { opacity: 0.5 }]}
                  disabled={!form.title.trim()}
                  onPress={save}
                  activeOpacity={0.8}
                >
                  <Text style={styles.submitBtnText}>
                    {form.id ? 'Save Changes' : 'Create Job Posting'}
                  </Text>
                </TouchableOpacity>

                {!!form.id && (
                  <TouchableOpacity
                    style={styles.dangerBtn}
                    onPress={() => {
                      const j = jobs.find((x) => x.id === form.id);
                      if (j) remove(j);
                    }}
                    activeOpacity={0.8}
                  >
                    <Trash2 size={16} color="#B91C1C" />
                    <Text style={styles.dangerBtnText}>Delete Job Posting</Text>
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

function Chips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  if (!options.length) return null;
  return (
    <View style={styles.chipsContainer}>
      <Text style={styles.inputLabel}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsScroll}
      >
        {options.map((o) => {
          const isSelected = value === o;
          return (
            <TouchableOpacity
              key={o}
              style={[styles.chip, isSelected && styles.chipActive]}
              onPress={() => onChange(o)}
              activeOpacity={0.8}
            >
              <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>{o}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
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

  // KPI Metrics Deck
  kpis: {
    flexDirection: 'row',
    gap: 8,
  },
  kpi: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1.5,
    gap: 2,
  },
  kpiNum: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
  },

  // Search Input
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

  // Section Header with New Job Action
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  sectionSub: {
    fontSize: 11,
    fontWeight: '500',
    color: '#64748B',
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1373E5',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#1373E5',
        shadowOpacity: 0.25,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  createBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },

  // Job Cards
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOpacity: 0.04,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
      android: {
        elevation: 1.5,
      },
    }),
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  name: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    flex: 1,
    letterSpacing: -0.2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 4,
  },
  tagPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  tagPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  metaText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  salaryBadge: {
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#DCFCE7',
  },
  salaryBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#15803D',
  },

  // Card Footer
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
    backgroundColor: '#FAFAFC',
  },
  applicantsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  applicantsText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1373E5',
  },
  closingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
  },
  closingText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  actionPillOpen: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  actionPillOpenText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#047857',
  },
  actionPillClose: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  actionPillCloseText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#B91C1C',
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
  // MODAL & FORM STYLES
  // -------------------------------------------------------------
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    paddingBottom: 30,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  sheetSubtitle: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  closeBtn: {
    padding: 6,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
  },
  formScroll: {
    padding: 16,
    gap: 14,
  },
  formSection: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    gap: 12,
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  fieldGroup: {
    gap: 5,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
  },
  textArea: {
    minHeight: 110,
    textAlignVertical: 'top',
    lineHeight: 20,
  },
  salaryHelper: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
    marginTop: 2,
  },
  chipsContainer: {
    gap: 6,
  },
  chipsScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chipActive: {
    backgroundColor: '#1373E5',
    borderColor: '#1373E5',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  submitBtn: {
    height: 48,
    borderRadius: 14,
    backgroundColor: '#1373E5',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    ...Platform.select({
      ios: {
        shadowColor: '#1373E5',
        shadowOpacity: 0.25,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
  dangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  dangerBtnText: {
    color: '#B91C1C',
    fontWeight: '800',
    fontSize: 14,
  },
});
