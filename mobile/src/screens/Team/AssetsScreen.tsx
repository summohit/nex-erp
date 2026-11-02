import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useAuthStore } from '../../store/authStore';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, TextInput, Modal, ScrollView,
  Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Search, X, Check, Plus, Package, AlertTriangle, Undo2, Trash2, Laptop } from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { Avatar } from '../../components/PersonSheet';
import { theme } from '../../theme/theme';

/**
 * Assets & IT for admins, as on the web: the Inventory (stock, value, low
 * stock, add/edit, assign, consume, expire, adjust, status, delete, history)
 * and Assignments (who holds what, and returns). The server decides who gets
 * in, with the same assets/inventory and assets/assignments permissions.
 */
type Item = {
  id: number; name: string; brand?: string; category: string; itemType: 'ASSET' | 'CONSUMABLE'; unit: string; quantity: number; unitCost: number;
  purchaseDate?: string; supplier?: string; location?: string; model?: string; serialNumber?: string; warrantyExpiry?: string; expiryDate?: string;
  notes?: string; status: 'ACTIVE' | 'IN_REPAIR' | 'RETIRED'; netAssigned: number; returned: number; consumed: number; expired: number;
  available: number; totalValue: number; statusLabel: string; lowStock: boolean;
};
type Txn = {
  id: number; type: string; quantity: number; date: string; purpose?: string; reason?: string; assigneeText?: string; expectedReturnDate?: string;
  conditionOnReturn?: string; item?: { id: number; name: string; category: string; unit: string; itemType: string };
  employee?: { id: number; firstName: string; lastName: string; department?: { name: string } }; linkedReturns?: { id: number; quantity: number }[];
};
type Action = 'assign' | 'consume' | 'expire' | 'adjust';
const CATEGORIES = ['LAPTOP', 'DESKTOP', 'MONITOR', 'PRINTER', 'PERIPHERAL', 'MOBILE', 'SOFTWARE', 'PANTRY', 'STATIONERY', 'HOUSEKEEPING'];
const UNITS = ['units', 'pcs', 'packets', 'boxes', 'bottles', 'pairs', 'sets', 'kg', 'litres'];
const STATUSES: Item['status'][] = ['ACTIVE', 'IN_REPAIR', 'RETIRED'];
const pretty = (v?: string) => (v || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const money = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const day = (d?: string) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const today = () => new Date().toISOString().slice(0, 10);
const errMsg = (e: any) => { const m = e?.response?.data?.message; return Array.isArray(m) ? m.join('\n') : m || 'Please try again.'; };
const outstanding = (t: Txn) => t.quantity - (t.linkedReturns || []).reduce((s, r) => s + r.quantity, 0);
const REQ_TONE: Record<string, { bg: string; text: string }> = {
  PENDING: { bg: '#FEF3C7', text: '#B45309' }, APPROVED: { bg: '#DCFCE7', text: '#166534' },
  FULFILLED: { bg: '#DBEAFE', text: '#1D4ED8' }, REJECTED: { bg: '#FEE2E2', text: '#B91C1C' },
};
const fullName = (e: any) => (e ? `${e.firstName} ${e.lastName || ''}`.trim() : '');

const BLANK = { name: '', category: 'LAPTOP', itemType: 'ASSET' as Item['itemType'], unit: 'units', quantity: '1', unitCost: '', brand: '', model: '', serialNumber: '', location: '', supplier: '', purchaseDate: '', warrantyExpiry: '', expiryDate: '', notes: '' };

export default function AssetsScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const role = useAuthStore((st) => st.user?.role) || '';
  const canDecide = ['SUPERADMIN', 'ADMIN', 'HR'].includes(role);
  const [tab, setTab] = useState<'inventory' | 'assignments' | 'requests'>(
    route.params?.initialTab === 'assignments' ? 'assignments' : route.params?.initialTab === 'requests' ? 'requests' : 'inventory');
  const [requests, setRequests] = useState<any[]>([]);
  const [reqStatus, setReqStatus] = useState<'PENDING' | 'APPROVED' | 'FULFILLED' | 'REJECTED' | ''>('PENDING');
  const [items, setItems] = useState<Item[]>([]);
  const [assigns, setAssigns] = useState<Txn[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [denied, setDenied] = useState(false);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'' | 'ASSET' | 'CONSUMABLE' | 'LOW'>('');
  const [onlyOut, setOnlyOut] = useState(true);

  const [detail, setDetail] = useState<Item | null>(null);
  const [history, setHistory] = useState<Txn[] | null>(null);
  const [form, setForm] = useState<(typeof BLANK & { id?: number }) | null>(null);
  const [act, setAct] = useState<{ type: Action; item: Item; qty: string; text: string; employeeId?: number; date: string; returnBy: string } | null>(null);
  const [ret, setRet] = useState<{ txn: Txn; qty: string; condition: string; notes: string } | null>(null);
  const [personPick, setPersonPick] = useState(false);
  const [pq, setPq] = useState('');

  const load = useCallback(async () => {
    // Requests are for everyone; inventory and assignments only for asset managers.
    apiClient.get('/assets/requests').then((r) => setRequests(r.data || [])).catch(() => setRequests([]));
    try {
      const [inv, asg] = await Promise.all([apiClient.get('/assets/inventory'), apiClient.get('/assets/inventory/assignments').catch(() => ({ data: [] }))]);
      setItems(inv.data || []);
      setAssigns(asg.data || []);
      setDenied(false);
    } catch (e: any) {
      if (e?.response?.status === 403) { setDenied(true); setTab('requests'); }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const ensurePeople = async () => {
    if (people.length) return;
    const { data } = await apiClient.get('/employees/basic-list').catch(() => ({ data: [] }));
    setPeople(data || []);
  };

  const kpis = useMemo(() => ({
    items: items.length,
    value: items.reduce((s, i) => s + (i.totalValue || 0), 0),
    low: items.filter((i) => i.lowStock).length,
    out: assigns.filter((t) => outstanding(t) > 0).reduce((s, t) => s + outstanding(t), 0),
  }), [items, assigns]);

  const shownItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) =>
      (!kind || (kind === 'LOW' ? i.lowStock : i.itemType === kind)) &&
      (!q || `${i.name} ${i.brand || ''} ${i.model || ''} ${i.serialNumber || ''} ${i.category} ${i.location || ''}`.toLowerCase().includes(q)));
  }, [items, query, kind]);

  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;
  const shownRequests = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests.filter((r) => (!reqStatus || r.status === reqStatus) &&
      (!q || `${fullName(r.employee)} ${r.requestType} ${r.category} ${r.reason} ${r.employee?.department?.name || ''}`.toLowerCase().includes(q)));
  }, [requests, query, reqStatus]);

  const decideRequest = async (r: any, status: 'APPROVED' | 'REJECTED' | 'FULFILLED', rejectionReason?: string) => {
    try {
      await apiClient.put(`/assets/requests/${r.id}/status`, { status, rejectionReason });
      load();
    } catch (e) { Alert.alert('Could not update request', errMsg(e)); }
  };
  const askReject = (r: any) => Alert.prompt
    ? Alert.prompt('Reject request', 'Reason (up to 100 characters)', (txt) => txt?.trim() && decideRequest(r, 'REJECTED', txt.trim().slice(0, 100)))
    : decideRequest(r, 'REJECTED', 'Rejected');

  const shownAssigns = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assigns.filter((t) => (!onlyOut || outstanding(t) > 0) &&
      (!q || `${t.item?.name || ''} ${fullName(t.employee)} ${t.assigneeText || ''} ${t.employee?.department?.name || ''}`.toLowerCase().includes(q)));
  }, [assigns, query, onlyOut]);

  const openDetail = async (i: Item) => {
    setDetail(i);
    setHistory(null);
    apiClient.get(`/assets/inventory/${i.id}/transactions`).then((r) => setHistory(r.data || [])).catch(() => setHistory([]));
  };

  const saveItem = async () => {
    if (!form || !form.name.trim()) return;
    const body: any = { ...form, name: form.name.trim(), quantity: Number(form.quantity) || 0, unitCost: Number(form.unitCost) || 0 };
    for (const k of ['purchaseDate', 'warrantyExpiry', 'expiryDate']) if (!body[k]) delete body[k];
    delete body.id;
    try {
      if (form.id) await apiClient.put(`/assets/inventory/${form.id}`, body);
      else await apiClient.post('/assets/inventory', body);
      setForm(null);
      setDetail(null);
      load();
    } catch (e) { Alert.alert('Could not save', errMsg(e)); }
  };

  const runAction = async () => {
    if (!act) return;
    const qty = Number(act.qty);
    const base = `/assets/inventory/${act.item.id}`;
    try {
      if (act.type === 'assign') {
        await apiClient.post(`${base}/assign`, { quantity: qty, employeeId: act.employeeId, assigneeText: act.employeeId ? undefined : act.text.trim() || undefined, date: act.date, expectedReturnDate: act.returnBy || undefined });
      } else if (act.type === 'consume') {
        await apiClient.post(`${base}/consume`, { quantity: qty, date: act.date, purpose: act.text.trim() || undefined });
      } else if (act.type === 'expire') {
        await apiClient.post(`${base}/expire`, { quantity: qty, date: act.date, reason: act.text.trim() || undefined });
      } else {
        await apiClient.post(`${base}/adjust`, { delta: qty, date: act.date, reason: act.text.trim() || undefined });
      }
      setAct(null);
      setDetail(null);
      load();
    } catch (e) { Alert.alert('Could not save', errMsg(e)); }
  };

  const setStatus = async (i: Item, status: Item['status']) => {
    try { await apiClient.put(`/assets/inventory/${i.id}/status`, { status }); setDetail(null); load(); } catch (e) { Alert.alert('Could not change status', errMsg(e)); }
  };

  const remove = (i: Item) => Alert.alert('Delete item?', `${i.name} and its history will be removed.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try { await apiClient.delete(`/assets/inventory/${i.id}`); setDetail(null); load(); } catch (e) { Alert.alert('Could not delete', errMsg(e)); }
    } },
  ]);

  const doReturn = async () => {
    if (!ret) return;
    try {
      await apiClient.put(`/assets/inventory/transactions/${ret.txn.id}/return`, { quantity: Number(ret.qty), returnDate: today(), conditionOnReturn: ret.condition || undefined, notes: ret.notes.trim() || undefined });
      setRet(null);
      load();
    } catch (e) { Alert.alert('Could not record return', errMsg(e)); }
  };


  const header = (
    <View style={{ gap: 10, marginBottom: 6 }}>
      <View style={styles.tabs}>
        {((denied ? ['requests'] : ['inventory', 'assignments', 'requests']) as ('inventory' | 'assignments' | 'requests')[]).map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>
              {t === 'inventory' ? 'Inventory' : t === 'assignments' ? 'Assignments' : `Requests${pendingCount ? ` ${pendingCount}` : ''}`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {tab !== 'requests' && (
      <View style={styles.kpis}>
        <View style={[styles.kpi, { backgroundColor: '#EEF2FF' }]}><Text style={[styles.kpiNum, { color: '#4338CA' }]}>{kpis.items}</Text><Text style={[styles.kpiLabel, { color: '#4338CA' }]}>Items</Text></View>
        <View style={[styles.kpi, { backgroundColor: '#ECFDF5' }]}><Text style={[styles.kpiNum, { color: '#047857', fontSize: 15 }]} numberOfLines={1}>{money(kpis.value)}</Text><Text style={[styles.kpiLabel, { color: '#047857' }]}>Value</Text></View>
        <View style={[styles.kpi, { backgroundColor: '#EFF6FF' }]}><Text style={[styles.kpiNum, { color: '#1D4ED8' }]}>{kpis.out}</Text><Text style={[styles.kpiLabel, { color: '#1D4ED8' }]}>Issued</Text></View>
        <View style={[styles.kpi, { backgroundColor: '#FFF7ED' }]}><Text style={[styles.kpiNum, { color: '#C2410C' }]}>{kpis.low}</Text><Text style={[styles.kpiLabel, { color: '#C2410C' }]}>Low stock</Text></View>
      </View>
      )}
      <View style={styles.search}>
        <Search size={16} color="#94A3B8" />
        <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder={tab === 'inventory' ? 'Search item, serial, location' : tab === 'requests' ? 'Search person, type, reason' : 'Search item or person'} placeholderTextColor="#94A3B8" autoCorrect={false} clearButtonMode="while-editing" />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {tab === 'requests' ? ([['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['FULFILLED', 'Fulfilled'], ['REJECTED', 'Rejected'], ['', 'All']] as const).map(([k, l]) => (
          <TouchableOpacity key={k || 'all'} style={[styles.chip, reqStatus === k && styles.chipOn]} onPress={() => setReqStatus(k)}>
            <Text style={[styles.chipText, reqStatus === k && styles.chipTextOn]}>{l} {k ? requests.filter((r) => r.status === k).length : requests.length}</Text>
          </TouchableOpacity>
        )) : tab === 'inventory' ? ([['', 'All'], ['ASSET', 'Assets'], ['CONSUMABLE', 'Consumables'], ['LOW', 'Low stock']] as const).map(([k, l]) => (
          <TouchableOpacity key={k || 'all'} style={[styles.chip, kind === k && styles.chipOn]} onPress={() => setKind(k)}>
            <Text style={[styles.chipText, kind === k && styles.chipTextOn]}>{l}</Text>
          </TouchableOpacity>
        )) : ([[true, 'Still out'], [false, 'All, incl. returned']] as const).map(([v, l]) => (
          <TouchableOpacity key={l} style={[styles.chip, onlyOut === v && styles.chipOn]} onPress={() => setOnlyOut(v)}>
            <Text style={[styles.chipText, onlyOut === v && styles.chipTextOn]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <AppScreen
      showBack
      title="Assets & IT"
      subtitle={tab === 'inventory' ? `${items.length} items · ${money(kpis.value)}` : tab === 'requests' ? `${pendingCount} pending request${pendingCount === 1 ? '' : 's'}` : `${kpis.out} units issued`}
      right={tab === 'inventory' ? (
        <TouchableOpacity style={styles.primaryBtn} onPress={() => setForm({ ...BLANK, purchaseDate: today() })}>
          <Plus size={15} color="#fff" /><Text style={styles.primaryText}>Add</Text>
        </TouchableOpacity>
      ) : tab === 'requests' ? (
        <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.navigate('HardwareRequests')}>
          <Plus size={15} color="#fff" /><Text style={styles.primaryText}>Request</Text>
        </TouchableOpacity>
      ) : undefined}
    >
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} /> : tab === 'requests' ? (
        <FlatList
          data={shownRequests}
          keyExtractor={(r) => String(r.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>No requests.</Text>}
          renderItem={({ item: r }) => {
            const tone = REQ_TONE[r.status] || REQ_TONE.PENDING;
            const urgent = r.urgency === 'HIGH';
            return (
              <View style={[styles.card, { flexDirection: 'column', alignItems: 'stretch', gap: 8 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  {r.employee ? <Avatar person={r.employee} size={36} /> : <View style={[styles.icon, { backgroundColor: '#F1F5F9' }]}><Laptop size={18} color="#64748B" /></View>}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{fullName(r.employee) || 'You'}</Text>
                    <Text style={styles.sub} numberOfLines={1}>{pretty(r.requestType)} · {pretty(r.category)}{r.employee?.department?.name ? ` · ${r.employee.department.name}` : ''}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 3 }}>
                    <Text style={[styles.reqPill, { backgroundColor: tone.bg, color: tone.text }]}>{pretty(r.status)}</Text>
                    <Text style={[styles.tiny, urgent && { color: '#B91C1C', fontWeight: '800' }]}>{pretty(r.urgency)} urgency</Text>
                  </View>
                </View>
                {!!r.reason && <Text style={styles.reqReason} numberOfLines={3}>{r.reason}</Text>}
                {r.status === 'REJECTED' && !!r.rejectionReason && <Text style={[styles.sub, { color: '#B91C1C' }]}>Rejected: {r.rejectionReason}</Text>}
                <Text style={styles.tiny}>Raised {day(r.createdAt)}</Text>
                {canDecide && (r.status === 'PENDING' || r.status === 'APPROVED') && (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {r.status === 'PENDING' && (
                      <>
                        <TouchableOpacity style={[styles.reqBtn, styles.reqReject]} onPress={() => askReject(r)}><Text style={styles.reqRejectText}>Reject</Text></TouchableOpacity>
                        <TouchableOpacity style={[styles.reqBtn, styles.reqApprove]} onPress={() => decideRequest(r, 'APPROVED')}><Text style={styles.primaryText}>Approve</Text></TouchableOpacity>
                      </>
                    )}
                    {r.status === 'APPROVED' && (
                      <TouchableOpacity style={[styles.reqBtn, styles.reqApprove]} onPress={() => decideRequest(r, 'FULFILLED')}><Text style={styles.primaryText}>Mark fulfilled</Text></TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            );
          }}
        />
      ) : tab === 'inventory' ? (
        <FlatList
          data={shownItems}
          keyExtractor={(i) => String(i.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>No items.</Text>}
          renderItem={({ item: i }) => (
            <TouchableOpacity style={[styles.card, i.status === 'RETIRED' && { opacity: 0.6 }]} onPress={() => openDetail(i)} activeOpacity={0.85}>
              <View style={[styles.icon, { backgroundColor: i.itemType === 'ASSET' ? '#EEF2FF' : '#F0FDFA' }]}>
                <Package size={18} color={i.itemType === 'ASSET' ? '#4338CA' : '#0D9488'} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name} numberOfLines={1}>{i.name}</Text>
                <Text style={styles.sub} numberOfLines={1}>{[pretty(i.category), i.brand, i.model, i.serialNumber && `SN ${i.serialNumber}`].filter(Boolean).join(' · ')}</Text>
                <Text style={styles.sub}>{i.available} of {i.quantity} {i.unit} available · {i.netAssigned} issued</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                {i.lowStock && <View style={styles.low}><AlertTriangle size={11} color="#C2410C" /><Text style={styles.lowText}>Low</Text></View>}
                {i.status !== 'ACTIVE' && <Text style={styles.status}>{pretty(i.status)}</Text>}
                <Text style={styles.value}>{money(i.totalValue)}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      ) : (
        <FlatList
          data={shownAssigns}
          keyExtractor={(t) => String(t.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>Nothing issued.</Text>}
          renderItem={({ item: t }) => {
            const left = outstanding(t);
            const overdue = left > 0 && t.expectedReturnDate && t.expectedReturnDate.slice(0, 10) < today();
            return (
              <View style={styles.card}>
                {t.employee ? <Avatar person={t.employee} size={38} /> : <View style={[styles.icon, { backgroundColor: '#F1F5F9' }]}><Package size={18} color="#64748B" /></View>}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.name} numberOfLines={1}>{t.item?.name}</Text>
                  <Text style={styles.sub} numberOfLines={1}>{fullName(t.employee) || t.assigneeText || '—'}{t.employee?.department?.name ? ` · ${t.employee.department.name}` : ''}</Text>
                  <Text style={[styles.sub, overdue && { color: '#B91C1C', fontWeight: '700' }]}>
                    {t.quantity} {t.item?.unit} on {day(t.date)}{t.expectedReturnDate ? ` · due ${day(t.expectedReturnDate)}` : ''}
                  </Text>
                </View>
                {left > 0 ? (
                  <TouchableOpacity style={styles.returnBtn} onPress={() => setRet({ txn: t, qty: String(left), condition: 'GOOD', notes: '' })}>
                    <Undo2 size={14} color="#1373E5" /><Text style={styles.returnText}>Return{left < t.quantity ? ` ${left}` : ''}</Text>
                  </TouchableOpacity>
                ) : <Text style={styles.done}>Returned</Text>}
              </View>
            );
          }}
        />
      )}

      {/* Item detail */}
      <Modal visible={!!detail && !act && !form} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <View style={styles.bottom}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>{detail?.name}</Text>
                <Text style={styles.sub}>{pretty(detail?.category)} · {detail?.itemType === 'ASSET' ? 'Asset' : 'Consumable'} · {pretty(detail?.status)}</Text>
              </View>
              <TouchableOpacity onPress={() => setDetail(null)}><X size={20} color="#334155" /></TouchableOpacity>
            </View>
            {detail && (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
                <View style={styles.stock}>
                  {([['Total', detail.quantity], ['Available', detail.available], ['Issued', detail.netAssigned], ['Returned', detail.returned], ['Used', detail.consumed], ['Expired', detail.expired]] as const).map(([l, v]) => (
                    <View key={l} style={styles.stockCell}><Text style={styles.stockNum}>{v}</Text><Text style={styles.tiny}>{l}</Text></View>
                  ))}
                </View>
                <Text style={styles.sub}>
                  {[detail.brand, detail.model, detail.serialNumber && `SN ${detail.serialNumber}`, detail.location, detail.supplier && `from ${detail.supplier}`].filter(Boolean).join(' · ')}
                </Text>
                <Text style={styles.sub}>{money(detail.unitCost)} per {detail.unit} · {money(detail.totalValue)} total{detail.purchaseDate ? ` · bought ${day(detail.purchaseDate)}` : ''}{detail.warrantyExpiry ? ` · warranty to ${day(detail.warrantyExpiry)}` : ''}</Text>
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.action} disabled={detail.available <= 0} onPress={() => { ensurePeople(); setAct({ type: 'assign', item: detail, qty: '1', text: '', date: today(), returnBy: '' }); }}>
                    <Text style={[styles.actionText, detail.available <= 0 && { color: '#94A3B8' }]}>Assign</Text>
                  </TouchableOpacity>
                  {detail.itemType === 'CONSUMABLE' && (
                    <TouchableOpacity style={styles.action} onPress={() => setAct({ type: 'consume', item: detail, qty: '1', text: '', date: today(), returnBy: '' })}><Text style={styles.actionText}>Use up</Text></TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.action} onPress={() => setAct({ type: 'expire', item: detail, qty: '1', text: '', date: today(), returnBy: '' })}><Text style={styles.actionText}>Write off</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.action} onPress={() => setAct({ type: 'adjust', item: detail, qty: '1', text: '', date: today(), returnBy: '' })}><Text style={styles.actionText}>Adjust stock</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.action} onPress={() => setForm({ ...BLANK, ...Object.fromEntries(Object.entries(detail).map(([k, v]) => [k, v == null ? '' : typeof v === 'number' ? String(v) : String(v).slice(0, k.toLowerCase().includes('date') || k.includes('Expiry') ? 10 : undefined)])), id: detail.id } as any)}>
                    <Text style={styles.actionText}>Edit</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.section}>STATUS</Text>
                <View style={styles.actions}>
                  {STATUSES.map((st) => (
                    <TouchableOpacity key={st} style={[styles.chip, detail.status === st && styles.chipOn]} onPress={() => detail.status !== st && setStatus(detail, st)}>
                      <Text style={[styles.chipText, detail.status === st && styles.chipTextOn]}>{pretty(st)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.section}>HISTORY</Text>
                {history === null ? <ActivityIndicator color={theme.colors.primary} /> : history.length ? history.map((t) => (
                  <View key={t.id} style={styles.txn}>
                    <Text style={styles.txnType}>{pretty(t.type)}</Text>
                    <Text style={[styles.sub, { flex: 1 }]} numberOfLines={2}>
                      {t.quantity} · {day(t.date)}{t.employee ? ` · ${fullName(t.employee)}` : t.assigneeText ? ` · ${t.assigneeText}` : ''}{t.purpose ? ` · ${t.purpose}` : t.reason ? ` · ${t.reason}` : ''}
                    </Text>
                  </View>
                )) : <Text style={styles.sub}>No history.</Text>}
                <TouchableOpacity style={styles.danger} onPress={() => remove(detail)}>
                  <Trash2 size={16} color="#B91C1C" /><Text style={styles.dangerText}>Delete item</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Assign / use up / write off / adjust */}
      <Modal visible={!!act} transparent animationType="slide" onRequestClose={() => setAct(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottom}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={[styles.sheetTitle, { flex: 1 }]}>{act ? { assign: 'Assign', consume: 'Use up', expire: 'Write off', adjust: 'Adjust stock' }[act.type] : ''} · {act?.item.name}</Text>
              <TouchableOpacity onPress={() => setAct(null)}><X size={20} color="#334155" /></TouchableOpacity>
            </View>
            {act && (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
                <Text style={styles.label}>{act.type === 'adjust' ? 'Change (e.g. 5 or -2)' : `Quantity (${act.item.available} available)`}</Text>
                <TextInput style={styles.input} value={act.qty} onChangeText={(v) => setAct((a) => (a ? { ...a, qty: v.replace(act.type === 'adjust' ? /[^0-9-]/g : /[^0-9]/g, '') } : a))} keyboardType="numbers-and-punctuation" />
                {act.type === 'assign' && (
                  <>
                    <Text style={styles.label}>To</Text>
                    <TouchableOpacity style={styles.input} onPress={() => setPersonPick(true)}>
                      <Text style={styles.inputText}>{fullName(people.find((p) => p.id === act.employeeId)) || 'Choose employee…'}</Text>
                    </TouchableOpacity>
                    {!act.employeeId && <TextInput style={styles.input} value={act.text} onChangeText={(v) => setAct((a) => (a ? { ...a, text: v } : a))} placeholder="…or a place / team (e.g. Meeting room 2)" placeholderTextColor="#94A3B8" />}
                    <Text style={styles.label}>Return by (YYYY-MM-DD, optional)</Text>
                    <TextInput style={styles.input} value={act.returnBy} onChangeText={(v) => setAct((a) => (a ? { ...a, returnBy: v } : a))} autoCapitalize="none" />
                  </>
                )}
                {act.type !== 'assign' && (
                  <TextInput style={styles.input} value={act.text} onChangeText={(v) => setAct((a) => (a ? { ...a, text: v } : a))} placeholder={act.type === 'consume' ? 'Purpose (optional)' : 'Reason'} placeholderTextColor="#94A3B8" />
                )}
                <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
                <TextInput style={styles.input} value={act.date} onChangeText={(v) => setAct((a) => (a ? { ...a, date: v } : a))} autoCapitalize="none" />
                <TouchableOpacity
                  style={[styles.submit, (!Number(act.qty) || (act.type === 'assign' && !act.employeeId && !act.text.trim())) && { opacity: 0.5 }]}
                  disabled={!Number(act.qty) || (act.type === 'assign' && !act.employeeId && !act.text.trim())}
                  onPress={runAction}
                >
                  <Text style={styles.primaryText}>Save</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
        <Modal visible={personPick} transparent animationType="slide" onRequestClose={() => setPersonPick(false)}>
          <TouchableOpacity style={styles.bottom} activeOpacity={1} onPress={() => setPersonPick(false)}>
            <TouchableOpacity activeOpacity={1} style={[styles.sheet, { maxHeight: '75%' }]}>
              <View style={[styles.search, { margin: 12 }]}>
                <Search size={16} color="#94A3B8" />
                <TextInput style={styles.searchInput} value={pq} onChangeText={setPq} placeholder="Find employee" placeholderTextColor="#94A3B8" autoCorrect={false} />
              </View>
              <ScrollView keyboardShouldPersistTaps="handled">
                {people.filter((p) => !pq.trim() || `${fullName(p)} ${p.employeeCode || ''}`.toLowerCase().includes(pq.trim().toLowerCase()))
                  .sort((a, b) => fullName(a).localeCompare(fullName(b))).map((p) => (
                    <TouchableOpacity key={p.id} style={styles.option} onPress={() => { setAct((a) => (a ? { ...a, employeeId: p.id, text: '' } : a)); setPersonPick(false); setPq(''); }}>
                      <Avatar person={p} size={30} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.optionText}>{fullName(p)}</Text>
                        <Text style={styles.sub}>{[p.designation?.name, p.employeeCode && `#${p.employeeCode}`].filter(Boolean).join(' · ')}</Text>
                      </View>
                      {act?.employeeId === p.id && <Check size={16} color="#1373E5" />}
                    </TouchableOpacity>
                  ))}
              </ScrollView>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </Modal>

      {/* Return */}
      <Modal visible={!!ret} transparent animationType="slide" onRequestClose={() => setRet(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottom}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={[styles.sheetTitle, { flex: 1 }]}>Return · {ret?.txn.item?.name}</Text>
              <TouchableOpacity onPress={() => setRet(null)}><X size={20} color="#334155" /></TouchableOpacity>
            </View>
            {ret && (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
                <Text style={styles.label}>Quantity ({outstanding(ret.txn)} still out)</Text>
                <TextInput style={styles.input} value={ret.qty} onChangeText={(v) => setRet((r) => (r ? { ...r, qty: v.replace(/[^0-9]/g, '') } : r))} keyboardType="number-pad" />
                <Text style={styles.label}>Condition</Text>
                <View style={styles.actions}>
                  {['GOOD', 'FAIR', 'DAMAGED'].map((c) => (
                    <TouchableOpacity key={c} style={[styles.chip, ret.condition === c && styles.chipOn]} onPress={() => setRet((r) => (r ? { ...r, condition: c } : r))}>
                      <Text style={[styles.chipText, ret.condition === c && styles.chipTextOn]}>{pretty(c)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput style={styles.input} value={ret.notes} onChangeText={(v) => setRet((r) => (r ? { ...r, notes: v } : r))} placeholder="Notes (optional)" placeholderTextColor="#94A3B8" />
                <TouchableOpacity style={[styles.submit, !Number(ret.qty) && { opacity: 0.5 }]} disabled={!Number(ret.qty)} onPress={doReturn}>
                  <Text style={styles.primaryText}>Record return</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add / edit item */}
      <Modal visible={!!form} transparent animationType="slide" onRequestClose={() => setForm(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottom}>
          <View style={[styles.sheet, { maxHeight: '92%' }]}>
            <View style={styles.sheetHead}>
              <Text style={[styles.sheetTitle, { flex: 1 }]}>{form?.id ? 'Edit item' : 'Add item'}</Text>
              <TouchableOpacity onPress={() => setForm(null)}><X size={20} color="#334155" /></TouchableOpacity>
            </View>
            {form && (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
                <TextInput style={styles.input} value={form.name} onChangeText={(v) => setForm((f) => (f ? { ...f, name: v } : f))} placeholder="Item name *" placeholderTextColor="#94A3B8" />
                <Text style={styles.label}>Type</Text>
                <View style={styles.actions}>
                  {(['ASSET', 'CONSUMABLE'] as const).map((k) => (
                    <TouchableOpacity key={k} style={[styles.chip, form.itemType === k && styles.chipOn]} onPress={() => setForm((f) => (f ? { ...f, itemType: k } : f))}>
                      <Text style={[styles.chipText, form.itemType === k && styles.chipTextOn]}>{k === 'ASSET' ? 'Asset (returnable)' : 'Consumable'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.label}>Category</Text>
                <View style={[styles.actions, { flexWrap: 'wrap' }]}>
                  {CATEGORIES.map((c) => (
                    <TouchableOpacity key={c} style={[styles.chip, form.category === c && styles.chipOn]} onPress={() => setForm((f) => (f ? { ...f, category: c } : f))}>
                      <Text style={[styles.chipText, form.category === c && styles.chipTextOn]}>{pretty(c)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput style={[styles.input, { flex: 1 }]} value={form.quantity} onChangeText={(v) => setForm((f) => (f ? { ...f, quantity: v.replace(/[^0-9]/g, '') } : f))} placeholder="Quantity" keyboardType="number-pad" placeholderTextColor="#94A3B8" editable={!form.id} />
                  <TextInput style={[styles.input, { flex: 1 }]} value={form.unitCost} onChangeText={(v) => setForm((f) => (f ? { ...f, unitCost: v.replace(/[^0-9.]/g, '') } : f))} placeholder="Unit cost ₹" keyboardType="decimal-pad" placeholderTextColor="#94A3B8" />
                </View>
                {!!form.id && <Text style={styles.tiny}>Change quantity with “Adjust stock”, so the history stays right.</Text>}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {UNITS.map((u) => (
                    <TouchableOpacity key={u} style={[styles.chip, form.unit === u && styles.chipOn]} onPress={() => setForm((f) => (f ? { ...f, unit: u } : f))}>
                      <Text style={[styles.chipText, form.unit === u && styles.chipTextOn]}>{u}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                {([['brand', 'Brand'], ['model', 'Model'], ['serialNumber', 'Serial number'], ['location', 'Location'], ['supplier', 'Supplier'],
                  ['purchaseDate', 'Purchase date (YYYY-MM-DD)'], ['warrantyExpiry', 'Warranty until (YYYY-MM-DD)'], ['expiryDate', 'Expiry (consumables, YYYY-MM-DD)'], ['notes', 'Notes']] as const).map(([k, l]) => (
                  <TextInput key={k} style={styles.input} value={(form as any)[k]} onChangeText={(v) => setForm((f) => (f ? { ...f, [k]: v } : f))} placeholder={l} placeholderTextColor="#94A3B8" autoCapitalize={k.includes('Date') || k.includes('xpiry') ? 'none' : 'sentences'} />
                ))}
                <TouchableOpacity style={[styles.submit, !form.name.trim() && { opacity: 0.5 }]} disabled={!form.name.trim()} onPress={saveItem}>
                  <Text style={styles.primaryText}>{form.id ? 'Save changes' : 'Add item'}</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 120, gap: 8 },
  tabs: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 12, padding: 3, gap: 3 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9 },
  tabOn: { backgroundColor: '#fff' },
  tabText: { fontSize: 13, fontWeight: '700', color: '#64748B' },
  tabTextOn: { color: '#0F172A' },
  kpis: { flexDirection: 'row', gap: 6 },
  kpi: { flex: 1, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 4, alignItems: 'center' },
  kpiNum: { fontSize: 18, fontWeight: '800' },
  kpiLabel: { fontSize: 10, fontWeight: '700' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 0 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  chipOn: { backgroundColor: '#1373E5', borderColor: '#1373E5' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  chipTextOn: { color: '#fff' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 12 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  sub: { fontSize: 12, color: '#64748B' },
  tiny: { fontSize: 11, color: '#94A3B8' },
  low: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FFF7ED', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  lowText: { fontSize: 10, fontWeight: '800', color: '#C2410C' },
  status: { fontSize: 10, fontWeight: '800', color: '#64748B' },
  value: { fontSize: 12, fontWeight: '700', color: '#0F172A' },
  returnBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 34, borderRadius: 10, backgroundColor: '#EFF6FF' },
  returnText: { fontSize: 12, fontWeight: '800', color: '#1373E5' },
  reqPill: { fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  reqReason: { fontSize: 13, color: '#334155', lineHeight: 19 },
  reqBtn: { flex: 1, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  reqReject: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
  reqRejectText: { color: '#B91C1C', fontWeight: '800' },
  reqApprove: { backgroundColor: '#16A34A' },
  done: { fontSize: 11, fontWeight: '800', color: '#047857' },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 30, paddingHorizontal: 24 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 38, borderRadius: 12, backgroundColor: '#1373E5' },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  bottom: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '85%', paddingBottom: 30 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  stock: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  stockCell: { width: '31.5%', backgroundColor: '#F8FAFC', borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  stockNum: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  action: { paddingHorizontal: 12, height: 36, borderRadius: 10, backgroundColor: '#EFF6FF', justifyContent: 'center' },
  actionText: { fontSize: 13, fontWeight: '700', color: '#1373E5' },
  section: { fontSize: 11, fontWeight: '800', color: '#64748B', letterSpacing: 0.6, marginTop: 4 },
  txn: { flexDirection: 'row', gap: 10, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  txnType: { width: 90, fontSize: 12, fontWeight: '700', color: '#334155' },
  danger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: 12, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', marginTop: 8 },
  dangerText: { color: '#B91C1C', fontWeight: '800' },
  label: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  input: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#0F172A', backgroundColor: '#F8FAFC' },
  inputText: { fontSize: 14, color: '#0F172A' },
  submit: { height: 48, borderRadius: 12, backgroundColor: '#1373E5', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
  optionText: { fontSize: 15, color: '#0F172A' },
});
