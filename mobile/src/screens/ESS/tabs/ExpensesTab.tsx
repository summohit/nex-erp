import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { IndianRupee, Plus, FileText, Calendar, Trash2 } from 'lucide-react-native';
import { payrollService, ExpenseClaim } from '../../../api/payrollService';
import CreateExpenseModal from '../modals/CreateExpenseModal';

export default function ExpensesTab() {
  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

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

  return (
    <View style={styles.container}>
      <View style={styles.list}>
        {claims.length === 0 ? (
          <View style={styles.emptyBox}>
            <FileText size={48} color="#CBD5E1" />
            <Text style={styles.emptyTitle}>No Expenses</Text>
            <Text style={styles.emptySub}>You haven't submitted any expense claims.</Text>
          </View>
        ) : (
          claims.map((item) => {
            const s = getStatusColor(item.status);
            return (
              <View key={item.id.toString()} style={styles.card}>
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
                </View>

                {item.status === 'PENDING' && (
                  <View style={styles.actions}>
                    <TouchableOpacity style={styles.delBtn} onPress={() => handleDelete(item.id)}>
                      <Trash2 size={16} color="#EF4444" />
                      <Text style={styles.delText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })
        )}
      </View>

      <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)}>
        <Plus size={24} color="#FFF" />
      </TouchableOpacity>

      <CreateExpenseModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSuccess={() => {
          setModalVisible(false);
          fetchClaims();
        }}
      />
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
});
