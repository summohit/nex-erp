import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, ActivityIndicator, Alert, Image,
  SafeAreaView, Platform,
} from 'react-native';
import {
  MapPin, Navigation, Clock, Ruler, Play, Square, X, Plus,
  Camera, ChevronDown, CheckCircle, XCircle, FileText,
  AlertTriangle, ArrowRight,
} from 'lucide-react-native';
import Geolocation from 'react-native-geolocation-service';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { useFieldVisitStore } from '../../store/fieldVisitStore';
import { fieldVisitService } from '../../api/fieldVisitService';
import { useDashboardStore } from '../../store/dashboardStore';
import { formatElapsed, formatDuration } from '../../utils/haversine';
import FeedbackModal from '../../components/FeedbackModal';

/* ────────────────────────────────────────────────────────── */
/*  TYPES                                                      */
/* ────────────────────────────────────────────────────────── */
interface Project { id: number; name: string; key: string; color: string }

/* ────────────────────────────────────────────────────────── */
/*  HELPERS                                                    */
/* ────────────────────────────────────────────────────────── */
const getCurrentLocation = (): Promise<{ lat: number; lng: number }> =>
  new Promise((resolve, reject) =>
    Geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    ),
  );

const statusColor = (status: string) => {
  if (status === 'COMPLETED') return { bg: '#DCFCE7', text: '#166534' };
  if (status === 'CANCELLED') return { bg: '#FEE2E2', text: '#991B1B' };
  return { bg: '#FEF9C3', text: '#854D0E' };
};

/* ────────────────────────────────────────────────────────── */
/*  SCREEN                                                     */
/* ────────────────────────────────────────────────────────── */
export default function FieldVisitScreen() {
  const {
    activeVisit, myVisits, isStarting, isEnding,
    routePoints, liveDistanceKm, elapsedSeconds,
    fetchActiveVisit, fetchMyVisits, startVisit, endVisit, cancelVisit,
    addRoutePoint, tickElapsed,
  } = useFieldVisitStore();
  const { projects } = useDashboardStore();

  const [showStartModal, setShowStartModal] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [purpose, setPurpose] = useState('');
  const [endNotes, setEndNotes] = useState('');
  const [pendingPhotos, setPendingPhotos] = useState<{ uri: string; takenAt: string }[]>([]);
  const [feedback, setFeedback] = useState({ visible: false, type: 'success' as any, title: '', message: '' });

  const trackingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Boot: load active visit + history ──────────────────────
  useEffect(() => {
    fetchActiveVisit();
    fetchMyVisits();
  }, []);

  // ── Restore timer if we already have an active visit ────────
  useEffect(() => {
    if (activeVisit) {
      const startMs = new Date(activeVisit.startTime).getTime();
      const alreadyElapsed = Math.floor((Date.now() - startMs) / 1000);
      useFieldVisitStore.setState({ elapsedSeconds: alreadyElapsed });
      startIntervals();
    } else {
      stopIntervals();
    }
    return () => stopIntervals();
  }, [activeVisit?.id]);

  // ── GPS tracking every 30 s ─────────────────────────────────
  const startIntervals = useCallback(() => {
    stopIntervals();
    timerInterval.current = setInterval(() => {
      useFieldVisitStore.getState().tickElapsed();
    }, 1000);
    trackingInterval.current = setInterval(() => {
      Geolocation.getCurrentPosition(
        (pos) => addRoutePoint(pos.coords.latitude, pos.coords.longitude),
        () => {},
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
      );
    }, 30000);
  }, []);

  const stopIntervals = useCallback(() => {
    if (timerInterval.current) { clearInterval(timerInterval.current); timerInterval.current = null; }
    if (trackingInterval.current) { clearInterval(trackingInterval.current); trackingInterval.current = null; }
  }, []);

  // ── Start Visit ─────────────────────────────────────────────
  const handleStart = async () => {
    if (!selectedProject) return;
    try {
      const loc = await getCurrentLocation();
      await startVisit({
        projectId: selectedProject.id,
        startLat: loc.lat,
        startLng: loc.lng,
        purpose: purpose.trim() || undefined,
      });
      setShowStartModal(false);
      setPurpose('');
      setSelectedProject(null);
      startIntervals();
      setFeedback({ visible: true, type: 'success', title: 'Visit Started!', message: 'GPS tracking is now active. Your route is being recorded.' });
    } catch (e: any) {
      setFeedback({ visible: true, type: 'error', title: 'Could Not Start', message: e?.message || 'Failed to get GPS location. Please enable location access.' });
    }
  };

  // ── End Visit ───────────────────────────────────────────────
  const handleEnd = async () => {
    if (!activeVisit) return;
    try {
      const loc = await getCurrentLocation();
      const completed = await endVisit(activeVisit.id, {
        endLat: loc.lat,
        endLng: loc.lng,
        notes: endNotes.trim() || undefined,
      });
      // Upload pending photos
      for (const p of pendingPhotos) {
        try {
          const fd = new FormData();
          fd.append('file', { uri: p.uri, name: 'visit_photo.jpg', type: 'image/jpeg' } as any);
          const uploaded = await fieldVisitService.uploadVisitPhoto(fd);
          const url = uploaded?.url || uploaded?.fileUrl;
          if (url) await fieldVisitService.addPhoto(completed.id, { url, takenAt: p.takenAt });
        } catch (_) {}
      }
      setShowEndModal(false);
      setPendingPhotos([]);
      setEndNotes('');
      setFeedback({
        visible: true, type: 'success',
        title: 'Visit Completed!',
        message: 'Great work! Your visit has been logged for the team.',
      });
    } catch (e: any) {
      setFeedback({ visible: true, type: 'error', title: 'End Failed', message: e?.message || 'Could not end visit.' });
    }
  };

  const handleCancel = () => {
    Alert.alert('Cancel Visit', 'Are you sure you want to cancel this field visit?', [
      { text: 'No' },
      { text: 'Yes, Cancel', style: 'destructive', onPress: async () => {
        if (activeVisit) await cancelVisit(activeVisit.id);
      }},
    ]);
  };

  // ── Photo picker ────────────────────────────────────────────
  const pickPhoto = async (source: 'camera' | 'gallery') => {
    const fn = source === 'camera' ? launchCamera : launchImageLibrary;
    const res = await fn({ mediaType: 'photo', quality: 0.7 });
    if (res.assets && res.assets[0]?.uri) {
      setPendingPhotos(prev => [...prev, { uri: res.assets![0].uri!, takenAt: new Date().toISOString() }]);
    }
  };

  /* ── RENDER ── */
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Field Visits</Text>
            <Text style={styles.headerSub}>Track your site visits & route</Text>
          </View>
          {!activeVisit && (
            <TouchableOpacity style={styles.startBtn} onPress={() => setShowStartModal(true)}>
              <Plus size={16} color="#FFFFFF" />
              <Text style={styles.startBtnText}>New Visit</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Active Visit Card ── */}
        {activeVisit && (
          <View style={styles.activeCard}>
            <View style={styles.activeHeader}>
              <View style={styles.activePulse}>
                <View style={styles.activeDot} />
              </View>
              <Text style={styles.activeLabel}>LIVE VISIT</Text>
            </View>

            <Text style={styles.activeProject}>{activeVisit.project?.name}</Text>
            {activeVisit.purpose ? (
              <Text style={styles.activePurpose}>{activeVisit.purpose}</Text>
            ) : null}

            <View style={styles.metricsRow}>
              <View style={styles.metricBox}>
                <Clock size={18} color="#E25E3E" />
                <Text style={styles.metricValue}>{formatElapsed(elapsedSeconds)}</Text>
                <Text style={styles.metricLabel}>Elapsed</Text>
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.metricBox}>
                <Ruler size={18} color="#2563EB" />
                <Text style={styles.metricValue}>{liveDistanceKm.toFixed(2)} km</Text>
                <Text style={styles.metricLabel}>Distance</Text>
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.metricBox}>
                <Navigation size={18} color="#9333EA" />
                <Text style={styles.metricValue}>{routePoints.length}</Text>
                <Text style={styles.metricLabel}>Points</Text>
              </View>
            </View>

            <View style={styles.activeActions}>
              <TouchableOpacity style={styles.endBtn} onPress={() => setShowEndModal(true)}>
                <Square size={16} color="#FFFFFF" />
                <Text style={styles.endBtnText}>End Visit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
                <X size={16} color="#DC2626" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Visit History ── */}
        <Text style={styles.sectionTitle}>Visit History</Text>
        {myVisits.length === 0 ? (
          <View style={styles.emptyBox}>
            <MapPin size={36} color="#CBD5E1" />
            <Text style={styles.emptyTitle}>No visits yet</Text>
            <Text style={styles.emptySub}>Start your first field visit to track your route</Text>
          </View>
        ) : (
          myVisits.map((v) => {
            const sc = statusColor(v.status);
            return (
              <View key={v.id} style={styles.historyCard}>
                <View style={styles.historyHeader}>
                  <View style={[styles.projectDot, { backgroundColor: v.project?.color || '#2563EB' }]} />
                  <Text style={styles.historyProject} numberOfLines={1}>{v.project?.name}</Text>
                  <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
                    <Text style={[styles.statusText, { color: sc.text }]}>{v.status}</Text>
                  </View>
                </View>
                <Text style={styles.historyDate}>
                  {new Date(v.startTime).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' · '}
                  {new Date(v.startTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </Text>
                {v.purpose ? <Text style={styles.historyPurpose}>{v.purpose}</Text> : null}
                <View style={styles.historyMetrics}>
                  {v.distanceKm !== undefined && v.distanceKm !== null && (
                    <View style={styles.historyMetric}>
                      <Ruler size={13} color="#64748B" />
                      <Text style={styles.historyMetricText}>{v.distanceKm.toFixed(2)} km</Text>
                    </View>
                  )}
                  {v.durationMins !== undefined && v.durationMins !== null && (
                    <View style={styles.historyMetric}>
                      <Clock size={13} color="#64748B" />
                      <Text style={styles.historyMetricText}>{formatDuration(v.durationMins)}</Text>
                    </View>
                  )}
                  {v.photos && v.photos.length > 0 && (
                    <View style={styles.historyMetric}>
                      <Camera size={13} color="#64748B" />
                      <Text style={styles.historyMetricText}>{v.photos.length} photo{v.photos.length > 1 ? 's' : ''}</Text>
                    </View>
                  )}
                </View>
                {v.photos && v.photos.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoStrip}>
                    {v.photos.map((p) => (
                      <View key={p.id} style={styles.photoThumb}>
                        <Image source={{ uri: p.url }} style={styles.photoImg} />
                        <Text style={styles.photoTime}>
                          {new Date(p.takenAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </View>
                    ))}
                  </ScrollView>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* ── Start Visit Modal ── */}
      <Modal visible={showStartModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowStartModal(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.dragHandle} />
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Start Field Visit</Text>
              <TouchableOpacity onPress={() => setShowStartModal(false)} style={styles.modalClose}>
                <X size={20} color="#64748B" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              <Text style={styles.fieldLabel}>Select Project *</Text>
              <TouchableOpacity style={styles.projectSelector} onPress={() => setShowProjectPicker(true)}>
                {selectedProject ? (
                  <View style={styles.selectedProjectRow}>
                    <View style={[styles.projectDot, { backgroundColor: selectedProject.color }]} />
                    <Text style={styles.selectedProjectName}>{selectedProject.name}</Text>
                  </View>
                ) : (
                  <Text style={styles.placeholderText}>Choose a project...</Text>
                )}
                <ChevronDown size={18} color="#94A3B8" />
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Purpose <Text style={styles.optional}>(Optional)</Text></Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Client meeting, Site inspection..."
                placeholderTextColor="#94A3B8"
                value={purpose}
                onChangeText={setPurpose}
                multiline
                numberOfLines={2}
              />

              <View style={styles.gpsInfo}>
                <MapPin size={16} color="#2563EB" />
                <Text style={styles.gpsInfoText}>Your current GPS location will be captured as the start point.</Text>
              </View>

              <TouchableOpacity
                style={[styles.confirmBtn, (!selectedProject || isStarting) && styles.confirmBtnDisabled]}
                onPress={handleStart}
                disabled={!selectedProject || isStarting}
              >
                {isStarting ? <ActivityIndicator color="#FFFFFF" size="small" /> : (
                  <>
                    <Play size={16} color="#FFFFFF" />
                    <Text style={styles.confirmBtnText}>Start Visit</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Project Picker Modal ── */}
      <Modal visible={showProjectPicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowProjectPicker(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.dragHandle} />
            <Text style={[styles.modalTitle, { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 }]}>Select Project</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {(projects as Project[]).map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.projectOption}
                  onPress={() => { setSelectedProject(p); setShowProjectPicker(false); }}
                >
                  <View style={[styles.projectDot, { backgroundColor: p.color }]} />
                  <Text style={styles.projectOptionName}>{p.name}</Text>
                  <Text style={styles.projectOptionKey}>{p.key}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── End Visit Modal ── */}
      <Modal visible={showEndModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowEndModal(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.dragHandle} />
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>End Field Visit</Text>
              <TouchableOpacity onPress={() => setShowEndModal(false)} style={styles.modalClose}>
                <X size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {/* Summary */}
              <View style={styles.endSummaryBox}>
                <View style={styles.endSummaryRow}>
                  <Clock size={15} color="#E25E3E" />
                  <Text style={styles.endSummaryText}>Duration: {formatElapsed(elapsedSeconds)}</Text>
                </View>
                <View style={styles.endSummaryRow}>
                  <Ruler size={15} color="#2563EB" />
                  <Text style={styles.endSummaryText}>Distance: {liveDistanceKm.toFixed(2)} km</Text>
                </View>
              </View>

              <Text style={styles.fieldLabel}>Notes <Text style={styles.optional}>(Optional)</Text></Text>
              <TextInput
                style={[styles.textInput, { minHeight: 80, textAlignVertical: 'top' }]}
                placeholder="Add any notes about this visit..."
                placeholderTextColor="#94A3B8"
                value={endNotes}
                onChangeText={setEndNotes}
                multiline
              />

              <Text style={styles.fieldLabel}>Photos <Text style={styles.optional}>(Optional)</Text></Text>
              <View style={styles.photoActions}>
                <TouchableOpacity style={styles.photoBtn} onPress={() => pickPhoto('camera')}>
                  <Camera size={18} color="#E25E3E" />
                  <Text style={styles.photoBtnText}>Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.photoBtn} onPress={() => pickPhoto('gallery')}>
                  <FileText size={18} color="#2563EB" />
                  <Text style={[styles.photoBtnText, { color: '#2563EB' }]}>Gallery</Text>
                </TouchableOpacity>
              </View>

              {pendingPhotos.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                  {pendingPhotos.map((p, i) => (
                    <View key={i} style={styles.pendingPhotoWrap}>
                      <Image source={{ uri: p.uri }} style={styles.pendingPhotoImg} />
                      <TouchableOpacity
                        style={styles.removePhoto}
                        onPress={() => setPendingPhotos(prev => prev.filter((_, idx) => idx !== i))}
                      >
                        <X size={12} color="#FFFFFF" />
                      </TouchableOpacity>
                      <Text style={styles.photoTime}>
                        {new Date(p.takenAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              )}

              <TouchableOpacity
                style={[styles.confirmBtn, isEnding && styles.confirmBtnDisabled]}
                onPress={handleEnd}
                disabled={isEnding}
              >
                {isEnding ? <ActivityIndicator color="#FFFFFF" size="small" /> : (
                  <>
                    <CheckCircle size={16} color="#FFFFFF" />
                    <Text style={styles.confirmBtnText}>Complete Visit</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <FeedbackModal
        visible={feedback.visible}
        type={feedback.type}
        title={feedback.title}
        message={feedback.message}
        onClose={() => setFeedback(p => ({ ...p, visible: false }))}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 14 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#0F172A' },
  headerSub: { fontSize: 13, color: '#94A3B8', marginTop: 2 },
  startBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#E25E3E', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12 },
  startBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },

  // Active card
  activeCard: { backgroundColor: '#0F172A', borderRadius: 20, padding: 20 },
  activeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  activePulse: { width: 14, height: 14, borderRadius: 7, backgroundColor: 'rgba(34,197,94,0.25)', justifyContent: 'center', alignItems: 'center' },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22C55E' },
  activeLabel: { fontSize: 11, fontWeight: '800', color: '#22C55E', letterSpacing: 1 },
  activeProject: { fontSize: 20, fontWeight: '800', color: '#FFFFFF', marginBottom: 4 },
  activePurpose: { fontSize: 13, color: '#94A3B8', marginBottom: 14 },

  metricsRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 14, padding: 14, marginBottom: 16 },
  metricBox: { flex: 1, alignItems: 'center', gap: 4 },
  metricDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.1)' },
  metricValue: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  metricLabel: { fontSize: 10, fontWeight: '600', color: '#64748B' },

  activeActions: { flexDirection: 'row', gap: 10 },
  endBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#E25E3E', borderRadius: 12, paddingVertical: 13 },
  endBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  cancelBtn: { width: 46, height: 46, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center' },

  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginTop: 4 },

  // History
  historyCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#F1F5F9', shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  historyHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  projectDot: { width: 10, height: 10, borderRadius: 5 },
  historyProject: { flex: 1, fontSize: 15, fontWeight: '700', color: '#0F172A' },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 10, fontWeight: '700' },
  historyDate: { fontSize: 12, color: '#64748B', marginBottom: 4 },
  historyPurpose: { fontSize: 13, color: '#475569', marginBottom: 8 },
  historyMetrics: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  historyMetric: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  historyMetricText: { fontSize: 12, color: '#64748B', fontWeight: '600' },

  photoStrip: { marginTop: 10 },
  photoThumb: { marginRight: 8, alignItems: 'center' },
  photoImg: { width: 72, height: 72, borderRadius: 10 },
  photoTime: { fontSize: 9, color: '#94A3B8', marginTop: 3, fontWeight: '500' },

  emptyBox: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#334155' },
  emptySub: { fontSize: 13, color: '#94A3B8', textAlign: 'center' },

  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.5)' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject },
  modalSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '90%', paddingBottom: Platform.OS === 'ios' ? 34 : 16 },
  dragHandle: { width: 40, height: 4, backgroundColor: '#E2E8F0', borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  modalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  modalClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' },
  modalBody: { padding: 20 },

  fieldLabel: { fontSize: 13, fontWeight: '700', color: '#334155', marginBottom: 8 },
  optional: { color: '#94A3B8', fontWeight: '400' },
  textInput: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: '#0F172A' },

  projectSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 16 },
  selectedProjectRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectedProjectName: { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  placeholderText: { fontSize: 14, color: '#94A3B8' },

  projectOption: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
  projectOptionName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#0F172A' },
  projectOptionKey: { fontSize: 11, fontWeight: '700', color: '#94A3B8' },

  gpsInfo: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#EFF6FF', borderRadius: 10, padding: 12, marginBottom: 16, marginTop: 8 },
  gpsInfoText: { flex: 1, fontSize: 12, color: '#1D4ED8', fontWeight: '500' },

  confirmBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, backgroundColor: '#E25E3E', borderRadius: 14, paddingVertical: 15, marginTop: 8, shadowColor: '#E25E3E', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 },
  confirmBtnDisabled: { opacity: 0.5 },
  confirmBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },

  endSummaryBox: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 14, marginBottom: 16, gap: 8 },
  endSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  endSummaryText: { fontSize: 13, fontWeight: '600', color: '#334155' },

  photoActions: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  photoBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingVertical: 12 },
  photoBtnText: { fontSize: 14, fontWeight: '600', color: '#E25E3E' },

  pendingPhotoWrap: { marginRight: 8, alignItems: 'center', position: 'relative' },
  pendingPhotoImg: { width: 80, height: 80, borderRadius: 10 },
  removePhoto: { position: 'absolute', top: 4, right: 4, backgroundColor: '#DC2626', width: 18, height: 18, borderRadius: 9, justifyContent: 'center', alignItems: 'center' },
});
