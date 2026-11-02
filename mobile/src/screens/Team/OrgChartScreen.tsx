import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Platform,
} from 'react-native';
import {
  ChevronRight,
  ChevronDown,
  Search,
  Users,
  X,
  User,
  FolderOpen,
  FolderClosed,
  MapPin,
  Briefcase,
  Building2,
  ArrowDown,
  Network,
  GitFork,
  Sparkles,
} from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { Avatar } from '../../components/PersonSheet';
import { useAuthStore } from '../../store/authStore';
import { theme } from '../../theme/theme';

/**
 * Org Chart Screen.
 * Provides two view modes:
 * 1. Tree View: Full collapsible organizational hierarchy with branch connectors.
 * 2. Chain of Command: Focused ladder showing the reporting path from leadership to you and your direct reports/peers.
 */
type Node = {
  id: number;
  managerId: number | null;
  firstName: string;
  lastName?: string | null;
  avatarUrl?: string | null;
  employeeCode?: string | null;
  designation?: { name: string } | null;
  department?: { name: string } | null;
  branch?: { name: string } | null;
  user?: { status?: string; role?: string } | null;
  children: Node[];
  size: number;
};

type ViewMode = 'TREE' | 'CHAIN';

const fullName = (n: Node) => `${n.firstName} ${n.lastName || ''}`.trim();

export default function OrgChartScreen() {
  const navigation = useNavigation<any>();
  const myId = useAuthStore((s) => s.user?.employeeId);

  const [nodes, setNodes] = useState<Map<number, Node>>(new Map());
  const [roots, setRoots] = useState<Node[]>([]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('TREE');
  const [selectedDept, setSelectedDept] = useState<string>('All');

  const expandTo = (map: Map<number, Node>, id: number, base: Set<number>) => {
    const next = new Set(base);
    let cur = map.get(id);
    while (cur?.managerId && map.has(cur.managerId)) {
      next.add(cur.managerId);
      cur = map.get(cur.managerId);
    }
    return next;
  };

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/employees/org-chart');
      const map = new Map<number, Node>();
      for (const e of (data || []).filter(
        (x: any) => String(x.user?.status || '').toUpperCase() !== 'SUSPENDED'
      )) {
        map.set(e.id, { ...e, children: [], size: 0 });
      }
      const top: Node[] = [];
      for (const n of map.values()) {
        const m = n.managerId ? map.get(n.managerId) : null;
        if (m) m.children.push(n);
        else top.push(n);
      }
      const sizeOf = (n: Node): number =>
        (n.size = n.children.reduce((s, c) => s + 1 + sizeOf(c), 0));
      const sortRec = (list: Node[]) => {
        list.sort((a, b) => b.size - a.size || fullName(a).localeCompare(fullName(b)));
        list.forEach((c) => sortRec(c.children));
      };
      top.forEach(sizeOf);
      sortRec(top);
      setNodes(map);
      setRoots(top);

      // Expand top leadership and down to current user
      const start = new Set<number>(top.slice(0, 1).map((r) => r.id));
      setOpen(myId && map.has(myId) ? expandTo(map, myId, start) : start);
    } finally {
      setLoading(false);
    }
  }, [myId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodes.values()) {
      if (n.department?.name) set.add(n.department.name);
    }
    return ['All', ...Array.from(set).sort()];
  }, [nodes]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return [...nodes.values()]
      .filter((n) =>
        `${fullName(n)} ${n.employeeCode || ''} ${n.designation?.name || ''} ${n.department?.name || ''}`
          .toLowerCase()
          .includes(q)
      )
      .slice(0, 8);
  }, [query, nodes]);

  const jump = (id: number) => {
    setOpen((o) => expandTo(nodes, id, o));
    setFocus(id);
    setQuery('');
  };

  const toggle = (id: number) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const managersCount = useMemo(
    () => [...nodes.values()].filter((n) => n.children.length > 0).length,
    [nodes]
  );

  // Path from root to logged-in user for Chain of Command view
  const myChain = useMemo(() => {
    if (!myId || !nodes.has(myId)) return null;
    const path: Node[] = [];
    let cur = nodes.get(myId);
    while (cur) {
      path.unshift(cur);
      cur = cur.managerId ? nodes.get(cur.managerId) : undefined;
    }
    const myNode = nodes.get(myId)!;
    const myReports = myNode.children;

    // Peers: other reports of the same manager
    let peers: Node[] = [];
    if (myNode.managerId && nodes.has(myNode.managerId)) {
      const parent = nodes.get(myNode.managerId)!;
      peers = parent.children.filter((c) => c.id !== myId);
    }

    return { path, myReports, peers, myNode };
  }, [myId, nodes]);

  // Tree node recursive renderer
  const renderNode = (n: Node, depth: number): React.ReactNode => {
    const isOpen = open.has(n.id);
    const hasKids = n.children.length > 0;
    const isMe = n.id === myId;
    const isFocused = n.id === focus;
    const isRoot = depth === 0;

    // Department filter matching
    if (selectedDept !== 'All') {
      const inDept = n.department?.name === selectedDept;
      const anyKidInDept = n.children.some((c) => c.department?.name === selectedDept);
      if (!inDept && !anyKidInDept) return null;
    }

    const indentOffset = Math.min(depth, 5) * 16;

    return (
      <View key={n.id} style={styles.nodeWrapper}>
        <View
          style={[
            styles.cardRow,
            { marginLeft: indentOffset },
            isRoot && styles.rootCard,
            isMe && styles.meCard,
            isFocused && styles.focusedCard,
          ]}
        >
          {/* Tree guide line connector */}
          {depth > 0 && <View style={styles.treeConnectorBranch} />}

          {/* Expand / Collapse Button */}
          <TouchableOpacity
            style={styles.expandTouch}
            disabled={!hasKids}
            onPress={() => toggle(n.id)}
            activeOpacity={0.7}
          >
            {hasKids ? (
              <View style={[styles.expandCircle, isOpen && styles.expandCircleOpen]}>
                {isOpen ? (
                  <ChevronDown size={14} color={isOpen ? '#FFFFFF' : '#475569'} strokeWidth={2.4} />
                ) : (
                  <ChevronRight size={14} color="#475569" strokeWidth={2.4} />
                )}
              </View>
            ) : (
              <View style={styles.leafDot} />
            )}
          </TouchableOpacity>

          {/* Employee Avatar & Info */}
          <TouchableOpacity
            style={styles.personBody}
            onPress={() => navigation.navigate('EmployeeProfile', { id: n.id, person: n })}
            activeOpacity={0.75}
          >
            <Avatar person={n} size={42} />
            <View style={styles.personMeta}>
              <View style={styles.nameRow}>
                <Text style={styles.personName} numberOfLines={1}>
                  {fullName(n)}
                </Text>
                {isMe && (
                  <View style={styles.youBadge}>
                    <Text style={styles.youBadgeText}>YOU</Text>
                  </View>
                )}
                {isRoot && (
                  <View style={styles.leaderBadge}>
                    <Sparkles size={9} color="#D97706" />
                    <Text style={styles.leaderBadgeText}>LEADER</Text>
                  </View>
                )}
              </View>

              <Text style={styles.personRole} numberOfLines={1}>
                {[n.designation?.name, n.department?.name].filter(Boolean).join(' · ') || '—'}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Team Count Badge */}
          {hasKids && (
            <TouchableOpacity
              style={[styles.countBadge, isOpen && styles.countBadgeOpen]}
              onPress={() => toggle(n.id)}
              activeOpacity={0.75}
            >
              <Users size={11} color={isOpen ? '#FFFFFF' : '#4338CA'} strokeWidth={2.4} />
              <Text style={[styles.countBadgeText, isOpen && styles.countBadgeTextOpen]}>
                {n.children.length}
                {n.size > n.children.length ? ` / ${n.size}` : ''}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Render Subtree Children */}
        {isOpen && n.children.map((c) => renderNode(c, depth + 1))}
      </View>
    );
  };

  return (
    <AppScreen
      showBack
      title="Org Chart"
      subtitle={`${nodes.size} people · ${managersCount} managers`}
    >
      {loading ? (
        <ActivityIndicator style={styles.loader} color={theme.colors.primary} size="large" />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* 1. VIEW MODE SWITCHER */}
          <View style={styles.viewModeSwitcher}>
            <TouchableOpacity
              style={[styles.viewModeBtn, viewMode === 'TREE' && styles.viewModeBtnActive]}
              onPress={() => setViewMode('TREE')}
              activeOpacity={0.8}
            >
              <GitFork size={14} color={viewMode === 'TREE' ? '#1373E5' : '#64748B'} strokeWidth={2.2} />
              <Text style={[styles.viewModeText, viewMode === 'TREE' && styles.viewModeTextActive]}>
                Hierarchy Tree
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.viewModeBtn, viewMode === 'CHAIN' && styles.viewModeBtnActive]}
              onPress={() => setViewMode('CHAIN')}
              activeOpacity={0.8}
            >
              <Network size={14} color={viewMode === 'CHAIN' ? '#1373E5' : '#64748B'} strokeWidth={2.2} />
              <Text style={[styles.viewModeText, viewMode === 'CHAIN' && styles.viewModeTextActive]}>
                Chain of Command
              </Text>
            </TouchableOpacity>
          </View>

          {/* 2. SEARCH BAR */}
          <View style={styles.searchBox}>
            <Search size={15} color="#94A3B8" strokeWidth={2.2} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search by name, role, department..."
              placeholderTextColor="#94A3B8"
              autoCorrect={false}
              clearButtonMode="never"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} style={{ padding: 4 }}>
                <X size={14} color="#64748B" strokeWidth={2.4} />
              </TouchableOpacity>
            )}
          </View>

          {/* Live Search Suggestions Dropdown */}
          {matches.length > 0 && (
            <View style={styles.resultsCard}>
              {matches.map((n) => (
                <TouchableOpacity
                  key={n.id}
                  style={styles.resultItem}
                  onPress={() => jump(n.id)}
                  activeOpacity={0.7}
                >
                  <Avatar person={n} size={32} />
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={styles.resultName} numberOfLines={1}>
                      {fullName(n)}
                      {n.id === myId ? ' (you)' : ''}
                    </Text>
                    <Text style={styles.resultSub} numberOfLines={1}>
                      {[n.designation?.name, n.department?.name].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <ChevronRight size={14} color="#94A3B8" />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* TREE VIEW MODE */}
          {viewMode === 'TREE' && (
            <>
              {/* Quick Actions Strip */}
              <View style={styles.actionPillsRow}>
                {!!myId && nodes.has(myId) && (
                  <TouchableOpacity
                    style={[styles.actionPill, styles.actionPillPrimary]}
                    onPress={() => jump(myId)}
                    activeOpacity={0.75}
                  >
                    <User size={12} color="#FFFFFF" strokeWidth={2.4} />
                    <Text style={styles.actionPillTextPrimary}>Show Me</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={styles.actionPill}
                  onPress={() =>
                    setOpen(new Set([...nodes.values()].filter((n) => n.children.length > 0).map((n) => n.id)))
                  }
                  activeOpacity={0.75}
                >
                  <FolderOpen size={12} color="#1373E5" strokeWidth={2.2} />
                  <Text style={styles.actionPillText}>Expand All</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionPill}
                  onPress={() => {
                    setOpen(new Set());
                    setFocus(null);
                  }}
                  activeOpacity={0.75}
                >
                  <FolderClosed size={12} color="#64748B" strokeWidth={2.2} />
                  <Text style={styles.actionPillTextSecondary}>Collapse All</Text>
                </TouchableOpacity>
              </View>

              {/* Department Filter Strip */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.deptScroll}
              >
                {departments.map((dept) => {
                  const isSelected = selectedDept === dept;
                  return (
                    <TouchableOpacity
                      key={dept}
                      style={[styles.deptChip, isSelected && styles.deptChipActive]}
                      onPress={() => setSelectedDept(dept)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.deptChipText, isSelected && styles.deptChipTextActive]}>
                        {dept}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Tree Nodes List */}
              <View style={styles.treeContainer}>{roots.map((r) => renderNode(r, 0))}</View>
            </>
          )}

          {/* CHAIN OF COMMAND VIEW MODE */}
          {viewMode === 'CHAIN' && (
            <View style={styles.chainContainer}>
              <View style={styles.chainIntroCard}>
                <View style={styles.chainIntroIcon}>
                  <Network size={18} color="#1373E5" strokeWidth={2.4} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.chainIntroTitle}>Your Reporting Line</Text>
                  <Text style={styles.chainIntroSub}>
                    Direct leadership chain from Executive to your position
                  </Text>
                </View>
              </View>

              {myChain ? (
                <>
                  {/* Reporting Ladder (Upwards to CEO) */}
                  {myChain.path.map((member, index) => {
                    const isMe = member.id === myId;
                    const isTop = index === 0;
                    return (
                      <View key={member.id} style={styles.ladderStep}>
                        <TouchableOpacity
                          style={[
                            styles.ladderCard,
                            isMe ? styles.ladderCardMe : isTop ? styles.ladderCardTop : undefined,
                          ]}
                          onPress={() =>
                            navigation.navigate('EmployeeProfile', { id: member.id, person: member })
                          }
                          activeOpacity={0.75}
                        >
                          <Avatar person={member} size={48} />
                          <View style={styles.ladderMeta}>
                            <View style={styles.nameRow}>
                              <Text style={styles.ladderName} numberOfLines={1}>
                                {fullName(member)}
                              </Text>
                              {isMe && (
                                <View style={styles.youBadge}>
                                  <Text style={styles.youBadgeText}>YOU</Text>
                                </View>
                              )}
                              {isTop && (
                                <View style={styles.leaderBadge}>
                                  <Sparkles size={9} color="#D97706" />
                                  <Text style={styles.leaderBadgeText}>HEAD</Text>
                                </View>
                              )}
                            </View>
                            <Text style={styles.ladderRole} numberOfLines={1}>
                              {[member.designation?.name, member.department?.name]
                                .filter(Boolean)
                                .join(' · ')}
                            </Text>
                            {member.children.length > 0 && (
                              <View style={styles.ladderTeamBadge}>
                                <Users size={10} color="#4338CA" />
                                <Text style={styles.ladderTeamText}>
                                  {member.children.length} direct reports · {member.size} total
                                </Text>
                              </View>
                            )}
                          </View>
                          <ChevronRight size={16} color="#CBD5E1" />
                        </TouchableOpacity>

                        {/* Pipeline Connector Arrow */}
                        {index < myChain.path.length - 1 && (
                          <View style={styles.ladderConnector}>
                            <View style={styles.ladderConnectorLine} />
                            <View style={styles.ladderConnectorIconCircle}>
                              <ArrowDown size={11} color="#64748B" strokeWidth={2.4} />
                            </View>
                            <View style={styles.ladderConnectorLine} />
                          </View>
                        )}
                      </View>
                    );
                  })}

                  {/* Direct Reports Section (If you have any) */}
                  {myChain.myReports.length > 0 && (
                    <View style={styles.subTeamSection}>
                      <View style={styles.subTeamHeader}>
                        <Users size={15} color="#1373E5" strokeWidth={2.4} />
                        <Text style={styles.subTeamTitle}>
                          Your Direct Reports ({myChain.myReports.length})
                        </Text>
                      </View>
                      <View style={styles.subTeamList}>
                        {myChain.myReports.map((report) => (
                          <TouchableOpacity
                            key={report.id}
                            style={styles.subTeamCard}
                            onPress={() =>
                              navigation.navigate('EmployeeProfile', { id: report.id, person: report })
                            }
                            activeOpacity={0.75}
                          >
                            <Avatar person={report} size={40} />
                            <View style={{ flex: 1, gap: 2 }}>
                              <Text style={styles.subTeamName}>{fullName(report)}</Text>
                              <Text style={styles.subTeamRole} numberOfLines={1}>
                                {report.designation?.name || 'Team member'}
                              </Text>
                            </View>
                            <ChevronRight size={14} color="#CBD5E1" />
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* Peers Section (Colleagues reporting to same manager) */}
                  {myChain.peers.length > 0 && myChain.myReports.length === 0 && (
                    <View style={styles.subTeamSection}>
                      <View style={styles.subTeamHeader}>
                        <Users size={15} color="#64748B" strokeWidth={2.4} />
                        <Text style={styles.subTeamTitle}>
                          Team Peers ({myChain.peers.length})
                        </Text>
                      </View>
                      <View style={styles.subTeamList}>
                        {myChain.peers.map((peer) => (
                          <TouchableOpacity
                            key={peer.id}
                            style={styles.subTeamCard}
                            onPress={() =>
                              navigation.navigate('EmployeeProfile', { id: peer.id, person: peer })
                            }
                            activeOpacity={0.75}
                          >
                            <Avatar person={peer} size={40} />
                            <View style={{ flex: 1, gap: 2 }}>
                              <Text style={styles.subTeamName}>{fullName(peer)}</Text>
                              <Text style={styles.subTeamRole} numberOfLines={1}>
                                {peer.designation?.name || 'Colleague'}
                              </Text>
                            </View>
                            <ChevronRight size={14} color="#CBD5E1" />
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.emptyChain}>
                  <Text style={styles.emptyChainText}>
                    Sign in with an active employee account to view your direct chain of command.
                  </Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  loader: { marginTop: 60 },
  scroll: {
    padding: 16,
    paddingBottom: 130,
    gap: 10,
  },

  // View Mode Switcher
  viewModeSwitcher: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  viewModeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
  },
  viewModeBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  viewModeText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#64748B',
  },
  viewModeTextActive: {
    color: '#0F172A',
    fontWeight: '800',
  },

  // Search Box
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    gap: 8,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 13.5,
    color: '#0F172A',
    paddingVertical: 0,
  },

  // Search Results Dropdown
  resultsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  resultName: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  resultSub: {
    fontSize: 11.5,
    color: '#64748B',
  },

  // Action Pills Row
  actionPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  actionPillPrimary: {
    backgroundColor: '#1373E5',
    borderColor: '#1373E5',
  },
  actionPillText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#1373E5',
  },
  actionPillTextPrimary: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  actionPillTextSecondary: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#64748B',
  },

  // Department Filter Chips
  deptScroll: {
    gap: 6,
    paddingVertical: 2,
  },
  deptChip: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  deptChipActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  deptChipText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#64748B',
  },
  deptChipTextActive: {
    color: '#1373E5',
    fontWeight: '800',
  },

  // Tree Nodes
  treeContainer: {
    gap: 6,
    marginTop: 4,
  },
  nodeWrapper: {
    position: 'relative',
  },
  cardRow: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 9,
    paddingRight: 10,
    marginBottom: 6,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  rootCard: {
    borderLeftWidth: 3.5,
    borderLeftColor: '#6366F1',
    backgroundColor: '#FAF5FF',
  },
  meCard: {
    borderWidth: 1.5,
    borderColor: '#3B82F6',
    backgroundColor: '#F0F9FF',
  },
  focusedCard: {
    borderWidth: 1.5,
    borderColor: '#F59E0B',
    backgroundColor: '#FFFBEB',
  },
  treeConnectorBranch: {
    position: 'absolute',
    left: -12,
    top: 20,
    width: 10,
    height: 2,
    backgroundColor: '#CBD5E1',
  },
  expandTouch: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandCircleOpen: {
    backgroundColor: '#1373E5',
  },
  leafDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#CBD5E1',
  },
  personBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  personMeta: {
    flex: 1,
    gap: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  personName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    flexShrink: 1,
  },
  youBadge: {
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  youBadgeText: {
    fontSize: 9.5,
    fontWeight: '900',
    color: '#1D4ED8',
  },
  leaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  leaderBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#B45309',
  },
  personRole: {
    fontSize: 12,
    color: '#64748B',
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  countBadgeOpen: {
    backgroundColor: '#4338CA',
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4338CA',
  },
  countBadgeTextOpen: {
    color: '#FFFFFF',
  },

  // Chain of Command Styles
  chainContainer: {
    gap: 12,
    marginTop: 4,
  },
  chainIntroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  chainIntroIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chainIntroTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1E40AF',
  },
  chainIntroSub: {
    fontSize: 11.5,
    color: '#3B82F6',
  },
  ladderStep: {
    alignItems: 'center',
  },
  ladderCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  ladderCardTop: {
    borderLeftWidth: 4,
    borderLeftColor: '#F59E0B',
  },
  ladderCardMe: {
    borderWidth: 2,
    borderColor: '#1373E5',
    backgroundColor: '#F0F9FF',
    shadowColor: '#1373E5',
    shadowOpacity: 0.12,
  },
  ladderMeta: {
    flex: 1,
    gap: 2,
  },
  ladderName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  ladderRole: {
    fontSize: 12.5,
    color: '#64748B',
  },
  ladderTeamBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  ladderTeamText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4338CA',
  },
  ladderConnector: {
    alignItems: 'center',
    marginVertical: 4,
  },
  ladderConnectorLine: {
    width: 2,
    height: 12,
    backgroundColor: '#CBD5E1',
  },
  ladderConnectorIconCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 2,
  },

  // Sub Team / Direct Reports Section
  subTeamSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    gap: 10,
    marginTop: 6,
  },
  subTeamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  subTeamTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  subTeamList: {
    gap: 8,
  },
  subTeamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  subTeamName: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  subTeamRole: {
    fontSize: 12,
    color: '#64748B',
  },
  emptyChain: {
    padding: 24,
    alignItems: 'center',
  },
  emptyChainText: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
});
