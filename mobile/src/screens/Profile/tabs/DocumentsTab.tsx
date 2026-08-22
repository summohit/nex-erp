import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  Linking,
  ScrollView,
} from 'react-native';
import { FileText, Eye, Trash2, FolderOpen, Upload, X, FileCheck, FileCode, Paperclip } from 'lucide-react-native';
import { employeeService } from '../../../api/employeeService';
import FeedbackModal, { ModalType } from '../../../components/FeedbackModal';

interface DocumentsTabProps {
  profileData: any;
  onRefresh: () => void;
  onUploadPress: () => void;
  pendingFile: { uri: string; fileName: string; type: string } | null;
  onClearPendingFile: () => void;
}

const DOCUMENT_TYPES = [
  'PAN Card',
  'Aadhaar Card',
  'Passport',
  'Bank Proof / Cancelled Cheque',
  'Educational Certificate',
  'Relieving / Experience Letter',
  'Payslips',
  'Form 16 / Tax Proof',
  'Driving License / Voter ID',
  'Other',
];

export default function DocumentsTab({
  profileData,
  onRefresh,
  onUploadPress,
  pendingFile,
  onClearPendingFile,
}: DocumentsTabProps) {
  const [loading, setLoading] = useState(false);
  
  const [modalVisible, setModalVisible] = useState(false);
  const [fileName, setFileName] = useState('');
  const [documentType, setDocumentType] = useState('PAN Card');

  const [feedback, setFeedback] = useState<{ visible: boolean; type: ModalType; title: string; message: string }>({
    visible: false,
    type: 'success',
    title: '',
    message: '',
  });
  const [confirmDelete, setConfirmDelete] = useState<{ visible: boolean; docId: string | number | null }>({
    visible: false,
    docId: null,
  });

  const showFeedback = (type: ModalType, title: string, message: string) =>
    setFeedback({ visible: true, type, title, message });

  const documents = profileData?.documents || [];
  const employeeId = profileData?.id;

  useEffect(() => {
    if (pendingFile) {
      setFileName(pendingFile.fileName || 'document_file');
      setDocumentType('PAN Card');
      setModalVisible(true);
    }
  }, [pendingFile]);

  const handleCancelUpload = () => {
    setModalVisible(false);
    onClearPendingFile();
  };

  const handleUpload = async () => {
    if (!pendingFile) return;
    if (!fileName.trim()) {
      showFeedback('warning', 'Required', 'Please enter a document name.');
      return;
    }

    try {
      setLoading(true);

      const formData = new FormData();
      formData.append('file', {
        uri: pendingFile.uri,
        name: pendingFile.fileName || 'file.pdf',
        type: pendingFile.type || 'application/pdf',
      } as any);

      const fileUrlResponse = await employeeService.uploadFile(formData);
      const fileUrl = fileUrlResponse?.url || fileUrlResponse?.fileUrl || fileUrlResponse;

      await employeeService.addDocument(employeeId, {
        fileName,
        fileUrl,
        documentType,
      });

      setModalVisible(false);
      onClearPendingFile();
      onRefresh();
      showFeedback('success', 'Document Uploaded', 'Your document was uploaded successfully.');
    } catch (error) {
      console.error('Upload Error:', error);
      showFeedback('error', 'Error', 'Failed to upload document.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDocument = (docId: string | number) => {
    setConfirmDelete({ visible: true, docId });
  };

  const performDeleteDocument = async () => {
    const docId = confirmDelete.docId;
    setConfirmDelete({ visible: false, docId: null });
    if (docId == null) return;
    try {
      setLoading(true);
      await employeeService.deleteDocument(Number(employeeId), Number(docId));
      onRefresh();
    } catch (error) {
      console.error(error);
      showFeedback('error', 'Error', 'Failed to delete document.');
    } finally {
      setLoading(false);
    }
  };

  const handleViewDocument = (url: string) => {
    if (url) {
      Linking.openURL(url).catch(() => {
        showFeedback('error', 'Error', 'Cannot open this document link.');
      });
    }
  };

  const timeAgo = (dateStr: string) => {
    if (!dateStr) return '';
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 30) return `${diffDays} days ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  const getDocColor = (type: string) => {
    if (type?.includes('PAN') || type?.includes('Aadhaar') || type?.includes('Passport')) {
      return { bg: '#EFF6FF', text: '#2563EB', icon: FileCheck };
    }
    if (type?.includes('Certificate') || type?.includes('Letter')) {
      return { bg: '#FAF5FF', text: '#9333EA', icon: FileText };
    }
    if (type?.includes('Payslip') || type?.includes('Tax')) {
      return { bg: '#F0FDF4', text: '#16A34A', icon: FileCode };
    }
    return { bg: '#FFF7ED', text: '#EA580C', icon: FileText };
  };

  return (
    <View style={styles.container}>
      {/* Main Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.headerLeft}>
            <View style={[styles.iconBox, { backgroundColor: '#EFF6FF' }]}>
              <FolderOpen size={18} color="#2563EB" />
            </View>
            <View style={styles.headerTitles}>
              <Text style={styles.cardTitle}>OFFICIAL DOCUMENTS</Text>
              <Text style={styles.cardSubtitle}>Government IDs, proof of address, and tax records</Text>
            </View>
          </View>
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.addBtn}
            onPress={onUploadPress}
            disabled={loading}
          >
            <Upload size={15} color="#FFFFFF" strokeWidth={2.5} />
            <Text style={styles.addBtnText}>Upload</Text>
          </TouchableOpacity>
        </View>

        {/* Documents List */}
        {documents.length === 0 ? (
          <View style={styles.emptyContainer}>
            <FolderOpen size={44} color="#CBD5E1" />
            <Text style={styles.emptyTitle}>No documents uploaded yet</Text>
            <Text style={styles.emptySubtitle}>Upload ID proofs, certificates, or tax files for your record</Text>
          </View>
        ) : (
          <View style={styles.documentsList}>
            {documents.map((item: any, index: number) => {
              const docStyle = getDocColor(item.documentType);
              const DocIcon = docStyle.icon;
              return (
                <View key={item.id?.toString() || index.toString()} style={styles.docItem}>
                  <View style={[styles.docIconWrap, { backgroundColor: docStyle.bg }]}>
                    <DocIcon size={20} color={docStyle.text} />
                  </View>

                  <View style={styles.docInfo}>
                    <View style={styles.docTopRow}>
                      <Text style={styles.docName} numberOfLines={1}>{item.fileName || 'Document'}</Text>
                    </View>
                    <View style={styles.docMetaRow}>
                      <View style={[styles.typeBadge, { backgroundColor: docStyle.bg }]}>
                        <Text style={[styles.typeBadgeText, { color: docStyle.text }]}>
                          {item.documentType || 'Other'}
                        </Text>
                      </View>
                      <Text style={styles.dateText}>
                        • {timeAgo(item.uploadDate || item.createdAt)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.actionButtons}>
                    {item.fileUrl && (
                      <TouchableOpacity
                        activeOpacity={0.7}
                        style={styles.viewBtn}
                        onPress={() => handleViewDocument(item.fileUrl)}
                      >
                        <Eye size={15} color="#2563EB" />
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      activeOpacity={0.7}
                      style={styles.deleteBtn}
                      onPress={() => handleDeleteDocument(item.id)}
                      disabled={loading}
                    >
                      <Trash2 size={15} color="#DC2626" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Upload Confirmation Modal */}
      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <TouchableOpacity 
            style={styles.modalDismissArea} 
            activeOpacity={1} 
            onPress={handleCancelUpload} 
          />
          <View style={styles.modalContent}>
            <View style={styles.modalDragHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Upload Document</Text>
              <TouchableOpacity style={styles.closeBtn} onPress={handleCancelUpload}>
                <X size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {pendingFile && (
                <View style={styles.fileSelectedBox}>
                  <Paperclip size={16} color="#E25E3E" />
                  <Text style={styles.fileSelectedName} numberOfLines={1}>
                    {pendingFile.fileName}
                  </Text>
                </View>
              )}

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Document Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. PAN Card Front"
                  placeholderTextColor="#94A3B8"
                  value={fileName}
                  onChangeText={setFileName}
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Document Type</Text>
                <View style={styles.typesGrid}>
                  {DOCUMENT_TYPES.map((type) => {
                    const active = documentType === type;
                    return (
                      <TouchableOpacity
                        key={type}
                        style={[styles.typeChip, active && styles.typeChipActive]}
                        onPress={() => setDocumentType(type)}
                      >
                        <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>
                          {type}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <TouchableOpacity 
                activeOpacity={0.8}
                style={[styles.submitBtn, loading && styles.submitBtnDisabled]} 
                onPress={handleUpload}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.submitBtnText}>Confirm & Upload</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Delete confirmation */}
      <FeedbackModal
        visible={confirmDelete.visible}
        type="warning"
        title="Remove Document"
        message="Are you sure you want to delete this uploaded document?"
        showCancel
        confirmText="Delete"
        onClose={() => setConfirmDelete({ visible: false, docId: null })}
        onConfirm={performDeleteDocument}
      />

      {/* Success / error feedback */}
      <FeedbackModal
        visible={feedback.visible}
        type={feedback.type}
        title={feedback.title}
        message={feedback.message}
        onClose={() => setFeedback((prev) => ({ ...prev, visible: false }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitles: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.4,
  },
  cardSubtitle: {
    fontSize: 11,
    fontWeight: '500',
    color: '#94A3B8',
    marginTop: 2,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#E25E3E',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  addBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  emptyContainer: {
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
    marginTop: 10,
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 3,
  },
  documentsList: {
    gap: 10,
  },
  docItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  docIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  docInfo: {
    flex: 1,
  },
  docTopRow: {
    marginBottom: 4,
  },
  docName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  docMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  typeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  dateText: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 6,
    marginLeft: 8,
  },
  viewBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  modalDismissArea: {
    flex: 1,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '85%',
    paddingBottom: 24,
  },
  modalDragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
    alignSelf: 'center',
    marginTop: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBody: {
    padding: 20,
  },
  fileSelectedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  fileSelectedName: {
    flex: 1,
    fontSize: 13,
    color: '#EA580C',
    fontWeight: '700',
  },
  inputContainer: {
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: '#0F172A',
  },
  typesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  typeChipActive: {
    backgroundColor: '#FFF7ED',
    borderColor: '#EA580C',
  },
  typeChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  typeChipTextActive: {
    color: '#EA580C',
    fontWeight: '800',
  },
  submitBtn: {
    backgroundColor: '#E25E3E',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 20,
    shadowColor: '#E25E3E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
});
