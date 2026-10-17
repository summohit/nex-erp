import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert, Modal, Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  IndianRupee, Plus, FileText, Calendar, Trash2, Pencil, X, ZoomIn, Store, FolderKanban, Clock, CheckCircle, XCircle,
  Receipt, Car, Utensils, Plane, Laptop, Phone,
} from 'lucide-react-native';
import GradientHero from '../../../components/GradientHero';
import { ds, colors, status } from '../../../theme/ds';
import { payrollService, ExpenseClaim } from '../../../api/payrollService';
import CreateExpenseModal from '../modals/CreateExpenseModal';

type Filter = 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED';

const rupees = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;

const STATUS: Record<string, { tone: typeof status.success; label: string; icon: any }> = {
  PENDING: { tone: status.warning, label: 'Pending', icon: Clock },
  APPROVED: { tone: status.success, label: 'Approved', icon: CheckCircle },
  REJECTED: { tone: status.danger, label: 'Rejected', icon: XCircle },
};

/** An icon for the category, so a list of claims scans at a glance. */
function categoryIcon(category: string) {
  const c = (category || '').toLowerCase();
  if (/travel|fuel|cab|taxi|conveyance|transport/.test(c)) return Car;
  if (/food|meal|lunch|dinner/.test(c)) return Utensils;
  if (/flight|hotel|stay|tour/.test(c)) return Plane;
  if (/laptop|hardware|equipment|software/.test(c)) return Laptop;
  if (/phone|mobile|internet|telephone/.test(c)) return Phone;
  return Receipt;
}

/**
 * Expense claims, in the Timesheet design system: a hero with what was
 * claimed this year, a status filter, and one card per claim.
 */
export default function ExpensesTab() {
  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingClaim, setEditingClaim] = useState<ExpenseClaim | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');

  const fetchClaims = async () => {
    try {
      const data = await payrollService.getMyExpenseClaims();
      setClaims(data);
    } catch (err) {
      console.error('Failed to fetch expense claims', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchClaims();
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchClaims();
  };

  const handleDelete = (id: number) => {
    Alert.alert('Delete Claim', 'Are you sure you want to delete this pending claim?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await payrollService.deleteExpenseClaim(id);
            fetchClaims();
          } catch {
            Alert.alert('Error', 'Failed to delete claim');
          }
        }
      }
    ]);
  };

  const year = new Date().getFullYear();
  const totals = useMemo(() => {
    const sum = (st?: string) => claims
      .filter((c) => (!st || c.status === st) && new Date(c.purchaseDate || c.createdAt).getFullYear() === year)
      .reduce((t, c) => t + (Number(c.amount) || 0), 0);
    return {
      claimed: sum(), pending: sum('PENDING'), approved: sum('APPROVED'), rejected: sum('REJECTED'),
      count: (st: Filter) => (st === 'ALL' ? claims.length : claims.filter((c) => c.status === st).length),
    };
  }, [claims, year]);
  const shown = filter === 'ALL' ? claims : claims.filter((c) => c.status === filter);
  const openNew = () => { setEditingClaim(null); setModalVisible(true); };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const renderItem = ({ item }: { item: ExpenseClaim }) => {
    const st = STATUS[item.status] || STATUS.PENDING;
    const StatusIcon = st.icon;
    const CatIcon = categoryIcon(item.category);
    const date = item.purchaseDate || item.createdAt;
    const hasImage = !!item.receiptUrl && /\.(jpg|jpeg|png|gif|webp)/i.test(item.receiptUrl);
    return (
      <View style={[ds.listCard, styles.card]}>
        <View style={styles.top}>
          <View style={styles.catBox}>
            <CatIcon size={18} color={colors.primary} />
          </View>
          <View style={styles.center1}>
            <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
            <Text style={styles.category} numberOfLines={1}>{item.category}</Text>
          </View>
          <View style={styles.amountCol}>
            <Text style={styles.amount}>{rupees(item.amount)}</Text>
            <View style={[ds.pill, { backgroundColor: st.tone.bg, borderColor: st.tone.border }]}>
              <StatusIcon size={10} color={st.tone.strong} />
              <Text style={[ds.pillText, { color: st.tone.strong }]}>{st.label}</Text>
            </View>
          </View>
        </View>

        <View style={styles.chips}>
          {!!date && (
            <View style={ds.chip}>
              <Calendar size={11} color={colors.textMuted} />
              <Text style={ds.chipText}>
                {new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </Text>
            </View>
          )}
          {!!item.purchasedFrom && (
            <View style={ds.chip}>
              <Store size={11} color={colors.textMuted} />
              <Text style={ds.chipText} numberOfLines={1}>{item.purchasedFrom}</Text>
            </View>
          )}
          {!!item.projectName && (
            <View style={ds.chip}>
              <FolderKanban size={11} color={colors.textMuted} />
              <Text style={ds.chipText} numberOfLines={1}>{item.projectName}</Text>
            </View>
          )}
        </View>

        {!!item.description && <Text style={styles.description} numberOfLines={2}>“{item.description}”</Text>}

        {item.status === 'REJECTED' && !!item.rejectionReason && (
          <View style={styles.rejectBox}>
            <XCircle size={13} color={status.danger.strong} />
            <Text style={styles.rejectText}>{item.rejectionReason}</Text>
          </View>
        )}

        {(hasImage || item.status === 'PENDING') && (
          <View style={styles.footer}>
            {hasImage ? (
              <TouchableOpacity style={styles.receiptThumbWrap} onPress={() => setLightboxUrl(item.receiptUrl!)} activeOpacity={0.8}>
                <Image source={{ uri: item.receiptUrl }} style={styles.receiptThumb} resizeMode="cover" />
                <View style={styles.receiptThumbOverlay}>
                  <ZoomIn size={12} color="#FFFFFF" />
                </View>
              </TouchableOpacity>
            ) : <View />}
            {item.status === 'PENDING' && (
              <View style={styles.actions}>
                <TouchableOpacity style={ds.softButton} onPress={() => { setEditingClaim(item); setModalVisible(true); }} activeOpacity={0.75}>
                  <Pencil size={12} color={colors.primary} />
                  <Text style={ds.softButtonText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[ds.softButton, styles.delBtn]} onPress={() => handleDelete(item.id)} activeOpacity={0.75}>
                  <Trash2 size={12} color={status.danger.strong} />
                  <Text style={[ds.softButtonText, { color: status.danger.strong }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  const header = (
    <View>
      <GradientHero
        id="expenseHeroGrad"
        overline={`CLAIMED IN ${year}`}
        value={rupees(totals.claimed)}
        caption={`${claims.length} ${claims.length === 1 ? 'claim' : 'claims'} in total`}
        action={
          <TouchableOpacity style={ds.heroButton} onPress={openNew} activeOpacity={0.85}>
            <Plus size={14} color={colors.text} />
            <Text style={ds.heroButtonText}>New claim</Text>
          </TouchableOpacity>
        }
        stats={[
          { label: 'Pending', value: rupees(totals.pending), color: '#FDE68A' },
          { label: 'Approved', value: rupees(totals.approved), color: '#A7F3D0' },
          { label: 'Rejected', value: rupees(totals.rejected), color: '#FECACA' },
        ]}
      />
      {claims.length > 0 && (
        <View style={ds.segmented}>
          {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as Filter[]).map((f) => (
            <TouchableOpacity key={f} style={[ds.segment, filter === f && ds.segmentActive]} onPress={() => setFilter(f)} activeOpacity={0.85}>
              <Text style={[ds.segmentText, styles.segText, filter === f && ds.segmentTextActive]} numberOfLines={1}>
                {f === 'ALL' ? 'All' : STATUS[f].label} {totals.count(f)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={shown}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          <View style={ds.empty}>
            <View style={ds.emptyIcon}>
              {claims.length ? <FileText size={22} color={colors.primary} /> : <IndianRupee size={22} color={colors.primary} />}
            </View>
            <Text style={ds.emptyTitle}>{claims.length ? `No ${STATUS[filter]?.label.toLowerCase()} claims` : 'No expense claims yet'}</Text>
            <Text style={ds.emptyText}>
              {claims.length ? 'Try another filter.' : 'Spent money on work? Claim it back with the receipt.'}
            </Text>
            {!claims.length && (
              <TouchableOpacity style={ds.primaryButton} onPress={openNew} activeOpacity={0.85}>
                <Plus size={14} color="#FFFFFF" />
                <Text style={ds.primaryButtonText}>New claim</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />

      <TouchableOpacity style={styles.fab} onPress={openNew} activeOpacity={0.85}>
        <Plus size={24} color="#FFF" />
      </TouchableOpacity>

      <CreateExpenseModal
        visible={modalVisible}
        onClose={() => { setModalVisible(false); setEditingClaim(null); }}
        onSuccess={() => {
          setModalVisible(false);
          setEditingClaim(null);
          fetchClaims();
        }}
        editingClaim={editingClaim}
      />

      <Modal
        visible={!!lightboxUrl}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxUrl(null)}
        statusBarTranslucent
      >
        <View style={styles.lightboxOverlay}>
          <TouchableOpacity
            style={styles.lightboxClose}
            onPress={() => setLightboxUrl(null)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <X size={24} color="#FFFFFF" />
          </TouchableOpacity>
          {lightboxUrl && (
            <Image source={{ uri: lightboxUrl }} style={styles.lightboxImage} resizeMode="contain" />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  list: { padding: 16, paddingBottom: 140, gap: 10 },
  segText: { fontSize: 12 },
  card: { flexDirection: 'column', alignItems: 'stretch', gap: 10 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  catBox: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft,
    borderWidth: 1, borderColor: colors.primaryBorder, alignItems: 'center', justifyContent: 'center',
  },
  center1: { flex: 1, gap: 3 },
  title: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  category: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  amountCol: { alignItems: 'flex-end', gap: 5 },
  amount: { fontSize: 17, fontWeight: '900', color: colors.text, fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  description: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic', lineHeight: 18 },
  rejectBox: {
    flexDirection: 'row', gap: 6, alignItems: 'flex-start', backgroundColor: status.danger.bg,
    borderWidth: 1, borderColor: status.danger.border, borderRadius: 10, padding: 10,
  },
  rejectText: { flex: 1, fontSize: 12.5, color: status.danger.strong, fontWeight: '600', lineHeight: 17 },
  footer: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: 8 },
  delBtn: { backgroundColor: status.danger.bg, borderColor: status.danger.border },
  fab: {
    position: 'absolute', bottom: 24, right: 20, width: 54, height: 54, borderRadius: 18,
    backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center',
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  receiptThumbWrap: { borderRadius: 12, overflow: 'hidden', width: 84, height: 60, borderWidth: 1, borderColor: colors.border },
  receiptThumb: { width: 84, height: 60 },
  receiptThumbOverlay: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(15,23,42,0.55)', borderRadius: 8, padding: 3 },
  lightboxOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  lightboxClose: {
    position: 'absolute', top: 52, right: 20, zIndex: 10,
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, padding: 8,
  },
  lightboxImage: { width: '100%', height: '80%' },
});
