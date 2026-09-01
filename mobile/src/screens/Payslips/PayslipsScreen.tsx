import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  ArrowLeft,
  FileText,
  ChevronRight,
  X,
  TrendingUp,
  TrendingDown,
  Calendar,
  Briefcase,
  DollarSign,
} from 'lucide-react-native';
import { payrollService, Payslip, PayslipItem } from '../../api/payrollService';

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function fmt(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function StatusBadge({ status }: { status: Payslip['status'] }) {
  const cfg = {
    PAID:      { bg: '#DCFCE7', text: '#15803D', label: 'Paid' },
    FINALIZED: { bg: '#FEF9C3', text: '#A16207', label: 'Finalized' },
    DRAFT:     { bg: '#F1F5F9', text: '#64748B', label: 'Draft' },
  }[status] ?? { bg: '#F1F5F9', text: '#64748B', label: status };

  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.badgeText, { color: cfg.text }]}>{cfg.label}</Text>
    </View>
  );
}

function SectionRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, bold && styles.detailLabelBold]}>{label}</Text>
      <Text style={[styles.detailValue, bold && styles.detailValueBold]}>{value}</Text>
    </View>
  );
}

function PayslipDetail({ payslip, onClose }: { payslip: Payslip; onClose: () => void }) {
  const earnings  = payslip.items.filter(i => i.type === 'EARNING');
  const deductions = payslip.items.filter(i => i.type === 'DEDUCTION');
  const expenses  = payslip.items.filter(i => i.type === 'EXPENSE');
  const name = `${payslip.employee.firstName} ${payslip.employee.lastName}`;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalContainer} edges={['top']}>
        <StatusBar barStyle="dark-content" />

        {/* Modal header */}
        <View style={styles.modalHeader}>
          <View>
            <Text style={styles.modalTitle}>{MONTH_NAMES[payslip.month - 1]} {payslip.year}</Text>
            <Text style={styles.modalSubtitle}>Payslip</Text>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
            <X size={18} color="#475569" />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.detailScroll} showsVerticalScrollIndicator={false}>

          {/* Employee info */}
          <View style={styles.card}>
            <View style={styles.empRow}>
              <View style={styles.empAvatar}>
                <Text style={styles.empAvatarText}>{payslip.employee.firstName[0]}{payslip.employee.lastName[0]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.empName}>{name}</Text>
                {payslip.employee.designation && (
                  <Text style={styles.empMeta}>{payslip.employee.designation.name}</Text>
                )}
                {payslip.employee.department && (
                  <Text style={styles.empMeta}>{payslip.employee.department.name}</Text>
                )}
              </View>
              <StatusBadge status={payslip.status} />
            </View>
            {payslip.paidOn && (
              <View style={styles.paidOnRow}>
                <Calendar size={13} color="#64748B" />
                <Text style={styles.paidOnText}>Paid on {new Date(payslip.paidOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
              </View>
            )}
          </View>

          {/* Attendance */}
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Briefcase size={15} color="#E25E3E" />
              <Text style={styles.cardTitle}>Attendance</Text>
            </View>
            <View style={styles.attGrid}>
              {[
                { label: 'Working Days', value: String(payslip.workingDays) },
                { label: 'Present',       value: String(payslip.presentDays) },
                { label: 'Absent',        value: String(payslip.absentDays) },
                { label: 'Half Days',     value: String(payslip.halfDays) },
              ].map(item => (
                <View key={item.label} style={styles.attCell}>
                  <Text style={styles.attValue}>{item.value}</Text>
                  <Text style={styles.attLabel}>{item.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Earnings */}
          {earnings.length > 0 && (
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <TrendingUp size={15} color="#10B981" />
                <Text style={styles.cardTitle}>Earnings</Text>
              </View>
              {earnings.map(renderItem)}
              <View style={styles.divider} />
              <SectionRow label="Total Earnings" value={fmt(payslip.totalEarnings)} bold />
            </View>
          )}

          {/* Deductions */}
          {(deductions.length > 0 || payslip.lossOfPay > 0) && (
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <TrendingDown size={15} color="#EF4444" />
                <Text style={styles.cardTitle}>Deductions</Text>
              </View>
              {deductions.map(renderItem)}
              {payslip.lossOfPay > 0 && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Loss of Pay</Text>
                  <Text style={[styles.detailValue, { color: '#EF4444' }]}>{fmt(payslip.lossOfPay)}</Text>
                </View>
              )}
              <View style={styles.divider} />
              <SectionRow label="Total Deductions" value={fmt(payslip.totalDeductions)} bold />
            </View>
          )}

          {/* Expenses */}
          {expenses.length > 0 && (
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <DollarSign size={15} color="#8B5CF6" />
                <Text style={styles.cardTitle}>Expense Reimbursements</Text>
              </View>
              {expenses.map(renderItem)}
              <View style={styles.divider} />
              <SectionRow label="Total Expenses" value={fmt(payslip.expenseAmount)} bold />
            </View>
          )}

          {/* Net Pay */}
          <View style={[styles.card, styles.netPayCard]}>
            <Text style={styles.netPayLabel}>Net Pay</Text>
            <Text style={styles.netPayValue}>{fmt(payslip.netPay)}</Text>
          </View>

        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function renderItem(item: PayslipItem) {
  return (
    <View key={item.id} style={styles.detailRow}>
      <Text style={styles.detailLabel}>{item.componentName}</Text>
      <Text style={styles.detailValue}>{fmt(item.amount)}</Text>
    </View>
  );
}

function PayslipCard({ payslip, onPress }: { payslip: Payslip; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={onPress}>
      <View style={styles.cardRow}>
        <View style={styles.cardIcon}>
          <FileText size={20} color="#E25E3E" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardMonthText}>{MONTH_NAMES[payslip.month - 1]} {payslip.year}</Text>
          <Text style={styles.cardNetPay}>{fmt(payslip.netPay)}</Text>
        </View>
        <StatusBadge status={payslip.status} />
        <ChevronRight size={16} color="#94A3B8" style={{ marginLeft: 8 }} />
      </View>
    </TouchableOpacity>
  );
}

export default function PayslipsScreen() {
  const navigation = useNavigation();
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Payslip | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await payrollService.getMyPayslips();
      data.sort((a, b) => b.year !== a.year ? b.year - a.year : b.month - a.month);
      setPayslips(data);
      if (data.length > 0) {
        setSelectedYear(data[0].year);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load payslips');
    } finally {
      setLoading(false);
    }
  }, []);

  const years = useMemo(() => {
    const set = new Set(payslips.map(p => p.year));
    return Array.from(set).sort((a, b) => b - a);
  }, [payslips]);

  const filtered = useMemo(
    () => payslips.filter(p => p.year === selectedYear),
    [payslips, selectedYear],
  );

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <ArrowLeft size={20} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payslips</Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#E25E3E" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load} activeOpacity={0.7}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : payslips.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <FileText size={36} color="#CBD5E1" />
          </View>
          <Text style={styles.emptyTitle}>No payslips yet</Text>
          <Text style={styles.emptyMsg}>Your finalized payslips will appear here once payroll is processed.</Text>
        </View>
      ) : (
        <>
          {years.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.yearBar}
              contentContainerStyle={styles.yearBarContent}
            >
              {years.map(y => (
                <TouchableOpacity
                  key={y}
                  style={[styles.yearChip, selectedYear === y && styles.yearChipActive]}
                  onPress={() => setSelectedYear(y)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.yearChipText, selectedYear === y && styles.yearChipTextActive]}>
                    {y}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          <FlatList
            data={filtered}
            keyExtractor={item => String(item.id)}
            renderItem={({ item }) => (
              <PayslipCard payslip={item} onPress={() => setSelected(item)} />
            )}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No payslips for {selectedYear}</Text>
              </View>
            }
          />
        </>
      )}

      {selected && (
        <PayslipDetail payslip={selected} onClose={() => setSelected(null)} />
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  list: {
    padding: 16,
    gap: 10,
  },
  yearBar: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  yearBarContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    flexDirection: 'row',
  },
  yearChip: {
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 8,
  },
  yearChipActive: {
    backgroundColor: '#E25E3E',
    borderColor: '#E25E3E',
  },
  yearChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  yearChipTextActive: {
    color: '#FFFFFF',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    marginBottom: 10,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FFF1EC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardMonthText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 2,
  },
  cardNetPay: {
    fontSize: 13,
    color: '#64748B',
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorText: {
    fontSize: 14,
    color: '#EF4444',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryBtn: {
    backgroundColor: '#E25E3E',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 12,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  emptyMsg: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
  },
  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailScroll: {
    padding: 16,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  empRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  empAvatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#E25E3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  empAvatarText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
  empName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  empMeta: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  paidOnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  paidOnText: {
    fontSize: 12,
    color: '#64748B',
  },
  attGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  attCell: {
    flex: 1,
    minWidth: '40%',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  attValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0F172A',
  },
  attLabel: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
  },
  detailLabel: {
    fontSize: 13,
    color: '#64748B',
    flex: 1,
  },
  detailLabelBold: {
    color: '#0F172A',
    fontWeight: '700',
  },
  detailValue: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '500',
  },
  detailValueBold: {
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 6,
  },
  netPayCard: {
    backgroundColor: '#E25E3E',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  netPayLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  netPayValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
