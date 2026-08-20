import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import { ChevronLeft, Globe, Kanban, List, GanttChart, Calendar, Paperclip, BarChart, Archive } from 'lucide-react-native';
import { useProjectStore } from '../../store/projectStore';
import BoardTab from './tabs/BoardTab';
import { GradientBanner, PulseSkeleton } from '../../components/SharedUI';

const TABS = [
  { id: 'summary', label: 'Summary', icon: Globe },
  { id: 'board', label: 'Board', icon: Kanban },
  { id: 'list', label: 'List', icon: List },
  { id: 'roadmap', label: 'Roadmap', icon: GanttChart },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'attachments', label: 'Files', icon: Paperclip },
  { id: 'reports', label: 'Reports', icon: BarChart },
  { id: 'archived', label: 'Archived', icon: Archive },
];

export default function ProjectDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { projectId, projectName } = route.params || {};
  const { fetchProjectDetails, isLoading, currentProject } = useProjectStore();

  const [activeTab, setActiveTab] = useState('board');

  useEffect(() => {
    if (projectId) {
      fetchProjectDetails(projectId);
    }
  }, [projectId]);

  return (
    <GradientBanner colorStr={currentProject?.color} index={currentProject?.id || 1} style={styles.container}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        {/* Header */}
        <View style={styles.headerContent}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <ChevronLeft size={24} color="#0F172A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{projectName || currentProject?.name || 'Project'}</Text>
        </View>

        {/* Scrollable Tabs */}
        <View style={styles.tabsContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsScroll}>
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.tabBtn, isActive && styles.tabBtnActive]}
                onPress={() => setActiveTab(tab.id)}
              >
                <Icon size={16} color={isActive ? '#FFFFFF' : '#64748B'} />
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Content Area */}
      <View style={styles.content}>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <PulseSkeleton style={{ width: '85%', height: 120, borderRadius: 16, marginBottom: 16 }} />
            <PulseSkeleton style={{ width: '85%', height: 120, borderRadius: 16, marginBottom: 16 }} />
            <PulseSkeleton style={{ width: '85%', height: 120, borderRadius: 16 }} />
          </View>
        ) : (
          <View style={styles.tabContent}>
            {activeTab === 'board' ? (
              <BoardTab />
            ) : (
              <Text style={styles.wipText}>{activeTab.toUpperCase()} TAB - COMING SOON</Text>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  </GradientBanner>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
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
    borderBottomColor: 'rgba(255,255,255,0.2)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    zIndex: 10,
  },
  tabsScroll: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
  },
  tabBtnActive: {
    backgroundColor: '#E25E3E',
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
    marginLeft: 6,
  },
  tabLabelActive: {
    color: '#FFFFFF',
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  wipText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#94A3B8',
  }
});
