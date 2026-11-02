import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator, Alert,
  TouchableOpacity, Modal, ScrollView, Linking, TextInput, Image,
} from 'react-native';
import { Search, ArrowUpDown, Paperclip, Eye, X, Megaphone } from 'lucide-react-native';
import { apiClient } from '../../api/apiClient';
import { htmlToText } from '../../utils/htmlText';
import AppScreen from '../../components/AppScreen';
import { teamService, Notice } from '../../api/teamService';
import { theme } from '../../theme/theme';

const when = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const ago = (d?: string | null) => {
  if (!d) return '';
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 30 ? `${days} days ago` : when(d);
};

const HIGH = new Set(['HIGH', 'URGENT', 'CRITICAL']);
const isHigh = (n: Notice) => HIGH.has(String(n.priority).toUpperCase());
type N = Notice & { isActive?: boolean; _count?: { recipients?: number; views?: number } };
const expired = (n: N) => !!n.expiresAt && new Date(n.expiresAt).getTime() < Date.now();
const scheduled = (n: N) => !!n.publishedAt && new Date(n.publishedAt).getTime() > Date.now();
const live = (n: N) => n.isActive !== false && !expired(n) && !scheduled(n);

// Same filters as the web Notice Board; Scheduled and Expired only for people who post.
type Filter = 'ALL' | 'ACTIVE' | 'HIGH' | 'ATTACHMENTS' | 'SCHEDULED' | 'EXPIRED';
type Sort = 'NEWEST' | 'OLDEST' | 'PRIORITY';
const PRIORITY_RANK: Record<string, number> = { URGENT: 0, CRITICAL: 0, HIGH: 1, NORMAL: 2, MEDIUM: 2, LOW: 3 };
const SORT_LABEL: Record<Sort, string> = { NEWEST: 'Newest', OLDEST: 'Oldest', PRIORITY: 'Priority' };
const PRIORITY_TONE: Record<string, { bg: string; text: string; label: string }> = {
  HIGH: { bg: '#FEE2E2', text: '#B91C1C', label: 'High priority' },
  URGENT: { bg: '#FEE2E2', text: '#B91C1C', label: 'Urgent' },
  CRITICAL: { bg: '#FEE2E2', text: '#B91C1C', label: 'Critical' },
  LOW: { bg: '#F1F5F9', text: '#475569', label: 'Low' },
};
const author = (n?: N | null) => (n?.createdBy ? `${n.createdBy.firstName} ${n.createdBy.lastName || ''}`.trim() : 'HR');
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export default function NoticesScreen() {
  const [notices, setNotices] = useState<N[]>([]);
  const [canPost, setCanPost] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<N | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [sort, setSort] = useState<Sort>('NEWEST');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/notices');
      setNotices(Array.isArray(data) ? data : data?.notices || []);
      setCanPost(!!data?.canPost);
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

  const openNotice = (n: N) => {
    setOpen(n);
    if (n.isRead === false) {
      setNotices((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      teamService.markNoticeRead(n.id).catch(() => { /* reading it matters more than the receipt */ });
    }
  };

  const counts = useMemo(() => ({
    ALL: notices.length,
    ACTIVE: notices.filter(live).length,
    HIGH: notices.filter((n) => isHigh(n) && live(n)).length,
    ATTACHMENTS: notices.filter((n) => n.attachments?.length).length,
    SCHEDULED: notices.filter((n) => n.isActive !== false && scheduled(n)).length,
    EXPIRED: notices.filter((n) => n.isActive === false || expired(n)).length,
  }), [notices]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = notices.filter((n) => {
      if (filter === 'ACTIVE' && !live(n)) return false;
      if (filter === 'HIGH' && !(isHigh(n) && live(n))) return false;
      if (filter === 'ATTACHMENTS' && !n.attachments?.length) return false;
      if (filter === 'SCHEDULED' && !(n.isActive !== false && scheduled(n))) return false;
      if (filter === 'EXPIRED' && !(n.isActive === false || expired(n))) return false;
      return !q || `${n.title} ${htmlToText(n.body)} ${author(n)}`.toLowerCase().includes(q);
    });
    const t = (n: N) => new Date(n.publishedAt || 0).getTime();
    return list.sort((a, b) =>
      sort === 'OLDEST' ? t(a) - t(b)
      : sort === 'PRIORITY' ? (PRIORITY_RANK[String(a.priority).toUpperCase()] ?? 2) - (PRIORITY_RANK[String(b.priority).toUpperCase()] ?? 2) || t(b) - t(a)
      : t(b) - t(a));
  }, [notices, filter, sort, query]);

  const unread = notices.filter((n) => n.isRead === false).length;
  const tabs: { key: Filter; label: string }[] = [
    { key: 'ALL', label: 'All' },
    { key: 'ACTIVE', label: 'Active' },
    { key: 'HIGH', label: 'High priority' },
    { key: 'ATTACHMENTS', label: 'With files' },
    ...(canPost ? [{ key: 'SCHEDULED' as Filter, label: 'Scheduled' }, { key: 'EXPIRED' as Filter, label: 'Expired' }] : []),
  ];
  const kpis: { key: Filter; label: string; n: number; color: string; bg: string }[] = [
    { key: 'ACTIVE', label: 'Active', n: counts.ACTIVE, color: '#047857', bg: '#ECFDF5' },
    { key: 'HIGH', label: 'High priority', n: counts.HIGH, color: '#B91C1C', bg: '#FEF2F2' },
    { key: 'ALL', label: 'Total', n: counts.ALL, color: '#1D4ED8', bg: '#EFF6FF' },
    canPost
      ? { key: 'EXPIRED', label: 'Past / expired', n: counts.EXPIRED, color: '#475569', bg: '#F1F5F9' }
      : { key: 'ATTACHMENTS', label: 'Documents', n: counts.ATTACHMENTS, color: '#6D28D9', bg: '#F5F3FF' },
  ];
  const cycleSort = () => setSort((s) => (s === 'NEWEST' ? 'OLDEST' : s === 'OLDEST' ? 'PRIORITY' : 'NEWEST'));

  const header = (
    <View style={styles.headerWrap}>
      <View style={styles.kpis}>
        {kpis.map((k) => (
          <TouchableOpacity key={k.label} style={[styles.kpi, { backgroundColor: k.bg }, filter === k.key && { borderColor: k.color }]} onPress={() => setFilter(k.key)} activeOpacity={0.85}>
            <Text style={[styles.kpiNum, { color: k.color }]}>{k.n}</Text>
            <Text style={[styles.kpiLabel, { color: k.color }]} numberOfLines={1}>{k.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Search size={16} color="#94A3B8" />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search title, content or author"
            placeholderTextColor="#94A3B8"
            clearButtonMode="while-editing"
            autoCorrect={false}
          />
        </View>
        <TouchableOpacity style={styles.sortBtn} onPress={cycleSort} activeOpacity={0.7}>
          <ArrowUpDown size={14} color="#334155" />
          <Text style={styles.sortText}>{SORT_LABEL[sort]}</Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {tabs.map((t) => {
          const on = filter === t.key;
          return (
            <TouchableOpacity key={t.key} style={[styles.tab, on && styles.tabOn]} onPress={() => setFilter(t.key)} activeOpacity={0.8}>
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.label}</Text>
              <View style={[styles.tabCount, on && styles.tabCountOn]}>
                <Text style={[styles.tabCountText, on && styles.tabTextOn]}>{counts[t.key]}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );

  const statusPill = (n: N) =>
    n.isActive === false ? { label: 'Retired', bg: '#F1F5F9', text: '#64748B' }
    : expired(n) ? { label: 'Expired', bg: '#F1F5F9', text: '#64748B' }
    : scheduled(n) ? { label: 'Scheduled', bg: '#FFFBEB', text: '#B45309' }
    : { label: 'Live', bg: '#ECFDF5', text: '#047857' };

  return (
    <AppScreen title="Notice Board" subtitle={`${counts.ACTIVE} active${unread ? ` · ${unread} unread` : ''}`}>
      {loading ? <ActivityIndicator style={styles.loader} color={theme.colors.primary} /> : (
        <FlatList
          data={shown}
          keyExtractor={(n) => String(n.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Megaphone size={28} color="#94A3B8" />
              <Text style={styles.emptyTitle}>{notices.length ? 'No matching announcements' : 'No notices announced yet'}</Text>
              {(query || filter !== 'ALL') && (
                <TouchableOpacity onPress={() => { setQuery(''); setFilter('ALL'); }}>
                  <Text style={styles.clear}>Clear filters</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          renderItem={({ item: n }) => {
            const pill = statusPill(n);
            const tone = PRIORITY_TONE[String(n.priority).toUpperCase()];
            const name = author(n);
            const retired = n.isActive === false || expired(n);
            return (
              <TouchableOpacity style={[styles.card, n.isRead === false && styles.unread, retired && styles.retired]} onPress={() => openNotice(n)} activeOpacity={0.85}>
                <View style={styles.cardTop}>
                  <View style={[styles.pill, { backgroundColor: pill.bg }]}>
                    <View style={[styles.pillDot, { backgroundColor: pill.text }]} />
                    <Text style={[styles.pillText, { color: pill.text }]}>{pill.label}</Text>
                  </View>
                  {tone && <View style={[styles.pill, { backgroundColor: tone.bg }]}><Text style={[styles.pillText, { color: tone.text }]}>{tone.label}</Text></View>}
                  {n.isRead === false && <View style={styles.newDot} />}
                </View>
                <Text style={styles.title} numberOfLines={2}>{n.title}</Text>
                <Text style={styles.preview} numberOfLines={3}>{htmlToText(n.body)}</Text>
                <View style={styles.cardFoot}>
                  {n.createdBy?.avatarUrl
                    ? <Image source={{ uri: n.createdBy.avatarUrl }} style={styles.avatar} />
                    : <View style={styles.avatarFallback}><Text style={styles.avatarText}>{initials(name)}</Text></View>}
                  <Text style={styles.meta} numberOfLines={1}>{name} · {ago(n.publishedAt)}</Text>
                  {!!n.attachments?.length && (
                    <View style={styles.files}><Paperclip size={12} color="#6D28D9" /><Text style={styles.filesText}>{n.attachments.length}</Text></View>
                  )}
                  {canPost && n._count?.recipients != null && (
                    <View style={styles.files}><Eye size={12} color="#475569" /><Text style={[styles.filesText, { color: '#475569' }]}>{n._count.recipients}</Text></View>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      <Modal visible={!!open} animationType="slide" onRequestClose={() => setOpen(null)}>
        <View style={styles.modal}>
          <View style={styles.modalHead}>
            <View style={{ flex: 1, gap: 8 }}>
              {open && (
                <View style={styles.cardTop}>
                  <View style={[styles.pill, { backgroundColor: statusPill(open).bg }]}>
                    <Text style={[styles.pillText, { color: statusPill(open).text }]}>{statusPill(open).label}</Text>
                  </View>
                  {PRIORITY_TONE[String(open.priority).toUpperCase()] && (
                    <View style={[styles.pill, { backgroundColor: PRIORITY_TONE[String(open.priority).toUpperCase()].bg }]}>
                      <Text style={[styles.pillText, { color: PRIORITY_TONE[String(open.priority).toUpperCase()].text }]}>{PRIORITY_TONE[String(open.priority).toUpperCase()].label}</Text>
                    </View>
                  )}
                </View>
              )}
              <Text style={styles.modalTitle}>{open?.title}</Text>
            </View>
            <TouchableOpacity onPress={() => setOpen(null)} style={styles.close}><X size={18} color="#334155" /></TouchableOpacity>
          </View>
          <Text style={styles.modalMeta}>
            {author(open)} · {when(open?.publishedAt)}{open?.expiresAt ? ` · until ${when(open.expiresAt)}` : ''}
          </Text>
          <ScrollView style={styles.flex} contentContainerStyle={styles.modalBody}>
            <Text style={styles.body}>{htmlToText(open?.body)}</Text>
            {!!open?.attachments?.length && <Text style={styles.attachHead}>Attachments</Text>}
            {open?.attachments?.map((a) => (
              <TouchableOpacity key={a.id} style={styles.attachment} onPress={() => Linking.openURL(a.fileUrl)}>
                <Paperclip size={14} color={theme.colors.primaryText} />
                <Text style={styles.attachmentText} numberOfLines={1}>{a.fileName}</Text>
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
  list: { padding: 16, paddingBottom: 120, gap: 12 },
  headerWrap: { gap: 10, marginBottom: 2 },
  kpis: { flexDirection: 'row', gap: 8 },
  kpi: { flex: 1, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  kpiNum: { fontSize: 20, fontWeight: '800' },
  kpiLabel: { fontSize: 10, fontWeight: '700' },
  searchRow: { flexDirection: 'row', gap: 8 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 0 },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 42, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  sortText: { fontSize: 12, fontWeight: '700', color: '#334155' },
  tabs: { gap: 6, paddingBottom: 2 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  tabOn: { backgroundColor: '#1373E5', borderColor: '#1373E5' },
  tabText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  tabTextOn: { color: '#fff' },
  tabCount: { backgroundColor: '#F1F5F9', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  tabCountOn: { backgroundColor: 'rgba(255,255,255,0.25)' },
  tabCountText: { fontSize: 10, fontWeight: '800', color: '#334155' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: theme.colors.border, gap: 8 },
  unread: { borderColor: '#BFDBFE', backgroundColor: '#F8FBFF' },
  retired: { opacity: 0.7 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 11, fontWeight: '700' },
  newDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.primary, marginLeft: 'auto' },
  title: { fontSize: 16, fontWeight: '800', color: theme.colors.textPrimary },
  preview: { fontSize: 13, lineHeight: 19, color: theme.colors.textSecondary },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  avatar: { width: 24, height: 24, borderRadius: 12 },
  avatarFallback: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#E0E7FF', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 10, fontWeight: '800', color: '#4338CA' },
  meta: { flex: 1, fontSize: 12, color: theme.colors.textMuted },
  files: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  filesText: { fontSize: 12, fontWeight: '700', color: '#6D28D9' },
  emptyBox: { alignItems: 'center', gap: 8, marginTop: 40 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.textSecondary },
  clear: { fontSize: 13, fontWeight: '700', color: '#1373E5' },
  modal: { flex: 1, backgroundColor: '#fff', paddingTop: 58, paddingHorizontal: 18 },
  modalHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: theme.colors.textPrimary },
  modalMeta: { fontSize: 12, color: theme.colors.textMuted, marginTop: 8 },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F5F9', borderRadius: 10 },
  modalBody: { paddingVertical: 16, paddingBottom: 60 },
  body: { fontSize: 15, lineHeight: 23, color: theme.colors.textPrimary },
  attachHead: { marginTop: 20, fontSize: 12, fontWeight: '800', color: '#64748B', letterSpacing: 0.5 },
  attachment: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, padding: 12, borderRadius: 10, backgroundColor: '#EFF6FF' },
  attachmentText: { flex: 1, color: theme.colors.primaryText, fontWeight: '600' },
});
