import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator, Alert, ScrollView, Switch,
} from 'react-native';
import { Download, Upload, FileSpreadsheet, CheckCircle, AlertTriangle, XCircle, RefreshCw, X } from 'lucide-react-native';
import DocumentPicker from 'react-native-document-picker';
import { taskTransferService, TaskImportSummary, PickedFile } from '../../../api/taskTransferService';
import { colors, status } from '../../../theme/ds';

/**
 * "⇅ Export / Import" for a project's tasks on the phone, as on the web:
 * download the Excel template or the current tasks, then import a filled
 * file — always previewed first (what will be created, updated, or skipped
 * and why), and written only on Confirm. Rows that fail can be downloaded
 * as a file to fix and import again.
 */
export default function TaskImportSheet({
  visible, projectId, projectName, onClose, onImported, bottomInset = 0,
}: {
  visible: boolean;
  projectId: number;
  projectName: string;
  onClose: () => void;
  onImported: () => void;
  bottomInset?: number;
}) {
  const [tab, setTab] = useState<'export' | 'import'>('import');
  const [includeDone, setIncludeDone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [file, setFile] = useState<PickedFile | null>(null);
  const [preview, setPreview] = useState<TaskImportSummary | null>(null);
  const [result, setResult] = useState<TaskImportSummary | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setFile(null); setPreview(null); setResult(null); setBusy(null); setOnlyProblems(false);
  }, [visible]);

  const fail = (e: any, fallback: string) => {
    const m = e?.response?.data?.message;
    Alert.alert('Something went wrong', (Array.isArray(m) ? m.join('\n') : m) || e?.message || fallback);
  };

  const download = async (kind: 'template' | 'export') => {
    setBusy(kind);
    try { await taskTransferService.download(kind, projectId, projectName, includeDone); } catch (e) { fail(e, 'Could not download.'); } finally { setBusy(null); }
  };

  const pick = async () => {
    try {
      const d = await DocumentPicker.pickSingle({
        type: [DocumentPicker.types.xlsx, DocumentPicker.types.xls, DocumentPicker.types.csv],
      });
      const f = { uri: d.uri, name: d.name || 'tasks.xlsx', type: d.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
      setFile(f); setPreview(null); setResult(null);
      setBusy('preview');
      try {
        const s = await taskTransferService.preview(projectId, f);
        setPreview(s);
        setOnlyProblems(s.failed > 0);
      } catch (e) { fail(e, 'Could not read that file.'); setFile(null); } finally { setBusy(null); }
    } catch (e) {
      if (!DocumentPicker.isCancel(e)) fail(e, 'Could not open files.');
    }
  };

  const confirm = async () => {
    if (!file || !preview) return;
    setBusy('import');
    try {
      const s = await taskTransferService.commit(projectId, file);
      setResult(s); setPreview(null);
      onImported();
    } catch (e) { fail(e, 'Import failed.'); } finally { setBusy(null); }
  };

  const shown = useMemo(() => {
    const s = result ?? preview;
    if (!s) return [];
    return onlyProblems ? s.rows.filter((r) => !r.ok || r.warnings.length) : s.rows;
  }, [preview, result, onlyProblems]);

  const summary = result ?? preview;
  const willWrite = preview ? preview.total - preview.failed : 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => { if (!busy) onClose(); }} />
        <View style={[styles.sheet, { paddingBottom: Math.max(bottomInset, 20) }]}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <View style={styles.headIcon}><FileSpreadsheet size={18} color="#16A34A" /></View>
            <View style={styles.flex}>
              <Text style={styles.title}>Export / Import tasks</Text>
              <Text style={styles.sub} numberOfLines={1}>{projectName} · Excel</Text>
            </View>
            <TouchableOpacity onPress={onClose} disabled={!!busy} style={styles.close}><X size={18} color={colors.textMuted} /></TouchableOpacity>
          </View>

          <View style={styles.segmented}>
            {(['import', 'export'] as const).map((t) => (
              <TouchableOpacity key={t} style={[styles.segment, tab === t && styles.segmentOn]} onPress={() => setTab(t)} disabled={!!busy}>
                <Text style={[styles.segmentText, tab === t && styles.segmentTextOn]}>{t === 'import' ? 'Import' : 'Export'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === 'export' ? (
            <View style={styles.block}>
              <Text style={styles.p}>Download this project's tasks in the template layout. Edit the file and import it back: rows that keep their <Text style={styles.b}>Task ID</Text> update that task instead of creating a new one.</Text>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Include completed tasks</Text>
                <Switch value={includeDone} onValueChange={setIncludeDone} />
              </View>
              <TouchableOpacity style={styles.primary} onPress={() => download('export')} disabled={!!busy}>
                {busy === 'export' ? <ActivityIndicator color="#FFFFFF" /> : (<><Download size={16} color="#FFFFFF" /><Text style={styles.primaryText}>Download tasks</Text></>)}
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={() => download('template')} disabled={!!busy}>
                {busy === 'template' ? <ActivityIndicator color={colors.primary} /> : (<><FileSpreadsheet size={16} color={colors.primary} /><Text style={styles.secondaryText}>Blank template</Text></>)}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.flexBlock}>
              {!summary && (
                <View style={styles.block}>
                  <Text style={styles.p}>Pick a filled Excel file (.xlsx or .csv). You will see what each row does before anything is saved.</Text>
                  <TouchableOpacity style={styles.drop} onPress={pick} disabled={!!busy} activeOpacity={0.8}>
                    {busy === 'preview' ? <ActivityIndicator color={colors.primary} /> : (
                      <>
                        <View style={styles.dropIcon}><Upload size={20} color={colors.primary} /></View>
                        <Text style={styles.dropTitle}>Choose Excel file</Text>
                        <Text style={styles.dropSub}>Need the layout? Export tab → Blank template</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              {summary && (
                <>
                  <View style={styles.statsRow}>
                    <Stat label={result ? 'Imported' : 'New'} value={result ? summary.total - summary.failed : summary.toCreate} tone={status.success} />
                    {!result && <Stat label="Updates" value={summary.toUpdate} tone={status.info} />}
                    <Stat label="Problems" value={summary.failed} tone={summary.failed ? status.danger : status.neutral} />
                    <Stat label="Rows" value={summary.total} tone={status.neutral} />
                  </View>
                  <View style={styles.listHead}>
                    <Text style={styles.listTitle} numberOfLines={1}>{result ? 'Import finished' : file?.name}</Text>
                    <View style={styles.switchInline}>
                      <Text style={styles.switchSmall}>Only problems</Text>
                      <Switch value={onlyProblems} onValueChange={setOnlyProblems} />
                    </View>
                  </View>
                  <ScrollView style={styles.list} contentContainerStyle={{ gap: 6 }}>
                    {shown.length === 0 && <Text style={styles.empty}>Nothing to show.</Text>}
                    {shown.map((r) => {
                      const tone = !r.ok ? status.danger : r.warnings.length ? status.warning : status.success;
                      const Icon = !r.ok ? XCircle : r.warnings.length ? AlertTriangle : CheckCircle;
                      const note = r.errors.concat(r.warnings).join(' · ')
                        || (result ? (r.action === 'UPDATE' ? 'Updated' : 'Created') : (r.action === 'UPDATE' ? 'Will update' : r.action === 'SKIP' ? 'Skipped' : 'Will create'));
                      return (
                        <View key={`${r.row}-${r.sNo}`} style={[styles.row, { borderColor: tone.border }]}>
                          <Icon size={14} color={tone.strong} />
                          <View style={styles.flex}>
                            <Text style={styles.rowTitle} numberOfLines={1}>Row {r.row}{r.taskKey ? ` · ${r.taskKey}` : ''} · {r.title || '—'}</Text>
                            <Text style={[styles.rowNote, { color: tone.strong }]} numberOfLines={3}>{note}</Text>
                          </View>
                        </View>
                      );
                    })}
                  </ScrollView>

                  {preview && (
                    <TouchableOpacity style={[styles.primary, !willWrite && { opacity: 0.5 }]} onPress={confirm} disabled={!willWrite || !!busy}>
                      {busy === 'import' ? <ActivityIndicator color="#FFFFFF" /> : (
                        <><Upload size={16} color="#FFFFFF" /><Text style={styles.primaryText}>Import {willWrite} {willWrite === 1 ? 'row' : 'rows'}</Text></>
                      )}
                    </TouchableOpacity>
                  )}
                  {result?.failedFile && (
                    <TouchableOpacity style={styles.secondary} onPress={() => taskTransferService.openFailed(result.failedFile!, projectName).catch((e) => fail(e, 'Could not open the file.'))}>
                      <Download size={16} color={colors.primary} /><Text style={styles.secondaryText}>Download rows to fix</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.link} onPress={pick} disabled={!!busy}>
                    <RefreshCw size={13} color={colors.textMuted} /><Text style={styles.linkText}>Choose another file</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: { bg: string; border: string; strong: string } }) {
  return (
    <View style={[styles.stat, { backgroundColor: tone.bg, borderColor: tone.border }]}>
      <Text style={[styles.statNum, { color: tone.strong }]}>{value}</Text>
      <Text style={styles.statLbl}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.45)' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, maxHeight: '90%' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  headIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16.5, fontWeight: '900', color: colors.text },
  sub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  close: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  segmented: { flexDirection: 'row', backgroundColor: colors.track, borderRadius: 14, padding: 4, marginBottom: 12 },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 11, alignItems: 'center' },
  segmentOn: { backgroundColor: '#FFFFFF' },
  segmentText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  segmentTextOn: { color: colors.text, fontWeight: '800' },
  block: { gap: 10 },
  flexBlock: { flexShrink: 1, gap: 10 },
  p: { fontSize: 13, color: colors.textSecondary, lineHeight: 19 },
  b: { fontWeight: '800', color: colors.text },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  switchLabel: { fontSize: 13.5, fontWeight: '700', color: colors.textBody },
  primary: { height: 48, borderRadius: 14, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14.5 },
  secondary: { height: 46, borderRadius: 14, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primaryBorder, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryText: { color: colors.primary, fontWeight: '800', fontSize: 14 },
  drop: { alignItems: 'center', gap: 6, paddingVertical: 26, borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.primaryBorder, backgroundColor: colors.primarySoft },
  dropIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  dropTitle: { fontSize: 14.5, fontWeight: '800', color: colors.primary },
  dropSub: { fontSize: 11.5, color: colors.textMuted },
  statsRow: { flexDirection: 'row', gap: 6 },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  statNum: { fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  statLbl: { fontSize: 10.5, fontWeight: '700', color: colors.textSecondary },
  listHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listTitle: { flex: 1, fontSize: 13, fontWeight: '800', color: colors.text },
  switchInline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  switchSmall: { fontSize: 11.5, fontWeight: '700', color: colors.textMuted },
  list: { maxHeight: 300 },
  empty: { fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingVertical: 16 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 10, borderRadius: 12, borderWidth: 1, backgroundColor: '#FFFFFF' },
  rowTitle: { fontSize: 12.5, fontWeight: '700', color: colors.textBody },
  rowNote: { fontSize: 11.5, fontWeight: '600', marginTop: 2 },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6 },
  linkText: { fontSize: 12.5, fontWeight: '700', color: colors.textMuted },
});
