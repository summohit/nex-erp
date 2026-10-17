import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Image, Linking, RefreshControl,
} from 'react-native';
import { FileCheck, Search, X, FileText, FileSpreadsheet, File, Image as ImageIcon, ChevronRight } from 'lucide-react-native';
import { useProjectStore } from '../../../store/projectStore';
import IssueDetailModal from '../modals/IssueDetailModal';
import { colors, status } from '../../../theme/ds';

/**
 * Evidence: every file attached to a task in this project, as on the web
 * (17 Oct 2026). Each card says which task it proves; tapping the task code
 * opens that task, tapping the file opens the file. Built from the task list
 * the board already loaded, so it needs no extra request.
 */
type Evidence = {
  id: number; fileName: string; fileUrl: string; createdAt: string;
  uploader?: { firstName?: string; lastName?: string | null } | null;
  issue: any;
};

const ext = (n: string) => (n.split('.').pop() || '').toLowerCase();
const isImage = (n: string) => ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext(n));

function FileBadge({ name }: { name: string }) {
  const e = ext(name);
  const [Icon, color, bg] = e === 'pdf'
    ? [FileText, '#DC2626', '#FEF2F2']
    : ['xls', 'xlsx', 'csv'].includes(e) ? [FileSpreadsheet, '#16A34A', '#F0FDF4']
      : ['doc', 'docx'].includes(e) ? [FileText, '#2563EB', '#EFF6FF']
        : isImage(name) ? [ImageIcon, '#7C3AED', '#F5F3FF'] : [File, '#64748B', '#F1F5F9'];
  return (
    <View style={[styles.fileIcon, { backgroundColor: bg as string }]}>
      <Icon size={20} color={color as string} />
      <Text style={[styles.fileExt, { color: color as string }]}>{e.toUpperCase().slice(0, 4) || 'FILE'}</Text>
    </View>
  );
}

export default function EvidenceTab() {
  const { currentIssues, currentProject, fetchProjectDetails, isLoading } = useProjectStore();
  const [query, setQuery] = useState('');
  const [openIssue, setOpenIssue] = useState<any>(null);

  const items = useMemo<Evidence[]>(() => {
    const out: Evidence[] = [];
    for (const issue of currentIssues) {
      if (issue.isArchived) continue;
      for (const a of issue.attachments ?? []) out.push({ ...a, issue });
    }
    return out.sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime());
  }, [currentIssues]);

  const q = query.trim().toLowerCase();
  const shown = q
    ? items.filter((e) => `${e.fileName} ${e.issue.key ?? ''} ${e.issue.title ?? ''} ${e.uploader?.firstName ?? ''} ${e.uploader?.lastName ?? ''}`.toLowerCase().includes(q))
    : items;

  const renderItem = ({ item: e }: { item: Evidence }) => {
    const proof = e.issue.status === 'IN_REVIEW' || e.issue.status === 'DONE';
    const who = `${e.uploader?.firstName ?? ''} ${e.uploader?.lastName ?? ''}`.trim();
    return (
      <View style={styles.card}>
        <TouchableOpacity style={styles.fileRow} onPress={() => Linking.openURL(e.fileUrl).catch(() => undefined)} activeOpacity={0.8}>
          {isImage(e.fileName)
            ? <Image source={{ uri: e.fileUrl }} style={styles.thumb} />
            : <FileBadge name={e.fileName} />}
          <View style={styles.flex}>
            <Text style={styles.fileName} numberOfLines={2}>{e.fileName}</Text>
            <Text style={styles.meta} numberOfLines={1}>
              {who ? `${who} · ` : ''}{new Date(e.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </Text>
          </View>
        </TouchableOpacity>

        {/* The task this file proves: tap to open it, as on the web. */}
        <TouchableOpacity style={styles.taskRow} onPress={() => setOpenIssue(e.issue)} activeOpacity={0.75}>
          <View style={[styles.keyChip, proof && styles.keyChipProof]}>
            <Text style={[styles.keyText, proof && { color: status.success.strong }]}>{e.issue.key || `#${e.issue.id}`}</Text>
          </View>
          <Text style={styles.taskTitle} numberOfLines={1}>{e.issue.title}</Text>
          <ChevronRight size={15} color={colors.textFaint} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <View style={styles.headIcon}><FileCheck size={16} color={status.success.strong} /></View>
        <Text style={styles.headTitle}>Evidence</Text>
        <Text style={styles.headCount}>{items.length} {items.length === 1 ? 'file' : 'files'}</Text>
      </View>
      <View style={styles.search}>
        <Search size={15} color={colors.textFaint} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search file, task code, title or person"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={setQuery}
        />
        {!!query && <TouchableOpacity onPress={() => setQuery('')}><X size={15} color={colors.textFaint} /></TouchableOpacity>}
      </View>

      <FlatList
        data={shown}
        keyExtractor={(e) => `${e.issue.id}-${e.id}`}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => currentProject?.id && fetchProjectDetails(currentProject.id)} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><FileCheck size={22} color={colors.primary} /></View>
            <Text style={styles.emptyTitle}>{items.length ? 'No files match' : 'There is no evidence yet'}</Text>
            <Text style={styles.emptyText}>
              {items.length ? 'Try another search.' : 'Files attached to tasks, such as proof when moving to Review or Done, appear here.'}
            </Text>
          </View>
        }
      />

      {openIssue && (
        <IssueDetailModal
          visible={!!openIssue}
          issue={openIssue}
          onClose={() => setOpenIssue(null)}
          projectId={currentProject?.id}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  headIcon: { width: 28, height: 28, borderRadius: 9, backgroundColor: status.success.bg, alignItems: 'center', justifyContent: 'center' },
  headTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.text },
  headCount: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 10, paddingHorizontal: 12,
    height: 42, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF',
  },
  searchInput: { flex: 1, fontSize: 13.5, color: colors.text },
  list: { padding: 16, gap: 10, paddingBottom: 120 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  thumb: { width: 54, height: 54, borderRadius: 12, backgroundColor: colors.bg },
  fileIcon: { width: 54, height: 54, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 2 },
  fileExt: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  fileName: { fontSize: 13.5, fontWeight: '800', color: colors.text },
  meta: { fontSize: 11.5, fontWeight: '600', color: colors.textMuted, marginTop: 3 },
  taskRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.bg,
  },
  keyChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: '#EEF2FF', borderWidth: 1, borderColor: '#E0E7FF' },
  keyChipProof: { backgroundColor: status.success.bg, borderColor: status.success.border },
  keyText: { fontSize: 11.5, fontWeight: '800', color: '#4338CA' },
  taskTitle: { flex: 1, fontSize: 12.5, fontWeight: '600', color: colors.textBody },
  empty: { alignItems: 'center', padding: 28, marginTop: 8, backgroundColor: '#FFFFFF', borderRadius: 20, borderWidth: 1, borderColor: colors.border },
  emptyIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: colors.text, marginBottom: 4 },
  emptyText: { fontSize: 12.5, color: colors.textMuted, textAlign: 'center', lineHeight: 18 },
});
