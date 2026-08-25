import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import { ChevronLeft, Globe, Kanban, List, GanttChart, Calendar, Paperclip, BarChart, Archive, Users, Lock } from 'lucide-react-native';
import { useProjectStore } from '../../store/projectStore';
import { launchImageLibrary } from 'react-native-image-picker';
import { projectService } from '../../api/projectService';
import { Alert } from 'react-native';
import BoardTab from './tabs/BoardTab';
import SummaryTab from './tabs/SummaryTab';
import ListTab from './tabs/ListTab';
import RoadmapTab from './tabs/RoadmapTab';
import CalendarTab from './tabs/CalendarTab';
import AttachmentsTab from './tabs/AttachmentsTab';
import ReportsTab from './tabs/ReportsTab';
import ArchivedTab from './tabs/ArchivedTab';
import FieldVisitsTab from './tabs/FieldVisitsTab';
import { GradientBanner, PulseSkeleton } from '../../components/SharedUI';

const TABS = [
  { id: 'summary',      label: 'Summary',  icon: Globe },
  { id: 'board',        label: 'Board',    icon: Kanban },
  { id: 'list',         label: 'List',     icon: List },
  { id: 'roadmap',      label: 'Roadmap',  icon: GanttChart },
  { id: 'calendar',     label: 'Calendar', icon: Calendar },
  { id: 'fieldvisits',  label: 'Visits',   icon: Users },
  { id: 'attachments',  label: 'Files',    icon: Paperclip },
  { id: 'reports',      label: 'Reports',  icon: BarChart },
  { id: 'archived',     label: 'Archived', icon: Archive },
];

function TabContent({ activeTab, projectId }: { activeTab: string; projectId: number }) {
  switch (activeTab) {
    case 'summary':     return <SummaryTab />;
    case 'board':       return <BoardTab />;
    case 'list':        return <ListTab />;
    case 'roadmap':     return <RoadmapTab />;
    case 'calendar':    return <CalendarTab />;
    case 'fieldvisits': return <FieldVisitsTab projectId={projectId} />;
    case 'attachments': return <AttachmentsTab />;
    case 'reports':     return <ReportsTab />;
    case 'archived':    return <ArchivedTab />;
    default:            return null;
  }
}

function AccessDeniedView({ onBack }: { onBack: () => void }) {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.accessDeniedSafeArea}>
      <View style={styles.accessDeniedContainer}>
        <View style={styles.accessDeniedCard}>
          <View style={styles.accessDeniedIconWrap}>
            <Lock size={28} color="#E25E3E" />
          </View>
          <Text style={styles.accessDeniedTitle}>Access Denied</Text>
          <Text style={styles.accessDeniedMessage}>
            You don't have access to this project. Ask a project manager or admin to add you as a member.
          </Text>
          <TouchableOpacity style={styles.accessDeniedBtn} onPress={onBack}>
            <Text style={styles.accessDeniedBtnText}>Back to Projects</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function ProjectDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { projectId, projectName } = route.params || {};
  const { fetchProjectDetails, isLoading, currentProject, currentIssues, accessDenied } = useProjectStore();

  const [activeTab, setActiveTab] = useState('board');
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (projectId) {
      fetchProjectDetails(projectId);
    }
  }, [projectId]);

  const archivedCount = currentIssues.filter(i => i.isArchived).length;

  const handleUpload = async () => {
    if (isUploading) return;
    const result = await launchImageLibrary({ mediaType: 'mixed', selectionLimit: 1 });
    if (result.didCancel || !result.assets || result.assets.length === 0) return;
    
    try {
      setIsUploading(true);
      const asset = result.assets[0];
      const formData = new FormData();
      formData.append('file', {
        uri: asset.uri,
        type: asset.type || 'image/jpeg',
        name: asset.fileName || 'upload.jpg',
      } as any);
      
      await projectService.uploadProjectDocument(projectId, formData);
      Alert.alert('Success', 'File uploaded successfully');
      await fetchProjectDetails(projectId);
      setActiveTab('attachments'); // Switch to Files tab
    } catch (err: any) {
      Alert.alert('Error', err.message || 'File upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  if (accessDenied) {
    return <AccessDeniedView onBack={() => navigation.goBack()} />;
  }

  return (
    <GradientBanner colorStr={currentProject?.color} index={currentProject?.id || 1} style={styles.container}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        {/* Header */}
        <View style={styles.headerContent}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <ChevronLeft size={24} color="#0F172A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {projectName || currentProject?.name || 'Project'}
          </Text>
          <TouchableOpacity
            style={styles.teamBtn}
            onPress={() => navigation.navigate('TeamMembers', { projectId, projectName })}
          >
            <Users size={18} color="#0F172A" />
          </TouchableOpacity>
        </View>

        {/* Scrollable Tabs */}
        <View style={styles.tabsContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabsScroll}
          >
            {TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const showBadge = tab.id === 'archived' && archivedCount > 0;
              return (
                <TouchableOpacity
                  key={tab.id}
                  style={[styles.tabBtn, isActive && styles.tabBtnActive]}
                  onPress={() => setActiveTab(tab.id)}
                >
                  <Icon size={15} color={isActive ? '#FFFFFF' : '#64748B'} />
                  <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                    {tab.label}
                  </Text>
                  {showBadge && (
                    <View style={[styles.tabBadge, isActive && styles.tabBadgeActive]}>
                      <Text style={[styles.tabBadgeText, isActive && styles.tabBadgeTextActive]}>
                        {archivedCount}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Content Area */}
        <View style={styles.content}>
          {isLoading && !currentProject ? (
            <View style={styles.loadingContainer}>
              <PulseSkeleton style={{ width: '85%', height: 120, borderRadius: 16, marginBottom: 16 }} />
              <PulseSkeleton style={{ width: '85%', height: 120, borderRadius: 16, marginBottom: 16 }} />
              <PulseSkeleton style={{ width: '85%', height: 120, borderRadius: 16 }} />
            </View>
          ) : (
            <TabContent activeTab={activeTab} projectId={currentProject?.id ?? 0} />
          )}
        </View>
      </SafeAreaView>
    </GradientBanner>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    padding: 8,
    marginRight: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  teamBtn: {
    padding: 8,
    marginLeft: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  tabsContainer: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    zIndex: 10,
  },
  tabsScroll: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    gap: 5,
  },
  tabBtnActive: { backgroundColor: '#E25E3E' },
  tabLabel: { fontSize: 12, fontWeight: '600', color: '#64748B' },
  tabLabelActive: { color: '#FFFFFF' },
  tabBadge: {
    backgroundColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: 'center',
  },
  tabBadgeActive: { backgroundColor: 'rgba(255,255,255,0.3)' },
  tabBadgeText: { fontSize: 10, fontWeight: '700', color: '#475569' },
  tabBadgeTextActive: { color: '#FFFFFF' },
  content: { flex: 1, backgroundColor: '#F8FAFC' },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  accessDeniedSafeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  accessDeniedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  accessDeniedCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  accessDeniedIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFF1EC',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  accessDeniedTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
  },
  accessDeniedMessage: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  accessDeniedBtn: {
    backgroundColor: '#E25E3E',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  accessDeniedBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
