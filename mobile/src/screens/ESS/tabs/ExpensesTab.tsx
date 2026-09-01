import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert, Modal, Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { IndianRupee, Plus, FileText, Calendar, Trash2, Pencil, X, ZoomIn } from 'lucide-react-native';
import { payrollService, ExpenseClaim } from '../../../api/payrollService';
import CreateExpenseModal from '../modals/CreateExpenseModal';

export default function ExpensesTab() {
  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingClaim, setEditingClaim] = useState<ExpenseClaim | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

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
          } catch (err) {
            Alert.alert('Error', 'Failed to delete claim');
          }
        }
      }
    ]);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'APPROVED': return { bg: '#DCFCE7', text: '#166534' };
      case 'REJECTED': return { bg: '#FEE2E2', text: '#991B1B' };
      default: return { bg: '#FEF9C3', text: '#854D0E' };
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#E25E3E" />
      </View>
    );
  }

  const renderItem = ({ item }: { item: ExpenseClaim }) => {
    const s = getStatusColor(item.status);
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{item.title}</Text>
            <View style={[styles.statusPill, { backgroundColor: s.bg }]}>
              <Text style={[styles.statusText, { color: s.text }]}>{item.status}</Text>
            </View>
          </View>
          <Text style={styles.amount}>₹{item.amount.toLocaleString('en-IN')}</Text>
        </View>

        <View style={styles.cardBody}>
          <Text style={styles.category}>{item.category}</Text>
          {item.projectName && (
            <Text style={styles.projectText}>{item.projectName}</Text>
          )}
          {item.purchaseDate && (
            <View style={styles.row}>
              <Calendar size={14} color="#64748B" />
              <Text style={styles.dateText}>{item.purchaseDate.split('T')[0]}</Text>
            </View>
          )}
          {item.description && (
            <Text style={styles.description} numberOfLines={2}>{item.description}</Text>
          )}
          {item.status === 'REJECTED' && item.rejectionReason && (
            <Text style={styles.rejectionReason}>Reason: {item.rejectionReason}</Text>
          )}
          {item.receiptUrl && /\.(jpg|jpeg|png|gif|webp)/i.test(item.receiptUrl) && (
            <TouchableOpacity
              style={styles.receiptThumbWrap}
              onPress={() => setLightboxUrl(item.receiptUrl!)}
              activeOpacity={0.8}
            >
              <Image source={{ uri: item.receiptUrl }} style={styles.receiptThumb} resizeMode="cover" />
              <View style={styles.receiptThumbOverlay}>
                <ZoomIn size={16} color="#FFFFFF" />
              </View>
            </TouchableOpacity>
          )}
        </View>

        {item.status === 'PENDING' && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => { setEditingClaim(item); setModalVisible(true); }}
            >
              <Pencil size={16} color="#2563EB" />
              <Text style={styles.editText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.delBtn} onPress={() => handleDelete(item.id)}>
              <Trash2 size={16} color="#EF4444" />
              <Text style={styles.delText}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={claims}
        keyExtractor={item => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#E25E3E']} tintColor="#E25E3E" />
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <FileText size={48} color="#CBD5E1" />
            <Text style={styles.emptyTitle}>No Expenses</Text>
            <Text style={styles.emptySub}>You haven't submitted any expense claims.</Text>
          </View>
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => { setEditingClaim(null); setModalVisible(true); }}
      >
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
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, paddingBottom: 100 },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  titleRow: { flex: 1, marginRight: 12 },
  title: { fontSize: 16, fontWeight: '700', color: '#0F172A', marginBottom: 4 },
  statusPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: { fontSize: 10, fontWeight: '800' },
  amount: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  cardBody: { gap: 6 },
  category: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dateText: { fontSize: 12, color: '#64748B' },
  description: { fontSize: 13, color: '#475569', marginTop: 4 },
  rejectionReason: { fontSize: 13, color: '#DC2626', marginTop: 4, fontStyle: 'italic' },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6, marginRight: 8 },
  editText: { color: '#2563EB', fontSize: 13, fontWeight: '600' },
  delBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6 },
  delText: { color: '#EF4444', fontSize: 13, fontWeight: '600' },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#E25E3E',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#E25E3E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#475569', marginTop: 16 },
  projectText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0EA5E9',
    marginBottom: 8,
  },
  emptySub: { fontSize: 13, color: '#94A3B8', marginTop: 4 },
  receiptThumbWrap: {
    marginTop: 10,
    borderRadius: 10,
    overflow: 'hidden',
    width: 100,
    height: 72,
  },
  receiptThumb: {
    width: 100,
    height: 72,
  },
  receiptThumbOverlay: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
    padding: 4,
  },
  lightboxOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxClose: {
    position: 'absolute',
    top: 52,
    right: 20,
    zIndex: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
    padding: 8,
  },
  lightboxImage: {
    width: '100%',
    height: '80%',
  },
});
