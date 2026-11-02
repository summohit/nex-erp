import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, TextInput, Modal, ScrollView,
  Image, Alert, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Award, Plus, Search, X, Check, Trash2, ImagePlus, Pencil } from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { employeeService } from '../../api/employeeService';
import { Avatar, PersonTap, PersonSheetHost } from '../../components/PersonSheet';
import MediaPickerModal from '../Profile/components/MediaPickerModal';
import { useAuthStore } from '../../store/authStore';
import { theme } from '../../theme/theme';

/**
 * Appreciation, as on the web: everyone sees the awards given in the company;
 * HR and admins can give an award (with an optional photo), delete one, and
 * manage the award types. The server enforces the same split.
 */
const MANAGERS = ['SUPERADMIN', 'ADMIN', 'HR'];
const COLORS: Record<string, { bg: string; text: string }> = {
  blue: { bg: '#EFF6FF', text: '#1D4ED8' }, green: { bg: '#ECFDF5', text: '#047857' }, purple: { bg: '#F5F3FF', text: '#6D28D9' },
  orange: { bg: '#FFF7ED', text: '#C2410C' }, red: { bg: '#FEF2F2', text: '#B91C1C' }, yellow: { bg: '#FEFCE8', text: '#A16207' },
};
const tone = (c?: string) => COLORS[c || 'orange'] || COLORS.orange;
const fullName = (e: any) => (e ? `${e.firstName} ${e.lastName || ''}`.trim() : 'Team member');
const date = (d?: string) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const today = () => new Date().toISOString().slice(0, 10);
const errMsg = (e: any) => e?.response?.data?.message || 'Please try again.';

export default function AppreciationScreen() {
  const role = useAuthStore((s) => s.user?.role) || '';
  const isManager = MANAGERS.includes(role);
  const [tab, setTab] = useState<'awards' | 'types'>('awards');
  const [awards, setAwards] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<number | null>(null);
  const [open, setOpen] = useState<any | null>(null);

  // Give-award form
  const [giving, setGiving] = useState(false);
  const [form, setForm] = useState<{ employeeId?: number; awardTypeId?: number; givenDate: string; summary: string; photoUrl?: string }>({ givenDate: today(), summary: '' });
  const [pick, setPick] = useState<'employee' | 'type' | null>(null);
  const [pickQuery, setPickQuery] = useState('');
  const [photoPicker, setPhotoPicker] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Award-type editor
  const [typeEdit, setTypeEdit] = useState<{ id?: number; title: string; color: string; status: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, t] = await Promise.all([apiClient.get('/appreciation'), apiClient.get('/appreciation/award-types')]);
      setAwards(a.data || []);
      setTypes(t.data || []);
    } catch { /* keep what we have */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return awards.filter((a) =>
      (!typeFilter || a.awardTypeId === typeFilter || a.awardType?.id === typeFilter) &&
      (!q || `${fullName(a.employee)} ${a.awardType?.title || ''} ${a.summary || ''} ${a.employee?.department?.name || ''}`.toLowerCase().includes(q)));
  }, [awards, query, typeFilter]);

  const openGive = async () => {
    setForm({ givenDate: today(), summary: '' });
    setGiving(true);
    if (!people.length) {
      const { data } = await apiClient.get('/employees/basic-list').catch(() => ({ data: [] }));
      setPeople(data || []);
    }
  };

  const uploadPhoto = async (asset: any) => {
    setPhotoPicker(false);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', { uri: asset.uri, name: asset.fileName || 'award.jpg', type: asset.type || 'image/jpeg' } as any);
      const res = await employeeService.uploadFile(fd);
      const url = res?.fileUrl || res?.url || res?.data?.fileUrl || res?.data?.url || res?.data;
      if (typeof url === 'string') setForm((f) => ({ ...f, photoUrl: url }));
    } catch (e) { Alert.alert('Could not upload photo', errMsg(e)); } finally { setUploading(false); }
  };

  const give = async () => {
    if (!form.employeeId || !form.awardTypeId || !form.summary.trim()) return;
    setSaving(true);
    try {
      await apiClient.post('/appreciation', { ...form, summary: form.summary.trim() });
      setGiving(false);
      load();
    } catch (e) { Alert.alert('Could not give award', errMsg(e)); } finally { setSaving(false); }
  };

  const removeAward = (a: any) =>
    Alert.alert('Delete this award?', `${a.awardType?.title} · ${fullName(a.employee)}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await apiClient.delete(`/appreciation/${a.id}`); setOpen(null); load(); } catch (e) { Alert.alert('Could not delete', errMsg(e)); }
      } },
    ]);

  const saveType = async () => {
    if (!typeEdit?.title.trim()) return;
    try {
      const body = { title: typeEdit.title.trim(), color: typeEdit.color, status: typeEdit.status };
      if (typeEdit.id) await apiClient.put(`/appreciation/award-types/${typeEdit.id}`, body);
      else await apiClient.post('/appreciation/award-types', body);
      setTypeEdit(null);
      load();
    } catch (e) { Alert.alert('Could not save', errMsg(e)); }
  };

  const deleteType = (t: any) =>
    Alert.alert('Delete award type?', `${t.title}. Awards already given with it are deleted too.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await apiClient.delete(`/appreciation/award-types/${t.id}`); setTypeEdit(null); load(); } catch (e) { Alert.alert('Could not delete', errMsg(e)); }
      } },
    ]);

  const pickOptions = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    if (pick === 'type') return types.filter((t) => t.status !== false).map((t) => ({ id: t.id, label: t.title }));
    return people
      .filter((p) => !q || `${fullName(p)} ${p.employeeCode || ''}`.toLowerCase().includes(q))
      .sort((a, b) => fullName(a).localeCompare(fullName(b)))
      .map((p) => ({ id: p.id, label: fullName(p), sub: [p.designation?.name, p.employeeCode && `#${p.employeeCode}`].filter(Boolean).join(' · '), person: p }));
  }, [pick, pickQuery, types, people]);

  const header = (
    <View style={{ gap: 10, marginBottom: 6 }}>
      {isManager && (
        <View style={styles.tabs}>
          {(['awards', 'types'] as const).map((t) => (
            <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}>
              <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t === 'awards' ? `Awards ${awards.length}` : `Award types ${types.length}`}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {tab === 'awards' && (
        <>
          <View style={styles.search}>
            <Search size={16} color="#94A3B8" />
            <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Search person, award, message" placeholderTextColor="#94A3B8" autoCorrect={false} clearButtonMode="while-editing" />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            <TouchableOpacity style={[styles.chip, !typeFilter && styles.chipOn]} onPress={() => setTypeFilter(null)}>
              <Text style={[styles.chipText, !typeFilter && styles.chipTextOn]}>All</Text>
            </TouchableOpacity>
            {types.map((t) => (
              <TouchableOpacity key={t.id} style={[styles.chip, typeFilter === t.id && styles.chipOn]} onPress={() => setTypeFilter(typeFilter === t.id ? null : t.id)}>
                <Text style={[styles.chipText, typeFilter === t.id && styles.chipTextOn]}>{t.title}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      )}
    </View>
  );

  return (
    <AppScreen
      showBack
      title="Appreciation"
      subtitle={`${awards.length} awards given`}
      right={isManager ? (
        <TouchableOpacity style={styles.primaryBtn} onPress={tab === 'awards' ? openGive : () => setTypeEdit({ title: '', color: 'orange', status: true })}>
          <Plus size={15} color="#fff" /><Text style={styles.primaryText}>{tab === 'awards' ? 'Give' : 'Type'}</Text>
        </TouchableOpacity>
      ) : undefined}
    >
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} /> : tab === 'awards' ? (
        <FlatList
          data={shown}
          keyExtractor={(a) => String(a.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>No awards yet.</Text>}
          renderItem={({ item: a }) => {
            const c = tone(a.awardType?.color);
            return (
              <TouchableOpacity style={styles.card} onPress={() => setOpen(a)} activeOpacity={0.85}>
                {a.photoUrl ? <Image source={{ uri: a.photoUrl }} style={styles.photo} /> : null}
                <View style={styles.cardBody}>
                  <View style={[styles.badge, { backgroundColor: c.bg }]}>
                    <Award size={13} color={c.text} /><Text style={[styles.badgeText, { color: c.text }]}>{a.awardType?.title || 'Appreciation'}</Text>
                  </View>
                  <PersonTap person={a.employee} style={styles.who}>
                    <Avatar person={a.employee} size={38} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name} numberOfLines={1}>{fullName(a.employee)}</Text>
                      <Text style={styles.sub} numberOfLines={1}>{[a.employee?.designation?.name, a.employee?.department?.name].filter(Boolean).join(' · ')}</Text>
                    </View>
                    <Text style={styles.sub}>{date(a.givenDate)}</Text>
                  </PersonTap>
                  {!!a.summary && <Text style={styles.summary} numberOfLines={3}>{a.summary}</Text>}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      ) : (
        <FlatList
          data={types}
          keyExtractor={(t) => String(t.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          renderItem={({ item: t }) => {
            const c = tone(t.color);
            const count = awards.filter((a) => (a.awardTypeId ?? a.awardType?.id) === t.id).length;
            return (
              <TouchableOpacity style={styles.typeRow} onPress={() => setTypeEdit({ id: t.id, title: t.title, color: t.color || 'orange', status: t.status !== false })}>
                <View style={[styles.typeIcon, { backgroundColor: c.bg }]}><Award size={18} color={c.text} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{t.title}</Text>
                  <Text style={styles.sub}>{count} given{t.status === false ? ' · inactive' : ''}</Text>
                </View>
                <Pencil size={16} color="#94A3B8" />
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Award detail */}
      <Modal visible={!!open} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <TouchableOpacity style={styles.center} activeOpacity={1} onPress={() => setOpen(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.dialog}>
            <TouchableOpacity style={styles.close} onPress={() => setOpen(null)}><X size={18} color="#334155" /></TouchableOpacity>
            {open && (
              <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
                {open.photoUrl ? <Image source={{ uri: open.photoUrl }} style={styles.bigPhoto} resizeMode="cover" /> : null}
                <View style={[styles.badge, { backgroundColor: tone(open.awardType?.color).bg }]}>
                  <Award size={14} color={tone(open.awardType?.color).text} />
                  <Text style={[styles.badgeText, { color: tone(open.awardType?.color).text }]}>{open.awardType?.title}</Text>
                </View>
                <View style={styles.who}>
                  <Avatar person={open.employee} size={52} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.name, { fontSize: 17 }]}>{fullName(open.employee)}</Text>
                    <Text style={styles.sub}>{[open.employee?.designation?.name, open.employee?.department?.name].filter(Boolean).join(' · ')}</Text>
                  </View>
                </View>
                <Text style={styles.sub}>Given on {date(open.givenDate)}</Text>
                {!!open.summary && <Text style={styles.fullSummary}>{open.summary}</Text>}
                {isManager && (
                  <TouchableOpacity style={styles.danger} onPress={() => removeAward(open)}>
                    <Trash2 size={16} color="#B91C1C" /><Text style={styles.dangerText}>Delete award</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Give award */}
      <Modal visible={giving} transparent animationType="slide" onRequestClose={() => setGiving(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottom}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Give an award</Text>
              <TouchableOpacity onPress={() => setGiving(false)}><X size={20} color="#334155" /></TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
              <TouchableOpacity style={styles.field} onPress={() => setPick('employee')}>
                <Text style={styles.fieldLabel}>Employee</Text>
                <Text style={styles.fieldValue}>{fullName(people.find((p) => p.id === form.employeeId)) === 'Team member' ? 'Choose…' : fullName(people.find((p) => p.id === form.employeeId))}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.field} onPress={() => setPick('type')}>
                <Text style={styles.fieldLabel}>Award</Text>
                <Text style={styles.fieldValue}>{types.find((t) => t.id === form.awardTypeId)?.title || 'Choose…'}</Text>
              </TouchableOpacity>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Date (YYYY-MM-DD)</Text>
                <TextInput style={styles.input} value={form.givenDate} onChangeText={(v) => setForm((f) => ({ ...f, givenDate: v }))} autoCapitalize="none" />
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Why they are being recognised</Text>
                <TextInput style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]} value={form.summary} onChangeText={(v) => setForm((f) => ({ ...f, summary: v }))} multiline placeholder="What they did" placeholderTextColor="#94A3B8" />
              </View>
              <TouchableOpacity style={styles.photoPick} onPress={() => setPhotoPicker(true)} disabled={uploading}>
                {form.photoUrl ? <Image source={{ uri: form.photoUrl }} style={styles.thumb} /> : <ImagePlus size={20} color="#64748B" />}
                <Text style={styles.sub}>{uploading ? 'Uploading…' : form.photoUrl ? 'Change photo' : 'Add a photo (optional)'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submit, (!form.employeeId || !form.awardTypeId || !form.summary.trim() || saving) && { opacity: 0.5 }]}
                disabled={!form.employeeId || !form.awardTypeId || !form.summary.trim() || saving}
                onPress={give}
              >
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Give award</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>

        {/* Picker inside the give sheet */}
        <Modal visible={!!pick} transparent animationType="slide" onRequestClose={() => setPick(null)}>
          <TouchableOpacity style={styles.bottom} activeOpacity={1} onPress={() => setPick(null)}>
            <TouchableOpacity activeOpacity={1} style={[styles.sheet, { maxHeight: '75%' }]}>
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle}>{pick === 'type' ? 'Award' : 'Employee'}</Text>
                <TouchableOpacity onPress={() => setPick(null)}><X size={20} color="#334155" /></TouchableOpacity>
              </View>
              {pick === 'employee' && (
                <View style={[styles.search, { margin: 12 }]}>
                  <Search size={16} color="#94A3B8" />
                  <TextInput style={styles.searchInput} value={pickQuery} onChangeText={setPickQuery} placeholder="Find employee" placeholderTextColor="#94A3B8" autoCorrect={false} />
                </View>
              )}
              <ScrollView keyboardShouldPersistTaps="handled">
                {pickOptions.map((o: any) => {
                  const on = (pick === 'type' ? form.awardTypeId : form.employeeId) === o.id;
                  return (
                    <TouchableOpacity key={o.id} style={styles.option} onPress={() => { setForm((f) => ({ ...f, [pick === 'type' ? 'awardTypeId' : 'employeeId']: o.id })); setPick(null); setPickQuery(''); }}>
                      {o.person && <Avatar person={o.person} size={30} />}
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
        <MediaPickerModal visible={photoPicker} onClose={() => setPhotoPicker(false)} onMediaSelected={uploadPhoto} title="Award photo" />
      </Modal>

      {/* Award type editor */}
      <Modal visible={!!typeEdit} transparent animationType="fade" onRequestClose={() => setTypeEdit(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.center}>
          <View style={[styles.dialog, { padding: 18, gap: 12 }]}>
            <Text style={styles.sheetTitle}>{typeEdit?.id ? 'Edit award type' : 'New award type'}</Text>
            <TextInput style={styles.input} value={typeEdit?.title} onChangeText={(v) => setTypeEdit((t) => (t ? { ...t, title: v } : t))} placeholder="e.g. Customer Hero" placeholderTextColor="#94A3B8" />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {Object.keys(COLORS).map((c) => (
                <TouchableOpacity key={c} onPress={() => setTypeEdit((t) => (t ? { ...t, color: c } : t))}
                  style={[styles.swatch, { backgroundColor: COLORS[c].text }, typeEdit?.color === c && styles.swatchOn]} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[styles.name, { flex: 1 }]}>Active</Text>
              <Switch value={!!typeEdit?.status} onValueChange={(v) => setTypeEdit((t) => (t ? { ...t, status: v } : t))} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {!!typeEdit?.id && (
                <TouchableOpacity style={[styles.danger, { flex: 0, paddingHorizontal: 14 }]} onPress={() => deleteType(typeEdit)}>
                  <Trash2 size={16} color="#B91C1C" />
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.secondary, { flex: 1 }]} onPress={() => setTypeEdit(null)}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.submit, { flex: 1 }, !typeEdit?.title.trim() && { opacity: 0.5 }]} disabled={!typeEdit?.title.trim()} onPress={saveType}>
                <Text style={styles.primaryText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <PersonSheetHost />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 120, gap: 12 },
  tabs: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 12, padding: 3, gap: 3 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9 },
  tabOn: { backgroundColor: '#fff' },
  tabText: { fontSize: 13, fontWeight: '700', color: '#64748B' },
  tabTextOn: { color: '#0F172A' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 0 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  chipOn: { backgroundColor: '#1373E5', borderColor: '#1373E5' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  chipTextOn: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden' },
  photo: { width: '100%', height: 150, backgroundColor: '#F1F5F9' },
  cardBody: { padding: 14, gap: 10 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: '800' },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  sub: { fontSize: 12, color: '#64748B' },
  summary: { fontSize: 13, lineHeight: 19, color: '#334155' },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 30 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 12 },
  typeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 38, borderRadius: 12, backgroundColor: '#1373E5' },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  center: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 20 },
  dialog: { backgroundColor: '#fff', borderRadius: 22, maxHeight: '85%' },
  close: { position: 'absolute', right: 12, top: 12, zIndex: 2, width: 34, height: 34, borderRadius: 10, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  bigPhoto: { width: '100%', height: 200, borderRadius: 14, backgroundColor: '#F1F5F9' },
  fullSummary: { fontSize: 15, lineHeight: 23, color: '#1E293B' },
  danger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: 12, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
  dangerText: { color: '#B91C1C', fontWeight: '800' },
  bottom: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '90%', paddingBottom: 30 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  field: { gap: 4 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  fieldValue: { fontSize: 15, fontWeight: '600', color: '#0F172A', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#F8FAFC' },
  input: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: '#0F172A', backgroundColor: '#F8FAFC' },
  photoPick: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: '#CBD5E1' },
  thumb: { width: 44, height: 44, borderRadius: 8 },
  submit: { height: 48, borderRadius: 12, backgroundColor: '#1373E5', alignItems: 'center', justifyContent: 'center' },
  secondary: { height: 48, borderRadius: 12, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#334155', fontWeight: '700' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
  optionText: { fontSize: 15, color: '#0F172A' },
  optionOn: { fontWeight: '800', color: '#1373E5' },
  swatch: { width: 30, height: 30, borderRadius: 15 },
  swatchOn: { borderWidth: 3, borderColor: '#0F172A' },
});
