import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, Modal, FlatList, Linking,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import AppScreen from '../../components/AppScreen';
import {
  fieldVisitRequestService as fv, ProjectLite, VisitLocation, TaskOption, FvAttachment, FvLeaveClash,
  VisitLocationCapabilities, NewFieldVisit,
} from '../../api/fieldVisitRequestService';
import MediaPickerModal from '../Profile/components/MediaPickerModal';
import { workService, PersonLite } from '../../api/workService';
import { getCurrentLocation, requestLocationPermission } from '../../store/dashboardStore';
import { theme } from '../../theme/theme';

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
 * Raise, edit or change a field visit request — the same request the web form sends.
 *
 * mode 'new' raises one (saved as a draft or sent for approval), 'edit' edits a
 * draft, 'change' proposes a change to an approved trip for an administrator to
 * rule on (the project cannot change). A project visit's tasks are picked from
 * the project (adopted on approval) or typed as new work; a general visit's are
 * the chosen people's own open general tasks. An administrator's own request is
 * approved on the spot by the server.
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
  const [submitting, setSubmitting] = useState<'draft' | 'send' | null>(null);
  const [locating, setLocating] = useState(false);
  const [attachments, setAttachments] = useState<FvAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [clashes, setClashes] = useState<FvLeaveClash[]>([]);
  const [loadingVisit, setLoadingVisit] = useState(mode !== 'new');
  // Loading a saved request sets the type and project, which would otherwise
  // clear the tasks that were loaded with it.
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

  // Project visits are raised by the project's manager (or an administrator);
  // anyone may raise a General visit. Offer only the projects the server would
  // accept, and no Project option at all to someone who manages none.
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

  // Editing a draft or changing an approved trip starts from what was saved.
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

  // Changing the kind of visit or the project invalidates the picked tasks.
  useEffect(() => {
    if (hydrating.current) { hydrating.current = false; return; }
    setTasks([]);
  }, [visitType, project?.id]);

  // Warn — as the web does — when someone going is on approved leave during the trip.
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

  /** An administrator adds the site at once; a project manager asks for it. */
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
      if (fix.accuracy > 150) Alert.alert('Location is approximate', `Your phone placed you within about ${Math.round(fix.accuracy)} m. Pick a saved site if there is one — clock-ins are measured from this point.`);
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
    if (!site.name.trim()) p.push('Name the site');
    if (site.lat == null || site.lng == null) p.push('Pick a saved site or use your current location for the site pin');
    if (endDate < startDate) p.push('The end date is before the start date');
    if (endTime <= startTime) p.push('Clock-out time must be after clock-in time');
    if (!people.length) p.push('Add who is going');
    if (!tasks.length) p.push('Add at least one task');
    return p;
  }, [visitType, project, site, startDate, endDate, startTime, endTime, people, tasks]);

  /**
   * send=false saves a draft; send=true sends it for approval. In change mode
   * the whole form goes to an administrator as a proposed change.
   */
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

  // ── picker rows ──
  const q = query.trim().toLowerCase();
  const pickerRows: { id: number; title: string; sub?: string; on?: boolean; onPress: () => void }[] =
    picker === 'PROJECT' ? projects.filter((p) => !q || `${p.name} ${p.key}`.toLowerCase().includes(q)).map((p) => ({
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
      return { id: p.id, title: personName(p), sub: p.employeeCode ? `#${p.employeeCode}` : undefined, on,
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
      {loadingVisit ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} /> : (
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {mode === 'change' && (
          <Text style={styles.notice}>Change what is needed and send it. The visit stays as approved until an administrator accepts the change. The project cannot be changed.</Text>
        )}
        <Text style={styles.label}>Type of visit</Text>
        {mode === 'change' ? (
          <Text style={styles.hint}>{visitType === 'GENERAL' ? 'General visit' : 'Project visit'}</Text>
        ) : canRaiseProject ? (
          <View style={styles.segment}>
            {(['PROJECT', 'GENERAL'] as const).map((t) => (
              <TouchableOpacity key={t} style={[styles.segBtn, visitType === t && styles.segOn]} onPress={() => setVisitType(t)}>
                <Text style={[styles.segText, visitType === t && styles.segTextOn]}>{t === 'PROJECT' ? 'Project visit' : 'General visit'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <Text style={styles.hint}>General visit — built from your own general tasks. A project visit is raised by that project's manager.</Text>
        )}

        {visitType === 'PROJECT' && (
          <>
            <Text style={styles.label}>Project *</Text>
            <TouchableOpacity style={styles.field} disabled={mode === 'change'} onPress={() => { setQuery(''); setPicker('PROJECT'); }}>
              <Text style={project ? styles.value : styles.placeholder}>{project ? `${project.name} (${project.key})` : 'Pick a project'}</Text>
            </TouchableOpacity>
          </>
        )}

        <Text style={styles.label}>Site *</Text>
        <TouchableOpacity style={styles.field} onPress={() => { setQuery(''); setPicker('SITE'); }}>
          <Text style={site.visitLocationId ? styles.value : styles.placeholder}>{site.visitLocationId ? site.name : 'Pick a saved site'}</Text>
        </TouchableOpacity>
        <Text style={styles.or}>or</Text>
        <TextInput style={styles.input} placeholder="Site name, e.g. Airtel Center Gurugram" value={site.visitLocationId ? '' : site.name}
          onChangeText={(v) => setSite((s) => ({ ...s, name: v, visitLocationId: undefined }))} />
        <TouchableOpacity style={styles.secondary} onPress={useCurrentLocation} disabled={locating}>
          {locating ? <ActivityIndicator color={theme.colors.primary} /> : (
            <Text style={styles.secondaryText}>
              {site.lat != null && !site.visitLocationId ? `📍 Pin set (${site.lat.toFixed(4)}, ${site.lng!.toFixed(4)}) — tap to refresh` : '📍 Use my current location as the site pin'}
            </Text>
          )}
        </TouchableOpacity>

        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.label}>From *</Text>
            <TouchableOpacity style={styles.field} onPress={() => setDateTarget('start')}><Text style={styles.value}>{nice(startDate)}</Text></TouchableOpacity>
          </View>
          <View style={styles.flex}>
            <Text style={styles.label}>To *</Text>
            <TouchableOpacity style={styles.field} onPress={() => setDateTarget('end')}><Text style={styles.value}>{nice(endDate)}</Text></TouchableOpacity>
          </View>
        </View>
        <Text style={styles.hint}>{days} day{days === 1 ? '' : 's'}</Text>

        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.label}>Expected clock-in</Text>
            <TouchableOpacity style={styles.field} onPress={() => setTimeTarget('start')}><Text style={styles.value}>{niceTime(startTime)}</Text></TouchableOpacity>
          </View>
          <View style={styles.flex}>
            <Text style={styles.label}>Expected clock-out</Text>
            <TouchableOpacity style={styles.field} onPress={() => setTimeTarget('end')}><Text style={styles.value}>{niceTime(endTime)}</Text></TouchableOpacity>
          </View>
        </View>

        <Text style={styles.label}>Who is going *</Text>
        <TouchableOpacity style={styles.field} onPress={() => { setQuery(''); setPicker('PEOPLE'); }}>
          <Text style={people.length ? styles.value : styles.placeholder} numberOfLines={2}>
            {people.length ? people.map(personName).join(', ') : 'Add people'}
          </Text>
        </TouchableOpacity>
        {clashText.length > 0 && (
          <View style={styles.clash}>
            <Text style={styles.clashTitle}>On leave during this visit</Text>
            {clashText.map((t) => <Text key={t} style={styles.clashLine}>• {t}</Text>)}
            <Text style={styles.clashHint}>You can still send it — the approver sees this too.</Text>
          </View>
        )}

        <Text style={styles.label}>Tasks *</Text>
        {tasks.map((t, i) => (
          <View key={`${t.issueId ?? 'new'}-${i}`} style={styles.taskLine}>
            <Text style={styles.taskText} numberOfLines={2}>{t.key ? `${t.key} · ` : '＋ '}{t.name}</Text>
            <TouchableOpacity onPress={() => setTasks((prev) => prev.filter((_, j) => j !== i))}><Text style={styles.remove}>✕</Text></TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity
          style={[styles.secondary, (visitType === 'PROJECT' ? !project : !people.length) && { opacity: 0.5 }]}
          disabled={visitType === 'PROJECT' ? !project : !people.length}
          onPress={openTaskPicker}>
          <Text style={styles.secondaryText}>
            {visitType === 'PROJECT' ? (project ? 'Pick tasks from the project' : 'Pick a project first') : (people.length ? "Pick from these people's general tasks" : 'Add people first')}
          </Text>
        </TouchableOpacity>
        {visitType === 'PROJECT' && (
          <View style={styles.row}>
            <TextInput style={[styles.input, styles.flex]} placeholder="…or type new work" value={newTask} onChangeText={setNewTask} />
            <TouchableOpacity style={styles.addBtn} disabled={!newTask.trim()} onPress={() => { setTasks((p) => [...p, { name: newTask.trim() }]); setNewTask(''); }}>
              <Text style={styles.addText}>Add</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.label}>Remarks</Text>
        <TextInput style={[styles.input, styles.area]} placeholder="Anything the approver should know" value={remarks} onChangeText={setRemarks} multiline />

        <Text style={styles.label}>Attachments</Text>
        {attachments.map((a, i) => (
          <View key={`${a.fileUrl}-${i}`} style={styles.taskLine}>
            <Text style={[styles.taskText, styles.linkText]} numberOfLines={1} onPress={() => Linking.openURL(a.fileUrl)}>📎 {a.fileName}</Text>
            <TouchableOpacity onPress={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}><Text style={styles.remove}>✕</Text></TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity style={styles.secondary} disabled={uploading} onPress={() => setMediaOpen(true)}>
          {uploading ? <ActivityIndicator color={theme.colors.primary} /> : <Text style={styles.secondaryText}>＋ Attach a photo or PDF</Text>}
        </TouchableOpacity>

        {mode === 'change' ? (
          <TouchableOpacity style={[styles.submit, !!submitting && { opacity: 0.7 }]} disabled={!!submitting} onPress={() => save(true)}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Send change for approval</Text>}
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity style={[styles.submit, !!submitting && { opacity: 0.7 }]} disabled={!!submitting} onPress={() => save(true)}>
              {submitting === 'send' ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Send for approval</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.draftBtn, !!submitting && { opacity: 0.7 }]} disabled={!!submitting} onPress={() => save(false)}>
              {submitting === 'draft' ? <ActivityIndicator color={theme.colors.primary} /> : <Text style={styles.draftText}>{mode === 'edit' ? 'Save draft' : 'Save as draft'}</Text>}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
      )}

      <MediaPickerModal
        visible={mediaOpen}
        onClose={() => setMediaOpen(false)}
        onMediaSelected={addAttachment}
        title="Attach to the request"
        allowFiles
        maxSizeMB={10}
      />

      <Modal visible={!!siteForm} animationType="slide" onRequestClose={() => setSiteForm(null)}>
        <View style={styles.picker}>
          <View style={styles.pickerHead}>
            <Text style={styles.pickerTitle}>{locCaps?.isAdmin ? 'Add a saved site' : 'Request a saved site'}</Text>
            <TouchableOpacity onPress={() => setSiteForm(null)}><Text style={styles.doneText}>Close</Text></TouchableOpacity>
          </View>
          {!locCaps?.isAdmin && <Text style={styles.hint}>An administrator approves it before it appears in the list.</Text>}
          <Text style={styles.label}>Site name *</Text>
          <TextInput style={styles.input} placeholder="e.g. PNB Head Office, Delhi" value={siteForm?.name ?? ''}
            onChangeText={(v) => setSiteForm((f) => (f ? { ...f, name: v } : f))} />
          <Text style={styles.label}>Address</Text>
          <TextInput style={[styles.input, styles.area]} placeholder="Street, area, city" value={siteForm?.address ?? ''} multiline
            onChangeText={(v) => setSiteForm((f) => (f ? { ...f, address: v } : f))} />
          <TouchableOpacity style={styles.secondary} onPress={pinSiteHere}>
            <Text style={styles.secondaryText}>
              {siteForm?.lat != null ? `📍 Pinned (${siteForm.lat.toFixed(4)}, ${siteForm.lng!.toFixed(4)}) — tap to refresh` : '📍 Pin it at my current location'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.submit, (!siteForm?.name.trim() || savingSite) && { opacity: 0.5 }]}
            disabled={!siteForm?.name.trim() || savingSite} onPress={saveSite}>
            {savingSite ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{locCaps?.isAdmin ? 'Add site' : 'Send request'}</Text>}
          </TouchableOpacity>
        </View>
      </Modal>

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
        date={(() => { const [h, m] = (timeTarget === 'end' ? endTime : startTime).split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d; })()}
        onConfirm={(d) => { (timeTarget === 'start' ? setStartTime : setEndTime)(hm(d)); setTimeTarget(null); }}
        onCancel={() => setTimeTarget(null)}
      />

      <Modal visible={!!picker} animationType="slide" onRequestClose={() => setPicker(null)}>
        <View style={styles.picker}>
          <View style={styles.pickerHead}>
            <Text style={styles.pickerTitle}>
              {picker === 'PROJECT' ? 'Project' : picker === 'SITE' ? 'Saved sites' : picker === 'PEOPLE' ? 'Who is going' : 'Tasks'}
            </Text>
            <TouchableOpacity onPress={() => setPicker(null)}><Text style={styles.doneText}>{multi ? 'Done' : 'Close'}</Text></TouchableOpacity>
          </View>
          <TextInput style={styles.input} placeholder="Search" value={query} onChangeText={setQuery} />
          {picker === 'SITE' && locCaps?.canAdd && (
            <TouchableOpacity style={styles.secondary} onPress={openSiteForm}>
              <Text style={styles.secondaryText}>{locCaps.isAdmin ? '＋ Add a new saved site' : '＋ Request a new saved site'}</Text>
            </TouchableOpacity>
          )}
          {loadingOptions ? <ActivityIndicator style={{ marginTop: 30 }} color={theme.colors.primary} /> : (
            <FlatList
              data={pickerRows}
              keyExtractor={(r) => String(r.id)}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={styles.empty}>
                {picker === 'TASKS' && visitType === 'GENERAL' ? 'These people have no open general tasks.' : 'Nothing found.'}
              </Text>}
              renderItem={({ item: r }) => (
                <TouchableOpacity style={[styles.pickRow, r.on && styles.pickOn]} onPress={r.onPress}>
                  <Text style={styles.pickCheck}>{multi ? (r.on ? '☑' : '☐') : r.on ? '●' : '○'}</Text>
                  <View style={styles.flex}>
                    <Text style={styles.pickTitle}>{r.title}</Text>
                    {!!r.sub && <Text style={styles.pickSub}>{r.sub}</Text>}
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
  body: { padding: 16, paddingBottom: 140 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 10 },
  label: { fontSize: 13, fontWeight: '700', color: theme.colors.textPrimary, marginTop: 14, marginBottom: 6 },
  hint: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 4 },
  segment: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 10, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  segOn: { backgroundColor: '#fff' },
  segText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  segTextOn: { color: theme.colors.primary },
  field: { minHeight: 44, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center', backgroundColor: '#fff' },
  value: { fontSize: 14, color: theme.colors.textPrimary },
  placeholder: { fontSize: 14, color: theme.colors.textMuted },
  or: { textAlign: 'center', color: theme.colors.textMuted, marginVertical: 6, fontSize: 12 },
  input: { minHeight: 44, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, paddingHorizontal: 12, backgroundColor: '#fff', color: theme.colors.textPrimary },
  area: { minHeight: 80, paddingTop: 10, textAlignVertical: 'top' },
  secondary: { marginTop: 8, minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: '#BFDBFE', backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  secondaryText: { color: theme.colors.primaryText, fontWeight: '600', textAlign: 'center' },
  taskLine: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: theme.colors.border, marginBottom: 6 },
  taskText: { flex: 1, fontSize: 13.5, color: theme.colors.textPrimary },
  remove: { fontSize: 16, color: '#DC2626', paddingHorizontal: 6 },
  addBtn: { marginTop: 8, height: 44, paddingHorizontal: 16, borderRadius: 10, backgroundColor: theme.colors.primary, justifyContent: 'center' },
  addText: { color: '#fff', fontWeight: '700' },
  submit: { marginTop: 24, height: 50, borderRadius: 12, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  draftBtn: { marginTop: 10, height: 48, borderRadius: 12, borderWidth: 1, borderColor: '#BFDBFE', backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  draftText: { color: theme.colors.primaryText, fontWeight: '700', fontSize: 15 },
  notice: { fontSize: 13, color: '#92400E', backgroundColor: '#FEF3C7', padding: 10, borderRadius: 10, marginBottom: 4 },
  clash: { marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FED7AA' },
  clashTitle: { fontWeight: '700', color: '#9A3412', marginBottom: 2 },
  clashLine: { fontSize: 13, color: '#9A3412', marginTop: 2 },
  clashHint: { fontSize: 12, color: '#C2410C', marginTop: 4 },
  linkText: { color: theme.colors.primary },
  picker: { flex: 1, backgroundColor: '#fff', paddingTop: 54, paddingHorizontal: 16, gap: 10 },
  pickerHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pickerTitle: { fontSize: 20, fontWeight: '800', color: theme.colors.textPrimary },
  doneText: { color: theme.colors.primary, fontWeight: '700', fontSize: 15 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  pickOn: { backgroundColor: '#F8FBFF' },
  pickCheck: { fontSize: 18, color: theme.colors.primary, width: 22 },
  pickTitle: { fontSize: 15, color: theme.colors.textPrimary, fontWeight: '600' },
  pickSub: { fontSize: 12, color: theme.colors.textSecondary },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 30 },
});
