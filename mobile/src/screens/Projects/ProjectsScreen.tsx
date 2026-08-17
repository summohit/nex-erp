import React, { useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Briefcase, ChevronRight, Activity } from 'lucide-react-native';
import { useProjectStore } from '../../store/projectStore';

export default function ProjectsScreen() {
  const navigation = useNavigation<any>();
  const { projects, isLoading, fetchProjects } = useProjectStore();

  useEffect(() => {
    fetchProjects();
  }, []);

  const renderProjectItem = ({ item }: { item: any }) => (
    <TouchableOpacity 
      style={styles.projectCard}
      onPress={() => navigation.navigate('ProjectDetail', { projectId: item.id, projectName: item.name })}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View style={styles.titleRow}>
          <View style={styles.iconBox}>
            <Briefcase size={20} color="#E25E3E" />
          </View>
          <View>
            <Text style={styles.projectTitle}>{item.name}</Text>
            {item.key && <Text style={styles.projectKey}>{item.key}</Text>}
          </View>
        </View>
        <ChevronRight size={20} color="#CBD5E1" />
      </View>

      <View style={styles.statusRow}>
        <View style={[styles.statusBadge, { backgroundColor: item.status === 'ACTIVE' ? '#D1FAE5' : '#F1F5F9' }]}>
          <Text style={[styles.statusText, { color: item.status === 'ACTIVE' ? '#059669' : '#64748B' }]}>
            {item.status || 'ACTIVE'}
          </Text>
        </View>
        {item.description && (
          <Text style={styles.projectDesc} numberOfLines={1}>
            {item.description}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Projects</Text>
        <Text style={styles.headerSubtitle}>Manage your tasks and boards</Text>
      </View>

      {isLoading && projects.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#E25E3E" />
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderProjectItem}
          contentContainerStyle={styles.listContainer}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={fetchProjects} colors={['#E25E3E']} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Activity size={48} color="#CBD5E1" />
              <Text style={styles.emptyTitle}>No projects found</Text>
              <Text style={styles.emptySub}>You are not assigned to any projects yet.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContainer: {
    padding: 16,
    paddingBottom: 100, // Space for bottom tab
  },
  projectCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFF1EC',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  projectTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
  },
  projectKey: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
    fontWeight: '500',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginRight: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  projectDesc: {
    flex: 1,
    fontSize: 13,
    color: '#64748B',
  },
  emptyContainer: {
    paddingTop: 80,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1E293B',
    marginTop: 16,
  },
  emptySub: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 8,
  },
});
