import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  View, Text, StyleSheet, SectionList, TouchableOpacity, ActivityIndicator, RefreshControl, TextInput, ScrollView, Alert, Linking, Modal,
} from 'react-native';
import { Search, FileText, Trash2, Upload, ChevronDown, X, Check } from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { Avatar } from '../../components/PersonSheet';
import { theme } from '../../theme/theme';

/**
 * Every employee document in one place, as on the web's Documents page:
 * search by person or file, filter by department and type, open, delete,
 * and upload for someone (through their profile's Documents tab).
 */
const fullName = (e: any) => `${e.firstName} ${e.lastName || ''}`.trim();
const errMsg = (e: any) => e?.response?.data?.message || 'Please try again.';
type Pick = 'department' | 'type' | 'upload' | null;

export default function EmployeeDocumentsScreen() {
  const navigation = useNavigation<any>();
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [denied, setDenied] = useState(false);
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('');
  const [type, setType] = useState('');
  const [picking, setPicking] = useState<Pick>(null);
  const [pickQuery, setPickQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/employees');
      setEmployees(data || []);
      setDenied(false);
    } catch (e: any) {
      if (e?.response?.status === 403) setDenied(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const allDocs = useMemo(() => employees.flatMap((e) => (e.documents || []).map((d: any) => ({ ...d, employee: e }))), [employees]);
  const departments = useMemo(() => [...new Set(employees.map((e) => e.department?.name).filter(Boolean))].sort() as string[], [employees]);
  const types = useMemo(() => [...new Set(allDocs.map((d) => d.documentType || 'Other'))].sort() as string[], [allDocs]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const docs = allDocs.filter((d) => {
      const e = d.employee;
      if (dept && e.department?.name !== dept) return false;
      if (type && (d.documentType || 'Other') !== type) return false;
      if (!q) return true;
      return [d.fileName, d.documentType, fullName(e), e.user?.email, e.phone, e.employeeCode, e.department?.name, e.designation?.name]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    const byEmp = new Map<number, { employee: any; data: any[] }>();
    for (const d of docs) {
      const s = byEmp.get(d.employee.id) || { employee: d.employee, data: [] };
      s.data.push(d);
      byEmp.set(d.employee.id, s);
    }
    return [...byEmp.values()].sort((a, b) => fullName(a.employee).localeCompare(fullName(b.employee)));
  }, [allDocs, query, dept, type]);

  const shownCount = sections.reduce((s, x) => s + x.data.length, 0);

  const remove = (d: any) =>
    Alert.alert('Delete document?', `${d.fileName}\n${fullName(d.employee)}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await apiClient.delete(`/employees/${d.employee.id}/documents/${d.id}`);
            setEmployees((list) => list.map((e) => (e.id === d.employee.id ? { ...e, documents: e.documents.filter((x: any) => x.id !== d.id) } : e)));
          } catch (e) { Alert.alert('Could not delete', errMsg(e)); }
        },
      },
    ]);

  const pickOptions = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    if (picking === 'department') return ['', ...departments].map((v) => ({ value: v, label: v || 'All departments' }));
    if (picking === 'type') return ['', ...types].map((v) => ({ value: v, label: v || 'All document types' }));
    if (picking === 'upload') {
      return employees
        .filter((e) => !q || `${fullName(e)} ${e.employeeCode || ''}`.toLowerCase().includes(q))
        .sort((a, b) => fullName(a).localeCompare(fullName(b)))
        .map((e) => ({ value: String(e.id), label: fullName(e), sub: [e.designation?.name, e.employeeCode && `#${e.employeeCode}`].filter(Boolean).join(' · ') }));
    }
    return [];
  }, [picking, pickQuery, departments, types, employees]);

  const choose = (v: string) => {
    if (picking === 'department') setDept(v);
    if (picking === 'type') setType(v);
    if (picking === 'upload') navigation.navigate('EmployeeEdit', { employeeId: Number(v), initialTab: 'Documents' });
    setPicking(null);
    setPickQuery('');
  };

  if (denied) {
    return (
      <AppScreen showBack title="Documents">
        <Text style={styles.empty}>Employee documents are visible to HR and administrators.</Text>
      </AppScreen>
    );
  }

  const header = (
    <View style={{ gap: 10, marginBottom: 6 }}>
      <View style={styles.kpis}>
        <View style={[styles.kpi, { backgroundColor: '#EEF2FF' }]}><Text style={[styles.kpiNum, { color: '#4338CA' }]}>{shownCount}</Text><Text style={[styles.kpiLabel, { color: '#4338CA' }]}>Documents</Text></View>
        <View style={[styles.kpi, { backgroundColor: '#ECFDF5' }]}><Text style={[styles.kpiNum, { color: '#047857' }]}>{sections.length}</Text><Text style={[styles.kpiLabel, { color: '#047857' }]}>Employees</Text></View>
        <View style={[styles.kpi, { backgroundColor: '#FFF7ED' }]}><Text style={[styles.kpiNum, { color: '#C2410C' }]}>{new Set(sections.map((s) => s.employee.department?.name).filter(Boolean)).size}</Text><Text style={[styles.kpiLabel, { color: '#C2410C' }]}>Departments</Text></View>
      </View>
      <View style={styles.search}>
        <Search size={16} color="#94A3B8" />
        <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Search file, person, #code, email" placeholderTextColor="#94A3B8" autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        <TouchableOpacity style={[styles.chip, !!dept && styles.chipOn]} onPress={() => setPicking('department')}>
          <Text style={[styles.chipText, !!dept && styles.chipTextOn]} numberOfLines={1}>{dept || 'Department'}</Text>
          <ChevronDown size={13} color={dept ? '#fff' : '#64748B'} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.chip, !!type && styles.chipOn]} onPress={() => setPicking('type')}>
          <Text style={[styles.chipText, !!type && styles.chipTextOn]} numberOfLines={1}>{type || 'Document type'}</Text>
          <ChevronDown size={13} color={type ? '#fff' : '#64748B'} />
        </TouchableOpacity>
        {(dept || type || query) ? (
          <TouchableOpacity style={styles.clear} onPress={() => { setDept(''); setType(''); setQuery(''); }}>
            <X size={13} color="#B91C1C" /><Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  );

  return (
    <AppScreen
      showBack
      title="Documents"
      subtitle={`${allDocs.length} files · ${employees.filter((e) => e.documents?.length).length} employees`}
      right={
        <TouchableOpacity style={styles.uploadBtn} onPress={() => setPicking('upload')}>
          <Upload size={15} color="#fff" /><Text style={styles.uploadText}>Upload</Text>
        </TouchableOpacity>
      }
    >
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} /> : (
        <SectionList
          sections={sections}
          keyExtractor={(d) => String(d.id)}
          ListHeaderComponent={header}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>No documents match.</Text>}
          renderSectionHeader={({ section }) => (
            <TouchableOpacity style={styles.person} onPress={() => navigation.navigate('EmployeeProfile', { id: section.employee.id, person: section.employee })}>
              <Avatar person={section.employee} size={32} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{fullName(section.employee)}</Text>
                <Text style={styles.sub} numberOfLines={1}>{[section.employee.designation?.name, section.employee.department?.name].filter(Boolean).join(' · ')}</Text>
              </View>
              <Text style={styles.count}>{section.data.length}</Text>
            </TouchableOpacity>
          )}
          renderItem={({ item: d }) => (
            <View style={styles.doc}>
              <TouchableOpacity style={styles.docMain} onPress={() => Linking.openURL(d.fileUrl)}>
                <FileText size={18} color="#4F46E5" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.docName} numberOfLines={1}>{d.fileName}</Text>
                  <Text style={styles.sub}>{d.documentType || 'Other'}{d.createdAt ? ` · ${new Date(d.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.del} onPress={() => remove(d)}><Trash2 size={16} color="#DC2626" /></TouchableOpacity>
            </View>
          )}
        />
      )}

      <Modal visible={!!picking} transparent animationType="slide" onRequestClose={() => setPicking(null)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setPicking(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{picking === 'upload' ? 'Upload for…' : picking === 'type' ? 'Document type' : 'Department'}</Text>
              <TouchableOpacity onPress={() => setPicking(null)}><X size={20} color="#334155" /></TouchableOpacity>
            </View>
            {picking === 'upload' && (
              <View style={[styles.search, { margin: 12 }]}>
                <Search size={16} color="#94A3B8" />
                <TextInput style={styles.searchInput} value={pickQuery} onChangeText={setPickQuery} placeholder="Find employee" placeholderTextColor="#94A3B8" autoCorrect={false} />
              </View>
            )}
            <ScrollView keyboardShouldPersistTaps="handled">
              {pickOptions.map((o: any) => {
                const on = (picking === 'department' ? dept : picking === 'type' ? type : null) === o.value;
                return (
                  <TouchableOpacity key={o.value || 'all'} style={styles.option} onPress={() => choose(o.value)}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionText, on && styles.optionOn]}>{o.label}</Text>
                      {!!o.sub && <Text style={styles.sub}>{o.sub}</Text>}
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
  list: { padding: 16, paddingBottom: 120 },
  kpis: { flexDirection: 'row', gap: 8 },
  kpi: { flex: 1, borderRadius: 14, paddingVertical: 10, alignItems: 'center' },
  kpiNum: { fontSize: 20, fontWeight: '800' },
  kpiLabel: { fontSize: 11, fontWeight: '700' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 0 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', maxWidth: 220 },
  chipOn: { backgroundColor: '#1373E5', borderColor: '#1373E5' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#475569', flexShrink: 1 },
  chipTextOn: { color: '#fff' },
  clear: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: '#FEF2F2' },
  clearText: { fontSize: 12, fontWeight: '700', color: '#B91C1C' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, marginBottom: 6 },
  name: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  sub: { fontSize: 12, color: '#64748B' },
  count: { fontSize: 12, fontWeight: '800', color: '#4338CA', backgroundColor: '#EEF2FF', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  doc: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 6 },
  docMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  docName: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  del: { padding: 14 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 38, borderRadius: 12, backgroundColor: '#1373E5' },
  uploadText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 30, paddingHorizontal: 24 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '75%', paddingBottom: 30 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
  optionText: { fontSize: 15, color: '#0F172A' },
  optionOn: { fontWeight: '800', color: '#1373E5' },
});
