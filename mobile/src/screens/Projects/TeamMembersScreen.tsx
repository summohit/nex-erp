import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import { ChevronLeft, Search, UserPlus, UserMinus, Crown, ShieldCheck, X } from 'lucide-react-native';
import { useProjectStore } from '../../store/projectStore';
import { projectService } from '../../api/projectService';
import { useProjectPermissions } from '../../hooks/useProjectPermissions';
import FeedbackModal, { ModalType } from '../../components/FeedbackModal';

function getRoleLabel(member: any, project: any): { label: string; color: string; Icon: any } {
  if (member.employeeId === project?.leadId) {
    return { label: 'Owner', color: '#E25E3E', Icon: Crown };
  }
  if (member.role === 'PROJECT_MANAGER') {
    return { label: 'PM', color: '#7C3AED', Icon: ShieldCheck };
  }
  return { label: 'Member', color: '#64748B', Icon: null };
}

export default function TeamMembersScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { projectId, projectName } = route.params || {};
  const { currentProject, addProjectMember, removeProjectMember } = useProjectStore();

  const [companyMembers, setCompanyMembers] = useState<any[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [busyEmployeeId, setBusyEmployeeId] = useState<number | null>(null);

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

  const perms = useProjectPermissions(currentProject, []);

  const members: any[] = currentProject?.members || [];

  useEffect(() => {
    if (perms.isOwner) {
      loadRoster();
    }
  }, [perms.isOwner]);

  const loadRoster = async () => {
    setLoadingRoster(true);
    try {
      const data = await projectService.getCompanyMembers();
      setCompanyMembers(data || []);
    } catch (error) {
      console.error('Failed to load company roster', error);
    } finally {
      setLoadingRoster(false);
    }
  };

  const invitableMembers = useMemo(() => {
    const existingIds = new Set(members.map((m: any) => m.employeeId));
    let list = companyMembers.filter((e: any) => !existingIds.has(e.id));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((e: any) =>
        `${e.firstName || ''} ${e.lastName || ''}`.toLowerCase().includes(q)
      );
    }
    return list;
  }, [companyMembers, members, searchQuery]);

  const handleAdd = async (employeeId: number) => {
    if (!projectId) return;
    setBusyEmployeeId(employeeId);
    try {
      await addProjectMember(projectId, employeeId, 'MEMBER');
    } catch (error: any) {
      showModal('Error', error?.response?.data?.message || 'Failed to add member.', 'error');
    } finally {
      setBusyEmployeeId(null);
    }
  };

  const handleRemove = (member: any) => {
    if (members.length <= 1) {
      showModal('Cannot Remove', 'A project must have at least one member.', 'warning');
      return;
    }
    const name = `${member.employee?.firstName || ''} ${member.employee?.lastName || ''}`.trim() || 'this member';
    showModal(
      'Remove Member',
      `Remove ${name} from this project?`,
      'warning',
      async () => {
        setModalVisible(false);
        setBusyEmployeeId(member.employeeId);
        try {
          await removeProjectMember(projectId, member.employeeId);
        } catch (error: any) {
          showModal('Error', error?.response?.data?.message || 'Failed to remove member.', 'error');
        } finally {
          setBusyEmployeeId(null);
        }
      },
      'Remove',
      true
    );
  };

  const renderMember = ({ item }: { item: any }) => {
    const { label, color, Icon } = getRoleLabel(item, currentProject);
    const emp = item.employee || {};
    const isBusy = busyEmployeeId === item.employeeId;
    const canRemove = perms.canManageMembers && members.length > 1;

    return (
      <View style={styles.memberRow}>
        {emp.avatarUrl ? (
          <Image source={{ uri: emp.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarInitial}>{(emp.firstName || '?').charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.memberInfo}>
          <Text style={styles.memberName} numberOfLines={1}>
            {emp.firstName} {emp.lastName}
          </Text>
          <View style={[styles.roleBadge, { backgroundColor: color + '18' }]}>
            {Icon && <Icon size={11} color={color} />}
            <Text style={[styles.roleBadgeText, { color }]}>{label}</Text>
          </View>
        </View>
        {canRemove && (
          <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemove(item)} disabled={isBusy}>
            {isBusy ? <ActivityIndicator size="small" color="#EF4444" /> : <UserMinus size={16} color="#EF4444" />}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderInvitable = ({ item }: { item: any }) => {
    const isBusy = busyEmployeeId === item.id;
    return (
      <TouchableOpacity style={styles.inviteRow} onPress={() => handleAdd(item.id)} disabled={isBusy}>
        {item.avatarUrl ? (
          <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarInitial}>{(item.firstName || '?').charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <Text style={styles.memberName} numberOfLines={1}>
          {item.firstName} {item.lastName}
        </Text>
        {isBusy ? (
          <ActivityIndicator size="small" color="#E25E3E" />
        ) : (
          <UserPlus size={16} color="#E25E3E" />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <ChevronLeft size={22} color="#0F172A" />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>Team</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>{projectName || currentProject?.name || ''}</Text>
        </View>
      </View>

      <FlatList
        data={members}
        keyExtractor={(item) => item.employeeId?.toString()}
        renderItem={renderMember}
        contentContainerStyle={styles.list}
        ListHeaderComponent={<Text style={styles.sectionTitle}>Members ({members.length})</Text>}
        ListFooterComponent={
          perms.isOwner ? (
            <View style={styles.inviteSection}>
              <Text style={styles.sectionTitle}>Invite</Text>
              <View style={styles.searchBox}>
                <Search size={15} color="#94A3B8" />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search employees..."
                  placeholderTextColor="#94A3B8"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery('')}>
                    <X size={14} color="#94A3B8" />
                  </TouchableOpacity>
                )}
              </View>
              {loadingRoster ? (
                <ActivityIndicator color="#E25E3E" style={{ marginTop: 20 }} />
              ) : invitableMembers.length === 0 ? (
                <Text style={styles.emptyInviteText}>No employees available to invite.</Text>
              ) : (
                invitableMembers.map((item) => (
                  <View key={item.id}>{renderInvitable({ item })}</View>
                ))
              )}
            </View>
          ) : undefined
        }
      />

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
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 8,
  },
  backBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#0F172A' },
  headerSubtitle: { fontSize: 12, color: '#64748B' },

  list: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E25E3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  memberInfo: { flex: 1, gap: 5 },
  memberName: { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  roleBadgeText: { fontSize: 10, fontWeight: '700' },
  removeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FEF2F2',
    justifyContent: 'center',
    alignItems: 'center',
  },

  inviteSection: { marginTop: 24 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', padding: 0 },
  emptyInviteText: { fontSize: 13, color: '#94A3B8', textAlign: 'center', marginTop: 20 },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
});
