import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Linking,
  Alert,
  ScrollView,
  RefreshControl,
} from 'react-native';
import {
  Paperclip,
  FileText,
  Image as ImageIcon,
  Film,
  FileArchive,
  ExternalLink,
  Trash2,
} from 'lucide-react-native';
import { useProjectStore } from '../../../store/projectStore';
import { projectService } from '../../../api/projectService';
import { useAuthStore } from '../../../store/authStore';

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
const VIDEO_EXTS = ['.mp4', '.mov', '.avi', '.webm'];
const ZIP_EXTS = ['.zip', '.tar', '.gz', '.rar'];

function getFileIcon(url: string) {
  const ext = url?.split('?')[0].toLowerCase().slice(-5) || '';
  if (IMAGE_EXTS.some(e => ext.includes(e))) return { Icon: ImageIcon, color: '#10B981' };
  if (VIDEO_EXTS.some(e => ext.includes(e))) return { Icon: Film, color: '#8B5CF6' };
  if (ZIP_EXTS.some(e => ext.includes(e))) return { Icon: FileArchive, color: '#F97316' };
  return { Icon: FileText, color: '#3B82F6' };
}

function isImage(url: string) {
  const ext = url?.split('?')[0].toLowerCase();
  return IMAGE_EXTS.some(e => ext?.endsWith(e));
}

function formatBytes(bytes: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

export default function AttachmentsTab() {
  const { currentIssues, currentProject, fetchProjectDetails } = useProjectStore();
  const { user } = useAuthStore();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!currentProject?.id) return;
    setIsRefreshing(true);
    try {
      await fetchProjectDetails(currentProject.id);
    } finally {
      setIsRefreshing(false);
    }
  };

  const allAttachments = useMemo(() => {
    const result: any[] = [];
    currentIssues.forEach(issue => {
      (issue.attachments || []).forEach((att: any) => {
        result.push({ ...att, issueKey: issue.key, issueTitle: issue.title, issueId: issue.id });
      });
    });
    return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [currentIssues]);

  const handleOpen = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Error', 'Could not open file.');
    }
  };

  const handleDelete = (att: any) => {
    Alert.alert(
      'Delete Attachment',
      `Remove "${att.fileName || 'this file'}" from ${att.issueKey}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingId(att.id);
            try {
              await projectService.deleteAttachment(currentProject?.id, att.issueId, att.id);
              if (currentProject?.id) fetchProjectDetails(currentProject.id);
            } catch {
              Alert.alert('Error', 'Failed to delete attachment.');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item: att }: { item: any }) => {
    const { Icon, color } = getFileIcon(att.fileUrl || '');
    const img = isImage(att.fileUrl || '');
    const isDeleting = deletingId === att.id;

    return (
      <View style={[styles.card, isDeleting && { opacity: 0.5 }]}>
        <TouchableOpacity
          style={styles.cardInner}
          onPress={() => handleOpen(att.fileUrl)}
          activeOpacity={0.8}
        >
          {img ? (
            <Image source={{ uri: att.fileUrl }} style={styles.thumbnail} resizeMode="cover" />
          ) : (
            <View style={[styles.iconBox, { backgroundColor: color + '18' }]}>
              <Icon size={26} color={color} />
            </View>
          )}
          <View style={styles.fileInfo}>
            <Text style={styles.fileName} numberOfLines={2}>
              {att.fileName || att.fileUrl?.split('/').pop()?.split('?')[0] || 'File'}
            </Text>
            <View style={styles.fileMeta}>
              <Text style={styles.issueRef} numberOfLines={1}>{att.issueKey}</Text>
              {att.fileSize ? <Text style={styles.fileSize}>{formatBytes(att.fileSize)}</Text> : null}
            </View>
            <Text style={styles.fileDate}>{formatDate(att.createdAt)}</Text>
            {att.uploader && (
              <Text style={styles.uploader} numberOfLines={1}>
                by {att.uploader.firstName} {att.uploader.lastName}
              </Text>
            )}
          </View>
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => handleOpen(att.fileUrl)}
            >
              <ExternalLink size={16} color="#3B82F6" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => handleDelete(att)}
            >
              <Trash2 size={16} color="#EF4444" />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  if (allAttachments.length === 0) {
    return (
      <ScrollView
        contentContainerStyle={styles.emptyContainer}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} colors={['#E25E3E']} tintColor="#E25E3E" />}
      >
        <Paperclip size={44} color="#CBD5E1" />
        <Text style={styles.emptyTitle}>No attachments yet</Text>
        <Text style={styles.emptySubtitle}>Upload files inside any issue card to see them here</Text>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Paperclip size={16} color="#64748B" />
        <Text style={styles.headerText}>{allAttachments.length} file{allAttachments.length !== 1 ? 's' : ''} across all issues</Text>
      </View>
      <FlatList
        data={allAttachments}
        keyExtractor={item => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} colors={['#E25E3E']} tintColor="#E25E3E" />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  headerText: { fontSize: 13, color: '#64748B', fontWeight: '500' },
  list: { paddingHorizontal: 16, paddingBottom: 32 },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
    overflow: 'hidden',
  },
  cardInner: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12 },
  thumbnail: { width: 56, height: 56, borderRadius: 8 },
  iconBox: { width: 56, height: 56, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  fileInfo: { flex: 1 },
  fileName: { fontSize: 14, fontWeight: '600', color: '#0F172A', marginBottom: 4, lineHeight: 19 },
  fileMeta: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 2 },
  issueRef: {
    fontSize: 11,
    fontWeight: '700',
    color: '#E25E3E',
    backgroundColor: '#FFF1EC',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  fileSize: { fontSize: 11, color: '#94A3B8' },
  fileDate: { fontSize: 11, color: '#94A3B8', marginBottom: 1 },
  uploader: { fontSize: 11, color: '#64748B' },
  actions: { gap: 8 },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
  },

  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 40,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#334155' },
  emptySubtitle: { fontSize: 13, color: '#94A3B8', textAlign: 'center', lineHeight: 20 },
});
