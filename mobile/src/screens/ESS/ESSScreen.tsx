import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { 
  View, Text, StyleSheet, ScrollView, TouchableOpacity, 
  TextInput, ActivityIndicator, RefreshControl, Alert, Animated, Modal
} from 'react-native';

const PulseSkeleton = ({ style }: { style: any }) => {
  const pulseAnim = React.useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.5, duration: 800, useNativeDriver: true })
      ])
    ).start();
  }, [pulseAnim]);
  return <Animated.View style={[style, { opacity: pulseAnim, backgroundColor: '#E2E8F0' }]} />;
};

import AppScreen from '../../components/AppScreen';
import GradientHero from '../../components/GradientHero';
import { ds, colors as dsColors, status as dsStatus, shadow as dsShadow } from '../../theme/ds';
import { TeamLeavePanel } from '../Team/TeamLeaveScreen';
import LeaveQuotaTab from './LeaveQuotaTab';
import { teamService, TeamLeaveRequest } from '../../api/teamService';
import { 
  Calendar, Clock, CheckCircle, XCircle, 
  FileText, Send, HeartPulse, Briefcase, Umbrella, Sparkles, Info, Trash2, AlertCircle,
  UploadCloud, Paperclip, X, ChevronDown,
} from 'lucide-react-native';
import { useLeaveStore } from '../../store/leaveStore';
import { leaveService } from '../../api/leaveService';
import { Calendar as RNCalendar } from 'react-native-calendars';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import FeedbackModal, { ModalType } from '../../components/FeedbackModal';
import TimesheetTab from './tabs/TimesheetTab';
import HolidaysTab from './tabs/HolidaysTab';
import ExpensesTab from './tabs/ExpensesTab';

export default function ESSScreen({ route }: any) {
  const { balances, requests, isLoading, isSubmitting, fetchLeaveData, submitLeaveRequest, cancelLeaveRequest } = useLeaveStore();
  const [mainTab, setMainTab] = useState<'timesheets' | 'leaves' | 'quota' | 'holidays' | 'expenses'>((route?.params?.initialTab as any) || 'timesheets');
  const [activeTab, setActiveTab] = useState<'requests' | 'apply' | 'team'>('requests');
  // Team leave sits here beside your own, for anyone with people under them.
  const [teamRows, setTeamRows] = useState<TeamLeaveRequest[] | null>(null);
  const [teamRefresh, setTeamRefresh] = useState(0);
  useEffect(() => {
    teamService.getTeamLeaveRequests().then(setTeamRows).catch(() => setTeamRows([]));
  }, [teamRefresh]);
  const hasTeam = (teamRows?.length ?? 0) > 0;
  const teamPending = teamRows?.filter((r) => r.status === 'PENDING').length ?? 0;

  useEffect(() => {
    if (route?.params?.initialTab) {
      setMainTab(route.params.initialTab);
    }
  }, [route?.params?.initialTab]);
  
  // Form State
  const [leaveTypeId, setLeaveTypeId] = useState<number | null>(null);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [attachedFile, setAttachedFile] = useState<{ name: string; size: string; url?: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [openStartPicker, setOpenStartPicker] = useState(false);
  const [openEndPicker, setOpenEndPicker] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [modalConfig, setModalConfig] = useState<{
    title: string;
    message: string;
    type: ModalType;
    onConfirm?: () => void;
    confirmText?: string;
    showCancel?: boolean;
  }>({ title: '', message: '', type: 'error' });

  const showModal = (title: string, message: string, type: ModalType = 'error', onConfirm?: () => void, confirmText?: string, showCancel = false) => {
    setModalConfig({
      title,
      message,
      type,
      onConfirm,
      confirmText: confirmText || (type === 'success' ? 'OK' : 'Try Again'),
      showCancel
    });
    setModalVisible(true);
  };

  // Reload whenever this screen comes back into view, so changes made on the
  // web or from a notification show up without pulling down.
  useFocusEffect(
    useCallback(() => {
      fetchLeaveData();
      setTeamRefresh((k) => k + 1);
    }, [fetchLeaveData]),
  );

  const validateAndCalculateDays = (startStr: string, endStr: string) => {
    if (!startStr.trim() || !endStr.trim()) return null;
    
    const parseDate = (str: string) => {
      const parts = str.trim().split(/[-/.]/);
      if (parts.length === 3) {
        if (parts[0].length === 4) { // YYYY-MM-DD
          return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        } else if (parts[2].length === 4) { // DD/MM/YYYY
          return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
        }
      }
      return new Date(str);
    };

    const s = parseDate(startStr);
    const e = parseDate(endStr);

    if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;

    if (e.getTime() < s.getTime()) {
      return 'INVALID_RANGE';
    }

    const diffTime = Math.abs(e.getTime() - s.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  };

  const dayResult = validateAndCalculateDays(startDate, endDate);
  const isDateRangeInvalid = dayResult === 'INVALID_RANGE';
  const calculatedDays = typeof dayResult === 'number' ? dayResult : null;

  const handlePickAttachment = () => {
    Alert.alert(
      'Attach Image',
      'Select an image for your leave request:',
      [
        {
          text: 'Take a Photo',
          onPress: async () => {
            const result = await launchCamera({ mediaType: 'photo', quality: 0.8 });
            if (!result.didCancel && result.assets && result.assets.length > 0) {
              uploadSelectedFile(result.assets[0]);
            }
          }
        },
        {
          text: 'Choose from Gallery',
          onPress: async () => {
            const result = await launchImageLibrary({ mediaType: 'photo', quality: 0.8 });
            if (!result.didCancel && result.assets && result.assets.length > 0) {
              uploadSelectedFile(result.assets[0]);
            }
          }
        },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  };

  const uploadSelectedFile = async (asset: any) => {
    if (!asset.uri || !asset.fileName) return;
    setIsUploading(true);
    try {
      const url = await leaveService.uploadAttachment(asset.uri, asset.fileName, asset.type || 'image/jpeg');
      const sizeStr = asset.fileSize ? (asset.fileSize / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown size';
      setAttachedFile({ name: asset.fileName, size: sizeStr, url });
    } catch (error) {
      showModal('Upload Failed', 'There was an error uploading the image.', 'error');
      console.error(error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!leaveTypeId) {
      showModal('Leave Type Required', 'Please select a leave type before submitting.', 'error');
      return;
    }
    if (!startDate.trim() || !endDate.trim()) {
      showModal('Dates Required', 'Please provide both Start Date and End Date.', 'error');
      return;
    }
    if (isDateRangeInvalid) {
      showModal('Invalid Date Range', 'End Date cannot be earlier than Start Date.', 'error');
      return;
    }

    const success = await submitLeaveRequest({
      leaveTypeId,
      startDate,
      endDate,
      reason: reason || 'Not specified',
      attachmentUrl: attachedFile ? attachedFile.url : undefined,
    });

    if (success) {
      showModal('Request Submitted', 'Your leave request has been sent for approval.', 'success');
      setActiveTab('requests');
      setStartDate('');
      setEndDate('');
      setReason('');
      setLeaveTypeId(null);
      setAttachedFile(null);
    } else {
      const errorMsg = useLeaveStore.getState().error;
      showModal('Request Failed', errorMsg || 'There was an error submitting your request.', 'error');
    }
  };

  const handleCancel = (requestId: number) => {
    showModal(
      'Cancel Leave Request',
      'Are you sure you want to cancel this pending leave request?',
      'error',
      async () => {
        setModalVisible(false);
        setTimeout(async () => {
          const success = await cancelLeaveRequest(requestId);
          if (success) {
            showModal('Request Cancelled', 'Your leave request has been successfully cancelled.', 'success');
          } else {
            const errorMsg = useLeaveStore.getState().error;
            showModal('Cancellation Failed', errorMsg || 'Could not cancel the request.', 'error');
          }
        }, 400);
      },
      'Cancel Request',
      true
    );
  };

  const getLeaveTypeTheme = (typeName: string) => {
    const lower = typeName.toLowerCase();
    if (lower.includes('sick') || lower.includes('sl')) {
      return { 
        accent: '#1373e5',
        bg: '#eff6ff',
        badgeBg: '#dbeafe',
        icon: HeartPulse,
        gradientStart: '#eff6ff'
      };
    } else if (lower.includes('earned') || lower.includes('el') || lower.includes('paid')) {
      return { 
        accent: '#6366F1', 
        bg: '#EEF2FF', 
        badgeBg: '#E0E7FF', 
        icon: Briefcase,
        gradientStart: '#F5F7FF'
      };
    } else {
      return { 
        accent: '#10B981', 
        bg: '#ECFDF5', 
        badgeBg: '#D1FAE5', 
        icon: Umbrella,
        gradientStart: '#F4FBF7'
      };
    }
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return { bg: dsStatus.success.bg, text: dsStatus.success.strong, border: dsStatus.success.border, icon: CheckCircle, label: 'Approved' };
      case 'REJECTED':
        return { bg: dsStatus.danger.bg, text: dsStatus.danger.strong, border: dsStatus.danger.border, icon: XCircle, label: 'Rejected' };
      case 'CANCELLED':
        return { bg: dsStatus.neutral.bg, text: dsStatus.neutral.fg, border: dsStatus.neutral.border, icon: XCircle, label: 'Cancelled' };
      default:
        return { bg: dsStatus.warning.bg, text: dsStatus.warning.fg, border: dsStatus.warning.border, icon: Clock, label: 'Pending' };
    }
  };

  /** Hero figures: days left across all leave types, and requests by status. */
  const leaveTotals = {
    allocated: balances.reduce((n, b) => n + (Number(b.allocated) || 0), 0),
    used: balances.reduce((n, b) => n + (Number(b.used) || 0), 0),
    left: balances.reduce((n, b) => n + ((Number(b.allocated) || 0) - (Number(b.used) || 0)), 0),
    pending: requests.filter((r) => r.status === 'PENDING').length,
    approved: requests.filter((r) => r.status === 'APPROVED').length,
    rejected: requests.filter((r) => r.status === 'REJECTED').length,
  };

  const calculateDays = (start: string, end: string) => {
    if (!start || !end) return null;
    const s = new Date(start);
    const e = new Date(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
    const diffTime = Math.abs(e.getTime() - s.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
  };

  return (
    <AppScreen
      showBottomNav={false}
      title="Attendance"
      subtitle="Timesheets, leaves & holidays"
    >
      {/* --- Main Navigation Tabs --- */}
      <View style={styles.mainTabsHeader}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          style={styles.mainTabsScroll}
          contentContainerStyle={styles.mainTabsContainer}
        >
          <TouchableOpacity 
            style={[styles.mainTabButton, mainTab === 'timesheets' && styles.mainTabActive]}
            onPress={() => setMainTab('timesheets')}
          >
            <Text style={[styles.mainTabText, mainTab === 'timesheets' && styles.mainTabTextActive]}>Timesheets</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.mainTabButton, mainTab === 'leaves' && styles.mainTabActive]}
            onPress={() => setMainTab('leaves')}
          >
            <Text style={[styles.mainTabText, mainTab === 'leaves' && styles.mainTabTextActive]}>My Leaves</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.mainTabButton, mainTab === 'quota' && styles.mainTabActive]}
            onPress={() => setMainTab('quota')}
          >
            <Text style={[styles.mainTabText, mainTab === 'quota' && styles.mainTabTextActive]}>Leave Quota</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.mainTabButton, mainTab === 'holidays' && styles.mainTabActive]}
            onPress={() => setMainTab('holidays')}
          >
            <Text style={[styles.mainTabText, mainTab === 'holidays' && styles.mainTabTextActive]}>Holidays</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.mainTabButton, mainTab === 'expenses' && styles.mainTabActive, { marginRight: 20 }]}
            onPress={() => setMainTab('expenses')}
          >
            <Text style={[styles.mainTabText, mainTab === 'expenses' && styles.mainTabTextActive]}>Expenses</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      <View style={styles.content}>
        {mainTab === 'timesheets' && (
          <TimesheetTab />
        )}

        {mainTab === 'holidays' && (
          <ScrollView
            style={styles.tabScrollView}
            contentContainerStyle={styles.scrollContentContainer}
            showsVerticalScrollIndicator={false}
          >
            <HolidaysTab />
          </ScrollView>
        )}

        {mainTab === 'expenses' && (
          <ExpensesTab />
        )}

        {mainTab === 'quota' && <LeaveQuotaTab />}

        {mainTab === 'leaves' && (
          <ScrollView
            style={styles.tabScrollView}
            contentContainerStyle={styles.scrollContentContainer}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => { fetchLeaveData(); setTeamRefresh((k) => k + 1); }} colors={['#1373e5']} />}
          >
            <View>
              {/* --- Hero: days left this year (Timesheet design system) --- */}
              <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
                <GradientHero
                  id="lvHeroGrad"
                  overline="LEAVE AVAILABLE"
                  value={leaveTotals.left}
                  unit={`/ ${leaveTotals.allocated} days`}
                  action={
                    <TouchableOpacity style={ds.heroButton} onPress={() => setActiveTab('apply')} activeOpacity={0.85}>
                      <Calendar size={14} color={dsColors.text} />
                      <Text style={ds.heroButtonText}>Apply</Text>
                    </TouchableOpacity>
                  }
                  stats={[
                    { label: 'Used', value: leaveTotals.used },
                    { label: 'Pending', value: leaveTotals.pending, color: '#FDE68A' },
                    { label: 'Approved', value: leaveTotals.approved, color: '#A7F3D0' },
                    { label: 'Rejected', value: leaveTotals.rejected, color: '#FECACA' },
                  ]}
                />

                {/* --- Balances card --- */}
                <View style={ds.section}>
                  <View style={ds.sectionHead}>
                    <Text style={ds.sectionTitle}>Leave balances</Text>
                    <Text style={ds.sectionHint}>{balances.length} {balances.length === 1 ? 'type' : 'types'}</Text>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.lvBalanceScroll}>
                    {isLoading && balances.length === 0 ? (
                      <>
                        <PulseSkeleton style={styles.lvBalanceTile} />
                        <PulseSkeleton style={styles.lvBalanceTile} />
                      </>
                    ) : balances.length === 0 ? (
                      <View style={styles.lvBalanceEmpty}>
                        <Info size={16} color={dsColors.textFaint} />
                        <Text style={ds.sectionHint}>No leave allotted yet</Text>
                      </View>
                    ) : (
                      balances.map((balance) => {
                        const remaining = balance.allocated - balance.used;
                        const theme = getLeaveTypeTheme(balance.leaveType.name);
                        const IconComp = theme.icon;
                        const usedPct = balance.allocated > 0 ? Math.min(100, Math.max(0, (balance.used / balance.allocated) * 100)) : 0;
                        return (
                          <View key={balance.id} style={styles.lvBalanceTile}>
                            <View style={styles.lvBalanceHead}>
                              <View style={[styles.lvBalanceIcon, { backgroundColor: theme.bg }]}>
                                <IconComp size={14} color={theme.accent} />
                              </View>
                              <Text style={styles.lvBalanceName} numberOfLines={1}>{balance.leaveType.name}</Text>
                            </View>
                            <View style={styles.lvHeroScoreRow}>
                              <Text style={styles.lvBalanceNum}>{remaining}</Text>
                              <Text style={styles.lvBalanceOf}>/ {balance.allocated} left</Text>
                            </View>
                            <View style={styles.lvTrack}>
                              <View style={[styles.lvFill, { width: `${usedPct}%`, backgroundColor: theme.accent }]} />
                            </View>
                            <Text style={styles.lvBalanceUsed}>{balance.used} used</Text>
                          </View>
                        );
                      })
                    )}
                  </ScrollView>
                </View>

                {/* --- Segmented control --- */}
                <View style={ds.segmented}>
                  {([
                    { key: 'requests', label: 'My Requests' },
                    { key: 'apply', label: 'Apply' },
                    ...(hasTeam ? [{ key: 'team', label: `Team${teamPending ? ` (${teamPending})` : ''}` }] : []),
                  ] as { key: typeof activeTab; label: string }[]).map((t) => (
                    <TouchableOpacity
                      key={t.key}
                      style={[ds.segment, activeTab === t.key && ds.segmentActive]}
                      onPress={() => setActiveTab(t.key)}
                      activeOpacity={0.85}
                    >
                      <Text style={[ds.segmentText, activeTab === t.key && ds.segmentTextActive]}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

        {/* --- Tab Content --- */}
        {activeTab === 'team' ? (
          <TeamLeavePanel refreshKey={teamRefresh} onLoaded={setTeamRows} />
        ) : activeTab === 'requests' ? (
          <View style={styles.lvList}>
            {isLoading && requests.length === 0 ? (
              <>
                <PulseSkeleton style={styles.lvSkeletonRow} />
                <PulseSkeleton style={styles.lvSkeletonRow} />
                <PulseSkeleton style={styles.lvSkeletonRow} />
              </>
            ) : requests.length === 0 ? (
              <View style={ds.empty}>
                <View style={ds.emptyIcon}>
                  <FileText size={22} color={dsColors.primary} />
                </View>
                <Text style={ds.emptyTitle}>No leave requests yet</Text>
                <Text style={ds.emptyText}>When you apply for leave, it shows here with its approval status.</Text>
                <TouchableOpacity style={ds.primaryButton} onPress={() => setActiveTab('apply')} activeOpacity={0.85}>
                  <Calendar size={14} color="#FFFFFF" />
                  <Text style={ds.primaryButtonText}>Apply for leave</Text>
                </TouchableOpacity>
              </View>
            ) : (
              requests.map((req) => {
                const st = getStatusStyle(req.status);
                const StatusIcon = st.icon;
                const days = calculateDays(req.startDate, req.endDate);
                const start = new Date(req.startDate);
                const end = new Date(req.endDate);
                const sameDay = start.toDateString() === end.toDateString();
                const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                const rejection = req.rejectionReason || (req as any).rejection_reason;

                return (
                  <View key={req.id} style={[ds.listCard, styles.lvRequestCard]}>
                    <View style={styles.lvRequestTop}>
                      <View style={ds.dateBox}>
                        <Text style={ds.dateBoxNum}>{start.getDate()}</Text>
                        <Text style={ds.dateBoxDay}>{start.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase()}</Text>
                      </View>
                      <View style={styles.lvRequestCenter}>
                        <View style={styles.lvRequestTitleRow}>
                          <Text style={styles.lvRequestTitle} numberOfLines={1}>{req.leaveType.name}</Text>
                          <View style={[ds.pill, { backgroundColor: st.bg, borderColor: st.border }]}>
                            <StatusIcon size={11} color={st.text} />
                            <Text style={[ds.pillText, { color: st.text }]}>{st.label}</Text>
                          </View>
                        </View>
                        <View style={styles.lvRequestMetaRow}>
                          <Text style={styles.lvRequestDates}>{sameDay ? fmt(start) : `${fmt(start)} – ${fmt(end)}`}</Text>
                          {!!days && <Text style={styles.lvDaysPill}>{days} {days === 1 ? 'day' : 'days'}</Text>}
                        </View>
                      </View>
                    </View>

                    {!!req.reason && <Text style={styles.lvReason} numberOfLines={2}>“{req.reason}”</Text>}

                    {req.status === 'REJECTED' && !!rejection && (
                      <View style={styles.lvRejection}>
                        <AlertCircle size={13} color={dsStatus.danger.strong} />
                        <Text style={styles.lvRejectionText}>{rejection}</Text>
                      </View>
                    )}

                    <View style={styles.lvRequestFooter}>
                      <View style={ds.chip}>
                        <Clock size={11} color={dsColors.textMuted} />
                        <Text style={ds.chipText}>
                          Applied {new Date(req.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </Text>
                      </View>
                      {req.status === 'PENDING' && (
                        <TouchableOpacity style={ds.softButton} onPress={() => handleCancel(req.id)} activeOpacity={0.7}>
                          <Trash2 size={12} color={dsColors.primary} />
                          <Text style={ds.softButtonText}>Cancel</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        ) : (
          <View style={styles.formContainer}>
            {/* Step 1: Select Leave Type */}
            <View style={styles.formSection}>
              <View style={styles.stepHead}><View style={styles.stepBadge}><Text style={styles.stepBadgeText}>1</Text></View><Text style={styles.formSectionTitle}>Select Leave Type</Text></View>
              {(() => {
                const sel = balances.find((b) => b.leaveTypeId === leaveTypeId);
                const theme = sel ? getLeaveTypeTheme(sel.leaveType.name) : null;
                const Icon = theme?.icon;
                return (
                  <TouchableOpacity
                    style={[styles.typeChip, sel && theme && { borderColor: theme.accent, backgroundColor: theme.bg }]}
                    onPress={() => setTypePickerOpen(true)}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.typeChipIconBox, { backgroundColor: sel ? '#FFFFFF' : '#F1F5F9' }]}>
                      {Icon ? <Icon size={16} color={theme!.accent} /> : <FileText size={16} color="#64748B" />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.typeChipTitle, sel && theme && { color: theme.accent }]}>
                        {sel ? sel.leaveType.name : 'Choose a leave type'}
                      </Text>
                      <Text style={styles.typeChipSub}>
                        {sel ? `${sel.allocated - sel.used} days available` : `${balances.length} types available`}
                      </Text>
                    </View>
                    <ChevronDown size={18} color="#94A3B8" />
                  </TouchableOpacity>
                );
              })()}

              <Modal visible={typePickerOpen} transparent animationType="slide" onRequestClose={() => setTypePickerOpen(false)}>
                <TouchableOpacity style={styles.typeSheetBackdrop} activeOpacity={1} onPress={() => setTypePickerOpen(false)} />
                <View style={styles.typeSheet}>
                  <View style={styles.typeSheetGrabber} />
                  <View style={styles.calendarModalHead}>
                    <Text style={styles.calendarModalTitle}>Select leave type</Text>
                    <TouchableOpacity onPress={() => setTypePickerOpen(false)} style={styles.calendarModalClose}>
                      <X size={16} color="#64748B" />
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={styles.typeSheetList} contentContainerStyle={styles.typeGrid}>
                    {balances.map((b) => {
                      const isSelected = leaveTypeId === b.leaveTypeId;
                      const theme = getLeaveTypeTheme(b.leaveType.name);
                      const Icon = theme.icon;
                      const left = b.allocated - b.used;
                      return (
                        <TouchableOpacity
                          key={b.id}
                          style={[styles.typeChip, isSelected && { borderColor: theme.accent, backgroundColor: theme.bg }]}
                          onPress={() => { setLeaveTypeId(b.leaveTypeId); setTypePickerOpen(false); }}
                          activeOpacity={0.75}
                        >
                          <View style={[styles.typeChipIconBox, { backgroundColor: isSelected ? '#FFFFFF' : theme.bg }]}>
                            <Icon size={16} color={theme.accent} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.typeChipTitle, isSelected && { color: theme.accent }]}>{b.leaveType.name}</Text>
                            <Text style={styles.typeChipSub}>{left} of {b.allocated} days available</Text>
                          </View>
                          {isSelected && <CheckCircle size={18} color={theme.accent} />}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              </Modal>
            </View>
            {/* Step 2: Choose Dates */}
            <View style={styles.formSection}>
              <View style={styles.dateSectionHeader}>
                <View style={[styles.stepHead, { flex: 1 }]}><View style={styles.stepBadge}><Text style={styles.stepBadgeText}>2</Text></View><Text style={styles.formSectionTitle}>Select Dates *</Text></View>
                {calculatedDays && (
                  <View style={styles.calculatedDaysBadge}>
                    <Sparkles size={12} color="#1373e5" />
                    <Text style={styles.calculatedDaysText}>{calculatedDays} {calculatedDays === 1 ? 'Day' : 'Days'} Selected</Text>
                  </View>
                )}
              </View>

              <View style={styles.dateRow}>
                <View style={styles.dateField}>
                  <Text style={styles.inputLabel}>Start Date *</Text>
                  <TouchableOpacity 
                    style={[styles.inputWrapper, isDateRangeInvalid && styles.inputWrapperError]}
                    onPress={() => setOpenStartPicker(true)}
                    activeOpacity={0.7}
                  >
                    <Calendar size={16} color={isDateRangeInvalid ? dsStatus.danger.strong : "#94A3B8"} style={styles.inputIcon} />
                    <Text style={[styles.textInput, !startDate && { color: '#94A3B8' }]}>
                      {startDate || "YYYY-MM-DD"}
                    </Text>
                  </TouchableOpacity>
                  <Modal
                    visible={openStartPicker}
                    transparent={true}
                    animationType="fade"
                    onRequestClose={() => setOpenStartPicker(false)}
                  >
                    <TouchableOpacity 
                      style={styles.modalOverlay} 
                      activeOpacity={1} 
                      onPressOut={() => setOpenStartPicker(false)}
                    >
                      <View style={styles.modalCalendarBox}>
                        <View style={styles.calendarModalHead}>
                          <Text style={styles.calendarModalTitle}>Select Start Date</Text>
                          <TouchableOpacity onPress={() => setOpenStartPicker(false)} style={styles.calendarModalClose}>
                            <X size={16} color="#64748B" />
                          </TouchableOpacity>
                        </View>
                        <RNCalendar
                          current={startDate || undefined}
                          onDayPress={(day: any) => {
                            setStartDate(day.dateString);
                            setOpenStartPicker(false);
                          }}
                          theme={{
                            todayTextColor: '#1373e5',
                            selectedDayBackgroundColor: '#1373e5',
                            arrowColor: '#1373e5',
                            textDayFontWeight: '600',
                            textMonthFontWeight: '800',
                          }}
                        />
                      </View>
                    </TouchableOpacity>
                  </Modal>
                </View>

                <View style={styles.dateField}>
                  <Text style={styles.inputLabel}>End Date *</Text>
                  <TouchableOpacity 
                    style={[styles.inputWrapper, isDateRangeInvalid && styles.inputWrapperError]}
                    onPress={() => setOpenEndPicker(true)}
                    activeOpacity={0.7}
                  >
                    <Calendar size={16} color={isDateRangeInvalid ? dsStatus.danger.strong : "#94A3B8"} style={styles.inputIcon} />
                    <Text style={[styles.textInput, !endDate && { color: '#94A3B8' }]}>
                      {endDate || "YYYY-MM-DD"}
                    </Text>
                  </TouchableOpacity>
                  <Modal
                    visible={openEndPicker}
                    transparent={true}
                    animationType="fade"
                    onRequestClose={() => setOpenEndPicker(false)}
                  >
                    <TouchableOpacity 
                      style={styles.modalOverlay} 
                      activeOpacity={1} 
                      onPressOut={() => setOpenEndPicker(false)}
                    >
                      <View style={styles.modalCalendarBox}>
                        <View style={styles.calendarModalHead}>
                          <Text style={styles.calendarModalTitle}>Select End Date</Text>
                          <TouchableOpacity onPress={() => setOpenEndPicker(false)} style={styles.calendarModalClose}>
                            <X size={16} color="#64748B" />
                          </TouchableOpacity>
                        </View>
                        <RNCalendar
                          current={endDate || startDate || undefined}
                          minDate={startDate || undefined}
                          onDayPress={(day: any) => {
                            setEndDate(day.dateString);
                            setOpenEndPicker(false);
                          }}
                          theme={{
                            todayTextColor: '#1373e5',
                            selectedDayBackgroundColor: '#1373e5',
                            arrowColor: '#1373e5',
                            textDayFontWeight: '600',
                            textMonthFontWeight: '800',
                          }}
                        />
                      </View>
                    </TouchableOpacity>
                  </Modal>
                </View>
              </View>

              {/* Inline Date Validation Error */}
              {isDateRangeInvalid && (
                <View style={styles.dateErrorBanner}>
                  <AlertCircle size={14} color={dsStatus.danger.strong} />
                  <Text style={styles.dateErrorText}>End Date cannot be earlier than Start Date</Text>
                </View>
              )}
            </View>

            {/* Step 3: Provide Reason (Optional) */}
            <View style={styles.formSection}>
              <View style={styles.stepHead}><View style={styles.stepBadge}><Text style={styles.stepBadgeText}>3</Text></View><Text style={styles.formSectionTitle}>Reason</Text><Text style={styles.stepOptional}>Optional</Text></View>
              <View style={[styles.inputWrapper, styles.textAreaWrapper]}>
                <TextInput 
                  style={[styles.textInput, styles.textAreaInput]} 
                  placeholder="Additional details..."
                  placeholderTextColor="#94A3B8"
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  value={reason}
                  onChangeText={setReason}
                />
              </View>
            </View>

            {/* Step 4: Attachment Upload (Optional) */}
            <View style={styles.formSection}>
              <View style={styles.stepHead}><View style={styles.stepBadge}><Text style={styles.stepBadgeText}>4</Text></View><Text style={styles.formSectionTitle}>Attachment</Text><Text style={styles.stepOptional}>Optional</Text></View>
              
              {!attachedFile ? (
                <TouchableOpacity 
                  style={styles.dropzoneContainer} 
                  onPress={handlePickAttachment}
                  activeOpacity={0.75}
                  disabled={isUploading}
                >
                  <View style={styles.dropzoneIconBox}>
                    {isUploading ? <ActivityIndicator color="#1373e5" /> : <UploadCloud size={24} color="#1373e5" />}
                  </View>
                  <Text style={styles.dropzoneTitle}>{isUploading ? 'Uploading...' : 'Tap to upload image'}</Text>
                  <Text style={styles.dropzoneSub}>Supports JPG, PNG (Max 5MB)</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.attachmentCard}>
                  <View style={styles.attachmentIconBox}>
                    <Paperclip size={18} color="#1373e5" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.attachmentName} numberOfLines={1}>{attachedFile.name}</Text>
                    <Text style={styles.attachmentSize}>{attachedFile.size}</Text>
                  </View>
                  <TouchableOpacity 
                    onPress={() => setAttachedFile(null)} 
                    style={styles.removeAttachmentBtn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <X size={16} color="#64748B" />
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Live summary: what this request will cost (design system card) */}
            {(() => {
              const sel = balances.find((b) => b.leaveTypeId === leaveTypeId);
              if (!sel) return null;
              const left = sel.allocated - sel.used;
              const after = calculatedDays != null ? left - calculatedDays : null;
              const short = after != null && after < 0;
              const theme = getLeaveTypeTheme(sel.leaveType.name);
              const Icon = theme.icon;
              return (
                <View style={[styles.formSection, styles.applySummary, short && styles.applySummaryShort]}>
                  <View style={styles.applySummaryHead}>
                    <View style={[styles.typeChipIconBox, { backgroundColor: theme.bg }]}>
                      <Icon size={16} color={theme.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.applySummaryOver}>YOU ARE APPLYING FOR</Text>
                      <Text style={styles.applySummaryTitle} numberOfLines={1}>
                        {sel.leaveType.name}{calculatedDays != null ? ` · ${calculatedDays} ${calculatedDays === 1 ? 'day' : 'days'}` : ''}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.applySummaryStrip}>
                    <View style={styles.applySummaryCol}>
                      <Text style={styles.applySummaryNum}>{left}</Text>
                      <Text style={styles.applySummaryLbl}>Available</Text>
                    </View>
                    <View style={styles.applySummaryDivider} />
                    <View style={styles.applySummaryCol}>
                      <Text style={styles.applySummaryNum}>{calculatedDays ?? '–'}</Text>
                      <Text style={styles.applySummaryLbl}>This request</Text>
                    </View>
                    <View style={styles.applySummaryDivider} />
                    <View style={styles.applySummaryCol}>
                      <Text style={[styles.applySummaryNum, short && { color: dsStatus.danger.strong }, !short && after != null && { color: dsStatus.success.strong }]}>
                        {after ?? '–'}
                      </Text>
                      <Text style={styles.applySummaryLbl}>Left after</Text>
                    </View>
                  </View>
                  {short && (
                    <View style={styles.dateErrorBanner}>
                      <AlertCircle size={14} color={dsStatus.danger.strong} />
                      <Text style={styles.dateErrorText}>That is {-after!} {-after! === 1 ? 'day' : 'days'} more than you have left of {sel.leaveType.name}.</Text>
                    </View>
                  )}
                </View>
              );
            })()}

            {/* Submit Action Button */}
            <TouchableOpacity 
              style={[styles.submitBtn, isSubmitting && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={isSubmitting}
              activeOpacity={0.85}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Send size={18} color="#FFFFFF" />
                  <Text style={styles.submitBtnText}>Submit Leave Application</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
            </View>
          </ScrollView>
        )}
      </View>
      {/* Custom Error/Success Modal */}
      <FeedbackModal
        visible={modalVisible}
        title={modalConfig.title}
        message={modalConfig.message}
        type={modalConfig.type}
        onClose={() => setModalVisible(false)}
        onConfirm={modalConfig.onConfirm}
        confirmText={modalConfig.confirmText}
        showCancel={modalConfig.showCancel}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },

  /* --- Content & Scroll Container --- */
  content: {
    flex: 1,
  },
  tabScrollView: {
    flex: 1,
  },
  /* --- My Leaves (Timesheet design system, see theme/ds.ts) --- */
  lvHeroScoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  lvBalanceScroll: { paddingHorizontal: 16, gap: 10 },
  lvBalanceTile: {
    width: 150, padding: 12, borderRadius: 16, backgroundColor: dsColors.bg,
    borderWidth: 1, borderColor: dsColors.borderSoft, gap: 6, minHeight: 112,
  },
  lvBalanceEmpty: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  lvBalanceHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lvBalanceIcon: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  lvBalanceName: { flex: 1, fontSize: 12.5, fontWeight: '800', color: dsColors.textBody },
  lvBalanceNum: { fontSize: 22, fontWeight: '900', color: dsColors.text, fontVariant: ['tabular-nums'] },
  lvBalanceOf: { fontSize: 11.5, fontWeight: '700', color: dsColors.textFaint },
  lvTrack: { height: 5, borderRadius: 999, backgroundColor: dsColors.track, overflow: 'hidden' },
  lvFill: { height: '100%', borderRadius: 999 },
  lvBalanceUsed: { fontSize: 11, fontWeight: '600', color: dsColors.textMuted },
  lvList: { paddingHorizontal: 16, gap: 10 },
  lvSkeletonRow: { height: 104, borderRadius: 18 },
  lvRequestCard: { flexDirection: 'column', alignItems: 'stretch', gap: 10 },
  lvRequestTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lvRequestCenter: { flex: 1, gap: 5 },
  lvRequestTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  lvRequestTitle: { flex: 1, fontSize: 14.5, fontWeight: '800', color: dsColors.text },
  lvRequestMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lvRequestDates: { fontSize: 12.5, fontWeight: '700', color: dsColors.textBody },
  lvDaysPill: {
    fontSize: 11.5, fontWeight: '800', color: dsColors.text, backgroundColor: dsColors.borderSoft,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, overflow: 'hidden',
  },
  lvReason: { fontSize: 13, color: dsColors.textSecondary, fontStyle: 'italic', lineHeight: 18 },
  lvRejection: {
    flexDirection: 'row', gap: 6, alignItems: 'flex-start', backgroundColor: dsStatus.danger.bg,
    borderWidth: 1, borderColor: dsStatus.danger.border, borderRadius: 10, padding: 10,
  },
  lvRejectionText: { flex: 1, fontSize: 12.5, color: dsStatus.danger.strong, fontWeight: '600', lineHeight: 17 },
  lvRequestFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  scrollContentContainer: {
    paddingBottom: 120, // Generous padding so elements aren't cut off by floating bottom bar
  },

  /* --- Main Tabs --- */
  mainTabsHeader: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingVertical: 10,
  },
  mainTabsScroll: {
    backgroundColor: '#FFFFFF',
  },
  mainTabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
  },
  mainTabButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  mainTabActive: {
    backgroundColor: '#1373e5',
    borderColor: '#1373e5',
  },
  mainTabText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#475569',
  },
  mainTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },

  /* --- Balances Section --- */
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 20,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  sectionBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  balancesScroll: {
    paddingHorizontal: 20,
    gap: 12,
    paddingBottom: 4,
  },
  balanceCard: {
    width: 155,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  emptyBalanceCard: {
    width: 155,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  emptyText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
  },
  balanceCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  balanceIconBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveBadgePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  leaveBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  balanceTypeName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 2,
  },
  balanceCountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginBottom: 8,
  },
  balanceRemaining: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
  },
  balanceSubtext: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
  },
  progressTrack: {
    height: 4,
    backgroundColor: '#E2E8F0',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  balanceFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(226, 232, 240, 0.7)',
  },
  balanceFooterText: {
    fontSize: 10,
    color: '#64748B',
  },

  /* --- Segmented Control --- */
  segmentedWrapper: {
    paddingHorizontal: 20,
    marginTop: 24,
    marginBottom: 16,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 16,
    padding: 4,
  },
  segmentButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: 12,
    gap: 8,
  },
  segmentActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  segmentTextActive: {
    color: '#0F172A',
    fontWeight: '700',
  },

  /* --- Requests Tab --- */
  requestsContainer: {
    paddingHorizontal: 20,
    gap: 14,
  },
  requestCard: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  requestHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  requestTypeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  requestTypeTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  durationPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  durationText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    gap: 5,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  requestDateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 8,
    marginBottom: 10,
  },
  requestDateText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  reasonQuoteBox: {
    borderLeftWidth: 3,
    borderLeftColor: '#1373e5',
    paddingLeft: 10,
    marginVertical: 4,
  },
  reasonText: {
    fontSize: 13,
    color: '#475569',
    fontStyle: 'italic',
    lineHeight: 18,
  },
  requestFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  requestAppliedGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  requestAppliedText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#94A3B8',
  },
  /* Rejection Reason Box */
  rejectionBox: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 12,
    padding: 10,
    marginTop: 8,
  },
  rejectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  rejectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f4f9c',
  },
  rejectionText: {
    fontSize: 12,
    color: '#4e4e4e',
    lineHeight: 16,
    fontWeight: '500',
  },
  /* Cancel Action Button */
  cancelActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbeafe',
    gap: 4,
  },
  cancelActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1373e5',
  },

  /* Empty State */
  emptyState: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  emptyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  emptyStateSub: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 18,
  },
  emptyStateButton: {
    backgroundColor: '#1373e5',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
  },
  emptyStateButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },

  /* --- Apply Form Tab --- */
  typeSheetBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)' },
  typeSheet: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 16, paddingBottom: 28, paddingTop: 8, maxHeight: '70%',
  },
  typeSheetGrabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: dsColors.border, marginBottom: 10 },
  typeSheetList: { marginTop: 6 },
  applySummary: { borderColor: dsColors.primaryBorder, backgroundColor: '#FBFDFF' },
  applySummaryShort: { borderColor: dsStatus.danger.border },
  applySummaryHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  applySummaryOver: { fontSize: 10, fontWeight: '800', letterSpacing: 0.7, color: dsColors.textFaint },
  applySummaryTitle: { fontSize: 15, fontWeight: '800', color: dsColors.text, marginTop: 1 },
  applySummaryStrip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: dsColors.bg, borderWidth: 1,
    borderColor: dsColors.borderSoft, borderRadius: 14, paddingVertical: 10,
  },
  applySummaryCol: { flex: 1, alignItems: 'center' },
  applySummaryDivider: { width: 1, height: 24, backgroundColor: dsColors.border },
  applySummaryNum: { fontSize: 18, fontWeight: '900', color: dsColors.text, fontVariant: ['tabular-nums'] },
  applySummaryLbl: { fontSize: 10.5, fontWeight: '700', color: dsColors.textMuted, marginTop: 1 },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  stepBadge: {
    width: 22, height: 22, borderRadius: 7, backgroundColor: dsColors.primarySoft,
    borderWidth: 1, borderColor: dsColors.primaryBorder, alignItems: 'center', justifyContent: 'center',
  },
  stepBadgeText: { fontSize: 11.5, fontWeight: '900', color: dsColors.primary },
  stepOptional: { fontSize: 11, fontWeight: '700', color: dsColors.textFaint },
  formContainer: {
    paddingHorizontal: 16,
    gap: 14,
  },
  formSection: {
    backgroundColor: dsColors.card,
    padding: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: dsColors.border,
    ...dsShadow.card,
  },
  formSectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: dsColors.text,
    flex: 1,
  },
  typeGrid: {
    gap: 10,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: dsColors.border,
    backgroundColor: dsColors.bg,
    gap: 12,
  },
  typeChipIconBox: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeChipTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: dsColors.textBody,
  },
  typeChipSub: {
    fontSize: 11.5,
    fontWeight: '600',
    color: dsColors.textFaint,
    marginTop: 1,
  },
  dateSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  calculatedDaysBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: dsColors.primarySoft,
    borderWidth: 1,
    borderColor: dsColors.primaryBorder,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    gap: 4,
    marginBottom: 12,
  },
  calculatedDaysText: {
    fontSize: 11,
    fontWeight: '800',
    color: dsColors.primary,
  },
  dateRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dateField: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: dsColors.textMuted,
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: dsColors.bg,
    borderWidth: 1,
    borderColor: dsColors.border,
    borderRadius: 14,
    paddingHorizontal: 12,
  },
  inputIcon: {
    marginRight: 8,
  },
  textInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '500',
  },
  textAreaWrapper: {
    alignItems: 'flex-start',
    paddingHorizontal: 14,
  },
  textAreaInput: {
    height: 90,
    paddingTop: 12,
    lineHeight: 20,
  },
  submitBtn: {
    backgroundColor: dsColors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 14,
    gap: 8,
    shadowColor: dsColors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 5,
    marginTop: 2,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  /* Date Validation Error */
  inputWrapperError: {
    borderColor: dsStatus.danger.border,
    backgroundColor: dsStatus.danger.bg,
  },
  dateErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: dsStatus.danger.bg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: dsStatus.danger.border,
  },
  dateErrorText: {
    fontSize: 12,
    fontWeight: '700',
    color: dsStatus.danger.strong,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCalendarBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 14,
    width: '100%',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 8,
  },
  calendarModalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    marginBottom: 6,
  },
  calendarModalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  calendarModalClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Dropzone Attachment */
  dropzoneContainer: {
    backgroundColor: dsColors.primarySoft,
    borderWidth: 1.5,
    borderColor: dsColors.primaryBorder,
    borderStyle: 'dashed',
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropzoneIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  dropzoneTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: dsColors.textBody,
  },
  dropzoneSub: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },

  /* Attachment Selected Card */
  attachmentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: dsColors.primarySoft,
    borderWidth: 1,
    borderColor: dsColors.primaryBorder,
    borderRadius: 14,
    padding: 12,
    gap: 12,
  },
  attachmentIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  attachmentSize: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  removeAttachmentBtn: {
    padding: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 10,
  },
  modalCloseBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    padding: 4,
  },
  modalIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalMessage: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  modalActionsRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  modalCancelButton: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
  },
  modalCancelButtonText: {
    color: '#64748B',
    fontSize: 15,
    fontWeight: '700',
  },
  modalButton: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  modalButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
