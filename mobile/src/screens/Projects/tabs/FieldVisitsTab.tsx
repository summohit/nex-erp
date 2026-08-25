import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Image, TouchableOpacity, Modal, Platform,
} from 'react-native';
import { MapPin, Clock, Ruler, Camera, User, CheckCircle2, XCircle, AlertTriangle, X } from 'lucide-react-native';
import { useFieldVisitStore } from '../../../store/fieldVisitStore';
import { formatDuration } from '../../../utils/haversine';

interface Props {
  projectId: number;
}

const statusColor = (status: string) => {
  if (status === 'COMPLETED') {
    return { bg: '#ECFDF5', border: '#A7F3D0', text: '#065F46', dot: '#10B981', label: 'COMPLETED' };
  }
  if (status === 'CANCELLED') {
    return { bg: '#FEF2F2', border: '#FECACA', text: '#991B1B', dot: '#EF4444', label: 'CANCELLED' };
  }
  return { bg: '#FFF7ED', border: '#FFEDD5', text: '#C2410C', dot: '#F97316', label: 'IN PROGRESS' };
};

export default function FieldVisitsTab({ projectId }: Props) {
  const { projectVisits, isLoading, fetchProjectVisits } = useFieldVisitStore();
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  useEffect(() => {
    fetchProjectVisits(projectId);
  }, [projectId]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#E25E3E" />
      </View>
    );
  }

  if (projectVisits.length === 0) {
    return (
      <View style={styles.emptyBox}>
        <View style={styles.emptyIconCircle}>
          <MapPin size={32} color="#E25E3E" />
        </View>
        <Text style={styles.emptyTitle}>No field visits yet</Text>
        <Text style={styles.emptySub}>Team members' site visits for this project will appear here.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {projectVisits.map((v) => {
        const sc = statusColor(v.status);
        const employeeName = v.employee
          ? v.employee.firstName + ' ' + v.employee.lastName
          : 'Employee';

        return (
          <View key={v.id} style={styles.card}>
            {/* Employee + Status */}
            <View style={styles.cardHeader}>
              {v.employee?.avatarUrl ? (
                <Image source={{ uri: v.employee.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <User size={18} color="#E25E3E" />
                </View>
              )}
              <View style={styles.employeeInfo}>
                <Text style={styles.employeeName}>{employeeName}</Text>
                <Text style={styles.visitDate}>
                  {new Date(v.startTime).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {'  •  '}
                  {new Date(v.startTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: sc.bg, borderColor: sc.border }]}>
                <View style={[styles.statusDot, { backgroundColor: sc.dot }]} />
                <Text style={[styles.statusText, { color: sc.text }]}>{sc.label}</Text>
              </View>
            </View>

            {/* Purpose */}
            {v.purpose ? (
              <View style={styles.purposeBox}>
                <Text style={styles.purpose}>{v.purpose}</Text>
              </View>
            ) : null}

            {/* Metrics */}
            <View style={styles.metricsRow}>
              {v.distanceKm != null && (
                <View style={styles.metricChip}>
                  <Ruler size={13} color="#2563EB" />
                  <Text style={styles.metricText}>{v.distanceKm.toFixed(2)} km</Text>
                </View>
              )}
              {v.durationMins != null && (
                <View style={[styles.metricChip, { backgroundColor: '#FFF1EC' }]}>
                  <Clock size={13} color="#E25E3E" />
                  <Text style={[styles.metricText, { color: '#E25E3E' }]}>{formatDuration(v.durationMins)}</Text>
                </View>
              )}
              {v.photos && v.photos.length > 0 && (
                <View style={[styles.metricChip, { backgroundColor: '#FAF5FF' }]}>
                  <Camera size={13} color="#9333EA" />
                  <Text style={[styles.metricText, { color: '#9333EA' }]}>{v.photos.length} photo{v.photos.length > 1 ? 's' : ''}</Text>
                </View>
              )}
            </View>

            {/* Route: start → end */}
            <View style={styles.routeBox}>
              <View style={styles.routePoint}>
                <View style={[styles.routeDot, { backgroundColor: '#10B981' }]} />
                <Text style={styles.routeText} numberOfLines={1}>
                  Start: {v.startAddress || (v.startLat.toFixed(4) + ', ' + v.startLng.toFixed(4))}
                </Text>
              </View>
              {v.endLat && (
                <View style={styles.routePoint}>
                  <View style={[styles.routeDot, { backgroundColor: '#E25E3E' }]} />
                  <Text style={styles.routeText} numberOfLines={1}>
                    End: {v.endAddress || (v.endLat.toFixed(4) + ', ' + (v.endLng ?? 0).toFixed(4))}
                  </Text>
                </View>
              )}
            </View>

            {/* Notes */}
            {v.notes ? (
              <View style={styles.notesBox}>
                <Text style={styles.notesLabel}>VISIT NOTES</Text>
                <Text style={styles.notesText}>{v.notes}</Text>
              </View>
            ) : null}

            {/* Photos */}
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
          </View>
        );
      })}

      {/* Lightbox Modal */}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyIconCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFF1EC', justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  emptySub: { fontSize: 13, color: '#94A3B8', textAlign: 'center', paddingHorizontal: 32, lineHeight: 19 },

  card: {
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
    gap: 10,
  },

  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  avatarPlaceholder: { backgroundColor: '#FFF1EC', justifyContent: 'center', alignItems: 'center' },
  employeeInfo: { flex: 1 },
  employeeName: { fontSize: 14.5, fontWeight: '800', color: '#0F172A' },
  visitDate: { fontSize: 11.5, color: '#64748B', marginTop: 1, fontWeight: '500' },
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

  purposeBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  purpose: { fontSize: 12.5, color: '#334155', fontWeight: '500', lineHeight: 17 },

  metricsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  metricChip: {
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
  metricText: { fontSize: 12, fontWeight: '700', color: '#334155' },

  routeBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  routePoint: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeDot: { width: 8, height: 8, borderRadius: 4 },
  routeText: { fontSize: 12, color: '#475569', flex: 1, fontWeight: '500' },

  notesBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 11,
    borderLeftWidth: 3,
    borderLeftColor: '#E25E3E',
  },
  notesLabel: { fontSize: 10, fontWeight: '800', color: '#94A3B8', marginBottom: 3, letterSpacing: 0.5 },
  notesText: { fontSize: 12.5, color: '#334155', lineHeight: 18 },

  photoStrip: { marginTop: 4 },
  photoThumbCard: {
    width: 80,
    height: 80,
    borderRadius: 12,
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

