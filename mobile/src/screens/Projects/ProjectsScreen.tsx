import React, { useEffect, useState, useMemo } from 'react';
import { 
  View, Text, StyleSheet, ScrollView, TouchableOpacity, 
  TextInput, ActivityIndicator, RefreshControl, Dimensions, Animated 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { 
  Search, Star, Clock, Archive, User, Plus, Sparkles, 
  ChevronRight, Kanban, Activity, LayoutGrid 
} from 'lucide-react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { useProjectStore } from '../../store/projectStore';
import FeedbackModal, { ModalType } from '../../components/FeedbackModal';
import { GradientBanner, PulseSkeleton } from '../../components/SharedUI';

const { width } = Dimensions.get('window');
const HORIZONTAL_CARD_WIDTH = (width - 48) / 2; // 2 column width for horizontal scroll
const VERTICAL_CARD_WIDTH = '100%'; // 1 column list

// Shared components imported above

export default function ProjectsScreen() {
  const navigation = useNavigation<any>();
  const { projects, archivedProjects, isLoading, fetchProjects, toggleStar, archiveProject, unarchiveProject } = useProjectStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'starred' | 'recent' | 'archived'>('all');
  const [recentlyViewedIds, setRecentlyViewedIds] = useState<number[]>([9, 8, 60]); // Initial recent tracking

  const [modalVisible, setModalVisible] = useState(false);
  const [modalConfig, setModalConfig] = useState<{
    title: string;
    message: string;
    type: ModalType;
    onConfirm?: () => void;
    confirmText?: string;
    showCancel?: boolean;
  }>({ title: '', message: '', type: 'error' });

  const showModal = (title: string, message: string, type: ModalType = 'error', onConfirm?: () => void, confirmText?: string, showCancel = false) => {
    setModalConfig({ title, message, type, onConfirm, confirmText, showCancel });
    setModalVisible(true);
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleToggleStar = async (projectId: number, e?: any) => {
    e?.stopPropagation?.();
    await toggleStar(projectId);
  };

  const handleArchive = async (project: any, e?: any) => {
    e?.stopPropagation?.();
    if (project.status === 'ARCHIVED') {
      try {
        await unarchiveProject(project.id);
        showModal('Project Restored', `${project.name} has been unarchived.`, 'success');
      } catch (err: any) {
        showModal('Error', 'Failed to unarchive project.', 'error');
      }
    } else {
      try {
        await archiveProject(project.id);
        showModal('Project Archived', `${project.name} has been archived.`, 'success');
      } catch (err: any) {
        const status = err.response?.status;
        const msg = err.response?.data?.message || 'Failed to archive project.';
        if (status === 409) {
          showModal(
            'Active Tasks Remaining',
            `${msg} Do you want to force archive this project anyway?`,
            'warning',
            async () => {
              try {
                await archiveProject(project.id, true);
                setModalVisible(false);
                showModal('Project Archived', `${project.name} has been forcefully archived.`, 'success');
              } catch (forceErr) {
                showModal('Error', 'Failed to forcefully archive project.', 'error');
              }
            },
            'Force Archive',
            true
          );
        } else {
          showModal('Error', msg, 'error');
        }
      }
    }
  };

  const handleProjectPress = (project: any) => {
    // Add to recently viewed if not already first
    setRecentlyViewedIds(prev => [project.id, ...prev.filter(id => id !== project.id)].slice(0, 4));
    navigation.navigate('ProjectDetail', { projectId: project.id, projectName: project.name });
  };

  // Filtered lists
  const filteredProjects = useMemo(() => {
    const sourceList = activeTab === 'archived' ? archivedProjects : projects;
    
    return sourceList.filter((p: any) => {
      const matchesSearch = p.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            p.key?.toLowerCase().includes(searchQuery.toLowerCase());
                            
      if (!matchesSearch) return false;
                            
      if (activeTab === 'starred') {
        return p.members && p.members.length > 0 && p.members[0].isStarred;
      }
      if (activeTab === 'recent') {
        return recentlyViewedIds.includes(p.id);
      }
      return true;
    });
  }, [projects, archivedProjects, searchQuery, activeTab, recentlyViewedIds]);

  const starredProjects = useMemo(() => {
    return projects.filter((p: any) => p.members && p.members.length > 0 && p.members[0].isStarred);
  }, [projects]);

  const recentlyViewedProjects = useMemo(() => {
    return projects.filter((p: any) => recentlyViewedIds.includes(p.id));
  }, [projects, recentlyViewedIds]);

  const renderCard = (p: any, index: number, isHorizontal: boolean = false) => {
    const isStarred = p.members && p.members.length > 0 && p.members[0].isStarred;
    const issueCount = p._count?.issues ?? 0;

    return (
      <TouchableOpacity
        key={p.id}
        style={[styles.boardCard, { width: isHorizontal ? HORIZONTAL_CARD_WIDTH : VERTICAL_CARD_WIDTH }]}
        onPress={() => handleProjectPress(p)}
        activeOpacity={0.8}
      >
        <GradientBanner colorStr={p.color} index={index} style={styles.cardBanner}>
          <View style={styles.bannerActions}>
            <TouchableOpacity 
              style={styles.actionBtn} 
              onPress={(e) => handleArchive(p, e)}
              activeOpacity={0.7}
            >
              <Archive size={14} color="#FFFFFF" />
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.actionBtn} 
              onPress={(e) => handleToggleStar(p.id, e)}
              activeOpacity={0.7}
            >
              <Star 
                size={14} 
                color={isStarred ? "#EAB308" : "#FFFFFF"} 
                fill={isStarred ? "#EAB308" : "none"} 
              />
            </TouchableOpacity>
          </View>
        </GradientBanner>

        <View style={styles.cardFooter}>
          <View style={styles.titleMeta}>
            <Text style={styles.boardTitle} numberOfLines={1}>{p.name}</Text>
            {p.key && (
              <View style={styles.keyBadge}>
                <Text style={styles.keyText}>{p.key}</Text>
              </View>
            )}
          </View>
          {issueCount > 0 && (
            <View style={styles.taskBadge}>
              <Text style={styles.taskBadgeText}>{issueCount} tasks</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Control Bar */}
      <View style={styles.controlBar}>
        {/* Search Bar */}
        <View style={styles.searchBox}>
          <Search size={18} color="#94A3B8" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search boards..."
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {/* Filter Pills Scroll */}
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          contentContainerStyle={styles.filterTabs}
        >
          <TouchableOpacity
            style={[styles.tabPill, activeTab === 'all' && styles.tabPillActive]}
            onPress={() => setActiveTab('all')}
          >
            <Text style={[styles.tabPillText, activeTab === 'all' && styles.tabPillTextActive]}>
              All Boards
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabPill, activeTab === 'starred' && styles.tabPillActive]}
            onPress={() => setActiveTab('starred')}
          >
            <Star size={14} color={activeTab === 'starred' ? '#0F172A' : '#64748B'} style={styles.pillIcon} />
            <Text style={[styles.tabPillText, activeTab === 'starred' && styles.tabPillTextActive]}>
              Starred ({starredProjects.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabPill, activeTab === 'recent' && styles.tabPillActive]}
            onPress={() => setActiveTab('recent')}
          >
            <Clock size={14} color={activeTab === 'recent' ? '#0F172A' : '#64748B'} style={styles.pillIcon} />
            <Text style={[styles.tabPillText, activeTab === 'recent' && styles.tabPillTextActive]}>
              Recent
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabPill, activeTab === 'archived' && styles.tabPillActive]}
            onPress={() => setActiveTab('archived')}
          >
            <Archive size={14} color={activeTab === 'archived' ? '#0F172A' : '#64748B'} style={styles.pillIcon} />
            <Text style={[styles.tabPillText, activeTab === 'archived' && styles.tabPillTextActive]}>
              Archived
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Main Scroll Content */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={fetchProjects} colors={['#3B82F6']} />
        }
      >
        {/* ⭐ STARRED BOARDS SECTION */}
        {(activeTab === 'all' || activeTab === 'starred') && starredProjects.length > 0 && (
          <View style={styles.sectionContainer}>
            <View style={styles.sectionHeader}>
              <Star size={18} color="#EAB308" fill="#EAB308" />
              <Text style={styles.sectionTitle}>Starred boards</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalGrid}>
              {starredProjects.map((p, i) => renderCard(p, i, true))}
            </ScrollView>
          </View>
        )}

        {/* 🕒 RECENTLY VIEWED SECTION */}
        {(activeTab === 'all' || activeTab === 'recent') && recentlyViewedProjects.length > 0 && (
          <View style={styles.sectionContainer}>
            <View style={styles.sectionHeader}>
              <Clock size={18} color="#64748B" />
              <Text style={styles.sectionTitle}>Recently viewed</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalGrid}>
              {recentlyViewedProjects.map((p, i) => renderCard(p, i, true))}
            </ScrollView>
          </View>
        )}

        {/* 👤 YOUR BOARDS SECTION */}
        {(activeTab === 'all' || activeTab === 'archived') && (
          <View style={styles.sectionContainer}>
            <View style={styles.sectionHeader}>
              <User size={18} color="#64748B" />
              <Text style={styles.sectionTitle}>
                {activeTab === 'archived' ? 'Archived boards' : 'Your boards'}
              </Text>
            </View>

            {/* Grid Layout */}
            <View style={styles.boardsGrid}>
              {isLoading && projects.length === 0 ? (
                [1, 2, 3, 4].map((key) => (
                  <View key={key} style={[styles.boardCard, { width: VERTICAL_CARD_WIDTH }]}>
                    <PulseSkeleton style={styles.cardBanner} />
                    <View style={styles.cardFooter}>
                      <PulseSkeleton style={{ width: '65%', height: 14, borderRadius: 4, marginBottom: 6 }} />
                      <PulseSkeleton style={{ width: '35%', height: 10, borderRadius: 4 }} />
                    </View>
                  </View>
                ))
              ) : (
                filteredProjects.map((p, i) => renderCard(p, i, false))
              )}
            </View>
          </View>
        )}

        {/* Empty State */}
        {!isLoading && filteredProjects.length === 0 && activeTab !== 'all' && (
          <View style={styles.emptyContainer}>
            <Kanban size={48} color="#CBD5E1" />
            <Text style={styles.emptyTitle}>No boards found</Text>
            <Text style={styles.emptySub}>No boards match your current filter.</Text>
          </View>
        )}
      </ScrollView>

      <FeedbackModal
        visible={modalVisible}
        title={modalConfig.title}
        message={modalConfig.message}
        type={modalConfig.type}
        onClose={() => setModalVisible(false)}
        onConfirm={modalConfig.onConfirm}
        confirmText={modalConfig.confirmText}
        showCancel={modalConfig.showCancel}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  controlBar: {
    backgroundColor: '#FFFFFF',
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    height: 42,
    marginBottom: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    paddingVertical: 0,
  },
  filterTabs: {
    paddingHorizontal: 16,
    gap: 8,
  },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  tabPillActive: {
    backgroundColor: '#E2E8F0',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  pillIcon: {
    marginRight: 6,
  },
  tabPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  tabPillTextActive: {
    color: '#0F172A',
  },

  /* Scroll Content */
  scrollContent: {
    paddingVertical: 16,
    paddingBottom: 100,
  },
  sectionContainer: {
    marginBottom: 24,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },

  /* Boards Grid */
  boardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  horizontalGrid: {
    gap: 12,
    paddingRight: 16,
  },
  boardCard: {
    height: 120,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardBanner: {
    height: 68,
    width: '100%',
    position: 'relative',
  },
  bannerActions: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    gap: 6,
  },
  actionBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardFooter: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  titleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  boardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    flexShrink: 1,
  },
  keyBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  keyText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
  },
  taskBadge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  taskBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
  },

  /* Action Cards */
  actionCard: {
    backgroundColor: '#F8FAFC',
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionCardContent: {
    alignItems: 'center',
    gap: 6,
  },
  actionCardText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },

  /* Empty state */
  emptyContainer: {
    paddingTop: 60,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 12,
  },
  emptySub: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
  },
});
