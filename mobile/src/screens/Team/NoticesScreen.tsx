import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator, Alert,
  TouchableOpacity, Modal, ScrollView, Linking,
} from 'react-native';
import AppScreen from '../../components/AppScreen';
import { teamService, Notice } from '../../api/teamService';
import { theme } from '../../theme/theme';

/** Notices are written in the web's rich-text editor; show them as plain text. */
function plain(html: string): string {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const when = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

const HIGH = new Set(['HIGH', 'URGENT', 'CRITICAL']);

export default function NoticesScreen() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    try {
      setNotices(await teamService.getNotices());
    } catch (e: any) {
      Alert.alert('Could not load notices', e?.response?.data?.message || 'Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload whenever this screen comes back into view, so changes made on the
  // web or from a notification show up without pulling down.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openNotice = (n: Notice) => {
    setOpen(n);
    if (n.isRead === false) {
      setNotices((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      teamService.markNoticeRead(n.id).catch(() => { /* reading it matters more than the receipt */ });
    }
  };

  const unread = notices.filter((n) => n.isRead === false).length;

  return (
    <AppScreen title="Notice Board" subtitle={unread ? `${unread} unread` : 'Company announcements'}>
      {loading ? <ActivityIndicator style={styles.loader} color={theme.colors.primary} /> : (
        <FlatList
          data={notices}
          keyExtractor={(n) => String(n.id)}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>No notices right now.</Text>}
          renderItem={({ item: n }) => (
            <TouchableOpacity style={[styles.card, n.isRead === false && styles.unread]} onPress={() => openNotice(n)}>
              <View style={styles.head}>
                {n.isRead === false && <View style={styles.dot} />}
                <Text style={styles.title} numberOfLines={2}>{n.title}</Text>
                {HIGH.has(String(n.priority).toUpperCase()) && <Text style={styles.important}>Important</Text>}
              </View>
              <Text style={styles.preview} numberOfLines={2}>{plain(n.body)}</Text>
              <Text style={styles.meta}>
                {when(n.publishedAt)}{n.createdBy ? ` · ${n.createdBy.firstName} ${n.createdBy.lastName || ''}` : ''}
                {n.attachments?.length ? ` · 📎 ${n.attachments.length}` : ''}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}

      <Modal visible={!!open} animationType="slide" onRequestClose={() => setOpen(null)}>
        <View style={styles.modal}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>{open?.title}</Text>
            <TouchableOpacity onPress={() => setOpen(null)} style={styles.close}><Text style={styles.closeText}>Close</Text></TouchableOpacity>
          </View>
          <Text style={styles.meta}>
            {when(open?.publishedAt)}{open?.createdBy ? ` · ${open.createdBy.firstName} ${open.createdBy.lastName || ''}` : ''}
          </Text>
          <ScrollView style={styles.flex} contentContainerStyle={styles.modalBody}>
            <Text style={styles.body}>{plain(open?.body || '')}</Text>
            {open?.attachments?.map((a) => (
              <TouchableOpacity key={a.id} style={styles.attachment} onPress={() => Linking.openURL(a.fileUrl)}>
                <Text style={styles.attachmentText}>📎 {a.fileName}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loader: { marginTop: 40 },
  list: { padding: 16, paddingBottom: 120, gap: 10 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.border },
  unread: { borderColor: '#BFDBFE', backgroundColor: '#F8FBFF' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.primary },
  title: { flex: 1, fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary },
  important: { fontSize: 11, fontWeight: '700', color: '#B91C1C', backgroundColor: '#FEE2E2', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  preview: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 6 },
  meta: { fontSize: 12, color: theme.colors.textMuted, marginTop: 8 },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 40 },
  modal: { flex: 1, backgroundColor: '#fff', paddingTop: 54, paddingHorizontal: 18 },
  modalHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  modalTitle: { flex: 1, fontSize: 20, fontWeight: '800', color: theme.colors.textPrimary },
  close: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#F1F5F9', borderRadius: 8 },
  closeText: { fontWeight: '600', color: '#334155' },
  modalBody: { paddingVertical: 16, paddingBottom: 60 },
  body: { fontSize: 15, lineHeight: 22, color: theme.colors.textPrimary },
  attachment: { marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: '#EFF6FF' },
  attachmentText: { color: theme.colors.primaryText, fontWeight: '600' },
});
