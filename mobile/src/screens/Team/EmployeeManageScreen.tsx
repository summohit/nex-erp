import React, { useEffect, useMemo, useState } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  Switch,
  Platform,
} from 'react-native';
import {
  ChevronDown,
  X,
  Check,
  Search,
  ShieldOff,
  ShieldCheck,
  GraduationCap,
  Building2,
  Briefcase,
  MapPin,
  Clock,
  UserCheck,
  Shield,
  IndianRupee,
} from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { useAuthStore } from '../../store/authStore';
import { safeGoBack } from '../../navigation/navigationUtils';
import { theme } from '../../theme/theme';

/**
 * HR / admin actions on one employee: placement (department, designation, branch,
 * shift, manager), system role, project-manager authority, internal cost rate,
 * deactivate/reactivate, and starting a trainee's conversion to employee.
 */
type Opt = { value: number | string; label: string; sub?: string };
type PickKey = 'departmentId' | 'designationId' | 'branchId' | 'shiftId' | 'managerId' | 'role' | 'jobId';

const ROLES: Opt[] = ['EMPLOYEE', 'OFFICE_STAFF', 'HR', 'FINANCE', 'SALES', 'ADMIN'].map((r) => ({
  value: r,
  label: r.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
}));
const COST_RATE_ROLES = ['SUPERADMIN', 'ADMIN', 'FINANCE'];
const errMsg = (e: any) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join('\n') : m || 'Please try again.';
};

const PICKER_ICONS: Record<PickKey, any> = {
  departmentId: Building2,
  designationId: Briefcase,
  branchId: MapPin,
  shiftId: Clock,
  managerId: UserCheck,
  role: Shield,
  jobId: Briefcase,
};

export default function EmployeeManageScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const id: number = route.params?.id;
  const myRole = useAuthStore((s) => s.user?.role) || '';

  const [p, setP] = useState<any>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [lists, setLists] = useState<Record<string, Opt[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState<PickKey | null>(null);
  const [query, setQuery] = useState('');
  const [rate, setRate] = useState('');
  const [convert, setConvert] = useState<{ jobId?: number; salary: string; joining: string } | null>(null);

  useEffect(() => {
    const get = (url: string) => apiClient.get(url).then((r) => r.data || []).catch(() => []);
    Promise.all([
      apiClient.get(`/employees/${id}/profile`).then((r) => r.data),
      get('/master-data/departments'),
      get('/master-data/designations'),
      get('/master-data/branches'),
      get('/shifts'),
      get('/employees/basic-list'),
    ])
      .then(([emp, deps, desigs, branches, shifts, people]) => {
        setP(emp);
        setForm({
          departmentId: emp.departmentId ?? null,
          designationId: emp.designationId ?? null,
          branchId: emp.branchId ?? null,
          shiftId: emp.shiftId ?? null,
          managerId: emp.managerId ?? null,
          role: emp.user?.role ?? 'EMPLOYEE',
          isProjectManager: !!emp.isProjectManager,
        });
        setRate(emp.hourlyCostRate != null ? String(emp.hourlyCostRate) : '');
        setLists({
          departmentId: deps.map((d: any) => ({ value: d.id, label: d.name })),
          designationId: desigs.map((d: any) => ({ value: d.id, label: d.name })),
          branchId: branches.map((b: any) => ({ value: b.id, label: b.name })),
          shiftId: shifts.map((s: any) => ({
            value: s.id,
            label: s.name,
            sub: s.startTime ? `${s.startTime}–${s.endTime}` : undefined,
          })),
          managerId: people
            .filter((x: any) => x.id !== id)
            .map((x: any) => ({
              value: x.id,
              label: `${x.firstName} ${x.lastName || ''}`.trim(),
              sub: [x.designation?.name, x.employeeCode && `#${x.employeeCode}`].filter(Boolean).join(' · '),
            })),
          role: myRole === 'SUPERADMIN' ? [...ROLES, { value: 'SUPERADMIN', label: 'Super Admin' }] : ROLES,
        });
      })
      .catch((e) => Alert.alert('Could not load', errMsg(e), [{ text: 'OK', onPress: () => safeGoBack(navigation) }]))
      .finally(() => setLoading(false));
  }, [id, myRole, navigation]);

  const labelFor = (k: PickKey) => {
    const v = k === 'jobId' ? convert?.jobId : form[k];
    return lists[k]?.find((o) => o.value === v)?.label || (v ? '—' : 'Select an option');
  };

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (picking ? lists[picking] || [] : []).filter(
      (o) => !q || `${o.label} ${o.sub || ''}`.toLowerCase().includes(q)
    );
  }, [picking, lists, query]);

  const choose = (v: any) => {
    if (picking === 'jobId') setConvert((c) => ({ ...(c || { salary: '', joining: '' }), jobId: v }));
    else if (picking) setForm((f) => ({ ...f, [picking]: v }));
    setPicking(null);
    setQuery('');
  };

  const openJobs = async () => {
    const jobs = await apiClient.get('/recruitment/jobs').then((r) => r.data || []).catch(() => []);
    setLists((l) => ({
      ...l,
      jobId: jobs
        .filter((j: any) => String(j.status).toUpperCase() !== 'CLOSED')
        .map((j: any) => ({ value: j.id, label: j.title, sub: j.department?.name })),
    }));
    setConvert({ salary: '', joining: '' });
  };

  const save = async () => {
    setSaving(true);
    try {
      const before: any = {
        departmentId: p.departmentId ?? null,
        designationId: p.designationId ?? null,
        branchId: p.branchId ?? null,
        shiftId: p.shiftId ?? null,
        managerId: p.managerId ?? null,
        role: p.user?.role ?? 'EMPLOYEE',
        isProjectManager: !!p.isProjectManager,
      };
      const changes = Object.fromEntries(Object.entries(form).filter(([k, v]) => before[k] !== v));
      if (Object.keys(changes).length) await apiClient.put(`/employees/${id}`, changes);
      const oldRate = p.hourlyCostRate != null ? String(p.hourlyCostRate) : '';
      if (COST_RATE_ROLES.includes(myRole) && rate.trim() !== oldRate) {
        await apiClient.put(`/employees/${id}/cost-rate`, {
          hourlyCostRate: rate.trim() === '' ? null : Number(rate),
        });
      }
      Alert.alert('Saved', 'Employee placement and access permissions updated.', [
        { text: 'OK', onPress: () => safeGoBack(navigation) },
      ]);
    } catch (e) {
      Alert.alert('Could not save', errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const suspended = String(p?.user?.status || '').toUpperCase() === 'SUSPENDED';
  const toggleActive = () =>
    Alert.alert(
      suspended ? 'Reactivate employee?' : 'Deactivate employee?',
      suspended
        ? `${p.firstName} will be able to sign in again.`
        : `${p.firstName} will be signed out and unable to sign in until reactivated.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: suspended ? 'Reactivate' : 'Deactivate',
          style: suspended ? 'default' : 'destructive',
          onPress: async () => {
            try {
              await apiClient.delete(`/employees/${id}`);
              setP((x: any) => ({ ...x, user: { ...x.user, status: suspended ? 'ACTIVE' : 'SUSPENDED' } }));
            } catch (e) {
              Alert.alert('Could not change status', errMsg(e));
            }
          },
        },
      ]
    );

  const startConversion = async () => {
    if (!convert?.jobId || !convert.salary) return;
    try {
      await apiClient.post(`/employees/${id}/convert-to-employee`, {
        jobId: convert.jobId,
        offeredSalary: Number(convert.salary),
        joiningDate: convert.joining || undefined,
      });
      setConvert(null);
      Alert.alert(
        'Conversion started',
        'An offer has been created in Recruitment. It completes when the offer letter is signed.'
      );
    } catch (e) {
      Alert.alert('Could not start conversion', errMsg(e));
    }
  };

  const Picker = ({ k, label }: { k: PickKey; label: string }) => {
    const Icon = PICKER_ICONS[k] || Briefcase;
    const isSet = k === 'jobId' ? !!convert?.jobId : form[k] != null;

    return (
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TouchableOpacity style={styles.fieldBox} onPress={() => setPicking(k)} activeOpacity={0.75}>
          <View style={styles.fieldIconBox}>
            <Icon size={15} color="#1373E5" strokeWidth={2.4} />
          </View>
          <Text style={[styles.fieldText, !isSet && styles.fieldTextPlaceholder]} numberOfLines={1}>
            {labelFor(k)}
          </Text>
          <ChevronDown size={16} color="#64748B" strokeWidth={2.4} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <AppScreen
      showBack
      showBottomNav={false}
      title={p ? `Manage ${p.firstName}` : 'Manage employee'}
      subtitle={p?.employeeCode ? `#${p.employeeCode}` : undefined}
      right={
        p ? (
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={save}
            disabled={saving}
            activeOpacity={0.8}
            accessibilityLabel="Save changes"
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Check size={15} color="#FFFFFF" strokeWidth={2.8} />
                <Text style={styles.saveText}>Save</Text>
              </>
            )}
          </TouchableOpacity>
        ) : undefined
      }
    >
      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={theme.colors.primary} size="large" />
      ) : !p ? null : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* 1. PLACEMENT SECTION */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderIcon}>
                <Building2 size={16} color="#1373E5" strokeWidth={2.4} />
              </View>
              <Text style={styles.cardTitle}>Placement</Text>
            </View>

            <Picker k="departmentId" label="Department" />
            <Picker k="designationId" label="Designation" />
            <Picker k="branchId" label="Office branch" />
            <Picker k="shiftId" label="Shift" />
            <Picker k="managerId" label="Reporting manager" />
          </View>

          {/* 2. ACCESS SECTION */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderIcon}>
                <Shield size={16} color="#1373E5" strokeWidth={2.4} />
              </View>
              <Text style={styles.cardTitle}>Access</Text>
            </View>

            <Picker k="role" label="System role" />

            <View style={styles.switchRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.switchTitle}>Project manager authority</Text>
                <Text style={styles.hint}>Can run projects and approve their requests.</Text>
              </View>
              <Switch
                value={!!form.isProjectManager}
                onValueChange={(v) => setForm((f) => ({ ...f, isProjectManager: v }))}
                trackColor={{ false: '#E2E8F0', true: '#BFDBFE' }}
                thumbColor={form.isProjectManager ? '#1373E5' : '#FFFFFF'}
              />
            </View>
          </View>

          {/* 3. INTERNAL COST RATE */}
          {COST_RATE_ROLES.includes(myRole) && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderIcon}>
                  <IndianRupee size={15} color="#1373E5" strokeWidth={2.4} />
                </View>
                <Text style={styles.cardTitle}>Internal cost rate</Text>
              </View>
              <Text style={styles.hint}>
                Per hour, for project billing and costing. Only admins and finance see this.
              </Text>
              <View style={styles.currencyInputBox}>
                <Text style={styles.currencyPrefix}>₹</Text>
                <TextInput
                  style={styles.currencyInput}
                  value={rate}
                  onChangeText={(t) => setRate(t.replace(/[^0-9.]/g, ''))}
                  placeholder="e.g. 850"
                  placeholderTextColor="#94A3B8"
                  keyboardType="decimal-pad"
                />
                <Text style={styles.currencySuffix}>/ hour</Text>
              </View>
            </View>
          )}

          {/* 4. TRAINEE CONVERSION */}
          {String(p.employmentCategory).toUpperCase() === 'TRAINEE' && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderIcon}>
                  <GraduationCap size={16} color="#1373E5" strokeWidth={2.4} />
                </View>
                <Text style={styles.cardTitle}>Trainee conversion</Text>
              </View>
              <Text style={styles.hint}>Creates an offer in Recruitment for this trainee. Their account is kept.</Text>
              {convert ? (
                <>
                  <Picker k="jobId" label="Position (open job)" />
                  <TextInput
                    style={styles.input}
                    value={convert.salary}
                    onChangeText={(t) => setConvert((c) => ({ ...c!, salary: t.replace(/[^0-9]/g, '') }))}
                    placeholder="Offered annual CTC (₹)"
                    placeholderTextColor="#94A3B8"
                    keyboardType="number-pad"
                  />
                  <TextInput
                    style={styles.input}
                    value={convert.joining}
                    onChangeText={(t) => setConvert((c) => ({ ...c!, joining: t }))}
                    placeholder="Joining date (YYYY-MM-DD, optional)"
                    placeholderTextColor="#94A3B8"
                    autoCapitalize="none"
                  />
                  <View style={styles.row2}>
                    <TouchableOpacity style={[styles.btn, styles.btnGrey]} onPress={() => setConvert(null)}>
                      <Text style={styles.btnGreyText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btn, styles.btnBlue, (!convert.jobId || !convert.salary) && { opacity: 0.5 }]}
                      disabled={!convert.jobId || !convert.salary}
                      onPress={startConversion}
                    >
                      <Text style={styles.btnText}>Start conversion</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={openJobs} activeOpacity={0.8}>
                  <GraduationCap size={16} color="#1373E5" strokeWidth={2.2} />
                  <Text style={styles.btnOutlineText}>Convert to employee</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* 5. ACCOUNT STATUS & ACCESS */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderIcon}>
                <ShieldCheck size={16} color={suspended ? '#DC2626' : '#16A34A'} strokeWidth={2.4} />
              </View>
              <Text style={styles.cardTitle}>Account Status</Text>
            </View>
            <Text style={styles.hint}>Current status: {suspended ? 'Deactivated' : 'Active'}</Text>
            <TouchableOpacity
              style={[styles.btn, suspended ? styles.btnReactivate : styles.btnDanger]}
              onPress={toggleActive}
              activeOpacity={0.8}
            >
              {suspended ? (
                <>
                  <ShieldCheck size={16} color="#1373E5" strokeWidth={2.4} />
                  <Text style={styles.btnReactivateText}>Reactivate employee</Text>
                </>
              ) : (
                <>
                  <ShieldOff size={16} color="#DC2626" strokeWidth={2.4} />
                  <Text style={styles.btnDangerText}>Deactivate employee</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* Modern Bottom Sheet Picker Modal */}
      <Modal visible={!!picking} transparent animationType="slide" onRequestClose={() => setPicking(null)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setPicking(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <View style={styles.dragHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Select {picking ? picking.replace(/Id$/, '') : ''}</Text>
              <TouchableOpacity onPress={() => setPicking(null)} style={styles.closeBtn}>
                <X size={18} color="#475569" strokeWidth={2.4} />
              </TouchableOpacity>
            </View>

            {(lists[picking || '']?.length || 0) > 6 && (
              <View style={styles.sheetSearchBox}>
                <Search size={14} color="#94A3B8" strokeWidth={2.2} />
                <TextInput
                  style={styles.sheetSearchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search options..."
                  placeholderTextColor="#94A3B8"
                  autoCorrect={false}
                />
                {query.length > 0 && (
                  <TouchableOpacity onPress={() => setQuery('')} style={{ padding: 4 }}>
                    <X size={13} color="#64748B" strokeWidth={2.4} />
                  </TouchableOpacity>
                )}
              </View>
            )}

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetOptionsList}>
              {picking && picking !== 'role' && picking !== 'jobId' && (
                <TouchableOpacity style={styles.sheetOption} onPress={() => choose(null)} activeOpacity={0.7}>
                  <Text style={[styles.sheetOptionText, { color: '#64748B' }]}>None / Clear selection</Text>
                </TouchableOpacity>
              )}
              {options.map((o) => {
                const isSelected = (picking === 'jobId' ? convert?.jobId : form[picking!]) === o.value;
                return (
                  <TouchableOpacity
                    key={String(o.value)}
                    style={[styles.sheetOption, isSelected && styles.sheetOptionSelected]}
                    onPress={() => choose(o.value)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[styles.sheetOptionText, isSelected && styles.sheetOptionTextSelected]}>
                        {o.label}
                      </Text>
                      {!!o.sub && <Text style={styles.optionSub}>{o.sub}</Text>}
                    </View>
                    {isSelected && <Check size={16} color="#1373E5" strokeWidth={2.6} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 60, gap: 14 },

  // Save Button in Header
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#16A34A',
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  saveText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },

  // Card Structure
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    gap: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  cardHeaderIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A' },

  // Field Pickers
  field: { gap: 6 },
  fieldLabel: { fontSize: 12.5, fontWeight: '700', color: '#475569' },
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 46,
    backgroundColor: '#F8FAFC',
  },
  fieldIconBox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldText: { flex: 1, fontSize: 14, fontWeight: '700', color: '#0F172A' },
  fieldTextPlaceholder: { fontWeight: '500', color: '#94A3B8' },
  hint: { fontSize: 12, color: '#64748B', lineHeight: 17 },

  // Switches & Inputs
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 4,
  },
  switchTitle: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  currencyInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    height: 46,
  },
  currencyPrefix: { fontSize: 15, fontWeight: '800', color: '#1373E5', marginRight: 6 },
  currencyInput: { flex: 1, fontSize: 14.5, fontWeight: '700', color: '#0F172A', paddingVertical: 0 },
  currencySuffix: { fontSize: 12.5, fontWeight: '600', color: '#64748B', marginLeft: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    fontSize: 14,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
  },

  // Buttons
  row2: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: 12,
  },
  btnBlue: { backgroundColor: '#1373E5' },
  btnText: { color: '#FFFFFF', fontWeight: '800' },
  btnGrey: { backgroundColor: '#F1F5F9' },
  btnGreyText: { color: '#334155', fontWeight: '700' },
  btnOutline: { borderWidth: 1, borderColor: '#BFDBFE', backgroundColor: '#EFF6FF' },
  btnOutlineText: { color: '#1373E5', fontWeight: '800' },
  btnReactivate: { borderWidth: 1, borderColor: '#BFDBFE', backgroundColor: '#EFF6FF' },
  btnReactivateText: { color: '#1373E5', fontWeight: '800' },
  btnDanger: { borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  btnDangerText: { color: '#DC2626', fontWeight: '800' },

  // Bottom Sheet Modal
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '75%',
    paddingBottom: 34,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 10,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A', textTransform: 'capitalize' },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 10,
    height: 38,
    backgroundColor: '#F8FAFC',
  },
  sheetSearchInput: { flex: 1, fontSize: 13, color: '#0F172A', paddingVertical: 0 },
  sheetOptionsList: { paddingHorizontal: 12, paddingVertical: 4 },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
  },
  sheetOptionSelected: { backgroundColor: '#EFF6FF' },
  sheetOptionText: { fontSize: 14.5, color: '#0F172A', fontWeight: '500' },
  sheetOptionTextSelected: { fontWeight: '800', color: '#1373E5' },
  optionSub: { fontSize: 12, color: '#64748B' },
});
