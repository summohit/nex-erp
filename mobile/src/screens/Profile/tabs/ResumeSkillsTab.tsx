import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Modal, Linking } from 'react-native';
import { FileText, Award, Plus, X, Edit2, Trash2, Paperclip, Calendar, Building2, GraduationCap, CheckCircle2, UploadCloud , Upload} from 'lucide-react-native';
import DocumentPicker from 'react-native-document-picker';
import { Alert } from 'react-native';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import SkillsModal from '../components/SkillsModal';
import { employeeService } from '../../../api/employeeService';
import { ActivityIndicator } from 'react-native';

interface ResumeSkillsTabProps {
  profileData: any;
  isOwner: boolean;
  onUploadAttachment: () => void;
  /** Refetches the profile from the server — every mutation below calls this
   * afterward so the list on screen always reflects what's actually in the
   * database, on real ids, rather than a locally-held guess. */
  onRefresh: () => void;
}

export default function ResumeSkillsTab({ profileData, isOwner, onUploadAttachment, onRefresh }: ResumeSkillsTabProps) {
  const employeeId = profileData?.id;
  const resumeLines: any[] = profileData?.resumeLines || [];
  const skills: any[] = profileData?.skills || [];

  // Modal states
  const [isResumeModalVisible, setResumeModalVisible] = useState(false);
  const [isSkillsModalVisible, setSkillsModalVisible] = useState(false);
  const [editingSkillIndex, setEditingSkillIndex] = useState<number | null>(null);

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [currentResume, setCurrentResume] = useState<any>({});

  const [isDatePickerVisible, setDatePickerVisibility] = useState(false);

  const [dateField, setDateField] = useState('');
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [isSavingSkills, setIsSavingSkills] = useState(false);

  const openResumeModal = (index: number | null = null) => {
    if (!isOwner) return;
    setEditingIndex(index);
    if (index !== null && resumeLines[index]) {
      setCurrentResume({ ...resumeLines[index] });
    } else {
      setCurrentResume({ type: 'Experience' });
    }
    setResumeModalVisible(true);
  };

  const saveResumeLine = async () => {
    let finalResume = { ...currentResume };

    // Check if attachment is a new file (object with uri)
    if (finalResume.attachment && typeof finalResume.attachment === 'object' && finalResume.attachment.uri) {
      try {
        setIsUploadingAttachment(true);
        const fileData = new FormData();
        fileData.append('file', {
          uri: finalResume.attachment.uri,
          name: finalResume.attachment.fileName || finalResume.attachment.name || 'document.pdf',
          type: finalResume.attachment.type || 'application/pdf',
        } as any);

        const response = await employeeService.uploadResume(fileData);
        const url = response?.url || response?.fileUrl || response;
        if (url && typeof url === 'string') {
          finalResume.attachment = url;
        } else {
          Alert.alert('Upload Failed', 'Failed to retrieve the document URL.');
          setIsUploadingAttachment(false);
          return;
        }
      } catch (err) {
        Alert.alert('Upload Failed', 'An error occurred while uploading the document.');
        setIsUploadingAttachment(false);
        return;
      } finally {
        setIsUploadingAttachment(false);
      }
    }

    // finalResume.attachment is now one of: a freshly-uploaded URL string (the
    // upload block above just replaced the picked-file object with one), null
    // (the user tapped the X to explicitly remove it), or untouched/undefined
    // (no change — keep whatever attachmentUrl already came from the server).
    const attachmentUrl =
      finalResume.attachment === null
        ? null
        : typeof finalResume.attachment === 'string'
          ? finalResume.attachment
          : finalResume.attachmentUrl || undefined;

    const payload = {
      type: finalResume.type || 'Experience',
      title: finalResume.title,
      organization: finalResume.organization,
      startDate: finalResume.startDate,
      endDate: finalResume.endDate,
      description: finalResume.description,
      attachmentUrl,
    };

    try {
      setIsUploadingAttachment(true);
      if (editingIndex !== null && finalResume.id) {
        await employeeService.updateResumeLine(employeeId, finalResume.id, payload);
      } else {
        await employeeService.addResumeLine(employeeId, payload);
      }
      setResumeModalVisible(false);
      onRefresh();
    } catch (err) {
      Alert.alert('Save Failed', 'Could not save this entry. Please try again.');
    } finally {
      setIsUploadingAttachment(false);
    }
  };

  const deleteResumeLine = (index: number) => {
    const line = resumeLines[index];
    if (!line?.id) return;
    Alert.alert('Delete Entry', `Remove "${line.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await employeeService.deleteResumeLine(employeeId, line.id);
            onRefresh();
          } catch (err) {
            Alert.alert('Delete Failed', 'Could not remove this entry. Please try again.');
          }
        },
      },
    ]);
  };

  const openSkillEditor = (index: number) => {
    if (!isOwner) return;
    setEditingSkillIndex(index);
    setSkillsModalVisible(true);
  };

  const openSkillAdder = () => {
    setEditingSkillIndex(null);
    setSkillsModalVisible(true);
  };

  const removeSkill = (index: number) => {
    const skill = skills[index];
    if (!skill?.id) return;
    Alert.alert('Remove Skill', `Remove "${skill.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await employeeService.deleteSkill(employeeId, skill.id);
            onRefresh();
          } catch (err) {
            Alert.alert('Remove Failed', 'Could not remove this skill. Please try again.');
          }
        },
      },
    ]);
  };

  /**
   * SkillsModal is a batch editor — it can add several skills across
   * multiple categories in one "Save & New" session and always hands back
   * the full resulting list rather than a single item. Diff that list
   * against what's actually on the server (matched by category+name, since
   * the modal doesn't track ids) so each add/edit/remove becomes exactly one
   * API call — no full-list replace that could stomp a change made from CRM
   * in between.
   */
  const syncSkillsFromModal = async (nextSkills: { category: string; name: string; level: string }[]) => {
    const keyOf = (s: { category: string; name: string }) => `${s.category}::${s.name}`;
    const before = new Map(skills.map((s) => [keyOf(s), s]));
    const after = new Map(nextSkills.map((s) => [keyOf(s), s]));

    const toAdd = nextSkills.filter((s) => !before.has(keyOf(s)));
    const toRemove = skills.filter((s) => !after.has(keyOf(s)));
    const toUpdate = skills.filter((s) => {
      const match = after.get(keyOf(s));
      return match && match.level !== s.level;
    });

    setIsSavingSkills(true);
    try {
      await Promise.all([
        ...toAdd.map((s) => employeeService.addSkill(employeeId, s)),
        ...toRemove.map((s) => employeeService.deleteSkill(employeeId, s.id)),
        ...toUpdate.map((s) => employeeService.updateSkill(employeeId, s.id, { ...s, level: after.get(keyOf(s))!.level })),
      ]);
      onRefresh();
    } catch (err) {
      Alert.alert('Save Failed', 'Could not save your skills. Please try again.');
    } finally {
      setIsSavingSkills(false);
    }
  };

  const showDatePicker = (field: string) => {
    setDateField(field);
    setDatePickerVisibility(true);
  };

  const handleConfirmDate = (date: Date) => {
    setCurrentResume({ ...currentResume, [dateField]: date.toISOString().split('T')[0] });
    setDatePickerVisibility(false);
  };

  const getTypeStyle = (type: string) => {
    switch (type) {
      case 'Education':
        return { bg: '#FAF5FF', text: '#9333EA', icon: GraduationCap };
      case 'Certification':
        return { bg: '#FFFBEB', text: '#D97706', icon: Award };
      default:
        return { bg: '#EFF6FF', text: '#2563EB', icon: Building2 };
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false} contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
      
      {/* 1. Resume Timeline Section */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.headerLeft}>
            <View style={[styles.iconBox, { backgroundColor: '#FFF7ED' }]}>
              <FileText size={18} color="#EA580C" />
            </View>
            <View style={styles.headerTitles}>
              <Text style={styles.cardTitle}>EXPERIENCE & EDUCATION</Text>
              <Text style={styles.cardSubtitle}>Career history and academic qualifications</Text>
            </View>
          </View>
          {isOwner && (
            <TouchableOpacity activeOpacity={0.8} style={styles.addBtn} onPress={() => openResumeModal()}>
              <Plus size={15} color="#FFFFFF" strokeWidth={2.5} />
              <Text style={styles.addBtnText}>Add</Text>
            </TouchableOpacity>
          )}
        </View>

        {(!resumeLines || resumeLines.length === 0) ? (
          <View style={styles.emptyState}>
            <GraduationCap size={40} color="#CBD5E1" />
            <Text style={styles.emptyTitle}>No experience or education added</Text>
            <Text style={styles.emptySubtitle}>Tap "+ Add" to add work history or degrees</Text>
          </View>
        ) : (
          <View style={styles.timelineList}>
            {resumeLines.map((item: any, index: number) => {
              const typeConfig = getTypeStyle(item.type);
              const TypeIcon = typeConfig.icon;
              return (
                <View key={item.id || index} style={styles.timelineItem}>
                  <View style={styles.timelineCard}>
                    <View style={styles.timelineCardHeader}>
                      <View style={[styles.typePill, { backgroundColor: typeConfig.bg }]}>
                        <TypeIcon size={12} color={typeConfig.text} />
                        <Text style={[styles.typePillText, { color: typeConfig.text }]}>{item.type || 'Experience'}</Text>
                      </View>
                      
                      {isOwner && (
                        <View style={styles.actionRow}>
                          <TouchableOpacity 
                            style={styles.iconActionBtn} 
                            onPress={() => openResumeModal(index)}
                          >
                            <Edit2 size={14} color="#64748B" />
                          </TouchableOpacity>
                          <TouchableOpacity 
                            style={[styles.iconActionBtn, { backgroundColor: '#FEE2E2' }]} 
                            onPress={() => deleteResumeLine(index)}
                          >
                            <Trash2 size={14} color="#DC2626" />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>

                    <Text style={styles.entryTitle}>{item.title}</Text>
                    <Text style={styles.entryOrg}>{item.organization}</Text>

                    <View style={styles.dateRow}>
                      <Calendar size={13} color="#94A3B8" />
                      <Text style={styles.dateText}>
                        {item.startDate || 'Start'} — {item.endDate || 'Present'}
                      </Text>
                    </View>

                    {item.description ? (
                      <Text style={styles.entryDesc}>{item.description}</Text>
                    ) : null}

                    {item.attachmentUrl && (
                      <TouchableOpacity
                        style={styles.attachmentChip}
                        onPress={() => Linking.openURL(item.attachmentUrl).catch(() => {})}
                      >
                        <Paperclip size={13} color="#2563EB" />
                        <Text style={styles.attachmentChipText}>View Attachment</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* 2. Skills Section */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.headerLeft}>
            <View style={[styles.iconBox, { backgroundColor: '#FAF5FF' }]}>
              <Award size={18} color="#9333EA" />
            </View>
            <View style={styles.headerTitles}>
              <Text style={styles.cardTitle}>SKILLS & CERTIFICATIONS</Text>
              <Text style={styles.cardSubtitle}>Technical proficiencies, tools, and languages</Text>
            </View>
          </View>
          {isOwner && (
            <TouchableOpacity activeOpacity={0.8} style={styles.addBtn} onPress={openSkillAdder}>
              <Plus size={15} color="#FFFFFF" strokeWidth={2.5} />
              <Text style={styles.addBtnText}>Add</Text>
            </TouchableOpacity>
          )}
        </View>

        {(!skills || skills.length === 0) ? (
          <View style={styles.emptyState}>
            <Award size={40} color="#CBD5E1" />
            <Text style={styles.emptyTitle}>No skills added yet</Text>
            <Text style={styles.emptySubtitle}>Tap "+ Add" to showcase your core competencies</Text>
          </View>
        ) : (
          <View style={styles.skillsContainer}>
            {skills.map((skill: any, index: number) => {
              const isExpert = skill.level === 'Expert' || skill.level === 'C2';
              const isIntermediate = skill.level === 'Intermediate' || skill.level === 'B1' || skill.level === 'B2';
              return (
                <View key={skill.id || index} style={styles.skillBadge}>
                  <TouchableOpacity
                    activeOpacity={isOwner ? 0.7 : 1}
                    style={styles.skillBadgeContent}
                    onPress={() => openSkillEditor(index)}
                    disabled={!isOwner}
                  >
                    <Text style={styles.skillCategory}>{skill.category}:</Text>
                    <Text style={styles.skillName}>{skill.name}</Text>
                    <View style={[
                      styles.levelPill,
                      isExpert && styles.levelExpert,
                      isIntermediate && styles.levelIntermediate
                    ]}>
                      <Text style={styles.levelText}>{skill.level}</Text>
                    </View>
                  </TouchableOpacity>
                  {isOwner && (
                    <TouchableOpacity onPress={() => removeSkill(index)} style={styles.removeSkillBtn}>
                      <X size={12} color="#94A3B8" />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* --- Create/Edit Resume Line Modal --- */}
      <Modal visible={isResumeModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <TouchableOpacity 
            style={styles.modalDismissArea} 
            activeOpacity={1} 
            onPress={() => setResumeModalVisible(false)} 
          />
          <View style={styles.modalContent}>
            <View style={styles.modalDragHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingIndex !== null ? 'Edit Experience / Degree' : 'Add Experience / Degree'}
              </Text>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setResumeModalVisible(false)}>
                <X size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {/* Type selector */}
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Type</Text>
                <View style={styles.typeSelectorRow}>
                  {['Experience', 'Education', 'Certification'].map((type) => {
                    const active = (currentResume.type || 'Experience') === type;
                    return (
                      <TouchableOpacity
                        key={type}
                        style={[styles.typeOptionChip, active && styles.typeOptionChipActive]}
                        onPress={() => setCurrentResume({ ...currentResume, type })}
                      >
                        <Text style={[styles.typeOptionText, active && styles.typeOptionTextActive]}>
                          {type}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Title / Degree</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="e.g. Senior Frontend Engineer"
                  placeholderTextColor="#94A3B8"
                  value={currentResume.title || ''}
                  onChangeText={(v) => setCurrentResume({ ...currentResume, title: v })}
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Company / University</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="e.g. Google / Stanford University"
                  placeholderTextColor="#94A3B8"
                  value={currentResume.organization || ''}
                  onChangeText={(v) => setCurrentResume({ ...currentResume, organization: v })}
                />
              </View>

              {/* Dates Row */}
              <View style={styles.row}>
                <View style={[styles.inputContainer, { flex: 1, marginRight: 8 }]}>
                  <Text style={styles.label}>Start Date</Text>
                  <TouchableOpacity style={styles.datePickerInput} onPress={() => showDatePicker('startDate')}>
                    <Text style={styles.dateValue}>{currentResume.startDate || 'YYYY-MM-DD'}</Text>
                    <Calendar size={16} color="#94A3B8" />
                  </TouchableOpacity>
                </View>

                <View style={[styles.inputContainer, { flex: 1, marginLeft: 8 }]}>
                  <Text style={styles.label}>End Date</Text>
                  <TouchableOpacity style={styles.datePickerInput} onPress={() => showDatePicker('endDate')}>
                    <Text style={styles.dateValue}>{currentResume.endDate || 'Present'}</Text>
                    <Calendar size={16} color="#94A3B8" />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Attachment (PDF) <Text style={{ color: '#94A3B8', fontWeight: '400' }}>Optional</Text></Text>
                {(currentResume.attachment || currentResume.attachmentUrl) ? (
                   <View style={styles.fileSelectedBox}>
                     <Paperclip size={18} color="#2563EB" />
                     <Text style={styles.fileSelectedName} numberOfLines={1}>
                       {currentResume.attachment?.fileName || currentResume.attachmentUrl?.split('/').pop()}
                     </Text>
                     <TouchableOpacity style={{ padding: 4 }} onPress={() => setCurrentResume({ ...currentResume, attachment: null, attachmentUrl: null })}>
                       <X size={16} color="#DC2626" />
                     </TouchableOpacity>
                   </View>
                ) : (
                   <TouchableOpacity style={styles.uploadBox} onPress={async () => {
                       try {
                         const res = await DocumentPicker.pickSingle({
                           type: [DocumentPicker.types.pdf],
                         });
                         if (res.size && res.size > 10 * 1024 * 1024) {
                           Alert.alert('File too large', 'Please select a PDF smaller than 10MB.');
                           return;
                         }
                         setCurrentResume({ ...currentResume, attachment: { uri: res.uri, fileName: res.name || 'document.pdf', type: res.type || 'application/pdf', size: res.size } });
                       } catch (err) {
                         if (!DocumentPicker.isCancel(err)) {
                           Alert.alert('Error', 'Failed to pick document');
                         }
                       }
                     }}>
                     <Upload size={24} color="#64748B" />
                     <Text style={styles.uploadBoxTitle}>Click to upload PDF</Text>
                     <Text style={styles.uploadBoxSub}>PDF document up to 10MB</Text>
                   </TouchableOpacity>
                )}
                <Text style={styles.hintText}>Upload supporting documents such as experience certificates, marksheets, or letters.</Text>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Description</Text>
                <TextInput
                  style={styles.textArea}
                  placeholder="Describe your role, accomplishments, or honors..."
                  placeholderTextColor="#94A3B8"
                  multiline
                  numberOfLines={4}
                  value={currentResume.description || ''}
                  onChangeText={(v) => setCurrentResume({ ...currentResume, description: v })}
                />
              </View>

              <TouchableOpacity activeOpacity={0.8} style={styles.saveSubmitBtn} onPress={saveResumeLine} disabled={isUploadingAttachment}>
                {isUploadingAttachment ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.saveSubmitBtnText}>Save Entry</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Date Picker Modal */}
      <DateTimePickerModal
        isVisible={isDatePickerVisible}
        mode="date"
        onConfirm={handleConfirmDate}
        onCancel={() => setDatePickerVisibility(false)}
      />

      {/* Skills Picker Modal */}
      <SkillsModal
        visible={isSkillsModalVisible}
        onClose={() => {
          setSkillsModalVisible(false);
          setEditingSkillIndex(null);
        }}
        onSave={(nextSkills) => {
          syncSkillsFromModal(nextSkills);
          setEditingSkillIndex(null);
        }}
        existingSkills={skills}
        editingSkill={editingSkillIndex !== null ? skills[editingSkillIndex] : null}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  contentContainer: {
    paddingBottom: 40,
    gap: 14,
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
  emptyState: {
    paddingVertical: 24,
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
  timelineList: {
    gap: 12,
  },
  timelineItem: {
    borderLeftWidth: 2,
    borderLeftColor: '#E2E8F0',
    paddingLeft: 14,
    marginLeft: 6,
  },
  timelineCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  timelineCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  typePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  typePillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 6,
  },
  iconActionBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  entryTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 2,
  },
  entryOrg: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 6,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  dateText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  entryDesc: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    marginTop: 4,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  attachmentChipText: {
    fontSize: 12,
    color: '#2563EB',
    fontWeight: '600',
  },
  skillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  skillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 6,
  },
  skillBadgeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  skillCategory: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
  },
  skillName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  levelPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  levelExpert: {
    backgroundColor: '#DCFCE7',
  },
  levelIntermediate: {
    backgroundColor: '#FEF3C7',
  },
  levelText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  removeSkillBtn: {
    padding: 2,
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
  typeSelectorRow: {
    flexDirection: 'row',
    gap: 8,
  },
  typeOptionChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  typeOptionChipActive: {
    backgroundColor: '#FFF7ED',
    borderColor: '#EA580C',
  },
  typeOptionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  typeOptionTextActive: {
    color: '#EA580C',
    fontWeight: '800',
  },
  textInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: '#0F172A',
  },
  textArea: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: '#0F172A',
    minHeight: 100,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
  },
  datePickerInput: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  dateValue: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '500',
  },
  saveSubmitBtn: {
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
  uploadBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  uploadBoxTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 8,
  },
  uploadBoxSub: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 4,
  },
  fileSelectedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  fileSelectedName: {
    flex: 1,
    fontSize: 13,
    color: '#1D4ED8',
    fontWeight: '600',
  },
  hintText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 6,
  },
  saveSubmitBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
});
