import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, RefreshControl, TouchableOpacity, Text, Platform, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';
import { employeeService } from '../../api/employeeService';
import { PulseSkeleton } from '../../components/SharedUI';
import { Check, Briefcase, GraduationCap, User, PhoneCall, Files, Sparkles } from 'lucide-react-native';

import ProfileHeader from './components/ProfileHeader';
import MediaPickerModal from './components/MediaPickerModal';
import FeedbackModal, { ModalType } from '../../components/FeedbackModal';

import WorkTab from './tabs/WorkTab';
import ResumeSkillsTab from './tabs/ResumeSkillsTab';
import PersonalTab from './tabs/PersonalTab';
import ContactsTab from './tabs/ContactsTab';
import DocumentsTab from './tabs/DocumentsTab';

const TAB_CONFIG = [
  { id: 'Work', label: 'Work', icon: Briefcase },
  { id: 'Resume', label: 'Resume', icon: GraduationCap },
  { id: 'Personal', label: 'Personal', icon: User },
  { id: 'Contacts', label: 'Contacts', icon: PhoneCall },
  { id: 'Documents', label: 'Documents', icon: Files },
];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((state) => state.user);
  
  const {
    profileData,
    profileVersion,
    isLoading,
    isSaving,
    activeTab,
    setActiveTab,
    fetchProfile,
    saveProfile,
    fetchMasterData,
    employees,
    departments,
    designations,
    branches
  } = useProfileStore();

  const [formData, setFormData] = useState<any>({});
  const [avatarPickerVisible, setAvatarPickerVisible] = useState(false);
  const [docPickerVisible, setDocPickerVisible] = useState(false);
  const [pendingDocFile, setPendingDocFile] = useState<{ uri: string; fileName: string; type: string } | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [feedback, setFeedback] = useState<{ visible: boolean; type: ModalType; title: string; message: string }>({
    visible: false,
    type: 'success',
    title: '',
    message: '',
  });

  const empId = user?.employeeId || user?.id;

  // Fetch on mount (master data) and on every tab focus (profile stays fresh with CRM edits)
  useEffect(() => {
    fetchMasterData();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (empId) {
        fetchProfile(empId);
      }
    }, [empId])
  );

  useEffect(() => {
    if (profileData) {
      setFormData(profileData);
      
      const tabIds = TAB_CONFIG.map(t => t.id);
      if (!activeTab || !tabIds.includes(activeTab)) {
        setActiveTab('Work');
      }
    }
  }, [profileData]);

  const onRefresh = () => {
    if (empId) {
      fetchProfile(empId);
    }
  };

  const handleFormChange = (updates: any) => {
    setFormData((prev: any) => ({ ...prev, ...updates }));
  };

  const handleAvatarSelect = async (asset: any) => {
    setAvatarPickerVisible(false);
    if (!empId) return;
    setAvatarUploading(true);
    try {
      const data = new FormData();
      data.append('file', {
        uri: asset.uri,
        name: asset.fileName || 'avatar.jpg',
        type: asset.type || 'image/jpeg',
      } as any);

      const response = await employeeService.uploadFile(data);
      const url = response?.fileUrl || response?.url || response?.data?.fileUrl || response?.data?.url || response?.data;
      if (url && typeof url === 'string') {
        // Immediately persist to DB so CRM reflects the change without a separate Save tap
        await employeeService.updateProfile(empId as number, { ...formData, avatarUrl: url });
        handleFormChange({ avatarUrl: url });
        await fetchProfile(empId);
      }
    } catch (err) {
      setFeedback({
        visible: true,
        type: 'error',
        title: 'Upload Failed',
        message: 'Could not update profile photo. Please try again.',
      });
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleDocumentSelected = (asset: { uri: string; fileName: string; type: string }) => {
    setDocPickerVisible(false);
    setPendingDocFile(asset);
  };

  const handleSave = async () => {
    if (!empId) return;
    try {
      await saveProfile(empId as number, formData);
      setFeedback({
        visible: true,
        type: 'success',
        title: 'Profile Saved',
        message: 'Your profile has been updated successfully.',
      });
    } catch {
      setFeedback({
        visible: true,
        type: 'error',
        title: 'Save Failed',
        message: 'Could not save your profile. Please try again.',
      });
    }
  };

  if (isLoading && !profileData) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={{ padding: 16 }}>
          <PulseSkeleton style={{ height: 160, width: '100%', borderRadius: 24, marginBottom: 16 }} />
          <PulseSkeleton style={{ height: 48, width: '100%', borderRadius: 16, marginBottom: 20 }} />
          <PulseSkeleton style={{ height: 120, width: '100%', borderRadius: 20, marginBottom: 16 }} />
          <PulseSkeleton style={{ height: 120, width: '100%', borderRadius: 20, marginBottom: 16 }} />
        </View>
      </View>
    );
  }

  const masterData = { employees, departments, designations, branches };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Sleek Top Navigation Bar */}
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <Text style={styles.topBarTitle}>My Profile</Text>
          <Text style={styles.topBarSubtitle}>View and manage employee details</Text>
        </View>

        <TouchableOpacity 
          activeOpacity={0.8}
          style={[styles.saveBtn, isSaving && styles.saveBtnLoading]} 
          onPress={handleSave} 
          disabled={isSaving}
        >
          <Check color="#FFFFFF" size={16} strokeWidth={3} />
          <Text style={styles.saveBtnText}>
            {isSaving ? 'Saving...' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl 
            refreshing={isLoading} 
            onRefresh={onRefresh} 
            tintColor="#E25E3E" 
            colors={['#E25E3E']} 
          />
        }
      >
        {/* Profile Header Hero */}
        {profileData && (
          <ProfileHeader 
            profileData={formData} 
            onAvatarPress={() => setAvatarPickerVisible(true)} 
          />
        )}

        {/* Modern Segmented Tab Bar */}
        <View style={styles.tabsWrapper}>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false} 
            contentContainerStyle={styles.tabsContent}
          >
            {TAB_CONFIG.map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <TouchableOpacity
                  key={tab.id}
                  activeOpacity={0.8}
                  style={[styles.tabChip, isActive && styles.tabChipActive]}
                  onPress={() => setActiveTab(tab.id)}
                >
                  <Icon 
                    size={16} 
                    color={isActive ? '#FFFFFF' : '#64748B'} 
                    strokeWidth={isActive ? 2.5 : 2} 
                  />
                  <Text style={[styles.tabChipText, isActive && styles.tabChipTextActive]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Tab Body Content */}
        <View style={styles.tabBody}>
          {activeTab === 'Work' && (
            <WorkTab profileData={formData} onFormChange={handleFormChange} masterData={masterData} refreshVersion={profileVersion} />
          )}
          {activeTab === 'Resume' && (
            <ResumeSkillsTab
              profileData={formData}
              onFormChange={handleFormChange}
              isOwner={true}
              onUploadAttachment={() => {}}
              refreshVersion={profileVersion}
            />
          )}
          {activeTab === 'Personal' && (
            <PersonalTab profileData={formData} onFormChange={handleFormChange} isOwner={true} refreshVersion={profileVersion} />
          )}
          {activeTab === 'Contacts' && (
            <ContactsTab profileData={profileData} onRefresh={onRefresh} />
          )}
          {activeTab === 'Documents' && (
            <DocumentsTab
              profileData={profileData}
              onRefresh={onRefresh}
              onUploadPress={() => setDocPickerVisible(true)}
              pendingFile={pendingDocFile}
              onClearPendingFile={() => setPendingDocFile(null)}
            />
          )}
        </View>
      </ScrollView>

      {/* Avatar picker */}
      <MediaPickerModal
        visible={avatarPickerVisible}
        onClose={() => setAvatarPickerVisible(false)}
        onMediaSelected={handleAvatarSelect}
        title="Update Profile Picture"
      />

      {/* Document picker — camera + gallery + file */}
      <MediaPickerModal
        visible={docPickerVisible}
        onClose={() => setDocPickerVisible(false)}
        onMediaSelected={handleDocumentSelected}
        title="Upload Document"
        allowFiles={true}
        maxSizeMB={20}
      />

      {/* Avatar upload overlay */}
      {avatarUploading && (
        <View style={styles.uploadingOverlay}>
          <View style={styles.uploadingBox}>
            <ActivityIndicator size="large" color="#E25E3E" />
            <Text style={styles.uploadingText}>Updating photo...</Text>
          </View>
        </View>
      )}

      {/* Custom success / error feedback */}
      <FeedbackModal
        visible={feedback.visible}
        type={feedback.type}
        title={feedback.title}
        message={feedback.message}
        onClose={() => setFeedback((prev) => ({ ...prev, visible: false }))}
      />
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  topBarLeft: {
    flex: 1,
  },
  topBarTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.4,
  },
  topBarSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94A3B8',
    marginTop: 2,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E25E3E',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 12,
    shadowColor: '#E25E3E',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  saveBtnLoading: {
    opacity: 0.7,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  scrollView: {
    flex: 1,
  },
  tabsWrapper: {
    backgroundColor: '#F8FAFC',
    paddingVertical: 10,
  },
  tabsContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  tabChipActive: {
    backgroundColor: '#E25E3E',
    borderColor: '#E25E3E',
    shadowColor: '#E25E3E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  tabChipText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '700',
  },
  tabChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  tabBody: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  uploadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  uploadingBox: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 22,
    paddingHorizontal: 32,
    borderRadius: 16,
    alignItems: 'center',
    gap: 12,
  },
  uploadingText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
});
