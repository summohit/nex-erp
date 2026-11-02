import React, { useEffect, useMemo, useState } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Modal, TextInput, Switch,
} from 'react-native';
import { ChevronDown, X, Check, Search, ShieldOff, ShieldCheck, GraduationCap } from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { useAuthStore } from '../../store/authStore';
import { theme } from '../../theme/theme';

/**
 * HR / admin actions on one employee, the mobile half of the web's employee
 * drawer: placement (department, designation, branch, shift, manager), system
 * role, project-manager authority, internal cost rate, deactivate/reactivate,
 * and starting a trainee's conversion to employee. Adding employees and bulk
 * import stay on the web. The server checks the caller's role on every call.
 */
type Opt = { value: number | string; label: string; sub?: string };
type PickKey = 'departmentId' | 'designationId' | 'branchId' | 'shiftId' | 'managerId' | 'role' | 'jobId';

const ROLES: Opt[] = ['EMPLOYEE', 'OFFICE_STAFF', 'HR', 'FINANCE', 'SALES', 'ADMIN'].map((r) => ({
  value: r, label: r.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
}));
const COST_RATE_ROLES = ['SUPERADMIN', 'ADMIN', 'FINANCE'];
const errMsg = (e: any) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join('\n') : m || 'Please try again.';
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
      get('/master-data/departments'), get('/master-data/designations'), get('/master-data/branches'),
      get('/shifts'), get('/employees/basic-list'),
    ]).then(([emp, deps, desigs, branches, shifts, people]) => {
      setP(emp);
      setForm({
        departmentId: emp.departmentId ?? null, designationId: emp.designationId ?? null, branchId: emp.branchId ?? null,
        shiftId: emp.shiftId ?? null, managerId: emp.managerId ?? null, role: emp.user?.role ?? 'EMPLOYEE',
        isProjectManager: !!emp.isProjectManager,
      });
      setRate(emp.hourlyCostRate != null ? String(emp.hourlyCostRate) : '');
      setLists({
        departmentId: deps.map((d: any) => ({ value: d.id, label: d.name })),
        designationId: desigs.map((d: any) => ({ value: d.id, label: d.name })),
        branchId: branches.map((b: any) => ({ value: b.id, label: b.name })),
        shiftId: shifts.map((s: any) => ({ value: s.id, label: s.name, sub: s.startTime ? `${s.startTime}–${s.endTime}` : undefined })),
        managerId: people.filter((x: any) => x.id !== id).map((x: any) => ({
          value: x.id, label: `${x.firstName} ${x.lastName || ''}`.trim(),
          sub: [x.designation?.name, x.employeeCode && `#${x.employeeCode}`].filter(Boolean).join(' · '),
        })),
        role: myRole === 'SUPERADMIN' ? [...ROLES, { value: 'SUPERADMIN', label: 'Super Admin' }] : ROLES,
      });
    }).catch((e) => Alert.alert('Could not load', errMsg(e), [{ text: 'OK', onPress: () => navigation.goBack() }]))
      .finally(() => setLoading(false));
  }, [id, myRole, navigation]);

  const labelFor = (k: PickKey) => {
    const v = k === 'jobId' ? convert?.jobId : form[k];
    return lists[k]?.find((o) => o.value === v)?.label || (v ? '—' : 'Not set');
  };

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (picking ? lists[picking] || [] : []).filter((o) => !q || `${o.label} ${o.sub || ''}`.toLowerCase().includes(q));
  }, [picking, lists, query]);

  const choose = (v: any) => {
    if (picking === 'jobId') setConvert((c) => ({ ...(c || { salary: '', joining: '' }), jobId: v }));
    else if (picking) setForm((f) => ({ ...f, [picking]: v }));
    setPicking(null);
    setQuery('');
  };

  const openJobs = async () => {
    const jobs = await apiClient.get('/recruitment/jobs').then((r) => r.data || []).catch(() => []);
    setLists((l) => ({ ...l, jobId: jobs.filter((j: any) => String(j.status).toUpperCase() !== 'CLOSED').map((j: any) => ({ value: j.id, label: j.title, sub: j.department?.name })) }));
    setConvert({ salary: '', joining: '' });
  };

  const save = async () => {
    setSaving(true);
    try {
      // Send only what changed; the server leaves every other field alone.
      const before: any = {
        departmentId: p.departmentId ?? null, designationId: p.designationId ?? null, branchId: p.branchId ?? null,
        shiftId: p.shiftId ?? null, managerId: p.managerId ?? null, role: p.user?.role ?? 'EMPLOYEE', isProjectManager: !!p.isProjectManager,
      };
      const changes = Object.fromEntries(Object.entries(form).filter(([k, v]) => before[k] !== v));
      if (Object.keys(changes).length) await apiClient.put(`/employees/${id}`, changes);
      const oldRate = p.hourlyCostRate != null ? String(p.hourlyCostRate) : '';
      if (COST_RATE_ROLES.includes(myRole) && rate.trim() !== oldRate) {
        await apiClient.put(`/employees/${id}/cost-rate`, { hourlyCostRate: rate.trim() === '' ? null : Number(rate) });
      }
      Alert.alert('Saved', 'Employee updated.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
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
      suspended ? `${p.firstName} will be able to sign in again.` : `${p.firstName} will be signed out and unable to sign in until reactivated.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: suspended ? 'Reactivate' : 'Deactivate', style: suspended ? 'default' : 'destructive',
          onPress: async () => {
            try {
              await apiClient.delete(`/employees/${id}`);
              setP((x: any) => ({ ...x, user: { ...x.user, status: suspended ? 'ACTIVE' : 'SUSPENDED' } }));
            } catch (e) { Alert.alert('Could not change status', errMsg(e)); }
          },
        },
      ],
    );

  const startConversion = async () => {
    if (!convert?.jobId || !convert.salary) return;
    try {
      await apiClient.post(`/employees/${id}/convert-to-employee`, {
        jobId: convert.jobId, offeredSalary: Number(convert.salary), joiningDate: convert.joining || undefined,
      });
      setConvert(null);
      Alert.alert('Conversion started', 'An offer has been created in Recruitment. It completes when the offer letter is signed.');
    } catch (e) { Alert.alert('Could not start conversion', errMsg(e)); }
  };

  const Picker = ({ k, label }: { k: PickKey; label: string }) => (
    <TouchableOpacity style={styles.field} onPress={() => setPicking(k)} activeOpacity={0.7}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldValue}>
        <Text style={styles.fieldText} numberOfLines={1}>{labelFor(k)}</Text>
        <ChevronDown size={16} color="#94A3B8" />
      </View>
    </TouchableOpacity>
  );

  return (
    <AppScreen
      showBack
      showBottomNav={false}
      title={p ? `Manage ${p.firstName}` : 'Manage employee'}
      subtitle={p?.employeeCode ? `#${p.employeeCode}` : undefined}
      right={p ? (
        <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <><Check size={15} color="#fff" /><Text style={styles.saveText}>Save</Text></>}
        </TouchableOpacity>
      ) : undefined}
    >
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} /> : !p ? null : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Placement</Text>
            <Picker k="departmentId" label="Department" />
            <Picker k="designationId" label="Designation" />
            <Picker k="branchId" label="Office branch" />
            <Picker k="shiftId" label="Shift" />
            <Picker k="managerId" label="Reporting manager" />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Access</Text>
            <Picker k="role" label="System role" />
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldText}>Project manager authority</Text>
                <Text style={styles.hint}>Can run projects and approve their requests.</Text>
              </View>
              <Switch value={!!form.isProjectManager} onValueChange={(v) => setForm((f) => ({ ...f, isProjectManager: v }))} />
            </View>
          </View>

          {COST_RATE_ROLES.includes(myRole) && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Internal cost rate</Text>
              <Text style={styles.hint}>Per hour, for project billing and costing. Only admins and finance see this.</Text>
              <TextInput
                style={styles.input}
                value={rate}
                onChangeText={(t) => setRate(t.replace(/[^0-9.]/g, ''))}
                placeholder="e.g. 850"
                placeholderTextColor="#94A3B8"
                keyboardType="decimal-pad"
              />
            </View>
          )}

          {String(p.employmentCategory).toUpperCase() === 'TRAINEE' && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Trainee conversion</Text>
              <Text style={styles.hint}>Creates an offer in Recruitment for this trainee. Their account is kept.</Text>
              {convert ? (
                <>
                  <Picker k="jobId" label="Position (open job)" />
                  <TextInput style={styles.input} value={convert.salary} onChangeText={(t) => setConvert((c) => ({ ...c!, salary: t.replace(/[^0-9]/g, '') }))} placeholder="Offered annual CTC (₹)" placeholderTextColor="#94A3B8" keyboardType="number-pad" />
                  <TextInput style={styles.input} value={convert.joining} onChangeText={(t) => setConvert((c) => ({ ...c!, joining: t }))} placeholder="Joining date (YYYY-MM-DD, optional)" placeholderTextColor="#94A3B8" autoCapitalize="none" />
                  <View style={styles.row2}>
                    <TouchableOpacity style={[styles.btn, styles.btnGrey]} onPress={() => setConvert(null)}><Text style={styles.btnGreyText}>Cancel</Text></TouchableOpacity>
                    <TouchableOpacity style={[styles.btn, styles.btnBlue, (!convert.jobId || !convert.salary) && { opacity: 0.5 }]} disabled={!convert.jobId || !convert.salary} onPress={startConversion}>
                      <Text style={styles.btnText}>Start conversion</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={openJobs}>
                  <GraduationCap size={16} color="#1373E5" /><Text style={styles.btnOutlineText}>Convert to employee</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Account</Text>
            <Text style={styles.hint}>Status: {suspended ? 'Deactivated' : 'Active'}</Text>
            <TouchableOpacity style={[styles.btn, suspended ? styles.btnOutline : styles.btnDanger]} onPress={toggleActive}>
              {suspended ? <ShieldCheck size={16} color="#1373E5" /> : <ShieldOff size={16} color="#B91C1C" />}
              <Text style={suspended ? styles.btnOutlineText : styles.btnDangerText}>{suspended ? 'Reactivate employee' : 'Deactivate employee'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      <Modal visible={!!picking} transparent animationType="slide" onRequestClose={() => setPicking(null)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setPicking(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Choose</Text>
              <TouchableOpacity onPress={() => setPicking(null)}><X size={20} color="#334155" /></TouchableOpacity>
            </View>
            {(lists[picking || '']?.length || 0) > 8 && (
              <View style={styles.search}>
                <Search size={16} color="#94A3B8" />
                <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Search" placeholderTextColor="#94A3B8" autoCorrect={false} />
              </View>
            )}
            <ScrollView keyboardShouldPersistTaps="handled">
              {picking && picking !== 'role' && picking !== 'jobId' && (
                <TouchableOpacity style={styles.option} onPress={() => choose(null)}>
                  <Text style={[styles.optionText, { color: '#64748B' }]}>None</Text>
                </TouchableOpacity>
              )}
              {options.map((o) => {
                const on = (picking === 'jobId' ? convert?.jobId : form[picking!]) === o.value;
                return (
                  <TouchableOpacity key={String(o.value)} style={styles.option} onPress={() => choose(o.value)}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionText, on && styles.optionOn]}>{o.label}</Text>
                      {!!o.sub && <Text style={styles.hint}>{o.sub}</Text>}
                    </View>
                    {on && <Check size={16} color="#1373E5" />}
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
  scroll: { padding: 16, paddingBottom: 60, gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  field: { gap: 4 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  fieldValue: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, height: 44, backgroundColor: '#F8FAFC' },
  fieldText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#0F172A' },
  hint: { fontSize: 12, color: '#64748B' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  input: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, height: 44, fontSize: 14, color: '#0F172A', backgroundColor: '#F8FAFC' },
  row2: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: 12 },
  btnBlue: { backgroundColor: '#1373E5' },
  btnText: { color: '#fff', fontWeight: '800' },
  btnGrey: { backgroundColor: '#F1F5F9' },
  btnGreyText: { color: '#334155', fontWeight: '700' },
  btnOutline: { borderWidth: 1, borderColor: '#BFDBFE', backgroundColor: '#EFF6FF' },
  btnOutlineText: { color: '#1373E5', fontWeight: '800' },
  btnDanger: { borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  btnDangerText: { color: '#B91C1C', fontWeight: '800' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, height: 38, borderRadius: 12, backgroundColor: '#16A34A' },
  saveText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '75%', paddingBottom: 30 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, height: 40 },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 0 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
  optionText: { fontSize: 15, color: '#0F172A' },
  optionOn: { fontWeight: '800', color: '#1373E5' },
});
