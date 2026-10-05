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
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppScreen from '../../components/AppScreen';
import {
  FileText,
  ChevronRight,
  X,
  Download,
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
    FINALIZED: { bg: '#f3efff', text: '#4f2aa7', label: 'Finalized' },
    DRAFT:     { bg: '#F1F5F9', text: '#64748B', label: 'Draft' },
  }[status] ?? { bg: '#F1F5F9', text: '#64748B', label: status };

  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.badgeText, { color: cfg.text }]}>{cfg.label}</Text>
    </View>
  );
}

/**
 * "One Lakh Twenty Nine Thousand Three Hundred and Sixty Eight Rupees Only" —
 * Indian grouping (lakh, crore), same wording as the web payslip.
 */
function amountInWords(amount: number): string {
  const n = Math.floor(Math.abs(amount || 0));
  if (n === 0) return 'Zero Rupees Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const under100 = (v: number): string =>
    v < 20 ? ones[v] : `${tens[Math.floor(v / 10)]}${v % 10 ? ' ' + ones[v % 10] : ''}`;
  const under1000 = (v: number): string => {
    const h = Math.floor(v / 100);
    const r = v % 100;
    return [h ? `${ones[h]} Hundred` : '', r ? (h ? 'and ' : '') + under100(r) : '']
      .filter(Boolean).join(' ');
  };
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${under1000(crore)} Crore`);
  if (lakh) parts.push(`${under100(lakh)} Lakh`);
  if (thousand) parts.push(`${under100(thousand)} Thousand`);
  if (rest) parts.push(under1000(rest));
  return `${parts.join(' ')} Rupees Only`;
}

function InfoCell({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <View style={styles.infoCell}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value === null || value === undefined || value === '' ? '—' : String(value)}</Text>
    </View>
  );
}

function PayslipDetail({ payslip, onClose }: { payslip: Payslip; onClose: () => void }) {
  const earnings   = payslip.items.filter(i => i.type === 'EARNING');
  const deductions = payslip.items.filter(i => i.type === 'DEDUCTION');
  const expenses   = payslip.items.filter(i => i.type === 'EXPENSE');
  const name = `${payslip.employee.firstName} ${payslip.employee.lastName}`;
  const monthName = MONTH_NAMES[payslip.month - 1];
  const [downloading, setDownloading] = useState(false);

  const onDownload = async () => {
    setDownloading(true);
    try {
      await payrollService.downloadPayslipPdf(
        payslip.id,
        `${payslip.employee.firstName}-${monthName}-${payslip.year}.pdf`,
      );
    } catch (e: any) {
      Alert.alert('Download failed', e?.message || 'Could not download the payslip.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalContainer} edges={['top', 'bottom']}>
        <StatusBar barStyle="dark-content" />

        <View style={styles.modalHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.modalTitle}>Payslip for {monthName} {payslip.year}</Text>
            <View style={styles.modalSubRow}>
              <Text style={styles.modalSubtitle} numberOfLines={1}>
                {name}{payslip.employee.designation ? ` · ${payslip.employee.designation.name}` : ''}
              </Text>
              <StatusBadge status={payslip.status} />
            </View>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
            <X size={18} color="#475569" />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.detailScroll} showsVerticalScrollIndicator={false}>
          <Image source={require('../../assets/ces_logo.png')} style={styles.logo} resizeMode="contain" />

          <View style={styles.infoBox}>
            <InfoCell label="Employee Name" value={name} />
            <InfoCell label="Employee ID" value={payslip.employee.employeeCode} />
            <InfoCell label="Designation" value={payslip.employee.designation?.name} />
            <InfoCell label="Department" value={payslip.employee.department?.name} />
            <InfoCell label="Working Days" value={payslip.workingDays} />
            <InfoCell label="Present Days" value={payslip.presentDays} />
            <InfoCell label="Absent Days" value={payslip.absentDays} />
            {payslip.halfDays > 0 && <InfoCell label="Half Days" value={payslip.halfDays} />}
          </View>

          <View style={styles.table}>
            <View style={styles.tableHead}>
              <Text style={styles.tableHeadText}>Earnings</Text>
              <Text style={styles.tableHeadText}>Amount (₹)</Text>
            </View>
            {earnings.map(renderItem)}
            <View style={[styles.tableRow, styles.tableTotalRow]}>
              <Text style={styles.tableTotalLabel}>Total Gross Earnings</Text>
              <Text style={styles.tableTotalValue}>{fmt(payslip.totalEarnings)}</Text>
            </View>
          </View>

          <View style={styles.table}>
            <View style={styles.tableHead}>
              <Text style={styles.tableHeadText}>Deductions</Text>
              <Text style={styles.tableHeadText}>Amount (₹)</Text>
            </View>
            {deductions.map(renderItem)}
            {payslip.lossOfPay > 0 && (
              <View style={styles.tableRow}>
                <Text style={styles.tableLabel}>Loss of Pay (LOP)</Text>
                <Text style={styles.tableValue}>{fmt(payslip.lossOfPay)}</Text>
              </View>
            )}
            <View style={[styles.tableRow, styles.tableTotalRow]}>
              <Text style={styles.tableTotalLabel}>Total Deductions</Text>
              <Text style={styles.tableTotalValue}>{fmt(payslip.totalDeductions)}</Text>
            </View>
          </View>

          {expenses.length > 0 && (
            <View style={styles.table}>
              <View style={styles.tableHead}>
                <Text style={styles.tableHeadText}>Expense Reimbursements</Text>
                <Text style={styles.tableHeadText}>Amount (₹)</Text>
              </View>
              {expenses.map(renderItem)}
              <View style={[styles.tableRow, styles.tableTotalRow]}>
                <Text style={styles.tableTotalLabel}>Total Expenses</Text>
                <Text style={styles.tableTotalValue}>{fmt(payslip.expenseAmount)}</Text>
              </View>
            </View>
          )}

          <View style={styles.netPayCard}>
            <Text style={styles.netPayLabel}>Net Salary Payable (Take Home)</Text>
            <Text style={styles.netPayValue}>{fmt(payslip.netPay)}</Text>
            <Text style={styles.netPayWords}>{amountInWords(payslip.netPay)}</Text>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.footerClose} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.footerCloseText}>Close</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.footerDownload, downloading && { opacity: 0.7 }]}
            onPress={onDownload}
            disabled={downloading}
            activeOpacity={0.8}
          >
            {downloading
              ? <ActivityIndicator size="small" color="#FFFFFF" />
              : <Download size={17} color="#FFFFFF" />}
            <Text style={styles.footerDownloadText}>{downloading ? 'Downloading…' : 'Download PDF'}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function renderItem(item: PayslipItem) {
  return (
    <View key={item.id} style={styles.tableRow}>
      <Text style={styles.tableLabel}>{item.componentName}</Text>
      <Text style={styles.tableValue}>{fmt(item.amount)}</Text>
    </View>
  );
}

function PayslipCard({ payslip, onPress }: { payslip: Payslip; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={onPress}>
      <View style={styles.cardRow}>
        <View style={styles.cardIcon}>
          <FileText size={20} color="#1373e5" />
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
    <AppScreen
      title="Payslips"
      subtitle="Salary & payroll slips"
    >

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1373e5" />
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
    </AppScreen>
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
    backgroundColor: '#1373e5',
    borderColor: '#1373e5',
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
    backgroundColor: '#eff6ff',
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
    color: '#1373e5',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryBtn: {
    backgroundColor: '#1373e5',
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
    flexShrink: 1,
  },
  modalSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 3,
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
  logo: {
    width: 130,
    height: 44,
    marginBottom: 14,
  },
  infoBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingTop: 12,
    marginBottom: 14,
  },
  infoCell: {
    width: '50%',
    paddingRight: 8,
    marginBottom: 12,
  },
  infoLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
    marginTop: 2,
  },
  table: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 14,
  },
  tableHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  tableHeadText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  tableLabel: {
    fontSize: 14,
    color: '#1E293B',
    flex: 1,
    paddingRight: 8,
  },
  tableValue: {
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '500',
  },
  tableTotalRow: {
    backgroundColor: '#F8FAFC',
  },
  tableTotalLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
  },
  tableTotalValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  netPayCard: {
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 18,
    marginBottom: 8,
  },
  netPayLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#CBD5E1',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  netPayValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#34D399',
    marginTop: 6,
  },
  netPayWords: {
    fontSize: 13,
    fontStyle: 'italic',
    color: '#E2E8F0',
    marginTop: 6,
    lineHeight: 18,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  footerClose: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerCloseText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#334155',
  },
  footerDownload: {
    flex: 2,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#1373e5',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  footerDownloadText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
