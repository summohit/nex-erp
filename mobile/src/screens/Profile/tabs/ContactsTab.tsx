import React, { useState } from 'react';
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
import { Plus, Phone, Mail, Trash2, UserPlus, PhoneCall, X, ShieldAlert, HeartHandshake } from 'lucide-react-native';
import { employeeService } from '../../../api/employeeService';
import FeedbackModal, { ModalType } from '../../../components/FeedbackModal';

interface ContactsTabProps {
  profileData: any;
  onRefresh: () => void;
}

const RELATIONSHIPS = ['Spouse', 'Father', 'Mother', 'Sibling', 'Friend', 'Relative', 'Other'];

export default function ContactsTab({ profileData, onRefresh }: ContactsTabProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [relationship, setRelationship] = useState(RELATIONSHIPS[0]);

  const [feedback, setFeedback] = useState<{ visible: boolean; type: ModalType; title: string; message: string }>({
    visible: false,
    type: 'success',
    title: '',
    message: '',
  });
  const [confirmDelete, setConfirmDelete] = useState<{ visible: boolean; contactId: string | number | null }>({
    visible: false,
    contactId: null,
  });

  const showFeedback = (type: ModalType, title: string, message: string) =>
    setFeedback({ visible: true, type, title, message });

  const contacts = profileData?.emergencyContacts || [];
  const employeeId = profileData?.id;

  const resetForm = () => {
    setName('');
    setEmail('');
    setMobile('');
    setRelationship(RELATIONSHIPS[0]);
  };

  const handleAddContact = async () => {
    if (!name.trim() || !mobile.trim()) {
      showFeedback('warning', 'Required Fields', 'Please enter a name and phone number.');
      return;
    }

    const phoneRegex = /^[0-9+\s-]{7,15}$/;
    if (!phoneRegex.test(mobile)) {
      showFeedback('warning', 'Invalid Number', 'Please enter a valid phone number.');
      return;
    }

    try {
      setLoading(true);
      const contactData = { name, email, mobile, relationship };
      await employeeService.addContact(employeeId, contactData);
      setModalVisible(false);
      resetForm();
      onRefresh();
      showFeedback('success', 'Contact Added', 'Emergency contact saved successfully.');
    } catch (error) {
      console.error(error);
      showFeedback('error', 'Error', 'Failed to add emergency contact.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteContact = (contactId: string | number) => {
    setConfirmDelete({ visible: true, contactId });
  };

  const performDeleteContact = async () => {
    const contactId = confirmDelete.contactId;
    setConfirmDelete({ visible: false, contactId: null });
    if (contactId == null) return;
    try {
      setLoading(true);
      await employeeService.deleteContact(Number(employeeId), Number(contactId));
      onRefresh();
    } catch (error) {
      console.error(error);
      showFeedback('error', 'Error', 'Failed to delete contact.');
    } finally {
      setLoading(false);
    }
  };

  const handleCall = (phoneNumber: string) => {
    if (phoneNumber) {
      Linking.openURL(`tel:${phoneNumber}`).catch(() => {
        showFeedback('error', 'Error', 'Unable to initiate call on this device.');
      });
    }
  };

  const getInitials = (nameStr: string) => {
    if (!nameStr) return 'EC';
    return nameStr
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  return (
    <View style={styles.container}>
      {/* Card Header Section */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.headerLeft}>
            <View style={[styles.iconBox, { backgroundColor: '#FEF2F2' }]}>
              <ShieldAlert size={18} color="#DC2626" />
            </View>
            <View style={styles.headerTitles}>
              <Text style={styles.cardTitle}>EMERGENCY CONTACTS</Text>
              <Text style={styles.cardSubtitle}>Trusted individuals to contact in case of urgency</Text>
            </View>
          </View>
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.addBtn}
            onPress={() => {
              resetForm();
              setModalVisible(true);
            }}
            disabled={loading}
          >
            <Plus size={15} color="#FFFFFF" strokeWidth={2.5} />
            <Text style={styles.addBtnText}>Add</Text>
          </TouchableOpacity>
        </View>

        {/* Contacts List */}
        {contacts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <HeartHandshake size={44} color="#CBD5E1" />
            <Text style={styles.emptyTitle}>No emergency contacts listed</Text>
            <Text style={styles.emptySubtitle}>Add a spouse, parent, or trusted friend for safety</Text>
          </View>
        ) : (
          <View style={styles.contactsList}>
            {contacts.map((item: any, index: number) => (
              <View key={item.id?.toString() || index.toString()} style={styles.contactItem}>
                <View style={styles.contactAvatar}>
                  <Text style={styles.contactAvatarText}>{getInitials(item.name)}</Text>
                </View>

                <View style={styles.contactInfo}>
                  <View style={styles.contactTopRow}>
                    <Text style={styles.contactName} numberOfLines={1}>{item.name}</Text>
                    <View style={styles.relBadge}>
                      <Text style={styles.relBadgeText}>{item.relationship || 'Emergency'}</Text>
                    </View>
                  </View>

                  <View style={styles.contactDetailRow}>
                    <Phone size={13} color="#64748B" />
                    <Text style={styles.contactPhone}>{item.mobile}</Text>
                  </View>

                  {!!item.email && (
                    <View style={styles.contactDetailRow}>
                      <Mail size={13} color="#94A3B8" />
                      <Text style={styles.contactEmail}>{item.email}</Text>
                    </View>
                  )}
                </View>

                <View style={styles.actionButtons}>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={styles.callBtn}
                    onPress={() => handleCall(item.mobile)}
                  >
                    <PhoneCall size={15} color="#16A34A" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={styles.deleteBtn}
                    onPress={() => handleDeleteContact(item.id)}
                    disabled={loading}
                  >
                    <Trash2 size={15} color="#DC2626" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Add Contact Modal */}
      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <TouchableOpacity 
            style={styles.modalDismissArea} 
            activeOpacity={1} 
            onPress={() => setModalVisible(false)} 
          />
          <View style={styles.modalContent}>
            <View style={styles.modalDragHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Emergency Contact</Text>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setModalVisible(false)}>
                <X size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Full Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Jane Doe"
                  placeholderTextColor="#94A3B8"
                  value={name}
                  onChangeText={setName}
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Relationship</Text>
                <View style={styles.relChipRow}>
                  {RELATIONSHIPS.map((rel) => {
                    const active = relationship === rel;
                    return (
                      <TouchableOpacity
                        key={rel}
                        style={[styles.relChip, active && styles.relChipActive]}
                        onPress={() => setRelationship(rel)}
                      >
                        <Text style={[styles.relChipText, active && styles.relChipTextActive]}>
                          {rel}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Phone Number *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. +1 555 123 4567"
                  placeholderTextColor="#94A3B8"
                  value={mobile}
                  onChangeText={setMobile}
                  keyboardType="phone-pad"
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Email Address (Optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. contact@gmail.com"
                  placeholderTextColor="#94A3B8"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              <TouchableOpacity 
                activeOpacity={0.8}
                style={[styles.submitBtn, loading && styles.submitBtnDisabled]} 
                onPress={handleAddContact}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.submitBtnText}>Save Contact</Text>
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
        title="Remove Contact"
        message="Are you sure you want to remove this emergency contact?"
        showCancel
        confirmText="Remove"
        onClose={() => setConfirmDelete({ visible: false, contactId: null })}
        onConfirm={performDeleteContact}
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
  contactsList: {
    gap: 10,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  contactAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  contactAvatarText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#EA580C',
  },
  contactInfo: {
    flex: 1,
  },
  contactTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  contactName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    flexShrink: 1,
  },
  relBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  relBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#2563EB',
  },
  contactDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  contactPhone: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
  },
  contactEmail: {
    fontSize: 12,
    color: '#64748B',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 6,
    marginLeft: 8,
  },
  callBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#DCFCE7',
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
  relChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  relChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  relChipActive: {
    backgroundColor: '#FFF7ED',
    borderColor: '#EA580C',
  },
  relChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  relChipTextActive: {
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
