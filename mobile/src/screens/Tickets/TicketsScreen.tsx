import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  TextInput,
  Image,
  KeyboardAvoidingView,
  Platform,
  ImageStyle,
} from 'react-native';
// Must come from safe-area-context, not react-native: RN's own SafeAreaView is
// a no-op on Android, which lets the header slide under the status bar.
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  ArrowLeft, Plus, X, Search, Ticket as TicketIcon, Send,
  Paperclip, Building2, User as UserIcon,
  Clock, CheckCircle2, AlertCircle, Timer,
} from 'lucide-react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import DocumentPicker from 'react-native-document-picker';
import {
  ticketService, Ticket, TicketStats, TicketPermissions, TicketEmployee,
  NewTicketAttachment, TicketType, TicketPriority, TicketPlatform,
} from '../../api/ticketService';
import { employeeService, Department } from '../../api/employeeService';

const TYPES: TicketType[] = ['BUG', 'FEATURE_REQUEST', 'IMPROVEMENT', 'QUESTION'];
const PRIORITIES: TicketPriority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const PLATFORMS: TicketPlatform[] = ['WEB', 'MOBILE', 'BOTH'];
const STATUS_FILTERS = ['ALL', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  OPEN:        { bg: '#DBEAFE', text: '#1E40AF' },
  IN_PROGRESS: { bg: '#FEF3C7', text: '#92400E' },
  RESOLVED:    { bg: '#DCFCE7', text: '#166534' },
  CLOSED:      { bg: '#F1F5F9', text: '#475569' },
  REJECTED:    { bg: '#FEE2E2', text: '#991B1B' },
};

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: '#DC2626',
  HIGH:     '#EA580C',
  MEDIUM:   '#D97706',
  LOW:      '#64748B',
};

/** Image needs a real ImageStyle — StyleSheet.create returns an unnarrowable union. */
const THUMB_STYLE: ImageStyle = {
  width: 74, height: 74, borderRadius: 9, backgroundColor: '#F1F5F9',
};

// Mirrors the server allowlist in upload.controller.ts.
const ALLOWED_EXTS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.heic',
  '.pdf', '.doc', '.docx', '.odt', '.rtf',
  '.xls', '.xlsx', '.ods', '.csv',
  '.ppt', '.pptx', '.odp',
  '.txt', '.log', '.json', '.xml', '.md',
  '.zip', '.rar', '.7z',
];
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

// Pre-filter the OS picker to what the backend accepts, so a rejected upload
// is not the first feedback the user gets.
const DOC_TYPES = [
  DocumentPicker.types.images,
  DocumentPicker.types.pdf,
  DocumentPicker.types.doc,
  DocumentPicker.types.docx,
  DocumentPicker.types.xls,
  DocumentPicker.types.xlsx,
  DocumentPicker.types.ppt,
  DocumentPicker.types.pptx,
  DocumentPicker.types.csv,
  DocumentPicker.types.plainText,
  DocumentPicker.types.json,
  DocumentPicker.types.zip,
];

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic'];

const label = (v?: string) => (v || '').replace(/_/g, ' ');

// Stored enum stays WEB/MOBILE/BOTH; only the display name changes.
const PLATFORM_LABELS: Record<string, string> = { WEB: 'Website', MOBILE: 'Mobile', BOTH: 'Both' };
const platformLabel = (v?: string) => PLATFORM_LABELS[v ?? ''] ?? v ?? '—';
const extOf = (name: string) => {
  const i = (name || '').lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
};
const isImage = (name: string) => IMAGE_EXTS.includes(extOf(name));

interface FormState {
  title: string;
  description: string;
  type: TicketType;
  priority: TicketPriority;
  platform: TicketPlatform;
  raisedByDepartmentId: number | null;
  attachments: NewTicketAttachment[];
}

const emptyForm = (deptId: number | null): FormState => ({
  title: '',
  description: '',
  type: 'BUG',
  priority: 'MEDIUM',
  platform: 'MOBILE',
  raisedByDepartmentId: deptId,
  attachments: [],
});

export default function TicketsScreen() {
  const navigation = useNavigation<any>();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [permissions, setPermissions] = useState<TicketPermissions | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Create
  const [createVisible, setCreateVisible] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm(null));
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Detail
  const [detail, setDetail] = useState<Ticket | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [members, setMembers] = useState<TicketEmployee[]>([]);
  const [assignVisible, setAssignVisible] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [list, s, perms] = await Promise.all([
        ticketService.getTickets(),
        ticketService.getStats(),
        ticketService.getMyPermissions(),
      ]);
      setTickets(list);
      setStats(s);
      setPermissions(perms);
    } catch {
      Alert.alert('Error', 'Could not load tickets. Pull down to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchAll();
      employeeService.getDepartments().then(setDepartments).catch(() => {});
    }, [fetchAll])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchAll();
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter(t => {
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.ticketNumber.toLowerCase().includes(q) ||
        (t.raisedByDepartment?.name ?? '').toLowerCase().includes(q)
      );
    });
  }, [tickets, search, statusFilter]);

  // ─── Create ────────────────────────────────────────────────────────────────

  const openCreate = () => {
    setForm(emptyForm(permissions?.departmentId ?? null));
    setCreateVisible(true);
  };

  const pickAttachment = async (source: 'camera' | 'gallery') => {
    const opts = { mediaType: 'photo' as const, quality: 0.8 as const, maxWidth: 1600, maxHeight: 1600 };
    const result = source === 'camera' ? await launchCamera(opts) : await launchImageLibrary(opts);
    if (result.didCancel || !result.assets?.[0]) return;

    const asset = result.assets[0];
    if (!asset.uri) return;
    const name = asset.fileName || `screenshot-${Date.now()}.jpg`;

    if (form.attachments.length >= 8) {
      Alert.alert('Limit reached', 'You can attach at most 8 files.');
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', { uri: asset.uri, name, type: asset.type || 'image/jpeg' } as any);
      const uploaded = await ticketService.uploadAttachment(fd);
      setForm(f => ({
        ...f,
        attachments: [...f.attachments, { fileName: name, fileUrl: uploaded.url, fileSize: asset.fileSize ?? null }],
      }));
    } catch {
      Alert.alert('Upload failed', 'Could not upload the file. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  /** Uploads one already-resolved file and appends it to the form. */
  const uploadOne = async (uri: string, name: string, type: string, size?: number | null) => {
    if (!ALLOWED_EXTS.includes(extOf(name))) {
      Alert.alert('Unsupported file', `"${name}" is not an allowed file type.`);
      return;
    }
    if (size && size > MAX_ATTACHMENT_BYTES) {
      Alert.alert('Too large', `"${name}" is larger than 20MB.`);
      return;
    }

    const fd = new FormData();
    fd.append('file', { uri, name, type } as any);
    const uploaded = await ticketService.uploadAttachment(fd);
    setForm(f => ({
      ...f,
      attachments: [...f.attachments, { fileName: name, fileUrl: uploaded.url, fileSize: size ?? null }],
    }));
  };

  const pickDocuments = async () => {
    try {
      const remaining = 8 - form.attachments.length;
      if (remaining <= 0) {
        Alert.alert('Limit reached', 'You can attach at most 8 files.');
        return;
      }

      // copyTo gives a real file:// path — Android content:// URIs are unreliable
      // as FormData sources.
      const picked = await DocumentPicker.pick({
        type: DOC_TYPES,
        allowMultiSelection: true,
        copyTo: 'cachesDirectory',
      });

      const batch = picked.slice(0, remaining);
      if (picked.length > remaining) {
        Alert.alert('Limit reached', `Only the first ${remaining} file(s) were added.`);
      }

      setUploading(true);
      for (const doc of batch) {
        const uri = doc.fileCopyUri || doc.uri;
        const name = doc.name || `document-${Date.now()}`;
        try {
          await uploadOne(uri, name, doc.type || 'application/octet-stream', doc.size);
        } catch {
          Alert.alert('Upload failed', `Could not upload "${name}".`);
        }
      }
    } catch (err) {
      // Backing out of the OS picker is not an error.
      if (!DocumentPicker.isCancel(err)) {
        Alert.alert('Error', 'Could not open the file picker.');
      }
    } finally {
      setUploading(false);
    }
  };

  const showAttachmentPicker = () => {
    Alert.alert('Add Attachment', 'Choose source', [
      { text: 'Camera', onPress: () => pickAttachment('camera') },
      { text: 'Photo Gallery', onPress: () => pickAttachment('gallery') },
      { text: 'Document', onPress: () => pickDocuments() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const submitCreate = async () => {
    if (!form.title.trim()) {
      Alert.alert('Validation', 'Please enter a ticket title.');
      return;
    }
    if (uploading) {
      Alert.alert('Please wait', 'An attachment is still uploading.');
      return;
    }
    setSubmitting(true);
    try {
      await ticketService.createTicket({
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        type: form.type,
        priority: form.priority,
        platform: form.platform,
        raisedByDepartmentId: form.raisedByDepartmentId,
        attachments: form.attachments,
      });
      setCreateVisible(false);
      fetchAll();
    } catch (e: any) {
      Alert.alert('Failed', e?.response?.data?.message || 'Could not create the ticket.');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Detail ────────────────────────────────────────────────────────────────

  const openDetail = async (id: number) => {
    setDetailLoading(true);
    try {
      const t = await ticketService.getTicket(id);
      setDetail(t);
      setMembers([]);
      setCommentBody('');
    } catch {
      Alert.alert('Error', 'Could not load that ticket.');
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async (id: number) => {
    try {
      setDetail(await ticketService.getTicket(id));
      fetchAll();
    } catch { /* keep what is on screen */ }
  };

  const canManage = permissions?.canManage === true;
  const isReporter = !!permissions?.employeeId && detail?.reporterId === permissions.employeeId;
  // Once the team marks it Resolved, the reporter confirms by closing it.
  const canCloseAsReporter = !canManage && isReporter && detail?.status === 'RESOLVED';

  const nextStatuses = (status?: string): string[] => {
    const flow: Record<string, string[]> = {
      OPEN: ['IN_PROGRESS', 'REJECTED'],
      IN_PROGRESS: ['RESOLVED', 'OPEN'],
      RESOLVED: ['CLOSED', 'IN_PROGRESS'],
      CLOSED: ['OPEN'],
      REJECTED: ['OPEN'],
    };
    return flow[status ?? ''] ?? [];
  };

  const changeStatus = async (status: string) => {
    if (!detail) return;
    try {
      await ticketService.updateTicket(detail.id, { status: status as any });
      refreshDetail(detail.id);
    } catch (e: any) {
      Alert.alert('Failed', e?.response?.data?.message || 'Could not update the status.');
    }
  };

  const openAssign = async () => {
    if (!detail) return;
    setAssignVisible(true);
    if (members.length) return;
    try {
      setMembers(await ticketService.getAssignableMembers(detail.id));
    } catch {
      Alert.alert('Error', 'Could not load team members.');
    }
  };

  const assignTo = async (m: TicketEmployee) => {
    if (!detail) return;
    setAssignVisible(false);
    try {
      await ticketService.updateTicket(detail.id, { assigneeId: m.id } as any);
      refreshDetail(detail.id);
    } catch (e: any) {
      Alert.alert('Failed', e?.response?.data?.message || 'Could not reassign the ticket.');
    }
  };

  const postComment = async () => {
    if (!detail || !commentBody.trim()) return;
    setPosting(true);
    try {
      await ticketService.addComment(detail.id, commentBody.trim());
      setCommentBody('');
      refreshDetail(detail.id);
    } catch {
      Alert.alert('Failed', 'Could not post the comment.');
    } finally {
      setPosting(false);
    }
  };

  // ─── Render helpers ────────────────────────────────────────────────────────

  const Chip = ({ active, text, onPress }: { active: boolean; text: string; onPress: () => void }) => (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{text}</Text>
    </TouchableOpacity>
  );

  const OptionRow = ({ options, value, onChange, format = label }: { options: string[]; value: string; onChange: (v: any) => void; format?: (v: string) => string }) => (
    <View style={styles.optionRow}>
      {options.map(o => (
        <TouchableOpacity
          key={o}
          style={[styles.option, value === o && styles.optionActive]}
          onPress={() => onChange(o)}>
          <Text style={[styles.optionText, value === o && styles.optionTextActive]}>{format(o)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderTicket = ({ item }: { item: Ticket }) => {
    const s = STATUS_COLORS[item.status] ?? STATUS_COLORS.CLOSED;
    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => openDetail(item.id)}>
        <View style={styles.cardTop}>
          <View style={styles.ticketNumWrap}>
            <Text style={styles.ticketNum}>{item.ticketNumber}</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: s.bg }]}>
            <Text style={[styles.statusText, { color: s.text }]}>{label(item.status)}</Text>
          </View>
        </View>

        <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>

        <View style={styles.cardMeta}>
          <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[item.priority] }]} />
          <Text style={styles.metaText}>{item.priority}</Text>
          <Text style={styles.metaDivider}>·</Text>
          <Text style={styles.metaText}>{label(item.type)}</Text>
          <Text style={styles.metaDivider}>·</Text>
          <Text style={styles.metaText}>{platformLabel(item.platform)}</Text>
        </View>

        <View style={styles.cardFooter}>
          <View style={styles.row}>
            <Building2 size={12} color="#94A3B8" />
            <Text style={styles.footerText} numberOfLines={1}>
              {item.raisedByDepartment?.name ?? item.reporter?.department?.name ?? '—'}
            </Text>
          </View>
          <View style={styles.row}>
            <UserIcon size={12} color="#94A3B8" />
            <Text style={styles.footerText} numberOfLines={1}>
              {item.assignee ? `${item.assignee.firstName} ${item.assignee.lastName}` : 'Unassigned'}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const statCards = [
    { key: 'ALL', label: 'Total', value: stats?.total ?? 0, Icon: TicketIcon, color: '#6366F1' },
    { key: 'OPEN', label: 'Open', value: stats?.open ?? 0, Icon: AlertCircle, color: '#2563EB' },
    { key: 'IN_PROGRESS', label: 'Active', value: stats?.inProgress ?? 0, Icon: Timer, color: '#D97706' },
    { key: 'RESOLVED', label: 'Resolved', value: stats?.resolved ?? 0, Icon: CheckCircle2, color: '#16A34A' },
  ];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <ArrowLeft size={22} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Helpdesk & Tickets</Text>
        <TouchableOpacity style={styles.headerAction} onPress={openCreate}>
          <Plus size={20} color="#E25E3E" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#E25E3E" />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={t => String(t.id)}
          renderItem={renderTicket}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#E25E3E" />}
          ListHeaderComponent={
            <View>
              {/* Stats — tapping one filters the list */}
              <View style={styles.statsRow}>
                {statCards.map(({ key, label: l, value, Icon, color }) => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.statCard, statusFilter === key && styles.statCardActive]}
                    onPress={() => setStatusFilter(key)}>
                    <Icon size={16} color={color} />
                    <Text style={styles.statValue}>{value}</Text>
                    <Text style={styles.statLabel}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.searchWrap}>
                <Search size={16} color="#94A3B8" />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search ticket #, title, department…"
                  placeholderTextColor="#94A3B8"
                  value={search}
                  onChangeText={setSearch}
                />
                {search.length > 0 && (
                  <TouchableOpacity onPress={() => setSearch('')}>
                    <X size={16} color="#94A3B8" />
                  </TouchableOpacity>
                )}
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                {STATUS_FILTERS.map(s => (
                  <Chip key={s} active={statusFilter === s} text={label(s)} onPress={() => setStatusFilter(s)} />
                ))}
              </ScrollView>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <TicketIcon size={34} color="#CBD5E1" />
              <Text style={styles.emptyTitle}>No tickets found</Text>
              <Text style={styles.emptyHint}>
                {search || statusFilter !== 'ALL'
                  ? 'Try clearing the search or filter.'
                  : 'Tap + to raise your first ticket.'}
              </Text>
            </View>
          }
        />
      )}

      {/* ─── Create Modal ─────────────────────────────────────────────── */}
      <Modal visible={createVisible} animationType="slide" transparent onRequestClose={() => setCreateVisible(false)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Ticket</Text>
              <TouchableOpacity onPress={() => setCreateVisible(false)}>
                <X size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>Title *</Text>
              <TextInput
                style={styles.input}
                placeholder="Brief summary of the issue"
                placeholderTextColor="#94A3B8"
                value={form.title}
                onChangeText={v => setForm(f => ({ ...f, title: v }))}
                maxLength={120}
              />

              <Text style={styles.fieldLabel}>Raised By Department</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionScroll}>
                {departments.map(d => (
                  <TouchableOpacity
                    key={d.id}
                    style={[styles.option, form.raisedByDepartmentId === d.id && styles.optionActive]}
                    onPress={() => setForm(f => ({ ...f, raisedByDepartmentId: d.id }))}>
                    <Text style={[styles.optionText, form.raisedByDepartmentId === d.id && styles.optionTextActive]}>
                      {d.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.fieldLabel}>Type</Text>
              <OptionRow options={TYPES} value={form.type} onChange={v => setForm(f => ({ ...f, type: v }))} />

              <Text style={styles.fieldLabel}>Priority</Text>
              <OptionRow options={PRIORITIES} value={form.priority} onChange={v => setForm(f => ({ ...f, priority: v }))} />

              <Text style={styles.fieldLabel}>Platform</Text>
              <OptionRow options={PLATFORMS} value={form.platform} onChange={v => setForm(f => ({ ...f, platform: v }))} format={platformLabel} />

              <Text style={styles.fieldLabel}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Steps to reproduce, expected vs actual behaviour…"
                placeholderTextColor="#94A3B8"
                value={form.description}
                onChangeText={v => setForm(f => ({ ...f, description: v }))}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
              />

              <View style={styles.attachHeader}>
                <Text style={styles.fieldLabel}>Attachments</Text>
                <Text style={styles.attachCount}>{form.attachments.length}/8</Text>
              </View>

              <TouchableOpacity style={styles.attachBtn} onPress={showAttachmentPicker} disabled={uploading}>
                {uploading
                  ? <ActivityIndicator size="small" color="#E25E3E" />
                  : <Paperclip size={16} color="#E25E3E" />}
                <Text style={styles.attachBtnText}>
                  {uploading ? 'Uploading…' : 'Add screenshot or document'}
                </Text>
              </TouchableOpacity>

              {form.attachments.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
                  {form.attachments.map((a, i) => (
                    <View key={i} style={styles.thumbWrap}>
                      {isImage(a.fileName)
                        ? <Image source={{ uri: a.fileUrl }} style={THUMB_STYLE} resizeMode="cover" />
                        : <View style={styles.fileBadge}>
                            <Text style={styles.fileBadgeText}>{extOf(a.fileName).replace('.', '').toUpperCase() || 'FILE'}</Text>
                          </View>}
                      <TouchableOpacity
                        style={styles.thumbRemove}
                        onPress={() => setForm(f => ({ ...f, attachments: f.attachments.filter((_, j) => j !== i) }))}>
                        <X size={11} color="#FFF" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}

              <View style={styles.noticeBox}>
                <Text style={styles.noticeText}>
                  This ticket routes to the Software Development team for triage.
                </Text>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.btnGhost} onPress={() => setCreateVisible(false)}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnPrimary, (submitting || uploading) && styles.btnDisabled]}
                onPress={submitCreate}
                disabled={submitting || uploading}>
                <Text style={styles.btnPrimaryText}>{submitting ? 'Creating…' : 'Submit Ticket'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── Detail Modal ─────────────────────────────────────────────── */}
      <Modal visible={!!detail} animationType="slide" transparent onRequestClose={() => setDetail(null)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.modalBox, styles.detailBox]}>
            <View style={styles.modalHeader}>
              <View style={styles.row}>
                <View style={styles.ticketNumWrap}>
                  <Text style={styles.ticketNum}>{detail?.ticketNumber}</Text>
                </View>
                {detail && (
                  <View style={[styles.statusPill, { backgroundColor: (STATUS_COLORS[detail.status] ?? STATUS_COLORS.CLOSED).bg, marginLeft: 8 }]}>
                    <Text style={[styles.statusText, { color: (STATUS_COLORS[detail.status] ?? STATUS_COLORS.CLOSED).text }]}>
                      {label(detail.status)}
                    </Text>
                  </View>
                )}
              </View>
              <TouchableOpacity onPress={() => setDetail(null)}>
                <X size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            {detailLoading || !detail ? (
              <View style={styles.center}><ActivityIndicator color="#E25E3E" /></View>
            ) : (
              <>
                <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
                  <Text style={styles.detailTitle}>{detail.title}</Text>

                  <View style={styles.metaGrid}>
                    <View style={styles.metaCell}>
                      <Text style={styles.metaLabel}>Priority</Text>
                      <Text style={[styles.metaValue, { color: PRIORITY_COLORS[detail.priority] }]}>{detail.priority}</Text>
                    </View>
                    <View style={styles.metaCell}>
                      <Text style={styles.metaLabel}>Type</Text>
                      <Text style={styles.metaValue}>{label(detail.type)}</Text>
                    </View>
                    <View style={styles.metaCell}>
                      <Text style={styles.metaLabel}>Raised By Dept</Text>
                      <Text style={styles.metaValue}>
                        {detail.raisedByDepartment?.name ?? detail.reporter?.department?.name ?? '—'}
                      </Text>
                    </View>
                    <View style={styles.metaCell}>
                      <Text style={styles.metaLabel}>Reporter</Text>
                      <Text style={styles.metaValue}>
                        {detail.reporter ? `${detail.reporter.firstName} ${detail.reporter.lastName}` : '—'}
                      </Text>
                    </View>
                    <View style={styles.metaCell}>
                      <Text style={styles.metaLabel}>Assignee</Text>
                      <Text style={styles.metaValue}>
                        {detail.assignee ? `${detail.assignee.firstName} ${detail.assignee.lastName}` : 'Unassigned'}
                      </Text>
                    </View>
                    <View style={styles.metaCell}>
                      <Text style={styles.metaLabel}>Created</Text>
                      <Text style={styles.metaValue}>{detail.createdAt.split('T')[0]}</Text>
                    </View>
                  </View>

                  {canManage && (
                    <TouchableOpacity style={styles.assignBtn} onPress={openAssign}>
                      <UserIcon size={14} color="#2563EB" />
                      <Text style={styles.assignBtnText}>
                        {detail.assignee ? 'Reassign' : 'Assign to team member'}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {!!detail.description && (
                    <>
                      <Text style={styles.sectionLabel}>Description</Text>
                      {/* Web writes rich text; strip tags so mobile shows readable copy. */}
                      <Text style={styles.descText}>
                        {detail.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()}
                      </Text>
                    </>
                  )}

                  {!!detail.attachments?.length && (
                    <>
                      <Text style={styles.sectionLabel}>Attachments ({detail.attachments.length})</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
                        {detail.attachments.map(a => (
                          <View key={a.id} style={styles.thumbWrap}>
                            {isImage(a.fileName)
                              ? <Image source={{ uri: a.fileUrl }} style={THUMB_STYLE} resizeMode="cover" />
                              : <View style={styles.fileBadge}>
                                  <Text style={styles.fileBadgeText}>{extOf(a.fileName).replace('.', '').toUpperCase() || 'FILE'}</Text>
                                </View>}
                          </View>
                        ))}
                      </ScrollView>
                    </>
                  )}

                  {/* Status actions — dev team / management only */}
                  {canManage && nextStatuses(detail.status).length > 0 && (
                    <>
                      <Text style={styles.sectionLabel}>Move To</Text>
                      <View style={styles.optionRow}>
                        {nextStatuses(detail.status).map(s => (
                          <TouchableOpacity key={s} style={styles.statusActionBtn} onPress={() => changeStatus(s)}>
                            <Text style={styles.statusActionText}>{label(s)}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </>
                  )}

                  {/* Reporter confirmation once the team resolves it */}
                  {canCloseAsReporter && (
                    <TouchableOpacity style={styles.closeConfirmBtn} onPress={() => changeStatus('CLOSED')}>
                      <CheckCircle2 size={15} color="#166534" />
                      <Text style={styles.closeConfirmText}>Fixed for me — close this ticket</Text>
                    </TouchableOpacity>
                  )}

                  <Text style={styles.sectionLabel}>Comments ({detail.comments?.length ?? 0})</Text>
                  {(detail.comments ?? []).map(c => (
                    <View key={c.id} style={styles.comment}>
                      <View style={styles.commentAvatar}>
                        <Text style={styles.commentInitials}>
                          {(c.author?.firstName?.[0] ?? '') + (c.author?.lastName?.[0] ?? '')}
                        </Text>
                      </View>
                      <View style={styles.commentBody}>
                        <View style={styles.commentHead}>
                          <Text style={styles.commentAuthor}>
                            {c.author?.firstName} {c.author?.lastName}
                          </Text>
                          <Text style={styles.commentTime}>{c.createdAt.split('T')[0]}</Text>
                        </View>
                        <Text style={styles.commentText}>{c.body}</Text>
                      </View>
                    </View>
                  ))}
                  {!detail.comments?.length && (
                    <Text style={styles.noComments}>No comments yet.</Text>
                  )}

                  {/* Activity log */}
                  {!!detail.activities?.length && (
                    <>
                      <Text style={styles.sectionLabel}>Activity</Text>
                      {detail.activities.map(a => (
                        <View key={a.id} style={styles.activityRow}>
                          <Clock size={11} color="#94A3B8" />
                          <Text style={styles.activityText}>
                            <Text style={styles.activityActor}>{a.actor?.firstName} {a.actor?.lastName}</Text>
                            {' '}{label(a.action).toLowerCase()}
                            {a.oldValue && a.newValue ? ` (${label(a.oldValue)} → ${label(a.newValue)})` : ''}
                          </Text>
                        </View>
                      ))}
                    </>
                  )}
                </ScrollView>

                <View style={styles.commentBar}>
                  <TextInput
                    style={styles.commentInput}
                    placeholder="Write a comment…"
                    placeholderTextColor="#94A3B8"
                    value={commentBody}
                    onChangeText={setCommentBody}
                    multiline
                  />
                  <TouchableOpacity
                    style={[styles.sendBtn, (!commentBody.trim() || posting) && styles.btnDisabled]}
                    onPress={postComment}
                    disabled={!commentBody.trim() || posting}>
                    <Send size={16} color="#FFF" />
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── Assign Picker ────────────────────────────────────────────── */}
      <Modal visible={assignVisible} animationType="fade" transparent onRequestClose={() => setAssignVisible(false)}>
        <TouchableOpacity style={styles.pickerWrap} activeOpacity={1} onPress={() => setAssignVisible(false)}>
          <View style={styles.pickerBox}>
            <Text style={styles.pickerTitle}>Assign To</Text>
            <ScrollView>
              {members.map(m => (
                <TouchableOpacity key={m.id} style={styles.pickerRow} onPress={() => assignTo(m)}>
                  <View style={styles.commentAvatar}>
                    <Text style={styles.commentInitials}>{m.firstName[0]}{m.lastName[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickerName}>{m.firstName} {m.lastName}</Text>
                    <Text style={styles.pickerRole}>{m.designation?.name ?? 'Team member'}</Text>
                  </View>
                </TouchableOpacity>
              ))}
              {members.length === 0 && <Text style={styles.noComments}>No team members found.</Text>}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerAction: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#0F172A' },

  listContent: { padding: 12, paddingBottom: 40 },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statCard: {
    flex: 1, backgroundColor: '#FFF', borderRadius: 12, padding: 10,
    borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'flex-start', gap: 2,
  },
  statCardActive: { borderColor: '#E25E3E', backgroundColor: '#FFF7F5' },
  statValue: { fontSize: 19, fontWeight: '800', color: '#0F172A' },
  statLabel: { fontSize: 10.5, color: '#64748B', fontWeight: '600' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFF', borderRadius: 10, paddingHorizontal: 12,
    height: 42, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 13.5, color: '#0F172A', padding: 0 },

  chipRow: { marginBottom: 12 },
  chip: {
    paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999,
    backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E2E8F0', marginRight: 7,
  },
  chipActive: { backgroundColor: '#0F172A', borderColor: '#0F172A' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#64748B' },
  chipTextActive: { color: '#FFF' },

  card: {
    backgroundColor: '#FFF', borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  ticketNumWrap: { backgroundColor: '#EEF2FF', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  ticketNum: { fontSize: 11, fontWeight: '800', color: '#4338CA', letterSpacing: 0.3 },
  statusPill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 10.5, fontWeight: '700' },

  cardTitle: { fontSize: 14.5, fontWeight: '700', color: '#0F172A', lineHeight: 20, marginBottom: 8 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' },
  priorityDot: { width: 7, height: 7, borderRadius: 4 },
  metaText: { fontSize: 11.5, color: '#64748B', fontWeight: '600' },
  metaDivider: { fontSize: 11.5, color: '#CBD5E1' },

  cardFooter: {
    flexDirection: 'row', justifyContent: 'space-between', gap: 10,
    borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 9,
  },
  footerText: { fontSize: 11, color: '#94A3B8', flexShrink: 1 },

  empty: { alignItems: 'center', padding: 44, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#334155' },
  emptyHint: { fontSize: 12.5, color: '#94A3B8', textAlign: 'center' },

  // Modals
  modalWrap: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '92%' },
  detailBox: { minHeight: '70%' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  modalBody: { paddingHorizontal: 16, paddingTop: 12 },
  modalFooter: {
    flexDirection: 'row', gap: 10, padding: 16,
    borderTopWidth: 1, borderTopColor: '#F1F5F9',
  },

  fieldLabel: { fontSize: 12.5, fontWeight: '700', color: '#334155', marginBottom: 7, marginTop: 12 },
  input: {
    borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 13.5, color: '#0F172A',
    backgroundColor: '#FFF',
  },
  textArea: { minHeight: 100 },

  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  optionScroll: { flexDirection: 'row' },
  option: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
    borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC', marginRight: 7,
  },
  optionActive: { backgroundColor: '#0F172A', borderColor: '#0F172A' },
  optionText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  optionTextActive: { color: '#FFF' },

  attachHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  attachCount: { fontSize: 11.5, color: '#94A3B8', marginTop: 12 },
  attachBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderColor: '#FBD5CA', borderStyle: 'dashed',
    borderRadius: 10, paddingVertical: 13, backgroundColor: '#FFF7F5',
  },
  attachBtnText: { fontSize: 13, fontWeight: '600', color: '#E25E3E' },

  thumbRow: { marginTop: 10, flexDirection: 'row' },
  thumbWrap: { marginRight: 9, position: 'relative' },
  fileBadge: {
    width: 74, height: 74, borderRadius: 9, backgroundColor: '#F1F5F9',
    alignItems: 'center', justifyContent: 'center',
  },
  fileBadgeText: { fontSize: 11, fontWeight: '800', color: '#475569' },
  thumbRemove: {
    position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(15,23,42,0.75)', alignItems: 'center', justifyContent: 'center',
  },

  noticeBox: { backgroundColor: '#EFF6FF', borderRadius: 9, padding: 11, marginTop: 14, marginBottom: 6 },
  noticeText: { fontSize: 12, color: '#1E40AF', lineHeight: 17 },

  btnGhost: {
    flex: 1, paddingVertical: 13, borderRadius: 10, alignItems: 'center',
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  btnGhostText: { fontSize: 14, fontWeight: '600', color: '#475569' },
  btnPrimary: { flex: 2, paddingVertical: 13, borderRadius: 10, alignItems: 'center', backgroundColor: '#E25E3E' },
  btnPrimaryText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  btnDisabled: { opacity: 0.5 },

  // Detail
  detailTitle: { fontSize: 17, fontWeight: '700', color: '#0F172A', lineHeight: 24, marginBottom: 14 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  metaCell: { width: '50%', marginBottom: 13 },
  metaLabel: { fontSize: 10.5, fontWeight: '700', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 },
  metaValue: { fontSize: 13, fontWeight: '600', color: '#1E293B' },

  assignBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderWidth: 1, borderColor: '#BFDBFE', backgroundColor: '#EFF6FF',
    borderRadius: 9, paddingVertical: 10, marginBottom: 6,
  },
  assignBtnText: { fontSize: 13, fontWeight: '600', color: '#2563EB' },

  sectionLabel: {
    fontSize: 11, fontWeight: '800', color: '#64748B',
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 18, marginBottom: 9,
  },
  descText: { fontSize: 13.5, color: '#334155', lineHeight: 20 },

  statusActionBtn: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 9,
    backgroundColor: '#0F172A',
  },
  statusActionText: { fontSize: 12.5, fontWeight: '700', color: '#FFF' },

  closeConfirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0',
    borderRadius: 10, paddingVertical: 12, marginTop: 16,
  },
  closeConfirmText: { fontSize: 13, fontWeight: '700', color: '#166534' },

  comment: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  commentAvatar: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#E0E7FF',
    alignItems: 'center', justifyContent: 'center',
  },
  commentInitials: { fontSize: 11.5, fontWeight: '800', color: '#4338CA' },
  commentBody: { flex: 1 },
  commentHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  commentAuthor: { fontSize: 12.5, fontWeight: '700', color: '#1E293B' },
  commentTime: { fontSize: 10.5, color: '#94A3B8' },
  commentText: { fontSize: 13, color: '#334155', lineHeight: 19 },
  noComments: { fontSize: 12.5, color: '#94A3B8', fontStyle: 'italic', paddingVertical: 8 },

  activityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginBottom: 8 },
  activityText: { flex: 1, fontSize: 11.5, color: '#64748B', lineHeight: 17 },
  activityActor: { fontWeight: '700', color: '#475569' },

  commentBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 9, padding: 12,
    borderTopWidth: 1, borderTopColor: '#F1F5F9', backgroundColor: '#FFF',
  },
  commentInput: {
    flex: 1, maxHeight: 90, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9, fontSize: 13.5, color: '#0F172A',
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 10, backgroundColor: '#E25E3E',
    alignItems: 'center', justifyContent: 'center',
  },

  pickerWrap: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center', padding: 26 },
  pickerBox: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, maxHeight: '65%' },
  pickerTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A', marginBottom: 12 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10 },
  pickerName: { fontSize: 13.5, fontWeight: '600', color: '#1E293B' },
  pickerRole: { fontSize: 11.5, color: '#94A3B8' },
});
