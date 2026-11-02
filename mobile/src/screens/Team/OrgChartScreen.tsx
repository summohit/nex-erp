import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { ChevronRight, ChevronDown, Search, Users, X } from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { Avatar } from '../../components/PersonSheet';
import { useAuthStore } from '../../store/authStore';
import { theme } from '../../theme/theme';

/**
 * Org chart as a collapsible tree (a phone is too narrow for the web's
 * canvas). Starts with the top of the company open and the path to you
 * expanded; search jumps to anyone and opens the chain above them.
 */
type Node = {
  id: number; managerId: number | null; firstName: string; lastName?: string | null; avatarUrl?: string | null;
  employeeCode?: string | null; designation?: { name: string } | null; department?: { name: string } | null;
  user?: { status?: string } | null; children: Node[]; size: number;
};
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

  const expandTo = (map: Map<number, Node>, id: number, base: Set<number>) => {
    const next = new Set(base);
    let cur = map.get(id);
    while (cur?.managerId && map.has(cur.managerId)) { next.add(cur.managerId); cur = map.get(cur.managerId); }
    return next;
  };

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/employees/org-chart');
      const map = new Map<number, Node>();
      for (const e of (data || []).filter((x: any) => String(x.user?.status || '').toUpperCase() !== 'SUSPENDED')) {
        map.set(e.id, { ...e, children: [], size: 0 });
      }
      const top: Node[] = [];
      for (const n of map.values()) {
        const m = n.managerId ? map.get(n.managerId) : null;
        if (m) m.children.push(n); else top.push(n);
      }
      const sizeOf = (n: Node): number => (n.size = n.children.reduce((s, c) => s + 1 + sizeOf(c), 0));
      const sortRec = (list: Node[]) => { list.sort((a, b) => b.size - a.size || fullName(a).localeCompare(fullName(b))); list.forEach((c) => sortRec(c.children)); };
      top.forEach(sizeOf);
      sortRec(top);
      setNodes(map);
      setRoots(top);
      // The biggest tree's head open, and the way down to you.
      const start = new Set<number>(top.slice(0, 1).map((r) => r.id));
      setOpen(myId && map.has(myId) ? expandTo(map, myId, start) : start);
    } finally {
      setLoading(false);
    }
  }, [myId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return [...nodes.values()]
      .filter((n) => `${fullName(n)} ${n.employeeCode || ''} ${n.designation?.name || ''} ${n.department?.name || ''}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, nodes]);

  const jump = (id: number) => {
    setOpen((o) => expandTo(nodes, id, o));
    setFocus(id);
    setQuery('');
  };

  const toggle = (id: number) => setOpen((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const managers = [...nodes.values()].filter((n) => n.children.length).length;

  const renderNode = (n: Node, depth: number): React.ReactNode => {
    const isOpen = open.has(n.id);
    const hasKids = n.children.length > 0;
    const highlight = n.id === focus ? styles.focus : n.id === myId ? styles.me : null;
    return (
      <View key={n.id}>
        <View style={[styles.row, { marginLeft: Math.min(depth, 6) * 16 }, highlight]}>
          <TouchableOpacity style={styles.chev} disabled={!hasKids} onPress={() => toggle(n.id)}>
            {hasKids ? (isOpen ? <ChevronDown size={18} color="#334155" /> : <ChevronRight size={18} color="#334155" />) : <View style={styles.dot} />}
          </TouchableOpacity>
          <TouchableOpacity style={styles.person} onPress={() => navigation.navigate('EmployeeProfile', { id: n.id, person: n })} activeOpacity={0.75}>
            <Avatar person={n} size={38} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{fullName(n)}{n.id === myId ? '  (you)' : ''}</Text>
              <Text style={styles.sub} numberOfLines={1}>{[n.designation?.name, n.department?.name].filter(Boolean).join(' · ') || '—'}</Text>
            </View>
          </TouchableOpacity>
          {hasKids && (
            <TouchableOpacity style={styles.count} onPress={() => toggle(n.id)}>
              <Users size={12} color="#4F46E5" />
              <Text style={styles.countText}>{n.children.length}{n.size > n.children.length ? ` / ${n.size}` : ''}</Text>
            </TouchableOpacity>
          )}
        </View>
        {isOpen && n.children.map((c) => renderNode(c, depth + 1))}
      </View>
    );
  };

  return (
    <AppScreen showBack title="Org Chart" subtitle={`${nodes.size} people · ${managers} managers`}>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} /> : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.search}>
            <Search size={16} color="#94A3B8" />
            <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Find someone in the chart" placeholderTextColor="#94A3B8" autoCorrect={false} />
            {!!query && <TouchableOpacity onPress={() => setQuery('')}><X size={16} color="#94A3B8" /></TouchableOpacity>}
          </View>
          {matches.length > 0 && (
            <View style={styles.results}>
              {matches.map((n) => (
                <TouchableOpacity key={n.id} style={styles.result} onPress={() => jump(n.id)}>
                  <Avatar person={n} size={28} />
                  <Text style={styles.resultText} numberOfLines={1}>{fullName(n)}</Text>
                  <Text style={styles.sub} numberOfLines={1}>{n.designation?.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <View style={styles.tools}>
            <TouchableOpacity onPress={() => setOpen(new Set([...nodes.values()].filter((n) => n.children.length).map((n) => n.id)))}>
              <Text style={styles.tool}>Expand all</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setOpen(new Set()); setFocus(null); }}>
              <Text style={styles.tool}>Collapse all</Text>
            </TouchableOpacity>
            {!!myId && nodes.has(myId) && (
              <TouchableOpacity onPress={() => jump(myId)}><Text style={styles.tool}>Show me</Text></TouchableOpacity>
            )}
          </View>
          {roots.map((r) => renderNode(r, 0))}
        </ScrollView>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 120, gap: 6 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 0 },
  results: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden' },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  resultText: { flex: 1, fontSize: 14, fontWeight: '700', color: '#0F172A' },
  tools: { flexDirection: 'row', gap: 16, paddingVertical: 6 },
  tool: { fontSize: 13, fontWeight: '700', color: '#1373E5' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', paddingVertical: 8, paddingRight: 10, marginBottom: 6 },
  me: { borderColor: '#93C5FD', backgroundColor: '#F8FBFF' },
  focus: { borderColor: '#F59E0B', backgroundColor: '#FFFBEB' },
  chev: { width: 32, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#CBD5E1' },
  person: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  sub: { fontSize: 12, color: '#64748B' },
  count: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#EEF2FF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  countText: { fontSize: 11, fontWeight: '800', color: '#4F46E5' },
});
