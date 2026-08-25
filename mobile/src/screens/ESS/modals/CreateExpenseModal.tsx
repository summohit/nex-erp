import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { X, Calendar as CalendarIcon, UploadCloud, Camera, Image as ImageIcon, FileText, ChevronDown } from 'lucide-react-native';
import DocumentPicker from 'react-native-document-picker';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { payrollService } from '../../../api/payrollService';
import { employeeService } from '../../../api/employeeService';
import { projectService } from '../../../api/projectService';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CATEGORIES = ['TRAVEL', 'MEALS', 'ACCOMMODATION', 'EQUIPMENT', 'OTHER'];

export default function CreateExpenseModal({ visible, onClose, onSuccess }: Props) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('OTHER');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [purchasedFrom, setPurchasedFrom] = useState('');
  
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  
  const [attachment, setAttachment] = useState<any>(null);
  const [isDatePickerVisible, setDatePickerVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      projectService.getProjects().then(setProjects).catch(() => {});
    }
  }, [visible]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setAmount('');
    setCategory('OTHER');
    setPurchaseDate('');
    setPurchasedFrom('');
    setAttachment(null);
    setProjectId(null);
    setShowProjectDropdown(false);
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
        uri: asset.uri,
        name: asset.fileName || `photo_${Date.now()}.jpg`,
        type: asset.type || 'image/jpeg'
      });
    }
  };

  const pickImage = async () => {
    const res = await launchImageLibrary({ mediaType: 'photo', quality: 0.8 });
    if (res.assets && res.assets.length > 0) {
      const asset = res.assets[0];
      setAttachment({
        uri: asset.uri,
        name: asset.fileName || `image_${Date.now()}.jpg`,
        type: asset.type || 'image/jpeg'
      });
    }
  };

  const pickDocument = async () => {
    try {
      const res = await DocumentPicker.pickSingle({
        type: [DocumentPicker.types.pdf, DocumentPicker.types.images],
      });
      setAttachment(res);
    } catch (err) {
      if (!DocumentPicker.isCancel(err)) {
        Alert.alert('Error', 'Failed to pick document');
      }
    }
  };

  const handleSubmit = async () => {
    if (!title.trim() || !amount.trim()) {
      Alert.alert('Missing Fields', 'Title and Amount are required.');
      return;
    }
    
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      Alert.alert('Invalid Amount', 'Amount must be greater than zero.');
      return;
    }
    if (numAmount > 100000) {
      Alert.alert('Limit Exceeded', 'Maximum claim limit is ₹1,00,000.');
      return;
    }
    
    if (purchaseDate) {
      const pDate = new Date(purchaseDate);
      if (pDate > new Date()) {
        Alert.alert('Invalid Date', 'Purchase date cannot be in the future.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      let receiptUrl = null;
      
      if (attachment) {
        const fileData = new FormData();
        fileData.append('file', {
          uri: attachment.uri,
          name: attachment.name || 'receipt.pdf',
          type: attachment.type || 'application/pdf',
        } as any);

        const uploadRes = await employeeService.uploadFile(fileData); 
        receiptUrl = uploadRes?.url || uploadRes?.fileUrl || uploadRes;
        
        if (!receiptUrl || typeof receiptUrl !== 'string') {
          throw new Error('Upload failed');
        }
      }

      const selectedProject = projects.find(p => p.id === projectId);

      await payrollService.createExpenseClaim({
        title: title.trim(),
        description: description.trim(),
        amount: numAmount,
        category,
        receiptUrl,
        purchaseDate: purchaseDate ? new Date(purchaseDate).toISOString() : undefined,
        purchasedFrom: purchasedFrom.trim() || undefined,
        projectId: selectedProject?.id,
        projectName: selectedProject?.name,
      });

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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />
        
        <View style={[styles.content, { paddingBottom: insets.bottom || 20 }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Raise Expense Claim</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <X size={20} color="#64748B" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Title *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Flight to Mumbai"
                value={title}
                onChangeText={setTitle}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Amount (₹) *</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                keyboardType="numeric"
                value={amount}
                onChangeText={setAmount}
              />
            </View>

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

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Purchase Date</Text>
              <TouchableOpacity
                style={styles.datePickerInput}
                onPress={() => setDatePickerVisible(true)}
              >
                <Text style={styles.dateValue}>{purchaseDate || 'Select Date'}</Text>
                <CalendarIcon size={18} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Purchased From / Vendor</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Indigo Airlines"
                value={purchasedFrom}
                onChangeText={setPurchasedFrom}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Project</Text>
              <TouchableOpacity 
                style={styles.dropdownToggle}
                onPress={() => setShowProjectDropdown(!showProjectDropdown)}
              >
                <Text style={[styles.dropdownValue, !selectedProject && styles.placeholderText]}>
                  {selectedProject ? selectedProject.name : 'Search Project...'}
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
                        onPress={() => {
                          setProjectId(p.id);
                          setShowProjectDropdown(false);
                        }}
                      >
                        <Text style={styles.dropdownItemText}>{p.name}</Text>
                      </TouchableOpacity>
                    ))
                  )}
                  {projectId !== null && (
                    <TouchableOpacity 
                      style={styles.dropdownItem}
                      onPress={() => {
                        setProjectId(null);
                        setShowProjectDropdown(false);
                      }}
                    >
                      <Text style={[styles.dropdownItemText, { color: '#EF4444' }]}>Clear Selection</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

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
              
              {attachment && (
                <View style={styles.selectedFileBox}>
                  <Text style={styles.selectedFileName} numberOfLines={1}>{attachment.name}</Text>
                  <TouchableOpacity onPress={() => setAttachment(null)}>
                    <X size={18} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </ScrollView>

          {/* Sticky Submit Button at the bottom */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.submitBtn, isSubmitting && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.submitBtnText}>Submit Claim</Text>
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
          }}
          onCancel={() => setDatePickerVisible(false)}
        />
      </KeyboardAvoidingView>
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
  title: {
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
  placeholderText: {
    color: '#94A3B8',
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
  selectedFileBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F1F5F9',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  selectedFileName: {
    fontSize: 13,
    color: '#334155',
    flex: 1,
    marginRight: 12,
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
});
