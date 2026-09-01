import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Alert, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { X, Calendar as CalendarIcon, Camera, Image as ImageIcon, FileText, ChevronDown, ZoomIn } from 'lucide-react-native';
import DocumentPicker from 'react-native-document-picker';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { payrollService } from '../../../api/payrollService';
import { employeeService } from '../../../api/employeeService';
import { projectService } from '../../../api/projectService';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editingClaim?: import('../../../api/payrollService').ExpenseClaim | null;
}

interface Attachment {
  uri: string;
  name: string;
  type: string;
  isImage: boolean;
}

interface Errors {
  title?: string;
  amount?: string;
  purchaseDate?: string;
  receipt?: string;
}

const CATEGORIES = ['TRAVEL', 'MEALS', 'ACCOMMODATION', 'EQUIPMENT', 'OTHER'];

export default function CreateExpenseModal({ visible, onClose, onSuccess, editingClaim }: Props) {
  const insets = useSafeAreaInsets();
  const isEditing = !!editingClaim;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('OTHER');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [purchasedFrom, setPurchasedFrom] = useState('');
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [existingReceiptUrl, setExistingReceiptUrl] = useState<string | null>(null);
  const [isDatePickerVisible, setDatePickerVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [lightboxVisible, setLightboxVisible] = useState(false);

  useEffect(() => {
    if (visible) {
      projectService.getProjects().then(setProjects).catch(() => {});
      if (editingClaim) {
        setTitle(editingClaim.title);
        setDescription(editingClaim.description || '');
        setAmount(String(editingClaim.amount));
        setCategory(editingClaim.category);
        setPurchaseDate(editingClaim.purchaseDate ? editingClaim.purchaseDate.split('T')[0] : '');
        setPurchasedFrom(editingClaim.purchasedFrom || '');
        setExistingReceiptUrl(editingClaim.receiptUrl || null);
        setAttachment(null);
      }
    }
  }, [visible, editingClaim]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setAmount('');
    setCategory('OTHER');
    setPurchaseDate('');
    setPurchasedFrom('');
    setAttachment(null);
    setExistingReceiptUrl(null);
    setProjectId(null);
    setShowProjectDropdown(false);
    setErrors({});
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const capturePhoto = async () => {
    const res = await launchCamera({ mediaType: 'photo', quality: 0.8 });
    if (res.assets && res.assets.length > 0) {
      const asset = res.assets[0];
      setAttachment({
        uri: asset.uri!,
        name: asset.fileName || `photo_${Date.now()}.jpg`,
        type: asset.type || 'image/jpeg',
        isImage: true,
      });
      setErrors(e => ({ ...e, receipt: undefined }));
    }
  };

  const pickImage = async () => {
    const res = await launchImageLibrary({ mediaType: 'photo', quality: 0.8 });
    if (res.assets && res.assets.length > 0) {
      const asset = res.assets[0];
      setAttachment({
        uri: asset.uri!,
        name: asset.fileName || `image_${Date.now()}.jpg`,
        type: asset.type || 'image/jpeg',
        isImage: true,
      });
      setErrors(e => ({ ...e, receipt: undefined }));
    }
  };

  const pickDocument = async () => {
    try {
      const res = await DocumentPicker.pickSingle({
        type: [DocumentPicker.types.pdf, DocumentPicker.types.images],
      });
      const isImage = (res.type || '').startsWith('image/');
      setAttachment({
        uri: res.uri,
        name: res.name || 'document',
        type: res.type || 'application/pdf',
        isImage,
      });
      setErrors(e => ({ ...e, receipt: undefined }));
    } catch (err) {
      if (!DocumentPicker.isCancel(err)) {
        Alert.alert('Error', 'Failed to pick document');
      }
    }
  };

  const validate = (): boolean => {
    const next: Errors = {};
    if (!title.trim()) next.title = 'Title is required.';

    const numAmount = parseFloat(amount);
    if (!amount.trim()) {
      next.amount = 'Amount is required.';
    } else if (isNaN(numAmount) || numAmount <= 0) {
      next.amount = 'Amount must be greater than zero.';
    } else if (numAmount > 100000) {
      next.amount = 'Maximum claim limit is ₹1,00,000.';
    }

    if (purchaseDate) {
      const pDate = new Date(purchaseDate);
      if (pDate > new Date()) {
        next.purchaseDate = 'Purchase date cannot be in the future.';
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      let receiptUrl: string | null | undefined = isEditing ? (existingReceiptUrl || editingClaim?.receiptUrl) : null;

      if (attachment) {
        const fileData = new FormData();
        fileData.append('file', {
          uri: attachment.uri,
          name: attachment.name,
          type: attachment.type,
        } as any);

        let uploadRes: any;
        if (attachment.isImage) {
          uploadRes = await employeeService.uploadImage(fileData);
        } else {
          uploadRes = await employeeService.uploadFile(fileData);
        }
        receiptUrl = uploadRes?.url || uploadRes?.fileUrl || uploadRes;

        if (!receiptUrl || typeof receiptUrl !== 'string') {
          setErrors(e => ({ ...e, receipt: 'Upload failed. Please try again.' }));
          return;
        }
      }

      const selectedProject = projects.find(p => p.id === projectId);
      const payload = {
        title: title.trim(),
        description: description.trim(),
        amount: parseFloat(amount),
        category,
        receiptUrl,
        purchaseDate: purchaseDate ? new Date(purchaseDate).toISOString() : undefined,
        purchasedFrom: purchasedFrom.trim() || undefined,
        projectId: selectedProject?.id,
        projectName: selectedProject?.name,
      };

      if (isEditing && editingClaim) {
        await payrollService.updateExpenseClaim(editingClaim.id, payload);
      } else {
        await payrollService.createExpenseClaim(payload);
      }

      onSuccess();
      handleClose();
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Failed to submit claim';
      Alert.alert('Submission Error', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedProject = projects.find(p => p.id === projectId);
  const previewImageUri = attachment?.isImage ? attachment.uri : null;
  const existingIsImage = existingReceiptUrl
    ? /\.(jpg|jpeg|png|gif|webp)/i.test(existingReceiptUrl)
    : false;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />

        <View style={[styles.content, { paddingBottom: insets.bottom || 20 }]}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{isEditing ? 'Edit Expense Claim' : 'Raise Expense Claim'}</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <X size={20} color="#64748B" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* Title */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Title *</Text>
              <TextInput
                style={[styles.input, errors.title && styles.inputError]}
                placeholder="e.g. Flight to Mumbai"
                value={title}
                onChangeText={v => { setTitle(v); setErrors(e => ({ ...e, title: undefined })); }}
              />
              {errors.title && <Text style={styles.errorText}>{errors.title}</Text>}
            </View>

            {/* Amount */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Amount (₹) *</Text>
              <TextInput
                style={[styles.input, errors.amount && styles.inputError]}
                placeholder="0.00"
                keyboardType="numeric"
                value={amount}
                onChangeText={v => { setAmount(v); setErrors(e => ({ ...e, amount: undefined })); }}
              />
              {errors.amount && <Text style={styles.errorText}>{errors.amount}</Text>}
            </View>

            {/* Category */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Category</Text>
              <View style={styles.categoryRow}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {CATEGORIES.map(cat => (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.categoryChip, category === cat && styles.categoryChipActive]}
                      onPress={() => setCategory(cat)}
                    >
                      <Text style={[styles.categoryText, category === cat && styles.categoryTextActive]}>
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>

            {/* Purchase Date */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Purchase Date</Text>
              <TouchableOpacity
                style={[styles.datePickerInput, errors.purchaseDate && styles.inputError]}
                onPress={() => setDatePickerVisible(true)}
              >
                <Text style={purchaseDate ? styles.dateValue : styles.placeholderText}>
                  {purchaseDate || 'Select Date'}
                </Text>
                <CalendarIcon size={18} color="#94A3B8" />
              </TouchableOpacity>
              {errors.purchaseDate && <Text style={styles.errorText}>{errors.purchaseDate}</Text>}
            </View>

            {/* Vendor */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Purchased From / Vendor</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Indigo Airlines"
                value={purchasedFrom}
                onChangeText={setPurchasedFrom}
              />
            </View>

            {/* Project */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Project</Text>
              <TouchableOpacity
                style={styles.dropdownToggle}
                onPress={() => setShowProjectDropdown(!showProjectDropdown)}
              >
                <Text style={[styles.dropdownValue, !selectedProject && styles.placeholderText]}>
                  {selectedProject ? selectedProject.name : 'Select Project...'}
                </Text>
                <ChevronDown size={18} color="#94A3B8" />
              </TouchableOpacity>
              {showProjectDropdown && (
                <View style={styles.dropdownList}>
                  {projects.length === 0 ? (
                    <Text style={styles.dropdownItemText}>No projects found</Text>
                  ) : (
                    projects.map(p => (
                      <TouchableOpacity
                        key={p.id}
                        style={styles.dropdownItem}
                        onPress={() => { setProjectId(p.id); setShowProjectDropdown(false); }}
                      >
                        <Text style={styles.dropdownItemText}>{p.name}</Text>
                      </TouchableOpacity>
                    ))
                  )}
                  {projectId !== null && (
                    <TouchableOpacity
                      style={styles.dropdownItem}
                      onPress={() => { setProjectId(null); setShowProjectDropdown(false); }}
                    >
                      <Text style={[styles.dropdownItemText, { color: '#EF4444' }]}>Clear Selection</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            {/* Description */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Provide any additional details..."
                multiline
                numberOfLines={3}
                value={description}
                onChangeText={setDescription}
              />
            </View>

            {/* Receipt Attachment */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Receipt Attachment</Text>
              <View style={styles.attachmentOptions}>
                <TouchableOpacity style={styles.attachBtn} onPress={capturePhoto}>
                  <Camera size={20} color="#2563EB" />
                  <Text style={styles.attachText}>Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.attachBtn} onPress={pickImage}>
                  <ImageIcon size={20} color="#2563EB" />
                  <Text style={styles.attachText}>Gallery</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.attachBtn} onPress={pickDocument}>
                  <FileText size={20} color="#2563EB" />
                  <Text style={styles.attachText}>File</Text>
                </TouchableOpacity>
              </View>

              {errors.receipt && <Text style={[styles.errorText, { marginTop: 6 }]}>{errors.receipt}</Text>}

              {/* New image preview */}
              {previewImageUri ? (
                <View style={styles.previewContainer}>
                  <TouchableOpacity onPress={() => setLightboxVisible(true)} activeOpacity={0.85}>
                    <Image source={{ uri: previewImageUri }} style={styles.previewImage} resizeMode="cover" />
                    <View style={styles.previewOverlay}>
                      <ZoomIn size={20} color="#FFFFFF" />
                    </View>
                  </TouchableOpacity>
                  <View style={styles.previewMeta}>
                    <Text style={styles.previewFileName} numberOfLines={1}>{attachment!.name}</Text>
                    <TouchableOpacity onPress={() => setAttachment(null)}>
                      <X size={18} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              ) : attachment ? (
                /* Non-image file */
                <View style={styles.selectedFileBox}>
                  <FileText size={16} color="#64748B" />
                  <Text style={styles.selectedFileName} numberOfLines={1}>{attachment.name}</Text>
                  <TouchableOpacity onPress={() => setAttachment(null)}>
                    <X size={18} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              ) : existingIsImage && existingReceiptUrl ? (
                /* Existing image from edit mode */
                <View style={styles.previewContainer}>
                  <TouchableOpacity onPress={() => setLightboxVisible(true)} activeOpacity={0.85}>
                    <Image source={{ uri: existingReceiptUrl }} style={styles.previewImage} resizeMode="cover" />
                    <View style={styles.previewOverlay}>
                      <ZoomIn size={20} color="#FFFFFF" />
                    </View>
                  </TouchableOpacity>
                  <View style={styles.previewMeta}>
                    <Text style={styles.previewFileName} numberOfLines={1}>Current receipt</Text>
                    <TouchableOpacity onPress={() => setExistingReceiptUrl(null)}>
                      <X size={18} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              ) : existingReceiptUrl ? (
                /* Existing non-image file */
                <View style={styles.selectedFileBox}>
                  <FileText size={16} color="#64748B" />
                  <Text style={styles.selectedFileName} numberOfLines={1}>Current receipt</Text>
                  <TouchableOpacity onPress={() => setExistingReceiptUrl(null)}>
                    <X size={18} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>

          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.submitBtn, isSubmitting && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.submitBtnText}>{isEditing ? 'Save Changes' : 'Submit Claim'}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <DateTimePickerModal
          isVisible={isDatePickerVisible}
          mode="date"
          maximumDate={new Date()}
          onConfirm={(d) => {
            setPurchaseDate(d.toISOString().split('T')[0]);
            setDatePickerVisible(false);
            setErrors(e => ({ ...e, purchaseDate: undefined }));
          }}
          onCancel={() => setDatePickerVisible(false)}
        />
      </KeyboardAvoidingView>

      {/* Fullscreen image lightbox */}
      <Modal
        visible={lightboxVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxVisible(false)}
        statusBarTranslucent
      >
        <View style={styles.lightboxOverlay}>
          <TouchableOpacity
            style={styles.lightboxClose}
            onPress={() => setLightboxVisible(false)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <X size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Image
            source={{ uri: (previewImageUri || existingReceiptUrl)! }}
            style={styles.lightboxImage}
            resizeMode="contain"
          />
        </View>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
  },
  backdrop: {
    ...StyleSheet.absoluteFill as any,
  },
  content: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  closeBtn: {
    padding: 4,
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
  },
  body: {
    padding: 20,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#0F172A',
  },
  inputError: {
    borderColor: '#EF4444',
    backgroundColor: '#FFF5F5',
  },
  errorText: {
    fontSize: 12,
    color: '#EF4444',
    marginTop: 4,
    marginLeft: 4,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  datePickerInput: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dateValue: {
    fontSize: 15,
    color: '#0F172A',
  },
  placeholderText: {
    color: '#94A3B8',
    fontSize: 15,
  },
  categoryRow: {
    flexDirection: 'row',
    marginHorizontal: -4,
  },
  categoryChip: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  categoryChipActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#3B82F6',
  },
  categoryText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  categoryTextActive: {
    color: '#1D4ED8',
  },
  dropdownToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dropdownValue: {
    fontSize: 15,
    color: '#0F172A',
  },
  dropdownList: {
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    maxHeight: 180,
    overflow: 'hidden',
  },
  dropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dropdownItemText: {
    fontSize: 14,
    color: '#0F172A',
  },
  attachmentOptions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  attachBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFF6FF',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  attachText: {
    color: '#1D4ED8',
    fontSize: 14,
    fontWeight: '600',
  },
  previewContainer: {
    marginTop: 12,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  previewImage: {
    width: '100%',
    height: 180,
  },
  previewOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 20,
    padding: 6,
  },
  previewMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  previewFileName: {
    fontSize: 13,
    color: '#334155',
    flex: 1,
    marginRight: 12,
  },
  selectedFileBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F1F5F9',
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
  },
  selectedFileName: {
    fontSize: 13,
    color: '#334155',
    flex: 1,
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  submitBtn: {
    backgroundColor: '#E25E3E',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.7,
  },
  submitBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  // Lightbox
  lightboxOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxClose: {
    position: 'absolute',
    top: 52,
    right: 20,
    zIndex: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
    padding: 8,
  },
  lightboxImage: {
    width: '100%',
    height: '80%',
  },
});
