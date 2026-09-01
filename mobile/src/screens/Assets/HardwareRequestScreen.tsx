import React, { useState, useCallback, useRef } from 'react';
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
} from 'react-native';
// Must come from safe-area-context, not react-native: RN's own SafeAreaView is
// a no-op on Android, which lets the header slide under the status bar.
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Plus, Package, Calendar, ZoomIn, X, Camera, Image as ImageIcon } from 'lucide-react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { hardwareRequestService, HardwareRequest } from '../../api/hardwareRequestService';
import { employeeService } from '../../api/employeeService';

const REQUEST_TYPES = ['New Purchase', 'Replacement', 'Repair', 'Software License', 'Other'];
const CATEGORIES = ['Laptop', 'Desktop', 'Monitor', 'Keyboard/Mouse', 'Phone', 'Headset', 'Printer', 'Network Equipment', 'Other'];
const URGENCY_LEVELS = ['Low', 'Medium', 'High', 'Critical'];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  PENDING:   { bg: '#FEF9C3', text: '#854D0E' },
  APPROVED:  { bg: '#DCFCE7', text: '#166534' },
  FULFILLED: { bg: '#DBEAFE', text: '#1E40AF' },
  REJECTED:  { bg: '#FEE2E2', text: '#991B1B' },
  CANCELLED: { bg: '#F1F5F9', text: '#64748B' },
};

interface FormState {
  requestType: string;
  category: string;
  urgency: string;
  reason: string;
  images: string[];
}

const emptyForm = (): FormState => ({
  requestType: REQUEST_TYPES[0],
  category: CATEGORIES[0],
  urgency: 'Medium',
  reason: '',
  images: [],
});

export default function HardwareRequestScreen() {
  const navigation = useNavigation();
  const [requests, setRequests] = useState<HardwareRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const fetchRequests = async () => {
    try {
      const data = await hardwareRequestService.getAll();
      setRequests(data);
    } catch (err) {
      console.error('Failed to fetch hardware requests', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchRequests();
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchRequests();
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setModalVisible(true);
  };

  const openEdit = (req: HardwareRequest) => {
    setEditingId(req.id);
    setForm({
      requestType: req.requestType,
      category: req.category,
      urgency: req.urgency,
      reason: req.reason,
      images: req.images || [],
    });
    setModalVisible(true);
  };

  const handleCancel = (id: number) => {
    Alert.alert('Cancel Request', 'Are you sure you want to cancel this request?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: async () => {
          try {
            await hardwareRequestService.cancel(id);
            fetchRequests();
          } catch {
            Alert.alert('Error', 'Failed to cancel request');
          }
        },
      },
    ]);
  };

  const pickImage = async (source: 'camera' | 'gallery') => {
    const opts = { mediaType: 'photo' as const, quality: 0.8 as const, maxWidth: 1200, maxHeight: 1200 };
    const result = source === 'camera'
      ? await launchCamera(opts)
      : await launchImageLibrary(opts);

    if (result.didCancel || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (!asset.uri || !asset.fileName) return;

    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append('file', { uri: asset.uri, name: asset.fileName, type: asset.type || 'image/jpeg' } as any);
      const uploaded = await employeeService.uploadImage(fd);
      setForm(f => ({ ...f, images: [...f.images, uploaded.url] }));
    } catch {
      Alert.alert('Upload failed', 'Could not upload image. Please try again.');
    } finally {
      setUploadingImage(false);
    }
  };

  const showImagePicker = () => {
    Alert.alert('Add Image', 'Choose source', [
      { text: 'Camera', onPress: () => pickImage('camera') },
      { text: 'Gallery', onPress: () => pickImage('gallery') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const removeImage = (idx: number) => {
    setForm(f => ({ ...f, images: f.images.filter((_, i) => i !== idx) }));
  };

  const handleSubmit = async () => {
    if (!form.reason.trim()) {
      Alert.alert('Validation', 'Please describe the reason for this request.');
      return;
    }
    setSubmitting(true);
    try {
      if (editingId) {
        await hardwareRequestService.update(editingId, form);
      } else {
        await hardwareRequestService.create(form);
      }
      setModalVisible(false);
      fetchRequests();
    } catch {
      Alert.alert('Error', 'Failed to submit request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderItem = ({ item }: { item: HardwareRequest }) => {
    const s = STATUS_COLORS[item.status] || STATUS_COLORS.PENDING;
    const isPending = item.status === 'PENDING';
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1, marginRight: 10 }}>
            <Text style={styles.cardTitle}>{item.requestType}</Text>
            <Text style={styles.cardSubtitle}>{item.category}</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: s.bg }]}>
            <Text style={[styles.statusText, { color: s.text }]}>{item.status}</Text>
          </View>
        </View>

        <View style={styles.cardMeta}>
          <View style={styles.urgencyBadge}>
            <Text style={styles.urgencyText}>{item.urgency}</Text>
          </View>
          <View style={styles.row}>
            <Calendar size={13} color="#94A3B8" />
            <Text style={styles.dateText}>{item.createdAt.split('T')[0]}</Text>
          </View>
        </View>

        <Text style={styles.reason} numberOfLines={2}>{item.reason}</Text>

        {item.status === 'REJECTED' && item.rejectionReason ? (
          <Text style={styles.rejection}>Rejected: {item.rejectionReason}</Text>
        ) : null}

        {item.images && item.images.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageRow}>
            {item.images.map((url, i) => (
              <TouchableOpacity key={i} onPress={() => setLightboxUrl(url)} activeOpacity={0.8} style={styles.thumbWrap}>
                <Image source={{ uri: url }} style={styles.thumb} resizeMode="cover" />
                <View style={styles.thumbOverlay}><ZoomIn size={14} color="#FFF" /></View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {isPending && (
          <View style={styles.actions}>
            <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(item)}>
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => handleCancel(item.id)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <ArrowLeft size={22} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Hardware Requests</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#E25E3E" />
        </View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={item => item.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#E25E3E']} tintColor="#E25E3E" />
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Package size={52} color="#CBD5E1" />
              <Text style={styles.emptyTitle}>No Requests</Text>
              <Text style={styles.emptySub}>Tap + to raise a hardware request.</Text>
            </View>
          }
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={openCreate} activeOpacity={0.85}>
        <Plus size={24} color="#FFF" />
      </TouchableOpacity>

      {/* Create / Edit Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingId ? 'Edit Request' : 'New Hardware Request'}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <X size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalBody}>
              <Text style={styles.label}>Request Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                {REQUEST_TYPES.map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.chip, form.requestType === t && styles.chipActive]}
                    onPress={() => setForm(f => ({ ...f, requestType: t }))}
                  >
                    <Text style={[styles.chipText, form.requestType === t && styles.chipTextActive]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.label}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                {CATEGORIES.map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.chip, form.category === c && styles.chipActive]}
                    onPress={() => setForm(f => ({ ...f, category: c }))}
                  >
                    <Text style={[styles.chipText, form.category === c && styles.chipTextActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.label}>Urgency</Text>
              <View style={styles.urgencyRow}>
                {URGENCY_LEVELS.map(u => (
                  <TouchableOpacity
                    key={u}
                    style={[styles.urgencyOpt, form.urgency === u && styles.urgencyOptActive]}
                    onPress={() => setForm(f => ({ ...f, urgency: u }))}
                  >
                    <Text style={[styles.urgencyOptText, form.urgency === u && styles.urgencyOptTextActive]}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Reason / Description</Text>
              <TextInput
                style={styles.textarea}
                placeholder="Describe why you need this..."
                placeholderTextColor="#94A3B8"
                multiline
                numberOfLines={4}
                value={form.reason}
                onChangeText={t => setForm(f => ({ ...f, reason: t }))}
              />

              <View style={styles.imageHeader}>
                <Text style={styles.label}>Images (optional)</Text>
                <TouchableOpacity
                  style={styles.addImageBtn}
                  onPress={showImagePicker}
                  disabled={uploadingImage}
                >
                  {uploadingImage
                    ? <ActivityIndicator size="small" color="#E25E3E" />
                    : <><ImageIcon size={16} color="#E25E3E" /><Text style={styles.addImageText}>Add</Text></>
                  }
                </TouchableOpacity>
              </View>

              {form.images.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageRow}>
                  {form.images.map((url, i) => (
                    <View key={i} style={styles.thumbWrap}>
                      <TouchableOpacity onPress={() => setLightboxUrl(url)}>
                        <Image source={{ uri: url }} style={styles.thumb} resizeMode="cover" />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.removeImg} onPress={() => removeImage(i)}>
                        <X size={12} color="#FFF" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}

              <TouchableOpacity
                style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting
                  ? <ActivityIndicator color="#FFF" />
                  : <Text style={styles.submitText}>{editingId ? 'Save Changes' : 'Submit Request'}</Text>
                }
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Lightbox */}
      <Modal
        visible={!!lightboxUrl}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxUrl(null)}
        statusBarTranslucent
      >
        <View style={styles.lightboxOverlay}>
          <TouchableOpacity style={styles.lightboxClose} onPress={() => setLightboxUrl(null)}>
            <X size={24} color="#FFF" />
          </TouchableOpacity>
          {lightboxUrl && (
            <Image source={{ uri: lightboxUrl }} style={styles.lightboxImage} resizeMode="contain" />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#0F172A' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, paddingBottom: 100 },

  card: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  cardSubtitle: { fontSize: 12, color: '#64748B', marginTop: 2 },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  statusText: { fontSize: 10, fontWeight: '800' },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  urgencyBadge: {
    backgroundColor: '#FFF7ED',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  urgencyText: { fontSize: 11, fontWeight: '700', color: '#C2410C' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dateText: { fontSize: 12, color: '#94A3B8' },
  reason: { fontSize: 13, color: '#475569', lineHeight: 20 },
  rejection: { fontSize: 12, color: '#DC2626', marginTop: 6, fontStyle: 'italic' },
  imageRow: { marginTop: 10 },
  thumbWrap: { marginRight: 8, borderRadius: 10, overflow: 'hidden', width: 80, height: 60 },
  thumb: { width: 80, height: 60 },
  thumbOverlay: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 10,
    padding: 3,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    gap: 10,
  },
  editBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  editBtnText: { color: '#2563EB', fontSize: 13, fontWeight: '600' },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  cancelBtnText: { color: '#DC2626', fontSize: 13, fontWeight: '600' },

  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#E25E3E',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#E25E3E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },

  emptyBox: { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#475569', marginTop: 16 },
  emptySub: { fontSize: 13, color: '#94A3B8', marginTop: 4 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#0F172A' },
  modalBody: { padding: 20, paddingBottom: 40 },

  label: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 8, marginTop: 16 },
  chipRow: { marginBottom: 4 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 8,
  },
  chipActive: { backgroundColor: '#FFF1EC', borderColor: '#E25E3E' },
  chipText: { fontSize: 13, color: '#64748B', fontWeight: '500' },
  chipTextActive: { color: '#E25E3E', fontWeight: '700' },

  urgencyRow: { flexDirection: 'row', gap: 8 },
  urgencyOpt: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  urgencyOptActive: { backgroundColor: '#FFF1EC', borderColor: '#E25E3E' },
  urgencyOptText: { fontSize: 12, color: '#64748B', fontWeight: '600' },
  urgencyOptTextActive: { color: '#E25E3E', fontWeight: '700' },

  textarea: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
    minHeight: 100,
    fontSize: 14,
    color: '#0F172A',
    textAlignVertical: 'top',
    backgroundColor: '#F8FAFC',
  },

  imageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 8 },
  addImageBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#E25E3E', backgroundColor: '#FFF1EC' },
  addImageText: { fontSize: 13, color: '#E25E3E', fontWeight: '600' },
  removeImg: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    padding: 3,
  },

  submitBtn: {
    marginTop: 24,
    backgroundColor: '#E25E3E',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  submitText: { color: '#FFF', fontSize: 15, fontWeight: '700' },

  lightboxOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  lightboxClose: { position: 'absolute', top: 52, right: 20, zIndex: 10, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, padding: 8 },
  lightboxImage: { width: '100%', height: '80%' },
});
