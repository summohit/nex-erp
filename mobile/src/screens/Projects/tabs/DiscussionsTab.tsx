import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Modal, ActivityIndicator, Alert, RefreshControl, ScrollView, Linking,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { apiClient } from '../../../api/apiClient';
import { useAuthStore } from '../../../store/authStore';

const name = (p: any) => `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim() || 'Someone';
const when = (s: string) => new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
/** Discussions are written in the web's rich editor; the app shows the words. */
const plain = (html?: string) => (html || '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<li>/gi, '• ')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\n{3,}/g, '\n\n').trim();
const html = (text: string) => text.split('\n').map((l) => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;') || '<br>'}</p>`).join('');

/**
 * A project's discussion threads, as on the web's Discussions tab: read a
 * thread and its replies, reply, and start a new one. Deleting stays with the
 * author, as on the web (the server enforces it).
 */
export default function DiscussionsTab({ projectId }: { projectId: number }) {
  const me = useAuthStore((s) => s.user?.employeeId);
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<any>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get(`/projects/${projectId}/discussions`);
      setList(data || []);
    } catch {
      setList([]);
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const openThread = async (d: any) => {
    setOpen(d); setReply('');
    try {
      const { data } = await apiClient.get(`/projects/${projectId}/discussions/${d.id}`);
      setOpen(data);
    } catch { /* keep the summary */ }
  };

  const sendReply = async () => {
    if (!reply.trim() || !open) return;
    setBusy(true);
    try {
      await apiClient.post(`/projects/${projectId}/discussions/${open.id}/comments`, { content: html(reply.trim()) });
      setReply('');
      await openThread(open);
      load();
    } catch (e: any) {
      Alert.alert('Could not send', e?.response?.data?.message || 'Please try again.');
    } finally { setBusy(false); }
  };

  const create = async () => {
    if (!title.trim() || !content.trim()) { Alert.alert('Almost there', 'Add a title and a message.'); return; }
    setBusy(true);
    try {
      await apiClient.post(`/projects/${projectId}/discussions`, { title: title.trim(), content: html(content.trim()) });
      setComposing(false); setTitle(''); setContent('');
      load();
    } catch (e: any) {
      Alert.alert('Could not post', e?.response?.data?.message || 'Please try again.');
    } finally { setBusy(false); }
  };

  const remove = (d: any) => Alert.alert('Delete this discussion?', d.title, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try { await apiClient.delete(`/projects/${projectId}/discussions/${d.id}`); setOpen(null); load(); }
      catch (e: any) { Alert.alert('Could not delete', e?.response?.data?.message || 'Please try again.'); }
    } },
  ]);

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} color="#2563EB" />;

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={list}
        keyExtractor={(d) => String(d.id)}
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListHeaderComponent={
          <TouchableOpacity style={styles.primary} onPress={() => setComposing(true)}>
            <Text style={styles.primaryText}>+ Start a discussion</Text>
          </TouchableOpacity>
        }
        ListEmptyComponent={<Text style={styles.empty}>No discussions yet.</Text>}
        renderItem={({ item: d }) => (
          <TouchableOpacity style={styles.card} onPress={() => openThread(d)}>
            <Text style={styles.title} numberOfLines={2}>{d.title}</Text>
            <Text style={styles.preview} numberOfLines={2}>{plain(d.content)}</Text>
            <Text style={styles.meta}>{name(d.author)} · {when(d.createdAt)} · {d._count?.comments ?? d.comments?.length ?? 0} replies</Text>
          </TouchableOpacity>
        )}
      />

      {/* Thread */}
      <Modal visible={!!open} animationType="slide" onRequestClose={() => setOpen(null)}>
        <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.pageHead}>
            <TouchableOpacity onPress={() => setOpen(null)}><Text style={styles.link}>‹ Back</Text></TouchableOpacity>
            {open && open.authorId === me && <TouchableOpacity onPress={() => remove(open)}><Text style={styles.danger}>Delete</Text></TouchableOpacity>}
          </View>
          <ScrollView contentContainerStyle={styles.body}>
            <Text style={styles.threadTitle}>{open?.title}</Text>
            <Text style={styles.meta}>{name(open?.author)} · {open ? when(open.createdAt) : ''}</Text>
            <Text style={styles.content}>{plain(open?.content)}</Text>
            {(open?.attachments || []).map((a: any) => (
              <TouchableOpacity key={a.id} onPress={() => a.fileUrl && Linking.openURL(a.fileUrl)}>
                <Text style={styles.link}>📎 {a.fileName}</Text>
              </TouchableOpacity>
            ))}
            <Text style={styles.section}>Replies</Text>
            {(open?.comments || []).length === 0 && <Text style={styles.meta}>No replies yet.</Text>}
            {(open?.comments || []).map((c: any) => (
              <View key={c.id} style={styles.comment}>
                <Text style={styles.commentHead}>{name(c.author)} · <Text style={styles.meta}>{when(c.createdAt)}</Text></Text>
                <Text style={styles.content}>{plain(c.content)}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={styles.replyBar}>
            <TextInput style={styles.replyInput} placeholder="Write a reply" value={reply} onChangeText={setReply} multiline />
            <TouchableOpacity style={[styles.send, (!reply.trim() || busy) && { opacity: 0.5 }]} disabled={!reply.trim() || busy} onPress={sendReply}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Send</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* New discussion */}
      <Modal visible={composing} animationType="slide" onRequestClose={() => setComposing(false)}>
        <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.pageHead}>
            <TouchableOpacity onPress={() => setComposing(false)}><Text style={styles.link}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity onPress={create} disabled={busy}>{busy ? <ActivityIndicator color="#2563EB" /> : <Text style={styles.link}>Post</Text>}</TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <TextInput style={styles.input} placeholder="Title" value={title} onChangeText={setTitle} />
            <TextInput style={[styles.input, { minHeight: 180, textAlignVertical: 'top', paddingTop: 10 }]} placeholder="What do you want to discuss?" value={content} onChangeText={setContent} multiline />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10, paddingBottom: 60 },
  primary: { height: 44, borderRadius: 10, backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontWeight: '700' },
  card: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, gap: 4 },
  title: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  preview: { fontSize: 13, color: '#475569' },
  meta: { fontSize: 12, color: '#64748B' },
  empty: { textAlign: 'center', color: '#64748B', marginTop: 30 },
  page: { flex: 1, backgroundColor: '#F8FAFC', paddingTop: 50 },
  pageHead: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  link: { color: '#2563EB', fontWeight: '700', fontSize: 15, marginTop: 4 },
  danger: { color: '#DC2626', fontWeight: '700', fontSize: 15 },
  threadTitle: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  content: { fontSize: 14.5, color: '#1E293B', lineHeight: 21, marginTop: 4 },
  section: { fontSize: 13, fontWeight: '700', color: '#0F172A', marginTop: 18 },
  comment: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', padding: 12 },
  commentHead: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  replyBar: { flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: '#fff', paddingBottom: 28 },
  replyInput: { flex: 1, minHeight: 42, maxHeight: 120, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, paddingHorizontal: 12, paddingTop: 10, color: '#0F172A' },
  send: { height: 42, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#2563EB', justifyContent: 'center', alignSelf: 'flex-end' },
  input: { minHeight: 46, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, paddingHorizontal: 12, backgroundColor: '#fff', color: '#0F172A' },
});
