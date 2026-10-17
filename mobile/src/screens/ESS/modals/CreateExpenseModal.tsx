import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Alert, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import {
  X, Calendar as CalendarIcon, Camera, Image as ImageIcon, FileText, ChevronDown, ZoomIn, Receipt,
  Car, Utensils, BedDouble, Laptop, MoreHorizontal, Store, FolderKanban, Check, AlertCircle, Send,
} from 'lucide-react-native';
import DocumentPicker from 'react-native-document-picker';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { payrollService } from '../../../api/payrollService';
import { employeeService } from '../../../api/employeeService';
import { projectService } from '../../../api/projectService';
import { colors, status } from '../../../theme/ds';

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
const CATEGORY_UI: Record<string, { label: string; icon: any }> = {
  TRAVEL: { label: 'Travel', icon: Car },
  MEALS: { label: 'Meals', icon: Utensils },
  ACCOMMODATION: { label: 'Stay', icon: BedDouble },
  EQUIPMENT: { label: 'Equipment', icon: Laptop },
  OTHER: { label: 'Other', icon: MoreHorizontal },
};

/** The calendar day picked, in the phone's own time zone (not UTC). */
const localYmd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Which form section each error belongs to, in the order they appear. */
type SectionKey = 'details' | 'purchase' | 'receipt';
const ERROR_SECTION: Record<keyof Errors, SectionKey> = {
  title: 'details', amount: 'details', purchaseDate: 'purchase', receipt: 'receipt',
};
const ERROR_ORDER: (keyof Errors)[] = ['title', 'amount', 'purchaseDate', 'receipt'];

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

  // Where each section sits in the scroll view, so Submit can take the person
  // straight to the first field that needs fixing.
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const sectionY = useRef<Partial<Record<SectionKey, number>>>({});
  const titleRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const amountRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const onSectionLayout = (k: SectionKey) => (e: any) => { sectionY.current[k] = e.nativeEvent.layout.y; };

  useEffect(() => {
    if (visible) {
      projectService.getProjects().then((list) => {
        setProjects(list);
        // Editing: claims store the project's name; find it again by name.
        if (editingClaim && !(editingClaim as any).projectId && editingClaim.projectName) {
          const match = list.find((p: any) => p.name === editingClaim.projectName);
          if (match) setProjectId(match.id);
        }
      }).catch(() => {});
      if (editingClaim) {
        setTitle(editingClaim.title);
        setDescription(editingClaim.description || '');
        setAmount(String(editingClaim.amount));
        setCategory(editingClaim.category);
        setPurchaseDate(editingClaim.purchaseDate ? editingClaim.purchaseDate.split('T')[0] : '');
        setPurchasedFrom(editingClaim.purchasedFrom || '');
        setExistingReceiptUrl(editingClaim.receiptUrl || null);
        setProjectId((editingClaim as any).projectId ?? null);
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
    const first = ERROR_ORDER.find((k) => next[k]);
    if (first) {
      // Take them to it: scroll the section into view, then focus the input.
      const y = sectionY.current[ERROR_SECTION[first]] ?? 0;
      scrollRef.current?.scrollTo({ y: Math.max(y - 12, 0), animated: true });
      setTimeout(() => {
        if (first === 'title') titleRef.current?.focus();
        else if (first === 'amount') amountRef.current?.focus();
        else if (first === 'purchaseDate') setDatePickerVisible(true);
      }, 350);
    }
    return !first;
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
  const amountNum = parseFloat(amount);
  const errorCount = Object.values(errors).filter(Boolean).length;

  const Step = ({ n, title, hint }: { n: number; title: string; hint?: string }) => (
    <View style={styles.stepHead}>
      <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>{n}</Text></View>
      <Text style={styles.stepTitle}>{title}</Text>
      {!!hint && <Text style={styles.stepHint}>{hint}</Text>}
    </View>
  );

  const FieldError = ({ text }: { text?: string }) => (text ? (
    <View style={styles.errorRow}>
      <AlertCircle size={12} color={status.danger.strong} />
      <Text style={styles.errorText}>{text}</Text>
    </View>
  ) : null);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />

        <View style={[styles.content, { paddingBottom: insets.bottom || 16 }]}>
          <View style={styles.dragHandle} />
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIconBadge}>
                <Receipt size={20} color={colors.primary} strokeWidth={2.3} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.headerTitle}>{isEditing ? 'Edit Expense Claim' : 'Raise Expense Claim'}</Text>
                <Text style={styles.headerSubtitle}>Get reimbursed for work spending</Text>
              </View>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <X size={18} color={colors.textMuted} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {errorCount > 0 && (
              <View style={styles.errorBanner}>
                <AlertCircle size={14} color={status.danger.strong} />
                <Text style={styles.errorBannerText}>
                  {errorCount === 1 ? '1 field needs your attention.' : `${errorCount} fields need your attention.`}
                </Text>
              </View>
            )}

            {/* 1. What was it */}
            <View style={styles.card} onLayout={onSectionLayout('details')}>
              <Step n={1} title="Expense details" />
              <Text style={styles.label}>Amount *</Text>
              <View style={[styles.amountBox, errors.amount && styles.inputError]}>
                <Text style={styles.amountRupee}>₹</Text>
                <TextInput
                  ref={amountRef}
                  style={styles.amountInput}
                  placeholder="0"
                  placeholderTextColor={colors.textFaint}
                  keyboardType="decimal-pad"
                  value={amount}
                  onChangeText={v => { setAmount(v.replace(/[^0-9.]/g, '')); setErrors(e => ({ ...e, amount: undefined })); }}
                />
              </View>
              <FieldError text={errors.amount} />

              <Text style={[styles.label, styles.labelGap]}>Title *</Text>
              <TextInput
                ref={titleRef}
                style={[styles.input, errors.title && styles.inputError]}
                placeholder="e.g. Cab to client site"
                placeholderTextColor={colors.textFaint}
                value={title}
                onChangeText={v => { setTitle(v); setErrors(e => ({ ...e, title: undefined })); }}
                returnKeyType="next"
              />
              <FieldError text={errors.title} />

              <Text style={[styles.label, styles.labelGap]}>Category</Text>
              <View style={styles.categoryGrid}>
                {CATEGORIES.map(cat => {
                  const ui = CATEGORY_UI[cat];
                  const Icon = ui.icon;
                  const on = category === cat;
                  return (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.categoryTile, on && styles.categoryTileOn]}
                      onPress={() => setCategory(cat)}
                      activeOpacity={0.8}
                    >
                      <Icon size={16} color={on ? colors.primary : colors.textMuted} />
                      <Text style={[styles.categoryText, on && styles.categoryTextOn]}>{ui.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* 2. Where and when */}
            <View style={styles.card} onLayout={onSectionLayout('purchase')}>
              <Step n={2} title="Purchase" hint="Optional" />
              <Text style={styles.label}>Purchase date</Text>
              <TouchableOpacity
                style={[styles.selectBox, errors.purchaseDate && styles.inputError]}
                onPress={() => setDatePickerVisible(true)}
                activeOpacity={0.75}
              >
                <CalendarIcon size={16} color={colors.textFaint} />
                <Text style={[styles.selectText, !purchaseDate && styles.placeholderText]}>
                  {purchaseDate
                    ? new Date(`${purchaseDate}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
                    : 'Select date'}
                </Text>
              </TouchableOpacity>
              <FieldError text={errors.purchaseDate} />

              <Text style={[styles.label, styles.labelGap]}>Purchased from</Text>
              <View style={styles.selectBox}>
                <Store size={16} color={colors.textFaint} />
                <TextInput
                  style={styles.inlineInput}
                  placeholder="e.g. Uber, Indigo, Croma"
                  placeholderTextColor={colors.textFaint}
                  value={purchasedFrom}
                  onChangeText={setPurchasedFrom}
                />
              </View>

              <Text style={[styles.label, styles.labelGap]}>Project</Text>
              <TouchableOpacity
                style={styles.selectBox}
                onPress={() => setShowProjectDropdown(!showProjectDropdown)}
                activeOpacity={0.75}
              >
                <FolderKanban size={16} color={colors.textFaint} />
                <Text style={[styles.selectText, !selectedProject && styles.placeholderText]} numberOfLines={1}>
                  {selectedProject ? selectedProject.name : 'Not for a project'}
                </Text>
                <ChevronDown size={16} color={colors.textFaint} />
              </TouchableOpacity>
              {showProjectDropdown && (
                <View style={styles.dropdownList}>
                  <ScrollView nestedScrollEnabled style={{ maxHeight: 220 }}>
                    {projectId !== null && (
                      <TouchableOpacity style={styles.dropdownItem} onPress={() => { setProjectId(null); setShowProjectDropdown(false); }}>
                        <Text style={[styles.dropdownItemText, { color: colors.primary }]}>Not for a project</Text>
                      </TouchableOpacity>
                    )}
                    {projects.length === 0 ? (
                      <Text style={[styles.dropdownItemText, styles.dropdownEmpty]}>No projects found</Text>
                    ) : (
                      projects.map(p => (
                        <TouchableOpacity
                          key={p.id}
                          style={[styles.dropdownItem, p.id === projectId && styles.dropdownItemOn]}
                          onPress={() => { setProjectId(p.id); setShowProjectDropdown(false); }}
                        >
                          <Text style={[styles.dropdownItemText, p.id === projectId && { color: colors.primary, fontWeight: '800' }]} numberOfLines={1}>
                            {p.name}
                          </Text>
                          {p.id === projectId && <Check size={14} color={colors.primary} />}
                        </TouchableOpacity>
                      ))
                    )}
                  </ScrollView>
                </View>
              )}

              <Text style={[styles.label, styles.labelGap]}>Notes</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Anything finance should know"
                placeholderTextColor={colors.textFaint}
                multiline
                numberOfLines={3}
                value={description}
                onChangeText={setDescription}
              />
            </View>

            {/* 3. Proof */}
            <View style={styles.card} onLayout={onSectionLayout('receipt')}>
              <Step n={3} title="Receipt" hint="Recommended" />
              {!attachment && !existingReceiptUrl ? (
                <View style={styles.attachmentOptions}>
                  {[
                    { label: 'Camera', icon: Camera, onPress: capturePhoto },
                    { label: 'Gallery', icon: ImageIcon, onPress: pickImage },
                    { label: 'PDF / File', icon: FileText, onPress: pickDocument },
                  ].map(o => {
                    const Icon = o.icon;
                    return (
                      <TouchableOpacity key={o.label} style={[styles.attachBtn, errors.receipt && styles.inputError]} onPress={o.onPress} activeOpacity={0.8}>
                        <View style={styles.attachIcon}><Icon size={18} color={colors.primary} /></View>
                        <Text style={styles.attachText}>{o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : previewImageUri || (existingIsImage && existingReceiptUrl && !attachment) ? (
                <View style={styles.previewContainer}>
                  <TouchableOpacity onPress={() => setLightboxVisible(true)} activeOpacity={0.85}>
                    <Image source={{ uri: (previewImageUri || existingReceiptUrl)! }} style={styles.previewImage} resizeMode="cover" />
                    <View style={styles.previewOverlay}><ZoomIn size={16} color="#FFFFFF" /></View>
                  </TouchableOpacity>
                  <View style={styles.previewMeta}>
                    <Check size={14} color={status.success.strong} />
                    <Text style={styles.previewFileName} numberOfLines={1}>{attachment ? attachment.name : 'Current receipt'}</Text>
                    <TouchableOpacity onPress={() => (attachment ? setAttachment(null) : setExistingReceiptUrl(null))} style={styles.removeBtn}>
                      <Text style={styles.removeText}>Replace</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.selectedFileBox}>
                  <FileText size={16} color={colors.primary} />
                  <Text style={styles.selectedFileName} numberOfLines={1}>{attachment ? attachment.name : 'Current receipt'}</Text>
                  <TouchableOpacity onPress={() => (attachment ? setAttachment(null) : setExistingReceiptUrl(null))} style={styles.removeBtn}>
                    <Text style={styles.removeText}>Replace</Text>
                  </TouchableOpacity>
                </View>
              )}
              <FieldError text={errors.receipt} />
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.footerSummary}>
              <Text style={styles.footerLabel}>{isEditing ? 'Updated claim' : 'You are claiming'}</Text>
              <Text style={styles.footerAmount}>
                {amountNum > 0 ? `₹${amountNum.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '₹0'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.submitBtn, isSubmitting && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={isSubmitting}
              activeOpacity={0.85}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Send size={16} color="#FFFFFF" />
                  <Text style={styles.submitBtnText}>{isEditing ? 'Save' : 'Submit Claim'}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <DateTimePickerModal
          isVisible={isDatePickerVisible}
          mode="date"
          maximumDate={new Date()}
          date={purchaseDate ? new Date(`${purchaseDate}T00:00:00`) : new Date()}
          onConfirm={(d) => {
            setPurchaseDate(localYmd(d));
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
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15, 23, 42, 0.5)' },
  backdrop: { ...(StyleSheet.absoluteFill as any) },
  content: {
    backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '94%',
    shadowColor: colors.shadow, shadowOffset: { width: 0, height: -8 }, shadowOpacity: 0.16, shadowRadius: 24, elevation: 12,
  },
  dragHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1', alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16,
    paddingTop: 8, paddingBottom: 14, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.border,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  headerIconBadge: {
    width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primarySoft, borderWidth: 1,
    borderColor: colors.primaryBorder, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '900', color: colors.text, letterSpacing: -0.2 },
  headerSubtitle: { fontSize: 12, fontWeight: '500', color: colors.textMuted, marginTop: 1 },
  closeBtn: {
    width: 36, height: 36, borderRadius: 12, backgroundColor: colors.bg, borderWidth: 1,
    borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  body: { flexGrow: 0 },
  bodyContent: { padding: 16, gap: 12 },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: status.danger.bg,
    borderWidth: 1, borderColor: status.danger.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9,
  },
  errorBannerText: { flex: 1, fontSize: 12.5, fontWeight: '700', color: status.danger.strong },
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, borderWidth: 1, borderColor: colors.border },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  stepBadge: {
    width: 22, height: 22, borderRadius: 7, backgroundColor: colors.primarySoft, borderWidth: 1,
    borderColor: colors.primaryBorder, alignItems: 'center', justifyContent: 'center',
  },
  stepBadgeText: { fontSize: 11.5, fontWeight: '900', color: colors.primary },
  stepTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.text },
  stepHint: { fontSize: 11, fontWeight: '700', color: colors.textFaint },
  label: { fontSize: 11, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.4, marginBottom: 6, textTransform: 'uppercase' },
  labelGap: { marginTop: 14 },
  amountBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg, borderWidth: 1,
    borderColor: colors.border, borderRadius: 16, paddingHorizontal: 14,
  },
  amountRupee: { fontSize: 24, fontWeight: '900', color: colors.textFaint, marginRight: 6 },
  amountInput: { flex: 1, fontSize: 26, fontWeight: '900', color: colors.text, paddingVertical: 10, fontVariant: ['tabular-nums'] },
  input: {
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14.5, color: colors.text,
  },
  inputError: { borderColor: status.danger.border, backgroundColor: status.danger.bg },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, marginLeft: 2 },
  errorText: { fontSize: 12, fontWeight: '700', color: status.danger.strong },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryTile: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9,
    borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  categoryTileOn: { borderColor: colors.primaryRing, backgroundColor: colors.primarySoft },
  categoryText: { fontSize: 12.5, fontWeight: '700', color: colors.textSecondary },
  categoryTextOn: { color: colors.primary, fontWeight: '800' },
  selectBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.bg, borderWidth: 1,
    borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, minHeight: 48,
  },
  selectText: { flex: 1, fontSize: 14.5, color: colors.text, fontWeight: '600' },
  inlineInput: { flex: 1, fontSize: 14.5, color: colors.text, paddingVertical: 12 },
  placeholderText: { color: colors.textFaint, fontWeight: '500' },
  dropdownList: {
    marginTop: 6, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: 14,
    overflow: 'hidden', shadowColor: colors.shadow, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  dropdownItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  dropdownItemOn: { backgroundColor: colors.primarySoft },
  dropdownItemText: { flex: 1, fontSize: 14, color: colors.textBody, fontWeight: '600' },
  dropdownEmpty: { padding: 14, color: colors.textFaint },
  attachmentOptions: { flexDirection: 'row', gap: 8 },
  attachBtn: {
    flex: 1, alignItems: 'center', gap: 6, paddingVertical: 14, borderRadius: 16, borderWidth: 1.5,
    borderStyle: 'dashed', borderColor: colors.primaryBorder, backgroundColor: colors.primarySoft,
  },
  attachIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  attachText: { fontSize: 12, fontWeight: '800', color: colors.primary },
  previewContainer: { borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  previewImage: { width: '100%', height: 160 },
  previewOverlay: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(15,23,42,0.55)', borderRadius: 10, padding: 5 },
  previewMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, backgroundColor: '#FFFFFF' },
  previewFileName: { flex: 1, fontSize: 12.5, fontWeight: '700', color: colors.textBody },
  selectedFileBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 14,
    borderWidth: 1, borderColor: colors.primaryBorder, backgroundColor: colors.primarySoft,
  },
  selectedFileName: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.textBody },
  removeBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 9, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: colors.border,
  },
  removeText: { fontSize: 11.5, fontWeight: '800', color: colors.primary },
  footer: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: colors.border,
  },
  footerSummary: { flex: 1 },
  footerLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.5, color: colors.textFaint, textTransform: 'uppercase' },
  footerAmount: { fontSize: 20, fontWeight: '900', color: colors.text, fontVariant: ['tabular-nums'] },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary,
    paddingHorizontal: 20, height: 50, borderRadius: 14,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.28, shadowRadius: 12, elevation: 5,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  lightboxOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  lightboxClose: {
    position: 'absolute', top: 52, right: 20, zIndex: 10, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, padding: 8,
  },
  lightboxImage: { width: '100%', height: '80%' },
});
