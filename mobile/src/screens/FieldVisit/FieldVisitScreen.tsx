import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, ActivityIndicator, Alert, Image,
  Platform, StatusBar, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  MapPin, Navigation, Clock, Ruler, Play, Square, X, Plus,
  Camera, ChevronDown, ChevronLeft, CheckCircle2, XCircle, FileText,
  AlertTriangle, ArrowRight, Search, Image as ImageIcon, Briefcase,
  Calendar, Activity, Check,
} from 'lucide-react-native';
import Geolocation from 'react-native-geolocation-service';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { useFieldVisitStore } from '../../store/fieldVisitStore';
import { fieldVisitService } from '../../api/fieldVisitService';
import { useDashboardStore } from '../../store/dashboardStore';
import { formatElapsed, formatDuration } from '../../utils/haversine';
import FeedbackModal from '../../components/FeedbackModal';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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
  if (status === 'COMPLETED') {
    return { bg: '#ECFDF5', border: '#A7F3D0', text: '#065F46', dot: '#10B981', label: 'COMPLETED' };
  }
  if (status === 'CANCELLED') {
    return { bg: '#FEF2F2', border: '#FECACA', text: '#991B1B', dot: '#EF4444', label: 'CANCELLED' };
  }
  return { bg: '#FFF7ED', border: '#FFEDD5', text: '#C2410C', dot: '#F97316', label: 'IN PROGRESS' };
};

/* ────────────────────────────────────────────────────────── */
/*  SCREEN                                                     */
/* ────────────────────────────────────────────────────────── */
export default function FieldVisitScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const {
    activeVisit, myVisits, isStarting, isEnding,
    routePoints, liveDistanceKm, elapsedSeconds,
    fetchActiveVisit, fetchMyVisits, startVisit, endVisit, cancelVisit,
    syncFromNative,
  } = useFieldVisitStore();
  const { projects, fetchDashboardData } = useDashboardStore();

  const [showStartModal, setShowStartModal] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');
  const [purpose, setPurpose] = useState('');
  const [endNotes, setEndNotes] = useState('');
  const [pendingPhotos, setPendingPhotos] = useState<{ uri: string; takenAt: string }[]>([]);
  const [feedback, setFeedback] = useState({ visible: false, type: 'success' as any, title: '', message: '' });
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [detailVisit, setDetailVisit] = useState<any | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // The running visit already has its own LIVE card above, so keep it out of history.
  const historyVisits = useMemo(() => {
    return (myVisits as any[]).filter(v => v.id !== activeVisit?.id);
  }, [myVisits, activeVisit?.id]);

  // Overall KPI stats
  const kpiStats = useMemo(() => {
    const totalVisits = historyVisits.length + (activeVisit ? 1 : 0);
    const totalDistance = historyVisits.reduce((sum, v) => sum + (v.distanceKm || 0), 0) + (liveDistanceKm || 0);
    const totalDurationMins = historyVisits.reduce((sum, v) => sum + (v.durationMins || 0), 0) + Math.floor(elapsedSeconds / 60);
    return {
      visits: totalVisits,
      distance: totalDistance.toFixed(1),
      duration: formatDuration(totalDurationMins),
    };
  }, [historyVisits, activeVisit, liveDistanceKm, elapsedSeconds]);

  // Filtered projects for picker
  const filteredProjects = useMemo(() => {
    if (!projectSearch.trim()) return projects as any[];
    const q = projectSearch.toLowerCase().trim();
    return (projects as any[]).filter(p =>
      p.name?.toLowerCase().includes(q) || p.key?.toLowerCase().includes(q)
    );
  }, [projects, projectSearch]);

  const trackingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Boot: load active visit + history + projects ───────────
  useEffect(() => {
    const load = async () => {
      const calls: Promise<any>[] = [fetchActiveVisit(), fetchMyVisits()];
      if (projects.length === 0) calls.push(fetchDashboardData());
      await Promise.all(calls);
    };
    load().catch(() => {});
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

  // ── Live UI refresh while a visit is active ─────────────────
  // Actual GPS recording is owned by the native tracker (Android foreground
  // service / iOS background CLLocationManager) so it keeps working while
  // the app is backgrounded or the screen is locked — a plain JS interval
  // cannot do that, the OS suspends it the moment the app leaves the
  // foreground. This just keeps the on-screen clock and route stats fresh
  // by periodically draining what the native side has captured.
  const startIntervals = useCallback(() => {
    stopIntervals();
    // Drain immediately — covers resuming a visit that collected points
    // while the app was away, so the UI doesn't sit on stale numbers.
    syncFromNative().catch(() => {});
    timerInterval.current = setInterval(() => {
      useFieldVisitStore.getState().tickElapsed();
    }, 1000);
    trackingInterval.current = setInterval(() => {
      syncFromNative().catch(() => {});
    }, 15000);
  }, []);

  const stopIntervals = useCallback(() => {
    if (timerInterval.current) { clearInterval(timerInterval.current); timerInterval.current = null; }
    if (trackingInterval.current) { clearInterval(trackingInterval.current); trackingInterval.current = null; }
  }, []);

  // ── Start Visit ─────────────────────────────────────────────
  const handleStart = async () => {
    if (!selectedProject || isGettingLocation || isStarting) return;
    try {
      setIsGettingLocation(true);
      const loc = await getCurrentLocation();
      setIsGettingLocation(false);
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
      setFeedback({ visible: true, type: 'success', title: 'Visit Started!', message: 'Your route is being recorded — this keeps working even if you lock your phone or switch apps.' });
    } catch (e: any) {
      setIsGettingLocation(false);
      const serverMsg = e?.response?.data?.message;
      if (e?.response?.status === 409) {
        setShowStartModal(false);
        fetchActiveVisit().catch(() => {});
        setFeedback({ visible: true, type: 'error', title: 'Visit Already Running', message: serverMsg || 'You already have a field visit in progress. End it before starting a new one.' });
        return;
      }
      setFeedback({ visible: true, type: 'error', title: 'Could Not Start', message: serverMsg || e?.message || 'Failed to get GPS location. Please enable location permissions and try again.' });
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
      { text: 'No, keep it' },
      { text: 'Yes, Cancel', style: 'destructive', onPress: async () => {
        if (activeVisit) await cancelVisit(activeVisit.id);
      }},
    ]);
  };

  // ── Pull to refresh ─────────────────────────────────────────
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchActiveVisit(), fetchMyVisits()]);
    } catch (_) {
    } finally {
      setRefreshing(false);
    }
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
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />

      {/* ── Top Header bar (outside scroll) ── */}
      <View style={styles.topBar}>
        <View style={styles.headerLeftRow}>
          {navigation.canGoBack() && (
            <TouchableOpacity style={styles.backBtn} activeOpacity={0.7} onPress={() => navigation.goBack()}>
              <ChevronLeft size={20} color="#0F172A" />
            </TouchableOpacity>
          )}
          <View>
            <Text style={styles.headerTitle}>Field Visits</Text>
            <Text style={styles.headerSub}>Track your site visits & route</Text>
          </View>
        </View>

        {!activeVisit && (
          <TouchableOpacity style={styles.startBtn} activeOpacity={0.8} onPress={() => setShowStartModal(true)}>
            <Plus size={16} color="#FFFFFF" strokeWidth={2.5} />
            <Text style={styles.startBtnText}>New Visit</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#E25E3E']}
            tintColor="#E25E3E"
          />
        }
      >
        {/* ── Active Live Visit Card ── */}
        {activeVisit && (
          <View style={styles.activeCard}>
            <View style={styles.activeTopRow}>
              <View style={styles.activePulseWrap}>
                <View style={styles.activePulseOuter} />
                <View style={styles.activeDot} />
                <Text style={styles.activeLabel}>LIVE TRACKING</Text>
              </View>
              <View style={styles.liveGpsBadge}>
                <Navigation size={12} color="#38BDF8" />
                <Text style={styles.liveGpsText}>GPS Active</Text>
              </View>
            </View>

            <Text style={styles.activeProject} numberOfLines={1}>
              {activeVisit.project?.name || 'Active Project'}
            </Text>

            {activeVisit.purpose ? (
              <View style={styles.activePurposeContainer}>
                <Text style={styles.activePurpose} numberOfLines={2}>
                  {activeVisit.purpose}
                </Text>
              </View>
            ) : null}

            {/* Metrics Glass Row */}
            <View style={styles.metricsRow}>
              <View style={styles.metricBox}>
                <View style={[styles.metricIconWrap, { backgroundColor: 'rgba(226, 94, 62, 0.18)' }]}>
                  <Clock size={16} color="#E25E3E" />
                </View>
                <Text style={styles.metricValue}>{formatElapsed(elapsedSeconds)}</Text>
                <Text style={styles.metricLabel}>Elapsed</Text>
              </View>

              <View style={styles.metricDivider} />

              <View style={styles.metricBox}>
                <View style={[styles.metricIconWrap, { backgroundColor: 'rgba(56, 189, 248, 0.18)' }]}>
                  <Ruler size={16} color="#38BDF8" />
                </View>
                <Text style={styles.metricValue}>{liveDistanceKm.toFixed(2)} km</Text>
                <Text style={styles.metricLabel}>Distance</Text>
              </View>

              <View style={styles.metricDivider} />

              <View style={styles.metricBox}>
                <View style={[styles.metricIconWrap, { backgroundColor: 'rgba(168, 85, 247, 0.18)' }]}>
                  <Navigation size={16} color="#C084FC" />
                </View>
                <Text style={styles.metricValue}>{routePoints.length}</Text>
                <Text style={styles.metricLabel}>Points</Text>
              </View>
            </View>

            {/* Action Buttons */}
            <View style={styles.activeActions}>
              <TouchableOpacity style={styles.endBtn} activeOpacity={0.8} onPress={() => setShowEndModal(true)}>
                <Square size={16} color="#FFFFFF" fill="#FFFFFF" />
                <Text style={styles.endBtnText}>End Visit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelBtn} activeOpacity={0.7} onPress={handleCancel}>
                <X size={18} color="#EF4444" strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── KPI Summary Stats (When visits exist) ── */}
        {historyVisits.length > 0 && (
          <View style={styles.kpiCard}>
            <View style={styles.kpiItem}>
              <Text style={styles.kpiVal}>{kpiStats.visits}</Text>
              <Text style={styles.kpiLbl}>Total Visits</Text>
            </View>
            <View style={styles.kpiDivider} />
            <View style={styles.kpiItem}>
              <Text style={[styles.kpiVal, { color: '#E25E3E' }]}>{kpiStats.distance} <Text style={styles.kpiUnit}>km</Text></Text>
              <Text style={styles.kpiLbl}>Distance</Text>
            </View>
            <View style={styles.kpiDivider} />
            <View style={styles.kpiItem}>
              <Text style={styles.kpiVal}>{kpiStats.duration}</Text>
              <Text style={styles.kpiLbl}>Time Logged</Text>
            </View>
          </View>
        )}

        {/* ── Visit History Header ── */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Visit History</Text>
          {historyVisits.length > 0 && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{historyVisits.length}</Text>
            </View>
          )}
        </View>

        {/* ── Empty State ── */}
        {historyVisits.length === 0 ? (
          <View style={styles.emptyBox}>
            <View style={styles.emptyIconCircle}>
              <MapPin size={32} color="#E25E3E" />
            </View>
            <Text style={styles.emptyTitle}>No visits yet</Text>
            <Text style={styles.emptySub}>Start your first field visit to track your route and capture site logs.</Text>
            <TouchableOpacity style={styles.emptyActionBtn} activeOpacity={0.8} onPress={() => setShowStartModal(true)}>
              <Plus size={16} color="#FFFFFF" strokeWidth={2.5} />
              <Text style={styles.emptyActionBtnText}>Start New Visit</Text>
            </TouchableOpacity>
          </View>
        ) : (
          historyVisits.map((v) => {
            const sc = statusColor(v.status);
            return (
              <TouchableOpacity
                key={v.id}
                style={styles.historyCard}
                activeOpacity={0.8}
                onPress={() => setDetailVisit(v)}
              >
                {/* Header row: Project & Status Badge */}
                <View style={styles.historyHeader}>
                  <View style={styles.projectTitleRow}>
                    <View style={[styles.projectDot, { backgroundColor: v.project?.color || '#E25E3E' }]} />
                    <Text style={styles.historyProject} numberOfLines={1}>
                      {v.project?.name || 'General Visit'}
                    </Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: sc.bg, borderColor: sc.border }]}>
                    <View style={[styles.statusDot, { backgroundColor: sc.dot }]} />
                    <Text style={[styles.statusText, { color: sc.text }]}>{sc.label}</Text>
                  </View>
                </View>

                {/* Date & Time */}
                <View style={styles.dateRow}>
                  <Calendar size={12} color="#94A3B8" />
                  <Text style={styles.historyDate}>
                    {new Date(v.startTime).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {'  •  '}
                    {new Date(v.startTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>

                {/* Purpose if present */}
                {v.purpose ? (
                  <View style={styles.purposeBox}>
                    <Text style={styles.historyPurpose} numberOfLines={2}>{v.purpose}</Text>
                  </View>
                ) : null}

                {/* Metric Chips Row */}
                <View style={styles.historyMetrics}>
                  {v.distanceKm !== undefined && v.distanceKm !== null && (
                    <View style={styles.historyMetricChip}>
                      <Ruler size={13} color="#2563EB" />
                      <Text style={styles.historyMetricChipText}>{v.distanceKm.toFixed(2)} km</Text>
                    </View>
                  )}
                  {v.durationMins !== undefined && v.durationMins !== null && (
                    <View style={[styles.historyMetricChip, { backgroundColor: '#FFF1EC' }]}>
                      <Clock size={13} color="#E25E3E" />
                      <Text style={[styles.historyMetricChipText, { color: '#E25E3E' }]}>{formatDuration(v.durationMins)}</Text>
                    </View>
                  )}
                  {v.photos && v.photos.length > 0 && (
                    <View style={[styles.historyMetricChip, { backgroundColor: '#FAF5FF' }]}>
                      <Camera size={13} color="#9333EA" />
                      <Text style={[styles.historyMetricChipText, { color: '#9333EA' }]}>
                        {v.photos.length} photo{v.photos.length > 1 ? 's' : ''}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Photo Thumbnails */}
                {v.photos && v.photos.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoStrip}>
                    {v.photos.map((p: any) => (
                      <TouchableOpacity
                        key={p.id}
                        style={styles.photoThumbCard}
                        activeOpacity={0.85}
                        onPress={() => setPreviewImage(p.url)}
                      >
                        <Image source={{ uri: p.url }} style={styles.photoImg} resizeMode="cover" />
                        <View style={styles.photoTimeOverlay}>
                          <Text style={styles.photoTimeText}>
                            {new Date(p.takenAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}

                {/* Footer: View Details CTA */}
                <View style={styles.viewDetailsRow}>
                  <Text style={styles.viewDetailsText}>View details</Text>
                  <ArrowRight size={14} color="#E25E3E" strokeWidth={2.5} />
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* ── Start Visit Modal ── */}
      <Modal visible={showStartModal} transparent animationType="slide" onRequestClose={() => setShowStartModal(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowStartModal(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.dragHandle} />
            <View style={styles.modalHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={styles.modalIconWrap}>
                  <Play size={16} color="#E25E3E" fill="#E25E3E" />
                </View>
                <Text style={styles.modalTitle}>Start Field Visit</Text>
              </View>
              <TouchableOpacity onPress={() => setShowStartModal(false)} style={styles.modalClose}>
                <X size={18} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              <Text style={styles.fieldLabel}>Select Project <Text style={styles.required}>*</Text></Text>
              <TouchableOpacity
                style={[styles.projectSelector, selectedProject ? styles.projectSelectorActive : null]}
                activeOpacity={0.8}
                onPress={() => {
                  setProjectSearch('');
                  setShowProjectPicker(true);
                }}
              >
                {selectedProject ? (
                  <View style={styles.selectedProjectRow}>
                    <View style={[styles.projectDot, { backgroundColor: selectedProject.color || '#E25E3E' }]} />
                    <Text style={styles.selectedProjectName} numberOfLines={1}>{selectedProject.name}</Text>
                    {selectedProject.key ? (
                      <View style={styles.projectKeyBadge}>
                        <Text style={styles.projectKeyText}>{selectedProject.key}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <View style={styles.placeholderRow}>
                    <Briefcase size={16} color="#94A3B8" />
                    <Text style={styles.placeholderText}>Choose a project...</Text>
                  </View>
                )}
                <ChevronDown size={18} color="#64748B" />
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Purpose <Text style={styles.optional}>(Optional)</Text></Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Client meeting, Site inspection, Survey..."
                placeholderTextColor="#94A3B8"
                value={purpose}
                onChangeText={setPurpose}
                multiline
                numberOfLines={3}
              />

              {/* GPS Info Banner */}
              <View style={styles.gpsInfo}>
                <View style={styles.gpsIconCircle}>
                  <MapPin size={16} color="#E25E3E" />
                </View>
                <Text style={styles.gpsInfoText}>
                  Your current GPS coordinates will be captured as the trip starting point.
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.confirmBtn, (!selectedProject || isStarting || isGettingLocation) && styles.confirmBtnDisabled]}
                onPress={handleStart}
                disabled={!selectedProject || isStarting || isGettingLocation}
                activeOpacity={0.85}
              >
                {(isGettingLocation || isStarting) ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator color="#FFFFFF" size="small" />
                    <Text style={styles.confirmBtnText}>{isGettingLocation ? 'Capturing GPS location...' : 'Starting trip...'}</Text>
                  </View>
                ) : (
                  <>
                    <Play size={16} color="#FFFFFF" fill="#FFFFFF" />
                    <Text style={styles.confirmBtnText}>Start Visit</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Project Picker Modal ── */}
      <Modal visible={showProjectPicker} transparent animationType="slide" onRequestClose={() => setShowProjectPicker(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowProjectPicker(false)} />
          <View style={[styles.modalSheet, { maxHeight: '80%' }]}>
            <View style={styles.dragHandle} />
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Select Project</Text>
              <TouchableOpacity onPress={() => setShowProjectPicker(false)} style={styles.modalClose}>
                <X size={18} color="#64748B" />
              </TouchableOpacity>
            </View>

            {/* Search Box */}
            <View style={styles.searchBoxWrap}>
              <Search size={16} color="#94A3B8" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search projects by name or code..."
                placeholderTextColor="#94A3B8"
                value={projectSearch}
                onChangeText={setProjectSearch}
                autoCorrect={false}
              />
              {projectSearch.length > 0 && (
                <TouchableOpacity onPress={() => setProjectSearch('')}>
                  <X size={16} color="#94A3B8" />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 380 }}>
              {filteredProjects.length === 0 ? (
                <View style={{ padding: 32, alignItems: 'center', gap: 6 }}>
                  <Briefcase size={28} color="#CBD5E1" />
                  <Text style={{ color: '#64748B', fontSize: 14, fontWeight: '600' }}>No projects found</Text>
                  <Text style={{ color: '#94A3B8', fontSize: 12 }}>Try searching with a different term</Text>
                </View>
              ) : filteredProjects.map((p) => {
                const isSelected = selectedProject?.id === p.id;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.projectOption, isSelected && styles.projectOptionSelected]}
                    activeOpacity={0.7}
                    onPress={() => {
                      setSelectedProject({ id: p.id, name: p.name, key: p.key || '', color: p.color || '#E25E3E' });
                      setShowProjectPicker(false);
                    }}
                  >
                    <View style={[styles.projectOptionAvatar, { backgroundColor: (p.color || '#E25E3E') + '1A' }]}>
                      <Briefcase size={16} color={p.color || '#E25E3E'} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.projectOptionName, isSelected && { color: '#E25E3E' }]}>{p.name}</Text>
                      {p.key ? <Text style={styles.projectOptionKey}>{p.key}</Text> : null}
                    </View>
                    {isSelected && (
                      <View style={styles.selectedCheckCircle}>
                        <Check size={14} color="#FFFFFF" strokeWidth={3} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── End Visit Modal ── */}
      <Modal visible={showEndModal} transparent animationType="slide" onRequestClose={() => setShowEndModal(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowEndModal(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.dragHandle} />
            <View style={styles.modalHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={[styles.modalIconWrap, { backgroundColor: '#FEE2E2' }]}>
                  <Square size={14} color="#DC2626" fill="#DC2626" />
                </View>
                <Text style={styles.modalTitle}>End Field Visit</Text>
              </View>
              <TouchableOpacity onPress={() => setShowEndModal(false)} style={styles.modalClose}>
                <X size={18} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {/* Trip Summary Card */}
              <View style={styles.endSummaryBox}>
                <View style={styles.endSummaryHeader}>
                  <Text style={styles.endSummaryTitle}>Trip Summary</Text>
                  <View style={styles.endSummaryBadge}>
                    <Activity size={12} color="#E25E3E" />
                    <Text style={styles.endSummaryBadgeText}>Logged Route</Text>
                  </View>
                </View>
                <View style={styles.endSummaryMetrics}>
                  <View style={styles.endMetricItem}>
                    <Clock size={16} color="#E25E3E" />
                    <Text style={styles.endMetricVal}>{formatElapsed(elapsedSeconds)}</Text>
                    <Text style={styles.endMetricLbl}>Duration</Text>
                  </View>
                  <View style={styles.endMetricDivider} />
                  <View style={styles.endMetricItem}>
                    <Ruler size={16} color="#2563EB" />
                    <Text style={styles.endMetricVal}>{liveDistanceKm.toFixed(2)} km</Text>
                    <Text style={styles.endMetricLbl}>Distance</Text>
                  </View>
                  <View style={styles.endMetricDivider} />
                  <View style={styles.endMetricItem}>
                    <Navigation size={16} color="#9333EA" />
                    <Text style={styles.endMetricVal}>{routePoints.length}</Text>
                    <Text style={styles.endMetricLbl}>GPS Points</Text>
                  </View>
                </View>
              </View>

              <Text style={styles.fieldLabel}>Visit Notes <Text style={styles.optional}>(Optional)</Text></Text>
              <TextInput
                style={[styles.textInput, { minHeight: 80, textAlignVertical: 'top' }]}
                placeholder="Add notes about client discussions, site status, or follow-ups..."
                placeholderTextColor="#94A3B8"
                value={endNotes}
                onChangeText={setEndNotes}
                multiline
              />

              <Text style={styles.fieldLabel}>Photos & Proof <Text style={styles.optional}>(Optional)</Text></Text>
              <View style={styles.photoActions}>
                <TouchableOpacity style={styles.photoBtn} activeOpacity={0.8} onPress={() => pickPhoto('camera')}>
                  <Camera size={18} color="#E25E3E" />
                  <Text style={styles.photoBtnText}>Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.photoBtn, { borderColor: '#DBEAFE', backgroundColor: '#EFF6FF' }]} activeOpacity={0.8} onPress={() => pickPhoto('gallery')}>
                  <ImageIcon size={18} color="#2563EB" />
                  <Text style={[styles.photoBtnText, { color: '#2563EB' }]}>Gallery</Text>
                </TouchableOpacity>
              </View>

              {pendingPhotos.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                  {pendingPhotos.map((p, i) => (
                    <View key={i} style={styles.pendingPhotoWrap}>
                      <Image source={{ uri: p.uri }} style={styles.pendingPhotoImg} />
                      <TouchableOpacity
                        style={styles.removePhoto}
                        activeOpacity={0.8}
                        onPress={() => setPendingPhotos(prev => prev.filter((_, idx) => idx !== i))}
                      >
                        <X size={12} color="#FFFFFF" strokeWidth={2.5} />
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
                activeOpacity={0.85}
              >
                {isEnding ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator color="#FFFFFF" size="small" />
                    <Text style={styles.confirmBtnText}>Finalizing visit log...</Text>
                  </View>
                ) : (
                  <>
                    <CheckCircle2 size={18} color="#FFFFFF" strokeWidth={2.5} />
                    <Text style={styles.confirmBtnText}>Complete & Save Visit</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Visit Detail Modal ── */}
      <Modal visible={detailVisit !== null} transparent animationType="slide" onRequestClose={() => setDetailVisit(null)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setDetailVisit(null)} />
          <View style={[styles.modalSheet, styles.detailSheet]}>
            <View style={styles.dragHandle} />
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Visit Details</Text>
              <TouchableOpacity onPress={() => setDetailVisit(null)} style={styles.modalClose}>
                <X size={18} color="#64748B" />
              </TouchableOpacity>
            </View>

            {detailVisit && (
              <ScrollView
                style={styles.modalBody}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 20) + 16 }}
              >
                {/* Project + status banner */}
                <View style={styles.detailProjectCard}>
                  <View style={styles.detailProjectRow}>
                    <View style={[styles.projectDotLarge, { backgroundColor: detailVisit.project?.color || '#E25E3E' }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.detailProjectName} numberOfLines={2}>
                        {detailVisit.project?.name || 'Project Visit'}
                      </Text>
                      <Text style={styles.detailDateText}>
                        {new Date(detailVisit.startTime).toLocaleDateString('en-IN', {
                          weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </Text>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: statusColor(detailVisit.status).bg, borderColor: statusColor(detailVisit.status).border }]}>
                      <View style={[styles.statusDot, { backgroundColor: statusColor(detailVisit.status).dot }]} />
                      <Text style={[styles.statusText, { color: statusColor(detailVisit.status).text }]}>
                        {statusColor(detailVisit.status).label}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Purpose Block */}
                {detailVisit.purpose ? (
                  <View style={styles.detailBlock}>
                    <Text style={styles.detailLabel}>PURPOSE</Text>
                    <View style={styles.purposeCallout}>
                      <Text style={styles.detailValue}>{detailVisit.purpose}</Text>
                    </View>
                  </View>
                ) : null}

                {/* Metrics 3-Card Grid */}
                <View style={styles.detailMetricsRow}>
                  <View style={styles.detailMetricBox}>
                    <Ruler size={16} color="#2563EB" />
                    <Text style={styles.detailMetricValue}>
                      {detailVisit.distanceKm != null ? `${detailVisit.distanceKm.toFixed(2)}` : '0.00'}
                    </Text>
                    <Text style={styles.detailMetricLabel}>Distance (km)</Text>
                  </View>
                  <View style={styles.detailMetricDivider} />
                  <View style={styles.detailMetricBox}>
                    <Clock size={16} color="#E25E3E" />
                    <Text style={styles.detailMetricValue}>
                      {detailVisit.durationMins != null ? formatDuration(detailVisit.durationMins) : '0m'}
                    </Text>
                    <Text style={styles.detailMetricLabel}>Duration</Text>
                  </View>
                  <View style={styles.detailMetricDivider} />
                  <View style={styles.detailMetricBox}>
                    <Navigation size={16} color="#9333EA" />
                    <Text style={styles.detailMetricValue}>
                      {Array.isArray(detailVisit.routePoints) ? detailVisit.routePoints.length : 0}
                    </Text>
                    <Text style={styles.detailMetricLabel}>GPS Points</Text>
                  </View>
                </View>

                {/* Route Timeline */}
                <Text style={styles.detailLabel}>ROUTE TIMELINE</Text>
                <View style={styles.timeline}>
                  <View style={styles.timelineRow}>
                    <View style={styles.timelineGutter}>
                      <View style={[styles.timelineDot, { backgroundColor: '#10B981' }]} />
                      <View style={styles.timelineLine} />
                    </View>
                    <View style={styles.timelineContent}>
                      <Text style={styles.timelineTime}>
                        {new Date(detailVisit.startTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        <Text style={styles.timelineTag}>  •  Started Trip</Text>
                      </Text>
                      <Text style={styles.timelineAddress}>
                        {detailVisit.startAddress ||
                          `${detailVisit.startLat?.toFixed(5) ?? '0.00'}, ${detailVisit.startLng?.toFixed(5) ?? '0.00'}`}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.timelineRow}>
                    <View style={styles.timelineGutter}>
                      <View style={[styles.timelineDot, { backgroundColor: detailVisit.endTime ? '#E25E3E' : '#CBD5E1' }]} />
                    </View>
                    <View style={styles.timelineContent}>
                      <Text style={styles.timelineTime}>
                        {detailVisit.endTime
                          ? new Date(detailVisit.endTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                          : '—'}
                        <Text style={styles.timelineTag}>
                          {'  •  '}{detailVisit.status === 'CANCELLED' ? 'Trip Cancelled' : 'Trip Completed'}
                        </Text>
                      </Text>
                      <Text style={styles.timelineAddress}>
                        {detailVisit.endAddress ||
                          (detailVisit.endLat != null
                            ? `${detailVisit.endLat.toFixed(5)}, ${detailVisit.endLng.toFixed(5)}`
                            : 'Site destination recorded')}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Notes */}
                {detailVisit.notes ? (
                  <View style={styles.detailBlock}>
                    <Text style={styles.detailLabel}>VISIT NOTES</Text>
                    <View style={styles.notesBox}>
                      <FileText size={15} color="#64748B" />
                      <Text style={styles.notesText}>{detailVisit.notes}</Text>
                    </View>
                  </View>
                ) : null}

                {/* Photos Grid */}
                {detailVisit.photos && detailVisit.photos.length > 0 ? (
                  <View style={styles.detailBlock}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <Text style={styles.detailLabel}>ATTACHED PHOTOS ({detailVisit.photos.length})</Text>
                      <Text style={{ fontSize: 11, color: '#94A3B8' }}>Tap to enlarge</Text>
                    </View>
                    <View style={styles.photoGrid}>
                      {detailVisit.photos.map((p: any) => (
                        <TouchableOpacity
                          key={p.id}
                          style={styles.photoGridItem}
                          activeOpacity={0.85}
                          onPress={() => setPreviewImage(p.url)}
                        >
                          <Image source={{ uri: p.url }} style={styles.photoGridImg} resizeMode="cover" />
                          <View style={styles.photoGridOverlay}>
                            <Camera size={11} color="#FFFFFF" />
                            <Text style={styles.photoGridTime}>
                              {new Date(p.takenAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ) : null}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Fullscreen Image Lightbox Modal ── */}
      <Modal visible={previewImage !== null} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <View style={styles.lightboxOverlay}>
          <TouchableOpacity style={styles.lightboxCloseBtn} activeOpacity={0.8} onPress={() => setPreviewImage(null)}>
            <X size={22} color="#FFFFFF" strokeWidth={2.5} />
          </TouchableOpacity>
          {previewImage && (
            <Image source={{ uri: previewImage }} style={styles.lightboxImage} resizeMode="contain" />
          )}
        </View>
      </Modal>

      {/* ── Feedback Modal ── */}
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

  // Top bar outside scroll
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 2,
  },
  headerLeftRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#0F172A', letterSpacing: -0.3 },
  headerSub: { fontSize: 12, color: '#94A3B8', marginTop: 1, fontWeight: '500' },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E25E3E',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    shadowColor: '#E25E3E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },
  startBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13.5 },

  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 44, gap: 14 },

  // Active Live Visit Card
  activeCard: {
    backgroundColor: '#0F172A',
    borderRadius: 22,
    padding: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(226, 94, 62, 0.4)',
    shadowColor: '#E25E3E',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  activeTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  activePulseWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  activePulseOuter: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22C55E',
  },
  activeDot: { display: 'none' },
  activeLabel: { fontSize: 10.5, fontWeight: '800', color: '#22C55E', letterSpacing: 0.8 },
  liveGpsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
  },
  liveGpsText: { fontSize: 11, fontWeight: '600', color: '#38BDF8' },

  activeProject: { fontSize: 20, fontWeight: '800', color: '#FFFFFF', marginBottom: 4, letterSpacing: -0.2 },
  activePurposeContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 14,
  },
  activePurpose: { fontSize: 12.5, color: '#CBD5E1', lineHeight: 18 },

  metricsRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  metricBox: { flex: 1, alignItems: 'center', gap: 3 },
  metricIconWrap: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginBottom: 2 },
  metricDivider: { width: 1, backgroundColor: 'rgba(255, 255, 255, 0.1)', marginVertical: 4 },
  metricValue: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  metricLabel: { fontSize: 10, fontWeight: '600', color: '#94A3B8' },

  activeActions: { flexDirection: 'row', gap: 10 },
  endBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#E25E3E',
    borderRadius: 14,
    paddingVertical: 13,
    shadowColor: '#E25E3E',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  endBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  cancelBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // KPI Card
  kpiCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  kpiItem: { flex: 1, alignItems: 'center' },
  kpiVal: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  kpiUnit: { fontSize: 12, fontWeight: '600', color: '#64748B' },
  kpiLbl: { fontSize: 11, color: '#94A3B8', fontWeight: '600', marginTop: 2 },
  kpiDivider: { width: 1, backgroundColor: '#F1F5F9', marginVertical: 4 },

  // Section Header
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A', letterSpacing: -0.2 },
  countBadge: { backgroundColor: '#F1F5F9', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  countBadgeText: { fontSize: 11.5, fontWeight: '700', color: '#64748B' },

  // History Cards
  historyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  projectTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  projectDot: { width: 9, height: 9, borderRadius: 4.5 },
  projectDotLarge: { width: 12, height: 12, borderRadius: 6 },
  historyProject: { fontSize: 15.5, fontWeight: '800', color: '#0F172A', flex: 1 },

  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
    borderRadius: 10,
    borderWidth: 1,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.2 },

  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  historyDate: { fontSize: 12, color: '#64748B', fontWeight: '500' },

  purposeBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 7,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  historyPurpose: { fontSize: 12.5, color: '#334155', lineHeight: 17, fontWeight: '500' },

  historyMetrics: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 4 },
  historyMetricChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
  },
  historyMetricChipText: { fontSize: 12, color: '#334155', fontWeight: '700' },

  photoStrip: { marginTop: 10, marginBottom: 4 },
  photoThumbCard: {
    width: 82,
    height: 82,
    borderRadius: 13,
    marginRight: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    position: 'relative',
    backgroundColor: '#F1F5F9',
  },
  photoImg: { width: '100%', height: '100%' },
  photoTimeOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    paddingVertical: 2,
    alignItems: 'center',
  },
  photoTimeText: { fontSize: 9.5, color: '#FFFFFF', fontWeight: '600' },

  viewDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
  },
  viewDetailsText: { fontSize: 12.5, fontWeight: '700', color: '#E25E3E' },

  // Empty Box
  emptyBox: { alignItems: 'center', paddingVertical: 40, gap: 10, backgroundColor: '#FFFFFF', borderRadius: 20, borderWidth: 1, borderColor: '#F1F5F9', paddingHorizontal: 20 },
  emptyIconCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFF1EC', justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  emptySub: { fontSize: 13, color: '#94A3B8', textAlign: 'center', lineHeight: 19 },
  emptyActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E25E3E',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 12,
    marginTop: 6,
    shadowColor: '#E25E3E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  emptyActionBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },

  // Modals & Bottom Sheets
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15, 23, 42, 0.55)' },
  modalBackdrop: { ...StyleSheet.absoluteFill },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '92%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 18,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 10,
  },
  dragHandle: { width: 44, height: 4, backgroundColor: '#CBD5E1', borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 6 },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalIconWrap: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#FFF1EC', justifyContent: 'center', alignItems: 'center' },
  modalTitle: { fontSize: 17.5, fontWeight: '800', color: '#0F172A', letterSpacing: -0.2 },
  modalClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', justifyContent: 'center', alignItems: 'center' },
  modalBody: { padding: 20 },

  fieldLabel: { fontSize: 13, fontWeight: '700', color: '#1E293B', marginBottom: 8 },
  required: { color: '#E25E3E' },
  optional: { color: '#94A3B8', fontWeight: '400' },
  textInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0F172A',
    marginBottom: 16,
  },

  projectSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 16,
  },
  projectSelectorActive: { borderColor: '#E25E3E', backgroundColor: '#FFFDFD' },
  selectedProjectRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  selectedProjectName: { fontSize: 14, fontWeight: '700', color: '#0F172A', flexShrink: 1 },
  projectKeyBadge: { backgroundColor: '#F1F5F9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  projectKeyText: { fontSize: 11, fontWeight: '700', color: '#64748B' },
  placeholderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  placeholderText: { fontSize: 14, color: '#94A3B8', fontWeight: '500' },

  gpsInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFF1EC',
    borderRadius: 12,
    padding: 13,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#FFE2D9',
  },
  gpsIconCircle: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' },
  gpsInfoText: { flex: 1, fontSize: 12.5, color: '#C2410C', fontWeight: '600', lineHeight: 18 },

  confirmBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#E25E3E',
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 4,
    shadowColor: '#E25E3E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmBtnDisabled: { opacity: 0.5 },
  confirmBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15.5 },

  // Search in Picker Modal
  searchBoxWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 13.5, color: '#0F172A', padding: 0 },
  projectOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  projectOptionSelected: { backgroundColor: '#FFF1EC' },
  projectOptionAvatar: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  projectOptionName: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  projectOptionKey: { fontSize: 11, fontWeight: '600', color: '#94A3B8', marginTop: 1 },
  selectedCheckCircle: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#E25E3E', justifyContent: 'center', alignItems: 'center' },

  // End Modal Summary
  endSummaryBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  endSummaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  endSummaryTitle: { fontSize: 13, fontWeight: '800', color: '#0F172A', textTransform: 'uppercase', letterSpacing: 0.5 },
  endSummaryBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFF1EC', paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 8 },
  endSummaryBadgeText: { fontSize: 10.5, fontWeight: '700', color: '#E25E3E' },
  endSummaryMetrics: { flexDirection: 'row', alignItems: 'center' },
  endMetricItem: { flex: 1, alignItems: 'center', gap: 3 },
  endMetricVal: { fontSize: 15.5, fontWeight: '800', color: '#0F172A' },
  endMetricLbl: { fontSize: 10.5, fontWeight: '600', color: '#94A3B8' },
  endMetricDivider: { width: 1, height: 26, backgroundColor: '#E2E8F0' },

  photoActions: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  photoBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFF1EC',
    borderWidth: 1,
    borderColor: '#FFE2D9',
    borderRadius: 12,
    paddingVertical: 12,
  },
  photoBtnText: { fontSize: 13.5, fontWeight: '700', color: '#E25E3E' },

  pendingPhotoWrap: { marginRight: 10, alignItems: 'center', position: 'relative' },
  pendingPhotoImg: { width: 78, height: 78, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0' },
  removePhoto: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#DC2626',
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  photoTime: { fontSize: 10, color: '#94A3B8', marginTop: 3, fontWeight: '600' },

  // Detail Modal Sheet
  detailSheet: { maxHeight: '90%' },
  detailProjectCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  detailProjectRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailProjectName: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  detailDateText: { fontSize: 12, fontWeight: '500', color: '#64748B', marginTop: 2 },

  detailBlock: { marginBottom: 18 },
  detailLabel: { fontSize: 11, fontWeight: '800', color: '#94A3B8', letterSpacing: 0.6, marginBottom: 8 },
  purposeCallout: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#F1F5F9' },
  detailValue: { fontSize: 13.5, color: '#0F172A', fontWeight: '600', lineHeight: 20 },

  detailMetricsRow: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 20,
  },
  detailMetricBox: { flex: 1, alignItems: 'center', gap: 3 },
  detailMetricValue: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  detailMetricLabel: { fontSize: 10.5, fontWeight: '600', color: '#94A3B8' },
  detailMetricDivider: { width: 1, height: 26, backgroundColor: '#E2E8F0', alignSelf: 'center' },

  timeline: { marginBottom: 20 },
  timelineRow: { flexDirection: 'row', gap: 12 },
  timelineGutter: { width: 14, alignItems: 'center' },
  timelineDot: { width: 12, height: 12, borderRadius: 6, marginTop: 3 },
  timelineLine: { flex: 1, width: 2, backgroundColor: '#E2E8F0', marginVertical: 3 },
  timelineContent: { flex: 1, paddingBottom: 16 },
  timelineTime: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  timelineTag: { fontSize: 11.5, fontWeight: '600', color: '#94A3B8' },
  timelineAddress: { fontSize: 12.5, color: '#475569', marginTop: 2, lineHeight: 18 },

  notesBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  notesText: { flex: 1, fontSize: 13, color: '#334155', lineHeight: 19 },

  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoGridItem: {
    width: (SCREEN_WIDTH - 72) / 2,
    height: 120,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    position: 'relative',
  },
  photoGridImg: { width: '100%', height: '100%' },
  photoGridOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  photoGridTime: { fontSize: 10, color: '#FFFFFF', fontWeight: '600' },

  // Lightbox
  lightboxOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxCloseBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 30,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  lightboxImage: { width: '92%', height: '80%' },
});

