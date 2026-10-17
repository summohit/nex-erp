import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, ActivityIndicator, Alert, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Camera, Image as ImageIcon, FileText, X, Paperclip, Send } from 'lucide-react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import DocumentPicker from 'react-native-document-picker';
import { projectService } from '../../../api/projectService';
import { colors } from '../../../theme/ds';

type ProofFile = { uri: string; name: string; type: string; size?: number };

/**
 * Proof before a task moves to Review or Done (17 Oct 2026), matching the
 * web: one or more files — photo, gallery or a PDF/document — uploaded with a
 * progress bar, then the move. Plus a remark for the reviewer, saved as a
 * comment on the task next to the files.
 */
export default function ProofUploadSheet({
  visible, projectId, issueId, stageName, bottomInset = 0, onCancel, onUploaded, canSkip = false, onSkip,
}: {
  visible: boolean;
  projectId: number;
  issueId: number;
  stageName: string;
  bottomInset?: number;
  onCancel: () => void;
  /** Files are attached (and the remark saved): now move the task. */
  onUploaded: () => Promise<void> | void;
  /** Owners and PMs may move without proof, as on the web ("Skip & Move"). */
  canSkip?: boolean;
  onSkip?: () => Promise<void> | void;
}) {
  const [skipping, setSkipping] = useState(false);
  const [files, setFiles] = useState<ProofFile[]>([]);
  const [remark, setRemark] = useState('');
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (visible) { setFiles([]); setRemark(''); setProgress(null); }
  }, [visible]);

  const add = (more: ProofFile[]) => setFiles((prev) => [...prev, ...more]);

  const fromCamera = async () => {
    const r = await launchCamera({ mediaType: 'photo', quality: 0.8 });
    const a = r.assets?.[0];
    if (!r.didCancel && a?.uri) add([{ uri: a.uri, name: a.fileName || `photo-${Date.now()}.jpg`, type: a.type || 'image/jpeg', size: a.fileSize }]);
  };

  const fromGallery = async () => {
    const r = await launchImageLibrary({ mediaType: 'photo', selectionLimit: 0, quality: 0.8 });
    if (r.didCancel || !r.assets?.length) return;
    add(r.assets.filter((a) => a.uri).map((a) => ({
      uri: a.uri!, name: a.fileName || `image-${Date.now()}.jpg`, type: a.type || 'image/jpeg', size: a.fileSize,
    })));
  };

  const fromFiles = async () => {
    try {
      const picked = await DocumentPicker.pick({ allowMultiSelection: true, type: [DocumentPicker.types.allFiles] });
      add(picked.map((d) => ({ uri: d.uri, name: d.name || 'document', type: d.type || 'application/octet-stream', size: d.size ?? undefined })));
    } catch (e) {
      if (!DocumentPicker.isCancel(e)) Alert.alert('Could not open files', 'Please try again.');
    }
  };

  const submit = async () => {
    if (!files.length) { Alert.alert('Add proof', 'Attach at least one photo or document.'); return; }
    setProgress(0);
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const fd = new FormData();
        fd.append('file', { uri: f.uri, name: f.name, type: f.type } as any);
        await projectService.uploadAttachment(projectId, issueId, fd);
        setProgress(Math.round(((i + 1) / files.length) * 90));
      }
      if (remark.trim()) {
        await projectService.addIssueComment(projectId, issueId, `Proof for ${stageName}: ${remark.trim()}`);
      }
      setProgress(100);
      await onUploaded();
    } catch (e: any) {
      Alert.alert('Upload failed', e?.response?.data?.message || 'Some files did not upload. Please try again.');
      setProgress(null);
    }
  };

  const busy = progress !== null;
  const kb = (n?: number) => (n ? (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`) : '');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!busy) onCancel(); }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => { if (!busy) onCancel(); }} />
        <View style={[styles.sheet, { paddingBottom: Math.max(bottomInset, 20) }]}>
          <View style={styles.grabber} />
          <Text style={styles.title}>Proof to move to {stageName}</Text>
          <Text style={styles.sub}>Attach at least one photo or document showing the work is done.</Text>

          <View style={styles.pickRow}>
            {[
              { label: 'Camera', icon: Camera, onPress: fromCamera },
              { label: 'Gallery', icon: ImageIcon, onPress: fromGallery },
              { label: 'PDF / File', icon: FileText, onPress: fromFiles },
            ].map((o) => {
              const Icon = o.icon;
              return (
                <TouchableOpacity key={o.label} style={styles.pick} onPress={o.onPress} disabled={busy} activeOpacity={0.8}>
                  <View style={styles.pickIcon}><Icon size={18} color={colors.primary} /></View>
                  <Text style={styles.pickText}>{o.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {files.length > 0 && (
            <ScrollView style={styles.list} contentContainerStyle={{ gap: 6 }}>
              {files.map((f, i) => (
                <View key={`${f.uri}-${i}`} style={styles.file}>
                  <Paperclip size={14} color={colors.primary} />
                  <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
                  {!!f.size && <Text style={styles.fileSize}>{kb(f.size)}</Text>}
                  {!busy && (
                    <TouchableOpacity onPress={() => setFiles((p) => p.filter((_, j) => j !== i))} hitSlop={8}>
                      <X size={16} color={colors.textFaint} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>
          )}

          <Text style={styles.label}>REMARK FOR THE REVIEWER</Text>
          <TextInput
            style={styles.input}
            placeholder="What was done, anything to check (optional)"
            placeholderTextColor={colors.textFaint}
            value={remark}
            onChangeText={setRemark}
            multiline
            editable={!busy}
          />

          {busy && (
            <View style={styles.progressWrap}>
              <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
              <Text style={styles.progressText}>Uploading {files.length} {files.length === 1 ? 'file' : 'files'}… {progress}%</Text>
            </View>
          )}

          {canSkip && !!onSkip && (
            <TouchableOpacity
              style={styles.skip}
              disabled={busy || skipping}
              onPress={async () => {
                setSkipping(true);
                try {
                  // A remark is still worth keeping when the proof is skipped.
                  if (remark.trim()) await projectService.addIssueComment(projectId, issueId, `Moved to ${stageName}: ${remark.trim()}`);
                  await onSkip();
                } catch (e: any) {
                  Alert.alert('Could not move', e?.response?.data?.message || 'Please try again.');
                } finally {
                  setSkipping(false);
                }
              }}
            >
              {skipping ? <ActivityIndicator color={colors.textMuted} /> : <Text style={styles.skipText}>Skip proof &amp; move</Text>}
            </TouchableOpacity>
          )}

          <View style={styles.actions}>
            <TouchableOpacity style={[styles.btn, styles.cancel]} onPress={onCancel} disabled={busy}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.submit, (!files.length || busy) && { opacity: 0.55 }]}
              onPress={submit}
              disabled={!files.length || busy}
            >
              {busy ? <ActivityIndicator color="#FFFFFF" /> : (
                <>
                  <Send size={15} color="#FFFFFF" />
                  <Text style={styles.submitText}>Upload &amp; move</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.45)' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, maxHeight: '88%' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 12 },
  title: { fontSize: 17, fontWeight: '900', color: colors.text },
  sub: { fontSize: 12.5, color: colors.textMuted, marginTop: 4, lineHeight: 18 },
  pickRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  pick: {
    flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 16, borderWidth: 1.5,
    borderStyle: 'dashed', borderColor: colors.primaryBorder, backgroundColor: colors.primarySoft,
  },
  pickIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  pickText: { fontSize: 12, fontWeight: '800', color: colors.primary },
  list: { maxHeight: 170, marginTop: 12 },
  file: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 9,
    borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  fileName: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textBody },
  fileSize: { fontSize: 11, color: colors.textFaint, fontWeight: '600' },
  label: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.6, color: colors.textMuted, marginTop: 14, marginBottom: 6 },
  input: {
    minHeight: 70, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12,
    textAlignVertical: 'top', color: colors.text, backgroundColor: colors.bg, fontSize: 14,
  },
  progressWrap: { marginTop: 12, gap: 6 },
  progressTrack: { height: 6, borderRadius: 999, backgroundColor: colors.track, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 999 },
  progressText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  cancel: { backgroundColor: colors.borderSoft },
  cancelText: { color: colors.textBody, fontWeight: '700', fontSize: 14 },
  submit: { backgroundColor: colors.primary },
  submitText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  skip: { marginTop: 12, alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 8 },
  skipText: { color: colors.textMuted, fontWeight: '700', fontSize: 13, textDecorationLine: 'underline' },
});
