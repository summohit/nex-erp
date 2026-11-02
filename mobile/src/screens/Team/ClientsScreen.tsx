import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, TextInput, Modal, ScrollView,
  Alert, KeyboardAvoidingView, Platform, Linking, Switch,
} from 'react-native';
import { Search, X, Plus, Building2, Phone, Mail, Globe, Pencil, Trash2, Archive, RotateCcw, UserPlus, FolderKanban, Star } from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { theme } from '../../theme/theme';

/**
 * Clients, as on the web: active / archived lists, a client profile with its
 * contacts and projects, add / edit, contacts, archive / restore and delete.
 * Everyone may read the list (projects, timesheets and quotations pick from
 * it); changes need the clients permission, which the server checks.
 */
type Client = any;
const errMsg = (e: any) => { const m = e?.response?.data?.message; return Array.isArray(m) ? m.join('\n') : m || 'Please try again.'; };
const BLANK = {
  name: '', industry: '', website: '', currency: 'INR', paymentTerms: '', taxId: '',
  billingAddressLine1: '', billingCity: '', billingState: '', billingZipCode: '', billingCountry: 'India',
  contactFirst: '', contactLast: '', contactEmail: '', contactPhone: '', contactTitle: '',
};
const CBLANK = { firstName: '', lastName: '', email: '', phone: '', jobTitle: '', isPrimary: false, isBilling: false };
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export default function ClientsScreen() {
  const navigation = useNavigation<any>();
  const [status, setStatus] = useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Client | null>(null);
  const [form, setForm] = useState<(typeof BLANK & { id?: number }) | null>(null);
  const [contact, setContact] = useState<(typeof CBLANK & { id?: number }) | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/v1/clients', { params: { status } });
      setClients(data || []);
    } catch { setClients([]); } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [status]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients.filter((c) => !q || `${c.name} ${c.industry || ''} ${c.billingCity || ''} ${c.contacts?.[0]?.email || ''}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, query]);

  const openClient = async (c: Client) => {
    setOpen(c);
    const { data } = await apiClient.get(`/v1/clients/${c.id}`).catch(() => ({ data: null }));
    if (data) setOpen(data);
  };

  const reopen = async (id: number) => {
    const { data } = await apiClient.get(`/v1/clients/${id}`).catch(() => ({ data: null }));
    if (data) setOpen(data);
    load();
  };

  const saveClient = async () => {
    if (!form || !form.name.trim()) return;
    const { contactFirst, contactLast, contactEmail, contactPhone, contactTitle, id, ...rest } = form;
    const body: any = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]));
    body.name = form.name.trim();
    if (!id && contactFirst.trim() && contactEmail.trim()) {
      body.contacts = [{ firstName: contactFirst.trim(), lastName: contactLast.trim() || null, email: contactEmail.trim(), phone: contactPhone.trim() || null, jobTitle: contactTitle.trim() || null, isPrimary: true }];
    }
    try {
      if (id) { await apiClient.patch(`/v1/clients/${id}`, body); setForm(null); reopen(id); }
      else { await apiClient.post('/v1/clients', body); setForm(null); load(); }
    } catch (e) { Alert.alert('Could not save client', errMsg(e)); }
  };

  const saveContact = async () => {
    if (!open || !contact || !contact.firstName.trim() || !contact.email.trim()) return;
    const body = { ...contact, firstName: contact.firstName.trim(), lastName: contact.lastName.trim() || null, email: contact.email.trim(), phone: contact.phone.trim() || null, jobTitle: contact.jobTitle.trim() || null };
    delete (body as any).id;
    try {
      if (contact.id) await apiClient.patch(`/v1/clients/${open.id}/contacts/${contact.id}`, body);
      else await apiClient.post(`/v1/clients/${open.id}/contacts`, body);
      setContact(null);
      reopen(open.id);
    } catch (e) { Alert.alert('Could not save contact', errMsg(e)); }
  };

  const removeContact = (ct: any) => open && Alert.alert('Remove contact?', `${ct.firstName} ${ct.lastName || ''}`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => {
      try { await apiClient.delete(`/v1/clients/${open.id}/contacts/${ct.id}`); reopen(open.id); } catch (e) { Alert.alert('Could not remove', errMsg(e)); }
    } },
  ]);

  const archive = (c: Client, restore: boolean) => Alert.alert(restore ? 'Restore client?' : 'Archive client?', c.name, [
    { text: 'Cancel', style: 'cancel' },
    { text: restore ? 'Restore' : 'Archive', onPress: async () => {
      try { await apiClient.patch(`/v1/clients/${c.id}/${restore ? 'restore' : 'archive'}`, {}); setOpen(null); load(); } catch (e) { Alert.alert('Could not update', errMsg(e)); }
    } },
  ]);

  const remove = (c: Client) => Alert.alert('Delete client?', `${c.name}. Clients with projects can't be deleted; archive them instead.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try { await apiClient.delete(`/v1/clients/${c.id}`); setOpen(null); load(); } catch (e) { Alert.alert('Could not delete', errMsg(e)); }
    } },
  ]);

  const editClient = (c: Client) => setForm({
    ...BLANK, id: c.id,
    ...Object.fromEntries(Object.keys(BLANK).filter((k) => !k.startsWith('contact')).map((k) => [k, c[k] ?? (BLANK as any)[k]])),
  } as any);

  const primary = (c: Client) => c.contacts?.find((x: any) => x.isPrimary) || c.contacts?.[0];

  const header = (
    <View style={{ gap: 10, marginBottom: 6 }}>
      <View style={styles.tabs}>
        {(['ACTIVE', 'ARCHIVED'] as const).map((s) => (
          <TouchableOpacity key={s} style={[styles.tab, status === s && styles.tabOn]} onPress={() => { setLoading(true); setStatus(s); }}>
            <Text style={[styles.tabText, status === s && styles.tabTextOn]}>{s === 'ACTIVE' ? 'Active' : 'Archived'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.search}>
        <Search size={16} color="#94A3B8" />
        <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Search name, industry, city, email" placeholderTextColor="#94A3B8" autoCorrect={false} clearButtonMode="while-editing" />
      </View>
    </View>
  );

  return (
    <AppScreen
      showBack
      title="Clients"
      subtitle={`${clients.length} ${status === 'ACTIVE' ? 'active' : 'archived'}`}
      right={<TouchableOpacity style={styles.primaryBtn} onPress={() => setForm({ ...BLANK })}><Plus size={15} color="#fff" /><Text style={styles.primaryText}>New</Text></TouchableOpacity>}
    >
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} /> : (
        <FlatList
          data={shown}
          keyExtractor={(c) => String(c.id)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>No clients.</Text>}
          renderItem={({ item: c }) => {
            const p = primary(c);
            return (
              <TouchableOpacity style={styles.card} onPress={() => openClient(c)} activeOpacity={0.85}>
                <View style={styles.logo}><Text style={styles.logoText}>{initials(c.name)}</Text></View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
                  <Text style={styles.sub} numberOfLines={1}>{[c.industry, c.billingCity].filter(Boolean).join(' · ') || '—'}</Text>
                  {!!p && <Text style={styles.sub} numberOfLines={1}>{p.firstName} {p.lastName || ''} · {p.email}</Text>}
                </View>
                <View style={styles.count}><FolderKanban size={12} color="#4F46E5" /><Text style={styles.countText}>{c._count?.projects ?? 0}</Text></View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Client profile */}
      <Modal visible={!!open && !form && !contact} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <View style={styles.bottom}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <View style={styles.logo}><Text style={styles.logoText}>{open ? initials(open.name) : ''}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>{open?.name}</Text>
                <Text style={styles.sub}>{[open?.industry, open?.status === 'ARCHIVED' ? 'Archived' : null].filter(Boolean).join(' · ')}</Text>
              </View>
              <TouchableOpacity onPress={() => setOpen(null)}><X size={20} color="#334155" /></TouchableOpacity>
            </View>
            {open && (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
                <View style={styles.actions}>
                  {!!open.website && <TouchableOpacity style={styles.act} onPress={() => Linking.openURL(/^https?:/.test(open.website) ? open.website : `https://${open.website}`)}><Globe size={15} color="#1373E5" /><Text style={styles.actText}>Website</Text></TouchableOpacity>}
                  <TouchableOpacity style={styles.act} onPress={() => editClient(open)}><Pencil size={15} color="#1373E5" /><Text style={styles.actText}>Edit</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.act} onPress={() => archive(open, open.status === 'ARCHIVED')}>
                    {open.status === 'ARCHIVED' ? <RotateCcw size={15} color="#1373E5" /> : <Archive size={15} color="#1373E5" />}
                    <Text style={styles.actText}>{open.status === 'ARCHIVED' ? 'Restore' : 'Archive'}</Text>
                  </TouchableOpacity>
                </View>
                {[
                  ['Currency', open.currency], ['Payment terms', open.paymentTerms], ['GST / Tax ID', open.taxId], ['Registration', open.registrationNo],
                  ['Hourly rate', open.defaultHourlyRate], ['Credit limit', open.creditLimit],
                  ['Billing address', [open.billingAddressLine1, open.billingAddressLine2, open.billingCity, open.billingState, open.billingZipCode, open.billingCountry].filter(Boolean).join(', ')],
                ].filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (
                  <View key={k as string} style={styles.field}><Text style={styles.fKey}>{k}</Text><Text style={styles.fVal}>{String(v)}</Text></View>
                ))}

                <View style={styles.rowBetween}>
                  <Text style={styles.section}>CONTACTS · {open.contacts?.length || 0}</Text>
                  <TouchableOpacity style={styles.inline} onPress={() => setContact({ ...CBLANK, isPrimary: !open.contacts?.length })}><UserPlus size={14} color="#1373E5" /><Text style={styles.link}>Add</Text></TouchableOpacity>
                </View>
                {(open.contacts || []).map((ct: any) => (
                  <View key={ct.id} style={styles.contact}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.name}>{ct.firstName} {ct.lastName || ''} {ct.isPrimary && <Star size={12} color="#F59E0B" fill="#F59E0B" />}</Text>
                      <Text style={styles.sub}>{[ct.jobTitle, ct.isBilling ? 'Billing' : null].filter(Boolean).join(' · ') || ct.email}</Text>
                    </View>
                    {!!(ct.mobile || ct.phone) && <TouchableOpacity style={styles.icon} onPress={() => Linking.openURL(`tel:${ct.mobile || ct.phone}`)}><Phone size={15} color="#059669" /></TouchableOpacity>}
                    {!!ct.email && <TouchableOpacity style={styles.icon} onPress={() => Linking.openURL(`mailto:${ct.email}`)}><Mail size={15} color="#1373E5" /></TouchableOpacity>}
                    <TouchableOpacity style={styles.icon} onPress={() => setContact({ ...CBLANK, ...ct, lastName: ct.lastName || '', phone: ct.phone || '', jobTitle: ct.jobTitle || '' })}><Pencil size={14} color="#64748B" /></TouchableOpacity>
                    <TouchableOpacity style={styles.icon} onPress={() => removeContact(ct)}><Trash2 size={14} color="#DC2626" /></TouchableOpacity>
                  </View>
                ))}

                <Text style={styles.section}>PROJECTS · {open.projects?.length ?? open._count?.projects ?? 0}</Text>
                {(open.projects || []).map((p: any) => (
                  <TouchableOpacity key={p.id} style={styles.contact} onPress={() => { setOpen(null); navigation.navigate('ProjectDetail', { projectId: p.id, projectName: p.name }); }}>
                    <FolderKanban size={16} color="#4F46E5" />
                    <Text style={[styles.name, { flex: 1, fontWeight: '600' }]} numberOfLines={1}>{p.name}</Text>
                    <Text style={styles.tiny}>{String(p.status || '').replace(/_/g, ' ').toLowerCase()}</Text>
                  </TouchableOpacity>
                ))}

                <TouchableOpacity style={styles.danger} onPress={() => remove(open)}><Trash2 size={15} color="#B91C1C" /><Text style={styles.dangerText}>Delete client</Text></TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Add / edit client */}
      <Modal visible={!!form} transparent animationType="slide" onRequestClose={() => setForm(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottom}>
          <View style={[styles.sheet, { maxHeight: '92%' }]}>
            <View style={styles.sheetHead}><Building2 size={18} color="#4F46E5" /><Text style={[styles.sheetTitle, { flex: 1 }]}>{form?.id ? 'Edit client' : 'New client'}</Text><TouchableOpacity onPress={() => setForm(null)}><X size={20} color="#334155" /></TouchableOpacity></View>
            {form && (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
                {([['name', 'Client name *'], ['industry', 'Industry'], ['website', 'Website'], ['currency', 'Currency (e.g. INR)'], ['paymentTerms', 'Payment terms (e.g. Net 30)'], ['taxId', 'GST / Tax ID'],
                  ['billingAddressLine1', 'Billing address'], ['billingCity', 'City'], ['billingState', 'State'], ['billingZipCode', 'PIN code'], ['billingCountry', 'Country']] as const).map(([k, l]) => (
                  <TextInput key={k} style={styles.input} value={(form as any)[k] ?? ''} onChangeText={(v) => setForm((f) => (f ? { ...f, [k]: v } : f))} placeholder={l} placeholderTextColor="#94A3B8" autoCapitalize={k === 'website' ? 'none' : 'sentences'} />
                ))}
                {!form.id && (
                  <>
                    <Text style={styles.section}>PRIMARY CONTACT (OPTIONAL)</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TextInput style={[styles.input, { flex: 1 }]} value={form.contactFirst} onChangeText={(v) => setForm((f) => (f ? { ...f, contactFirst: v } : f))} placeholder="First name" placeholderTextColor="#94A3B8" />
                      <TextInput style={[styles.input, { flex: 1 }]} value={form.contactLast} onChangeText={(v) => setForm((f) => (f ? { ...f, contactLast: v } : f))} placeholder="Last name" placeholderTextColor="#94A3B8" />
                    </View>
                    <TextInput style={styles.input} value={form.contactEmail} onChangeText={(v) => setForm((f) => (f ? { ...f, contactEmail: v } : f))} placeholder="Email" placeholderTextColor="#94A3B8" keyboardType="email-address" autoCapitalize="none" />
                    <TextInput style={styles.input} value={form.contactPhone} onChangeText={(v) => setForm((f) => (f ? { ...f, contactPhone: v } : f))} placeholder="Phone" placeholderTextColor="#94A3B8" keyboardType="phone-pad" />
                    <TextInput style={styles.input} value={form.contactTitle} onChangeText={(v) => setForm((f) => (f ? { ...f, contactTitle: v } : f))} placeholder="Job title" placeholderTextColor="#94A3B8" />
                  </>
                )}
                <TouchableOpacity style={[styles.submit, !form.name.trim() && { opacity: 0.5 }]} disabled={!form.name.trim()} onPress={saveClient}>
                  <Text style={styles.primaryText}>{form.id ? 'Save changes' : 'Create client'}</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add / edit contact */}
      <Modal visible={!!contact} transparent animationType="slide" onRequestClose={() => setContact(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottom}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}><Text style={[styles.sheetTitle, { flex: 1 }]}>{contact?.id ? 'Edit contact' : 'Add contact'}</Text><TouchableOpacity onPress={() => setContact(null)}><X size={20} color="#334155" /></TouchableOpacity></View>
            {contact && (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput style={[styles.input, { flex: 1 }]} value={contact.firstName} onChangeText={(v) => setContact((c) => (c ? { ...c, firstName: v } : c))} placeholder="First name *" placeholderTextColor="#94A3B8" />
                  <TextInput style={[styles.input, { flex: 1 }]} value={contact.lastName} onChangeText={(v) => setContact((c) => (c ? { ...c, lastName: v } : c))} placeholder="Last name" placeholderTextColor="#94A3B8" />
                </View>
                <TextInput style={styles.input} value={contact.email} onChangeText={(v) => setContact((c) => (c ? { ...c, email: v } : c))} placeholder="Email *" placeholderTextColor="#94A3B8" keyboardType="email-address" autoCapitalize="none" />
                <TextInput style={styles.input} value={contact.phone} onChangeText={(v) => setContact((c) => (c ? { ...c, phone: v } : c))} placeholder="Phone" placeholderTextColor="#94A3B8" keyboardType="phone-pad" />
                <TextInput style={styles.input} value={contact.jobTitle} onChangeText={(v) => setContact((c) => (c ? { ...c, jobTitle: v } : c))} placeholder="Job title" placeholderTextColor="#94A3B8" />
                <View style={styles.rowBetween}><Text style={styles.name}>Primary contact</Text><Switch value={contact.isPrimary} onValueChange={(v) => setContact((c) => (c ? { ...c, isPrimary: v } : c))} /></View>
                <View style={styles.rowBetween}><Text style={styles.name}>Billing contact</Text><Switch value={contact.isBilling} onValueChange={(v) => setContact((c) => (c ? { ...c, isBilling: v } : c))} /></View>
                <TouchableOpacity style={[styles.submit, (!contact.firstName.trim() || !contact.email.trim()) && { opacity: 0.5 }]} disabled={!contact.firstName.trim() || !contact.email.trim()} onPress={saveContact}>
                  <Text style={styles.primaryText}>Save contact</Text>
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
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 0 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 12 },
  logo: { width: 42, height: 42, borderRadius: 12, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },
  logoText: { fontSize: 14, fontWeight: '800', color: '#4338CA' },
  name: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  sub: { fontSize: 12, color: '#64748B' },
  tiny: { fontSize: 11, color: '#94A3B8' },
  count: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#EEF2FF', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  countText: { fontSize: 11, fontWeight: '800', color: '#4F46E5' },
  empty: { textAlign: 'center', color: theme.colors.textSecondary, marginTop: 30 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 38, borderRadius: 12, backgroundColor: '#1373E5' },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  bottom: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '88%', paddingBottom: 30 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  act: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 36, borderRadius: 10, backgroundColor: '#EFF6FF' },
  actText: { fontSize: 13, fontWeight: '700', color: '#1373E5' },
  field: { flexDirection: 'row', gap: 10 },
  fKey: { width: 110, fontSize: 12, color: '#64748B' },
  fVal: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0F172A' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  section: { fontSize: 11, fontWeight: '800', color: '#64748B', letterSpacing: 0.6, marginTop: 4 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  link: { fontSize: 13, fontWeight: '800', color: '#1373E5' },
  contact: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' },
  icon: { width: 32, height: 32, borderRadius: 9, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' },
  danger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: 12, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', marginTop: 8 },
  dangerText: { color: '#B91C1C', fontWeight: '800' },
  input: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#0F172A', backgroundColor: '#F8FAFC' },
  submit: { height: 48, borderRadius: 12, backgroundColor: '#1373E5', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
});
