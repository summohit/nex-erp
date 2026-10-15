import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, Modal, FlatList, Linking,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import {
  ArrowLeft,
  FolderKanban,
  Compass,
  MapPin,
  LocateFixed,
  Calendar,
  Clock,
  Users,
  CheckSquare,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  X,
  ChevronRight,
  ChevronDown,
  Check,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  FileText,
  Send,
  Upload,
  Building2,
} from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import {
  fieldVisitRequestService as fv, ProjectLite, VisitLocation, TaskOption, FvAttachment, FvLeaveClash,
  VisitLocationCapabilities, NewFieldVisit,
} from '../../api/fieldVisitRequestService';
import MediaPickerModal from '../Profile/components/MediaPickerModal';
import { workService, PersonLite } from '../../api/workService';
import { getCurrentLocation, requestLocationPermission } from '../../store/dashboardStore';
import { theme } from '../../theme/theme';
import { initials } from './fvFormat';

type PickerKind = 'PROJECT' | 'SITE' | 'PEOPLE' | 'TASKS' | null;
type TaskLine = { issueId?: number; name: string; key?: string };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const nice = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const niceTime = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const personName = (p: PersonLite) => `${p.firstName} ${p.lastName || ''}`.trim();

/**
 * Raise, edit or change a field visit request — executive mobile form matching ERP standards.
 */
export default function FieldVisitRequestForm() {
  const navigation = useNavigation<any>();
  const params = (useRoute<any>().params ?? {}) as { mode?: 'new' | 'edit' | 'change'; id?: number };
  const mode = params.id ? params.mode ?? 'edit' : 'new';
  const today = ymd(new Date());

  const [visitType, setVisitType] = useState<'PROJECT' | 'GENERAL'>('PROJECT');
  const [project, setProject] = useState<ProjectLite | null>(null);
  const [site, setSite] = useState<{ name: string; lat?: number; lng?: number; visitLocationId?: number }>({ name: '' });
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [startTime, setStartTime] = useState('09:30');
  const [endTime, setEndTime] = useState('18:30');
  const [people, setPeople] = useState<PersonLite[]>([]);
  const [tasks, setTasks] = useState<TaskLine[]>([]);
  const [newTask, setNewTask] = useState('');
  const [remarks, setRemarks] = useState('');
  /** Required when asking to change an approved visit. */
  const [changeReason, setChangeReason] = useState('');
  const [submitting, setSubmitting] = useState<'draft' | 'send' | null>(null);
  const [locating, setLocating] = useState(false);
  const [attachments, setAttachments] = useState<FvAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [clashes, setClashes] = useState<FvLeaveClash[]>([]);
  const [loadingVisit, setLoadingVisit] = useState(mode !== 'new');
  const hydrating = useRef(false);

  // New saved site
  const [locCaps, setLocCaps] = useState<VisitLocationCapabilities | null>(null);
  const [siteForm, setSiteForm] = useState<{ name: string; address: string; lat?: number; lng?: number } | null>(null);
  const [savingSite, setSavingSite] = useState(false);

  // Picker data
  const [picker, setPicker] = useState<PickerKind>(null);
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [sites, setSites] = useState<VisitLocation[]>([]);
  const [employees, setEmployees] = useState<PersonLite[]>([]);
  const [taskOptions, setTaskOptions] = useState<TaskOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  // Date / time pickers
  const [dateTarget, setDateTarget] = useState<'start' | 'end' | null>(null);
  const [timeTarget, setTimeTarget] = useState<'start' | 'end' | null>(null);

  const [canRaiseProject, setCanRaiseProject] = useState(true);

  useEffect(() => {
    Promise.all([fv.projects(), fv.capabilities()])
      .then(([all, caps]) => {
        const mine = caps.allProjects ? all : all.filter((p) => caps.managedProjectIds.includes(p.id));
        setProjects(mine);
        if (!caps.allProjects && mine.length === 0) {
          setCanRaiseProject(false);
          setVisitType('GENERAL');
        }
      })
      .catch(() => fv.projects().then(setProjects).catch(() => {}));
    fv.visitLocations().then(setSites).catch(() => {});
    fv.locationCapabilities().then(setLocCaps).catch(() => {});
    workService.getEmployees().then(setEmployees).catch(() => {});
  }, []);

  useEffect(() => {
    if (!params.id) return;
    fv.get(params.id)
      .then((v) => {
        hydrating.current = true;
        setVisitType(v.project?.isSystem ? 'GENERAL' : 'PROJECT');
        if (v.project && !v.project.isSystem) setProject({ id: v.project.id, name: v.project.name, key: v.project.key });
        setSite({ name: v.location, lat: v.latitude, lng: v.longitude, visitLocationId: v.visitLocation?.id });
        setStartDate(v.startDate.slice(0, 10));
        setEndDate(v.endDate.slice(0, 10));
        setStartTime(v.startTime);
        setEndTime(v.endTime);
        setPeople(v.members.map((m) => m.employee as PersonLite));
        setTasks(v.tasks.map((t) => ({ issueId: t.issueId ?? undefined, name: t.issue?.title ?? t.name, key: t.issue?.key })));
        setRemarks(v.remarks ?? '');
        setAttachments((v.attachments ?? []).map((a) => ({ fileName: a.fileName, fileUrl: a.fileUrl, fileSize: a.fileSize ?? undefined })));
      })
      .catch((e: any) => Alert.alert('Could not load', e?.response?.data?.message || 'Please try again.', [{ text: 'OK', onPress: () => navigation.goBack() }]))
      .finally(() => setLoadingVisit(false));
  }, [params.id, navigation]);

  useEffect(() => {
    if (hydrating.current) { hydrating.current = false; return; }
    setTasks([]);
  }, [visitType, project?.id]);

  useEffect(() => {
    const ids = people.map((p) => p.id);
    if (!ids.length || endDate < startDate) { setClashes([]); return; }
    fv.availability(ids, startDate, endDate).then(setClashes).catch(() => setClashes([]));
  }, [people, startDate, endDate]);

  const clashText = useMemo(() => clashes.map((c) => {
    const p = people.find((x) => x.id === c.employeeId);
    const from = c.startDate.slice(0, 10); const to = c.endDate.slice(0, 10);
    return `${p ? personName(p) : 'Someone'} is on leave ${from === to ? nice(from) : `${nice(from)} – ${nice(to)}`}`;
  }), [clashes, people]);

  const addAttachment = async (asset: { uri: string; fileName: string; type: string; fileSize?: number }) => {
    setMediaOpen(false);
    setUploading(true);
    try {
      const fileUrl = await fv.upload(asset);
      if (!fileUrl) throw new Error('The server did not return the file.');
      setAttachments((prev) => [...prev, { fileName: asset.fileName, fileUrl, fileSize: asset.fileSize }]);
    } catch (e: any) {
      Alert.alert('Could not attach', e?.response?.data?.message || e?.message || 'Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const openSiteForm = () => { setPicker(null); setSiteForm({ name: '', address: '' }); };

  const pinSiteHere = async () => {
    try {
      if (!(await requestLocationPermission())) throw new Error('Allow location for MIRA first.');
      const fix = await getCurrentLocation();
      setSiteForm((f) => (f ? { ...f, lat: fix.lat, lng: fix.lng } : f));
    } catch (e: any) {
      Alert.alert('No location', e?.message || 'Turn on Location and try again.');
    }
  };

  const saveSite = async () => {
    if (!siteForm?.name.trim()) return;
    const body = {
      name: siteForm.name.trim(), address: siteForm.address.trim() || undefined,
      latitude: siteForm.lat, longitude: siteForm.lng,
    };
    setSavingSite(true);
    try {
      if (locCaps?.isAdmin) {
        const added = await fv.addLocation(body);
        setSites((prev) => [...prev, added]);
        if (added.latitude != null && added.longitude != null) {
          setSite({ name: added.name, lat: added.latitude, lng: added.longitude, visitLocationId: added.id });
        }
        Alert.alert('Site added', `${added.name} is now a saved site.`);
      } else {
        await fv.requestLocation(body);
        Alert.alert('Sent for approval', `${body.name} will appear as a saved site once an administrator approves it. You can still pin the site for this visit now.`);
      }
      setSiteForm(null);
    } catch (e: any) {
      Alert.alert('Could not save the site', e?.response?.data?.message || 'Please try again.');
    } finally {
      setSavingSite(false);
    }
  };

  const openTaskPicker = async () => {
    setQuery('');
    setPicker('TASKS');
    setLoadingOptions(true);
    try {
      setTaskOptions(visitType === 'GENERAL'
        ? await fv.generalTasks(people.map((p) => p.id))
        : project ? await fv.projectTasks(project.id) : []);
    } catch {
      setTaskOptions([]);
    } finally {
      setLoadingOptions(false);
    }
  };

  const useCurrentLocation = async () => {
    setLocating(true);
    try {
      if (!(await requestLocationPermission())) throw new Error('Allow location for MIRA first.');
      const fix = await getCurrentLocation();
      setSite((s) => ({ ...s, lat: fix.lat, lng: fix.lng, visitLocationId: undefined }));
      if (fix.accuracy > 150) {
        Alert.alert('Location is approximate', `Your phone placed you within about ${Math.round(fix.accuracy)} m. Pick a saved site if there is one — clock-ins are measured from this point.`);
      }
    } catch (e: any) {
      Alert.alert('No location', e?.message || 'Turn on Location and try again.');
    } finally {
      setLocating(false);
    }
  };

  const days = Math.max(1, Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1);

  const problems = useMemo(() => {
    const p: string[] = [];
    if (visitType === 'PROJECT' && !project) p.push('Pick the project');
    if (mode === 'change' && !changeReason.trim()) p.push('Give a reason for the change');
    if (!site.name.trim()) p.push('Name the site');
    if (site.lat == null || site.lng == null) p.push('Pick a saved site or use your current location for the site pin');
    if (endDate < startDate) p.push('The end date is before the start date');
    if (endTime <= startTime) p.push('Clock-out time must be after clock-in time');
    if (!people.length) p.push('Add who is going');
    if (!tasks.length) p.push('Add at least one task');
    return p;
  }, [visitType, project, site, startDate, endDate, startTime, endTime, people, tasks, mode, changeReason]);

  const save = async (send: boolean) => {
    if (problems.length) { Alert.alert('Almost there', problems.join('\n')); return; }
    setSubmitting(send ? 'send' : 'draft');
    const body: NewFieldVisit = {
      visitType,
      projectId: visitType === 'PROJECT' ? project!.id : undefined,
      location: site.name.trim(),
      visitLocationId: site.visitLocationId,
      latitude: site.lat!, longitude: site.lng!,
      startDate, endDate, startTime, endTime,
      remarks: remarks.trim() || undefined,
      ...(mode === 'change' ? { changeReason: changeReason.trim() } : {}),
      employeeIds: people.map((p) => p.id),
      tasks: tasks.map((t) => ({ issueId: t.issueId, name: t.name })),
      attachments,
      submit: send,
    };
    try {
      let saved;
      if (mode === 'change') {
        saved = await fv.requestChange(params.id!, body);
        Alert.alert('Change sent', `The change to ${saved?.requestNumber ?? 'this visit'} is waiting for approval. The visit stays as it is until then.`,
          [{ text: 'OK', onPress: () => navigation.goBack() }]);
        return;
      }
      if (mode === 'edit') {
        saved = await fv.update(params.id!, { ...body, submit: false });
        if (send) saved = await fv.submit(params.id!);
      } else {
        saved = await fv.create(body);
      }
      const title = !send ? 'Draft saved' : saved?.status === 'APPROVED' ? 'Approved' : 'Request sent';
      const message = !send
        ? `${saved?.requestNumber ?? 'Your draft'} is saved. Send it for approval when it is ready.`
        : saved?.status === 'APPROVED'
          ? `${saved.requestNumber} is approved — clock in from Today when you reach the site.`
          : `${saved?.requestNumber ?? 'Your request'} is waiting for approval.`;
      Alert.alert(title, message, [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      Alert.alert(send ? 'Could not send' : 'Could not save', Array.isArray(msg) ? msg.join('\n') : msg || 'Please try again.');
    } finally {
      setSubmitting(null);
    }
  };

  const q = query.trim().toLowerCase();
  const pickerRows = picker === 'PROJECT' ? projects.filter((p) => !q || `${p.name} ${p.key}`.toLowerCase().includes(q)).map((p) => ({
    id: p.id, title: p.name, sub: p.key, on: project?.id === p.id, onPress: () => { setProject(p); setPicker(null); },
  }))
  : picker === 'SITE' ? sites.filter((s) => !q || `${s.name} ${s.address || ''}`.toLowerCase().includes(q)).map((s) => ({
    id: s.id, title: s.name, sub: s.address || undefined, on: site.visitLocationId === s.id,
    onPress: () => {
      if (s.latitude == null || s.longitude == null) { Alert.alert('No pin', 'This saved site has no map pin. Use your current location instead.'); return; }
      setSite({ name: s.name, lat: s.latitude, lng: s.longitude, visitLocationId: s.id }); setPicker(null);
    },
  }))
  : picker === 'PEOPLE' ? employees.filter((p) => !q || `${personName(p)} ${p.employeeCode || ''}`.toLowerCase().includes(q)).map((p) => {
    const on = people.some((x) => x.id === p.id);
    return { id: p.id, title: personName(p), sub: p.employeeCode ? `#${p.employeeCode}` : undefined, on, person: p,
      onPress: () => setPeople((prev) => (on ? prev.filter((x) => x.id !== p.id) : [...prev, p])) };
  })
  : picker === 'TASKS' ? taskOptions.filter((t) => !q || `${t.key} ${t.title}`.toLowerCase().includes(q)).map((t) => {
    const on = tasks.some((x) => x.issueId === t.id);
    return { id: t.id, title: t.title, sub: t.key, on,
      onPress: () => setTasks((prev) => (on ? prev.filter((x) => x.issueId !== t.id) : [...prev, { issueId: t.id, name: t.title, key: t.key }])) };
  })
  : [];
  const multi = picker === 'PEOPLE' || picker === 'TASKS';

  return (
    <AppScreen
      title={mode === 'change' ? 'Request a Change' : mode === 'edit' ? 'Edit Draft' : 'New Field Visit'}
      subtitle={mode === 'change' ? 'Approved visit — needs approval again' : 'Request a site visit'}
    >
      {loadingVisit ? (
        <View style={styles.centerLoader}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.centerLoaderText}>Loading request details…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollBody} keyboardShouldPersistTaps="handled">
          {/* Back Pill */}
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} activeOpacity={0.7}>
            <ArrowLeft size={16} color="#0F172A" strokeWidth={2.4} />
            <Text style={styles.backButtonText}>Cancel & Go Back</Text>
          </TouchableOpacity>

          {/* Change Mode Notice */}
          {mode === 'change' && (
            <View style={styles.changeNoticeBanner}>
              <AlertTriangle size={18} color="#D97706" strokeWidth={2.2} />
              <Text style={styles.changeNoticeText}>
                Change what is needed and submit. The visit remains as approved until an administrator accepts the change.
              </Text>
            </View>
          )}

          {/* Section 1: Type of Visit & Project */}
          <View style={styles.formCard}>
            <View style={styles.cardHeaderRow}>
              <View style={[styles.cardHeaderIcon, { backgroundColor: '#EFF6FF' }]}>
                <FolderKanban size={16} color="#1373e5" strokeWidth={2.2} />
              </View>
              <Text style={styles.cardHeaderTitle}>TYPE OF VISIT</Text>
            </View>

            {mode === 'change' ? (
              <View style={styles.readOnlyBadge}>
                <Text style={styles.readOnlyBadgeText}>
                  {visitType === 'GENERAL' ? 'General Visit' : 'Project Visit'}
                </Text>
              </View>
            ) : canRaiseProject ? (
              <View style={styles.segmentContainer}>
                {(['PROJECT', 'GENERAL'] as const).map((t) => {
                  const active = visitType === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                      activeOpacity={0.8}
                      onPress={() => setVisitType(t)}
                    >
                      {t === 'PROJECT' ? (
                        <FolderKanban size={14} color={active ? '#1373e5' : '#64748B'} strokeWidth={2.2} />
                      ) : (
                        <Compass size={14} color={active ? '#1373e5' : '#64748B'} strokeWidth={2.2} />
                      )}
                      <Text style={[styles.segmentBtnText, active && styles.segmentBtnTextActive]}>
                        {t === 'PROJECT' ? 'Project visit' : 'General visit'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <View style={styles.helperNotice}>
                <Text style={styles.helperNoticeText}>
                  General visit — built from your own general tasks. Project visits require project manager access.
                </Text>
              </View>
            )}

            {visitType === 'PROJECT' && (
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Project *</Text>
                <TouchableOpacity
                  style={[styles.selectBox, !project && styles.selectBoxEmpty]}
                  activeOpacity={0.75}
                  disabled={mode === 'change'}
                  onPress={() => { setQuery(''); setPicker('PROJECT'); }}
                >
                  <View style={styles.selectLeft}>
                    <View style={[styles.fieldInnerIcon, { backgroundColor: '#F3E8FF' }]}>
                      <FolderKanban size={15} color="#9333EA" strokeWidth={2.2} />
                    </View>
                    <Text style={project ? styles.selectValueText : styles.selectPlaceholderText} numberOfLines={1}>
                      {project ? `${project.name} (${project.key})` : 'Pick a project'}
                    </Text>
                  </View>
                  <ChevronDown size={18} color="#94A3B8" />
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Section 2: Location & Site */}
          <View style={styles.formCard}>
            <View style={styles.cardHeaderRow}>
              <View style={[styles.cardHeaderIcon, { backgroundColor: '#F0F9FF' }]}>
                <MapPin size={16} color="#0284C7" strokeWidth={2.2} />
              </View>
              <Text style={styles.cardHeaderTitle}>SITE & LOCATION *</Text>
            </View>

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Saved Site</Text>
              <TouchableOpacity
                style={styles.selectBox}
                activeOpacity={0.75}
                onPress={() => { setQuery(''); setPicker('SITE'); }}
              >
                <View style={styles.selectLeft}>
                  <View style={[styles.fieldInnerIcon, { backgroundColor: '#EFF6FF' }]}>
                    <Building2 size={15} color="#1373e5" strokeWidth={2.2} />
                  </View>
                  <Text style={site.visitLocationId ? styles.selectValueText : styles.selectPlaceholderText} numberOfLines={1}>
                    {site.visitLocationId ? site.name : 'Pick a saved site'}
                  </Text>
                </View>
                <ChevronDown size={18} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR CUSTOM SITE</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Site Name</Text>
              <TextInput
                style={styles.textInputBox}
                placeholder="e.g. Airtel Center Gurugram"
                placeholderTextColor="#94A3B8"
                value={site.visitLocationId ? '' : site.name}
                onChangeText={(v) => setSite((s) => ({ ...s, name: v, visitLocationId: undefined }))}
              />
            </View>

            <TouchableOpacity
              style={[styles.locationActionTile, site.lat != null && !site.visitLocationId && styles.locationActionTileActive]}
              activeOpacity={0.8}
              onPress={useCurrentLocation}
              disabled={locating}
            >
              {locating ? (
                <ActivityIndicator color={theme.colors.primary} size="small" />
              ) : (
                <View style={styles.locationActionInner}>
                  <View style={[styles.gpsIconCircle, site.lat != null && !site.visitLocationId && styles.gpsIconCircleActive]}>
                    <LocateFixed
                      size={18}
                      color={site.lat != null && !site.visitLocationId ? '#15803D' : '#1373e5'}
                      strokeWidth={2.4}
                    />
                  </View>
                  <View style={styles.locationActionTextCol}>
                    <Text style={[styles.locationActionTitle, site.lat != null && !site.visitLocationId && styles.locationActionTitleActive]}>
                      {site.lat != null && !site.visitLocationId
                        ? `GPS Pin Set (${site.lat.toFixed(4)}, ${site.lng!.toFixed(4)})`
                        : 'Use my current location as site pin'}
                    </Text>
                    <Text style={styles.locationActionSub}>
                      {site.lat != null && !site.visitLocationId ? 'Tap to refresh GPS coordinates' : 'Clock-ins are verified within approved distance'}
                    </Text>
                  </View>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Section 3: Schedule & Hours */}
          <View style={styles.formCard}>
            <View style={styles.cardHeaderRow}>
              <View style={[styles.cardHeaderIcon, { backgroundColor: '#F0FDF4' }]}>
                <Calendar size={16} color="#16A34A" strokeWidth={2.2} />
              </View>
              <Text style={styles.cardHeaderTitle}>DATES & HOURS *</Text>
            </View>

            {/* Date Pickers Row */}
            <View style={styles.dualGrid}>
              <View style={styles.dualCol}>
                <Text style={styles.fieldLabel}>From *</Text>
                <TouchableOpacity
                  style={styles.pickerTile}
                  activeOpacity={0.75}
                  onPress={() => setDateTarget('start')}
                >
                  <Calendar size={15} color="#1373e5" strokeWidth={2} />
                  <Text style={styles.pickerTileText}>{nice(startDate)}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.dualCol}>
                <Text style={styles.fieldLabel}>To *</Text>
                <TouchableOpacity
                  style={styles.pickerTile}
                  activeOpacity={0.75}
                  onPress={() => setDateTarget('end')}
                >
                  <Calendar size={15} color="#1373e5" strokeWidth={2} />
                  <Text style={styles.pickerTileText}>{nice(endDate)}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.durationPill}>
              <Clock size={12} color="#64748B" strokeWidth={2} />
              <Text style={styles.durationPillText}>
                {days} calendar day{days === 1 ? '' : 's'} duration
              </Text>
            </View>

            {/* Time Pickers Row */}
            <View style={[styles.dualGrid, { marginTop: 4 }]}>
              <View style={styles.dualCol}>
                <Text style={styles.fieldLabel}>Expected Clock-in</Text>
                <TouchableOpacity
                  style={styles.pickerTile}
                  activeOpacity={0.75}
                  onPress={() => setTimeTarget('start')}
                >
                  <Clock size={15} color="#475569" strokeWidth={2} />
                  <Text style={styles.pickerTileText}>{niceTime(startTime)}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.dualCol}>
                <Text style={styles.fieldLabel}>Expected Clock-out</Text>
                <TouchableOpacity
                  style={styles.pickerTile}
                  activeOpacity={0.75}
                  onPress={() => setTimeTarget('end')}
                >
                  <Clock size={15} color="#475569" strokeWidth={2} />
                  <Text style={styles.pickerTileText}>{niceTime(endTime)}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Section 4: Who is Going */}
          <View style={styles.formCard}>
            <View style={styles.cardHeaderRow}>
              <View style={[styles.cardHeaderIcon, { backgroundColor: '#EEF2FF' }]}>
                <Users size={16} color="#4338CA" strokeWidth={2.2} />
              </View>
              <Text style={styles.cardHeaderTitle}>WHO IS GOING *</Text>
              <View style={styles.countBadgePill}>
                <Text style={styles.countBadgePillText}>{people.length}</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.selectBox}
              activeOpacity={0.75}
              onPress={() => { setQuery(''); setPicker('PEOPLE'); }}
            >
              <View style={styles.selectLeft}>
                <View style={[styles.fieldInnerIcon, { backgroundColor: '#EEF2FF' }]}>
                  <Users size={15} color="#4338CA" strokeWidth={2.2} />
                </View>
                <Text style={people.length ? styles.selectValueText : styles.selectPlaceholderText} numberOfLines={1}>
                  {people.length ? `${people.length} member${people.length === 1 ? '' : 's'} assigned` : 'Add team members'}
                </Text>
              </View>
              <Plus size={18} color="#1373e5" strokeWidth={2.5} />
            </TouchableOpacity>

            {people.length > 0 && (
              <View style={styles.chipsWrap}>
                {people.map((p) => (
                  <View key={p.id} style={styles.personPillCard}>
                    <View style={styles.personPillAvatar}>
                      <Text style={styles.personPillAvatarText}>{initials(p)}</Text>
                    </View>
                    <Text style={styles.personPillName} numberOfLines={1}>{personName(p)}</Text>
                    <TouchableOpacity
                      onPress={() => setPeople((prev) => prev.filter((x) => x.id !== p.id))}
                      hitSlop={8}
                    >
                      <X size={14} color="#94A3B8" strokeWidth={2.4} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {clashText.length > 0 && (
              <View style={styles.clashBox}>
                <View style={styles.clashBoxHead}>
                  <AlertTriangle size={15} color="#EA580C" strokeWidth={2.2} />
                  <Text style={styles.clashTitle}>On leave during this visit</Text>
                </View>
                {clashText.map((t) => (
                  <Text key={t} style={styles.clashLine}>• {t}</Text>
                ))}
                <Text style={styles.clashHint}>You can still submit — the approver will review this clash.</Text>
              </View>
            )}
          </View>

          {/* Section 5: Tasks & Work Breakdown */}
          <View style={styles.formCard}>
            <View style={styles.cardHeaderRow}>
              <View style={[styles.cardHeaderIcon, { backgroundColor: '#FAF5FF' }]}>
                <CheckSquare size={16} color="#7E22CE" strokeWidth={2.2} />
              </View>
              <Text style={styles.cardHeaderTitle}>TASKS *</Text>
              <View style={[styles.countBadgePill, { backgroundColor: '#FAF5FF' }]}>
                <Text style={[styles.countBadgePillText, { color: '#7E22CE' }]}>{tasks.length}</Text>
              </View>
            </View>

            {/* Added Tasks List */}
            {tasks.map((t, i) => (
              <View key={`${t.issueId ?? 'new'}-${i}`} style={styles.taskCardItem}>
                <View style={styles.taskCardInfo}>
                  <View style={styles.taskCardPill}>
                    <Text style={styles.taskCardPillText}>{t.key ? `#${t.key}` : 'NEW WORK'}</Text>
                  </View>
                  <Text style={styles.taskCardTitle} numberOfLines={2}>{t.name}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setTasks((prev) => prev.filter((_, j) => j !== i))}
                  style={styles.taskRemoveTouch}
                >
                  <Trash2 size={16} color="#DC2626" strokeWidth={2} />
                </TouchableOpacity>
              </View>
            ))}

            <TouchableOpacity
              style={[
                styles.selectBox,
                (visitType === 'PROJECT' ? !project : !people.length) && { opacity: 0.5 },
              ]}
              disabled={visitType === 'PROJECT' ? !project : !people.length}
              activeOpacity={0.75}
              onPress={openTaskPicker}
            >
              <View style={styles.selectLeft}>
                <View style={[styles.fieldInnerIcon, { backgroundColor: '#FAF5FF' }]}>
                  <CheckSquare size={15} color="#7E22CE" strokeWidth={2.2} />
                </View>
                <Text style={styles.selectPlaceholderText} numberOfLines={1}>
                  {visitType === 'PROJECT'
                    ? (project ? 'Browse project tasks' : 'Pick a project first')
                    : (people.length ? "Browse members' general tasks" : 'Add team members first')}
                </Text>
              </View>
              <Plus size={18} color="#7E22CE" strokeWidth={2.5} />
            </TouchableOpacity>

            {visitType === 'PROJECT' && (
              <View style={styles.customTaskRow}>
                <TextInput
                  style={[styles.textInputBox, styles.flexInput]}
                  placeholder="…or type new task description"
                  placeholderTextColor="#94A3B8"
                  value={newTask}
                  onChangeText={setNewTask}
                />
                <TouchableOpacity
                  style={[styles.taskAddBtn, !newTask.trim() && { opacity: 0.5 }]}
                  disabled={!newTask.trim()}
                  activeOpacity={0.8}
                  onPress={() => { setTasks((p) => [...p, { name: newTask.trim() }]); setNewTask(''); }}
                >
                  <Plus size={16} color="#FFFFFF" strokeWidth={2.6} />
                  <Text style={styles.taskAddBtnText}>Add</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Section 6: Remarks & Attachments */}
          <View style={styles.formCard}>
            <View style={styles.cardHeaderRow}>
              <View style={[styles.cardHeaderIcon, { backgroundColor: '#FFFBEB' }]}>
                <MessageSquare size={16} color="#D97706" strokeWidth={2.2} />
              </View>
              <Text style={styles.cardHeaderTitle}>REMARKS & ATTACHMENTS</Text>
            </View>

            {mode === 'change' && (
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Reason for the change *</Text>
                <TextInput
                  style={[styles.textInputBox, styles.textAreaBox]}
                  placeholder="Why does this visit need to change? The approver sees this."
                  placeholderTextColor="#94A3B8"
                  value={changeReason}
                  onChangeText={setChangeReason}
                  multiline
                />
              </View>
            )}

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Remarks (Optional)</Text>
              <TextInput
                style={[styles.textInputBox, styles.textAreaBox]}
                placeholder="Anything the approver should know about this trip"
                placeholderTextColor="#94A3B8"
                value={remarks}
                onChangeText={setRemarks}
                multiline
              />
            </View>

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Attachments ({attachments.length})</Text>
              {attachments.map((a, i) => (
                <View key={`${a.fileUrl}-${i}`} style={styles.attachmentCardRow}>
                  <FileText size={16} color="#1373e5" strokeWidth={2} />
                  <Text
                    style={styles.attachmentCardName}
                    numberOfLines={1}
                    onPress={() => Linking.openURL(a.fileUrl)}
                  >
                    {a.fileName}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    hitSlop={8}
                  >
                    <Trash2 size={16} color="#DC2626" strokeWidth={2} />
                  </TouchableOpacity>
                </View>
              ))}

              <TouchableOpacity
                style={styles.attachmentBtn}
                activeOpacity={0.8}
                disabled={uploading}
                onPress={() => setMediaOpen(true)}
              >
                {uploading ? (
                  <ActivityIndicator color={theme.colors.primary} size="small" />
                ) : (
                  <>
                    <Upload size={16} color="#1373e5" strokeWidth={2.2} />
                    <Text style={styles.attachmentBtnText}>Attach photo or PDF document</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Bottom Action Submit Controls */}
          <View style={styles.actionControls}>
            {mode === 'change' ? (
              <TouchableOpacity
                style={[styles.primaryActionBtn, !!submitting && { opacity: 0.7 }]}
                activeOpacity={0.85}
                disabled={!!submitting}
                onPress={() => save(true)}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Send size={18} color="#FFFFFF" strokeWidth={2.4} />
                    <Text style={styles.primaryActionBtnText}>Send Change for Approval</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.primaryActionBtn, !!submitting && { opacity: 0.7 }]}
                  activeOpacity={0.85}
                  disabled={!!submitting}
                  onPress={() => save(true)}
                >
                  {submitting === 'send' ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Send size={18} color="#FFFFFF" strokeWidth={2.4} />
                      <Text style={styles.primaryActionBtnText}>Send for Approval</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.draftActionBtn, !!submitting && { opacity: 0.7 }]}
                  activeOpacity={0.8}
                  disabled={!!submitting}
                  onPress={() => save(false)}
                >
                  {submitting === 'draft' ? (
                    <ActivityIndicator color={theme.colors.primary} />
                  ) : (
                    <>
                      <FileText size={17} color="#334155" strokeWidth={2} />
                      <Text style={styles.draftActionBtnText}>
                        {mode === 'edit' ? 'Save Draft' : 'Save as Draft'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      )}

      {/* Media Picker */}
      <MediaPickerModal
        visible={mediaOpen}
        onClose={() => setMediaOpen(false)}
        onMediaSelected={addAttachment}
        title="Attach to the request"
        allowFiles
        maxSizeMB={10}
      />

      {/* Saved Site Form Modal */}
      <Modal visible={!!siteForm} animationType="slide" onRequestClose={() => setSiteForm(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {locCaps?.isAdmin ? 'Add a Saved Site' : 'Request a Saved Site'}
              </Text>
              <TouchableOpacity onPress={() => setSiteForm(null)} style={styles.modalCloseBtn}>
                <X size={18} color="#0F172A" strokeWidth={2.4} />
              </TouchableOpacity>
            </View>

            {!locCaps?.isAdmin && (
              <View style={styles.modalNotice}>
                <Text style={styles.modalNoticeText}>
                  An administrator will review and approve this site before it is saved globally.
                </Text>
              </View>
            )}

            <Text style={styles.fieldLabel}>Site Name *</Text>
            <TextInput
              style={styles.textInputBox}
              placeholder="e.g. PNB Head Office, Delhi"
              placeholderTextColor="#94A3B8"
              value={siteForm?.name ?? ''}
              onChangeText={(v) => setSiteForm((f) => (f ? { ...f, name: v } : f))}
            />

            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Address</Text>
            <TextInput
              style={[styles.textInputBox, styles.textAreaBox]}
              placeholder="Street, area, city"
              placeholderTextColor="#94A3B8"
              value={siteForm?.address ?? ''}
              multiline
              onChangeText={(v) => setSiteForm((f) => (f ? { ...f, address: v } : f))}
            />

            <TouchableOpacity style={styles.modalGpsBtn} activeOpacity={0.8} onPress={pinSiteHere}>
              <LocateFixed size={17} color="#1373e5" strokeWidth={2.4} />
              <Text style={styles.modalGpsBtnText}>
                {siteForm?.lat != null
                  ? `Pinned (${siteForm.lat.toFixed(4)}, ${siteForm.lng!.toFixed(4)}) — tap to update`
                  : 'Pin at my current location'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.primaryActionBtn, (!siteForm?.name.trim() || savingSite) && { opacity: 0.5 }, { marginTop: 16 }]}
              disabled={!siteForm?.name.trim() || savingSite}
              activeOpacity={0.85}
              onPress={saveSite}
            >
              {savingSite ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryActionBtnText}>
                  {locCaps?.isAdmin ? 'Add Saved Site' : 'Send Site Request'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Date Pickers */}
      <DateTimePickerModal
        isVisible={!!dateTarget}
        mode="date"
        minimumDate={dateTarget === 'end' ? new Date(`${startDate}T00:00:00`) : undefined}
        date={new Date(`${dateTarget === 'end' ? endDate : startDate}T00:00:00`)}
        onConfirm={(d) => {
          const v = ymd(d);
          if (dateTarget === 'start') { setStartDate(v); if (endDate < v) setEndDate(v); } else setEndDate(v);
          setDateTarget(null);
        }}
        onCancel={() => setDateTarget(null)}
      />

      <DateTimePickerModal
        isVisible={!!timeTarget}
        mode="time"
        date={(() => {
          const [h, m] = (timeTarget === 'end' ? endTime : startTime).split(':').map(Number);
          const d = new Date(); d.setHours(h, m, 0, 0); return d;
        })()}
        onConfirm={(d) => {
          (timeTarget === 'start' ? setStartTime : setEndTime)(hm(d));
          setTimeTarget(null);
        }}
        onCancel={() => setTimeTarget(null)}
      />

      {/* Pickers Modal (Project, Site, People, Tasks) */}
      <Modal visible={!!picker} animationType="slide" onRequestClose={() => setPicker(null)}>
        <View style={styles.pickerModalContainer}>
          <View style={styles.pickerModalHeader}>
            <View>
              <Text style={styles.pickerModalTitle}>
                {picker === 'PROJECT' ? 'Select Project' : picker === 'SITE' ? 'Select Saved Site' : picker === 'PEOPLE' ? 'Assign Team Members' : 'Select Tasks'}
              </Text>
              <Text style={styles.pickerModalSub}>
                {picker === 'PEOPLE' ? `${people.length} selected` : picker === 'TASKS' ? `${tasks.length} selected` : 'Tap to select'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setPicker(null)} style={styles.modalDoneBtn}>
              <Text style={styles.modalDoneBtnText}>{multi ? 'Done' : 'Cancel'}</Text>
            </TouchableOpacity>
          </View>

          {/* Search Bar */}
          <View style={styles.pickerSearchBar}>
            <Search size={18} color="#94A3B8" strokeWidth={2.2} />
            <TextInput
              style={styles.pickerSearchInput}
              placeholder={`Search ${picker?.toLowerCase()}…`}
              placeholderTextColor="#94A3B8"
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
            />
            {!!query && (
              <TouchableOpacity onPress={() => setQuery('')}>
                <X size={16} color="#94A3B8" />
              </TouchableOpacity>
            )}
          </View>

          {picker === 'SITE' && locCaps?.canAdd && (
            <TouchableOpacity style={styles.addNewSiteBtn} activeOpacity={0.8} onPress={openSiteForm}>
              <Plus size={16} color="#1373e5" strokeWidth={2.4} />
              <Text style={styles.addNewSiteBtnText}>
                {locCaps.isAdmin ? 'Add a new saved site' : 'Request a new saved site'}
              </Text>
            </TouchableOpacity>
          )}

          {loadingOptions ? (
            <View style={styles.pickerLoader}>
              <ActivityIndicator color={theme.colors.primary} size="large" />
              <Text style={styles.pickerLoaderText}>Loading options…</Text>
            </View>
          ) : (
            <FlatList
              data={pickerRows}
              keyExtractor={(r) => String(r.id)}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.pickerListContent}
              ListEmptyComponent={
                <View style={styles.emptyListWrap}>
                  <Text style={styles.emptyListText}>
                    {picker === 'TASKS' && visitType === 'GENERAL'
                      ? 'These people have no open general tasks.'
                      : 'No matching results found.'}
                  </Text>
                </View>
              }
              renderItem={({ item: r }) => (
                <TouchableOpacity
                  style={[styles.pickerItemRow, r.on && styles.pickerItemRowActive]}
                  activeOpacity={0.7}
                  onPress={r.onPress}
                >
                  {/* Left avatar or category icon */}
                  {picker === 'PEOPLE' ? (
                    <View style={[styles.itemAvatar, r.on && styles.itemAvatarActive]}>
                      <Text style={[styles.itemAvatarText, r.on && styles.itemAvatarTextActive]}>
                        {initials((r as any).person)}
                      </Text>
                    </View>
                  ) : picker === 'PROJECT' ? (
                    <View style={styles.itemCategoryIcon}>
                      <FolderKanban size={16} color="#9333EA" strokeWidth={2} />
                    </View>
                  ) : picker === 'SITE' ? (
                    <View style={styles.itemCategoryIcon}>
                      <MapPin size={16} color="#0284C7" strokeWidth={2} />
                    </View>
                  ) : (
                    <View style={styles.itemCategoryIcon}>
                      <CheckSquare size={16} color="#7E22CE" strokeWidth={2} />
                    </View>
                  )}

                  {/* Main text content */}
                  <View style={styles.itemContentCol}>
                    <Text style={[styles.itemTitleText, r.on && styles.itemTitleTextActive]}>
                      {r.title}
                    </Text>
                    {!!r.sub && (
                      <Text style={styles.itemSubText} numberOfLines={1}>{r.sub}</Text>
                    )}
                  </View>

                  {/* Right selection check */}
                  <View style={[styles.itemCheckCircle, r.on && styles.itemCheckCircleActive]}>
                    {r.on && <Check size={14} color="#FFFFFF" strokeWidth={2.8} />}
                  </View>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </Modal>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scrollBody: {
    padding: 16,
    paddingBottom: 140,
    gap: 14,
  },
  centerLoader: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
    gap: 12,
  },
  centerLoaderText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '500',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  backButtonText: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 14,
  },
  changeNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    padding: 12,
  },
  changeNoticeText: {
    fontSize: 13,
    color: '#92400E',
    fontWeight: '600',
    flex: 1,
    lineHeight: 18,
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    gap: 10,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  cardHeaderIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
    flex: 1,
  },
  readOnlyBadge: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  readOnlyBadgeText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  segmentContainer: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 9,
  },
  segmentBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  segmentBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  segmentBtnTextActive: {
    color: '#0F172A',
    fontWeight: '700',
  },
  helperNotice: {
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  helperNoticeText: {
    fontSize: 12.5,
    color: '#64748B',
    lineHeight: 18,
  },
  fieldBlock: {
    gap: 6,
    marginTop: 2,
  },
  fieldLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#334155',
  },
  selectBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 11,
    paddingHorizontal: 12,
    minHeight: 46,
  },
  selectBoxEmpty: {
    borderColor: '#E2E8F0',
  },
  selectLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  fieldInnerIcon: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectValueText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  selectPlaceholderText: {
    fontSize: 14,
    color: '#94A3B8',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#F1F5F9',
  },
  dividerText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  textInputBox: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 11,
    paddingHorizontal: 12,
    minHeight: 46,
    fontSize: 14,
    color: '#0F172A',
  },
  textAreaBox: {
    minHeight: 80,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  locationActionTile: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 12,
    padding: 12,
    marginTop: 2,
  },
  locationActionTileActive: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  locationActionInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  gpsIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsIconCircleActive: {
    backgroundColor: '#DCFCE7',
  },
  locationActionTextCol: {
    flex: 1,
  },
  locationActionTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#1373e5',
  },
  locationActionTitleActive: {
    color: '#15803D',
  },
  locationActionSub: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 1,
  },
  dualGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  dualCol: {
    flex: 1,
    gap: 6,
  },
  pickerTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 11,
    paddingHorizontal: 12,
    minHeight: 46,
  },
  pickerTileText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  durationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 12,
    alignSelf: 'center',
    marginTop: 2,
  },
  durationPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  countBadgePill: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 7.5,
    paddingVertical: 2,
    borderRadius: 999,
  },
  countBadgePillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4338CA',
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  personPillCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 20,
  },
  personPillAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  personPillAvatarText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4338CA',
  },
  personPillName: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#0F172A',
    maxWidth: 130,
  },
  clashBox: {
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    borderRadius: 12,
    padding: 12,
    marginTop: 6,
    gap: 4,
  },
  clashBoxHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  clashTitle: {
    fontWeight: '800',
    color: '#9A3412',
    fontSize: 13,
  },
  clashLine: {
    fontSize: 12.5,
    color: '#9A3412',
    marginTop: 2,
  },
  clashHint: {
    fontSize: 11.5,
    color: '#C2410C',
    marginTop: 4,
  },
  taskCardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 11,
    gap: 10,
  },
  taskCardInfo: {
    flex: 1,
    gap: 4,
  },
  taskCardPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#FAF5FF',
    borderWidth: 1,
    borderColor: '#E9D5FF',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  taskCardPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#7E22CE',
  },
  taskCardTitle: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#0F172A',
  },
  taskRemoveTouch: {
    padding: 6,
  },
  customTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  flexInput: {
    flex: 1,
  },
  taskAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 46,
    paddingHorizontal: 16,
    borderRadius: 11,
    backgroundColor: '#1373e5',
    justifyContent: 'center',
  },
  taskAddBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13.5,
  },
  attachmentCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 11,
    marginBottom: 6,
  },
  attachmentCardName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#1373e5',
  },
  attachmentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 11,
    height: 44,
    marginTop: 4,
  },
  attachmentBtnText: {
    color: '#1373e5',
    fontWeight: '700',
    fontSize: 13.5,
  },
  actionControls: {
    gap: 10,
    marginTop: 4,
  },
  primaryActionBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#1373e5',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    shadowColor: '#1373e5',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
  draftActionBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  draftActionBtnText: {
    color: '#334155',
    fontWeight: '700',
    fontSize: 14.5,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingTop: Platform.OS === 'ios' ? 44 : 20,
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalNotice: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
  },
  modalNoticeText: {
    fontSize: 12.5,
    color: '#64748B',
  },
  modalGpsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 11,
    height: 44,
    marginTop: 14,
  },
  modalGpsBtnText: {
    color: '#1373e5',
    fontWeight: '700',
    fontSize: 13,
  },
  pickerModalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
  },
  pickerModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  pickerModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  pickerModalSub: {
    fontSize: 12.5,
    color: '#64748B',
    marginTop: 2,
  },
  modalDoneBtn: {
    backgroundColor: '#EFF6FF',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  modalDoneBtnText: {
    color: '#1373e5',
    fontWeight: '700',
    fontSize: 14,
  },
  pickerSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  pickerSearchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
  },
  addNewSiteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 10,
    height: 40,
  },
  addNewSiteBtnText: {
    color: '#1373e5',
    fontWeight: '700',
    fontSize: 13,
  },
  pickerLoader: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 50,
    gap: 10,
  },
  pickerLoaderText: {
    color: '#64748B',
    fontSize: 13.5,
  },
  pickerListContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  emptyListWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 40,
  },
  emptyListText: {
    color: '#64748B',
    fontSize: 13.5,
  },
  pickerItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  pickerItemRowActive: {
    backgroundColor: '#F0F9FF',
  },
  itemAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemAvatarActive: {
    backgroundColor: '#DBEAFE',
  },
  itemAvatarText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  itemAvatarTextActive: {
    color: '#1373e5',
  },
  itemCategoryIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemContentCol: {
    flex: 1,
  },
  itemTitleText: {
    fontSize: 14.5,
    fontWeight: '600',
    color: '#0F172A',
  },
  itemTitleTextActive: {
    fontWeight: '700',
    color: '#0F172A',
  },
  itemSubText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  itemCheckCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemCheckCircleActive: {
    backgroundColor: '#1373e5',
    borderColor: '#1373e5',
  },
});
