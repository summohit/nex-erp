import React, { useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Image,
} from 'react-native';
import { MapPin, Clock, Ruler, Camera, User } from 'lucide-react-native';
import { useFieldVisitStore } from '../../../store/fieldVisitStore';
import { formatDuration } from '../../../utils/haversine';

interface Props {
  projectId: number;
}

const statusColor = (status: string) => {
  if (status === 'COMPLETED') return { bg: '#DCFCE7', text: '#166534' };
  if (status === 'CANCELLED') return { bg: '#FEE2E2', text: '#991B1B' };
  return { bg: '#FEF9C3', text: '#854D0E' };
};

export default function FieldVisitsTab({ projectId }: Props) {
  const { projectVisits, isLoading, fetchProjectVisits } = useFieldVisitStore();

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
        <MapPin size={40} color="#CBD5E1" />
        <Text style={styles.emptyTitle}>No field visits yet</Text>
        <Text style={styles.emptySub}>Team members' site visits will appear here once started.</Text>
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
                  <User size={16} color="#94A3B8" />
                </View>
              )}
              <View style={styles.employeeInfo}>
                <Text style={styles.employeeName}>{employeeName}</Text>
                <Text style={styles.visitDate}>
                  {new Date(v.startTime).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' · '}
                  {new Date(v.startTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
                <Text style={[styles.statusText, { color: sc.text }]}>{v.status}</Text>
              </View>
            </View>

            {/* Purpose */}
            {v.purpose ? (
              <Text style={styles.purpose}>{v.purpose}</Text>
            ) : null}

            {/* Metrics */}
            <View style={styles.metricsRow}>
              {v.distanceKm != null && (
                <View style={styles.metric}>
                  <Ruler size={14} color="#2563EB" />
                  <Text style={styles.metricText}>{v.distanceKm.toFixed(2)} km</Text>
                </View>
              )}
              {v.durationMins != null && (
                <View style={styles.metric}>
                  <Clock size={14} color="#9333EA" />
                  <Text style={styles.metricText}>{formatDuration(v.durationMins)}</Text>
                </View>
              )}
              {v.photos && v.photos.length > 0 && (
                <View style={styles.metric}>
                  <Camera size={14} color="#E25E3E" />
                  <Text style={styles.metricText}>{v.photos.length} photo{v.photos.length > 1 ? 's' : ''}</Text>
                </View>
              )}
            </View>

            {/* Route: start → end */}
            <View style={styles.routeRow}>
              <View style={styles.routePoint}>
                <View style={[styles.routeDot, { backgroundColor: '#22C55E' }]} />
                <Text style={styles.routeText}>
                  {v.startAddress || (v.startLat.toFixed(4) + ', ' + v.startLng.toFixed(4))}
                </Text>
              </View>
              {v.endLat && (
                <View style={styles.routePoint}>
                  <View style={[styles.routeDot, { backgroundColor: '#E25E3E' }]} />
                  <Text style={styles.routeText}>
                    {v.endAddress || (v.endLat.toFixed(4) + ', ' + v.endLng.toFixed(4))}
                  </Text>
                </View>
              )}
            </View>

            {/* Notes */}
            {v.notes ? (
              <View style={styles.notesBox}>
                <Text style={styles.notesLabel}>Notes</Text>
                <Text style={styles.notesText}>{v.notes}</Text>
              </View>
            ) : null}

            {/* Photos */}
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
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#334155' },
  emptySub: { fontSize: 13, color: '#94A3B8', textAlign: 'center', paddingHorizontal: 32 },

  card: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: '#F1F5F9', shadowColor: '#0F172A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2, gap: 10 },

  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarPlaceholder: { backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' },
  employeeInfo: { flex: 1 },
  employeeName: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  visitDate: { fontSize: 11, color: '#94A3B8', marginTop: 1 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 10, fontWeight: '700' },

  purpose: { fontSize: 13, color: '#475569', fontStyle: 'italic' },

  metricsRow: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metricText: { fontSize: 13, fontWeight: '600', color: '#334155' },

  routeRow: { gap: 6 },
  routePoint: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeDot: { width: 8, height: 8, borderRadius: 4 },
  routeText: { fontSize: 12, color: '#64748B', flex: 1 },

  notesBox: { backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10, borderLeftWidth: 3, borderLeftColor: '#E2E8F0' },
  notesLabel: { fontSize: 10, fontWeight: '700', color: '#94A3B8', marginBottom: 3 },
  notesText: { fontSize: 13, color: '#475569' },

  photoStrip: { marginTop: 4 },
  photoThumb: { marginRight: 8, alignItems: 'center' },
  photoImg: { width: 80, height: 80, borderRadius: 10 },
  photoTime: { fontSize: 9, color: '#94A3B8', marginTop: 3, fontWeight: '500' },
});
