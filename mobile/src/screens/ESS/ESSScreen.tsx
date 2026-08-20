import React, { useEffect, useState } from 'react';
import { 
  View, Text, StyleSheet, ScrollView, TouchableOpacity, 
  TextInput, ActivityIndicator, RefreshControl, Alert, StatusBar, Platform, Animated, Modal
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

import { SafeAreaView } from 'react-native-safe-area-context';
import { 
  Home, ChevronRight, Calendar, Clock, CheckCircle, XCircle, 
  FileText, Send, HeartPulse, Briefcase, Umbrella, Sparkles, Info, Trash2, AlertCircle,
  UploadCloud, Paperclip, X
} from 'lucide-react-native';
import { useLeaveStore } from '../../store/leaveStore';
import { leaveService } from '../../api/leaveService';
import { useNavigation } from '@react-navigation/native';
import { Calendar as RNCalendar } from 'react-native-calendars';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import FeedbackModal, { ModalType } from '../../components/FeedbackModal';
import TimesheetTab from './tabs/TimesheetTab';
import HolidaysTab from './tabs/HolidaysTab';
export default function ESSScreen({ route }: any) {
  const navigation = useNavigation<any>();
  const { balances, requests, isLoading, isSubmitting, fetchLeaveData, submitLeaveRequest, cancelLeaveRequest } = useLeaveStore();
  const [mainTab, setMainTab] = useState<'timesheets' | 'leaves' | 'holidays'>((route?.params?.initialTab as any) || 'timesheets');
  const [activeTab, setActiveTab] = useState<'requests' | 'apply'>('requests');

  useEffect(() => {
    if (route?.params?.initialTab) {
      setMainTab(route.params.initialTab);
    }
  }, [route?.params?.initialTab]);
  
  // Form State
  const [leaveTypeId, setLeaveTypeId] = useState<number | null>(null);
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

  useEffect(() => {
    fetchLeaveData();
  }, []);

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
        accent: '#EF4444', 
        bg: '#FEF2F2', 
        badgeBg: '#FEE2E2', 
        icon: HeartPulse,
        gradientStart: '#FFF5F5'
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
    switch(status) {
      case 'APPROVED': 
        return { bg: '#ECFDF5', text: '#047857', border: '#A7F3D0', icon: CheckCircle };
      case 'REJECTED': 
        return { bg: '#FEF2F2', text: '#B91C1C', border: '#FECACA', icon: XCircle };
      case 'CANCELLED': 
        return { bg: '#F1F5F9', text: '#64748B', border: '#CBD5E1', icon: XCircle };
      default: 
        return { bg: '#FFFBEB', text: '#B45309', border: '#FDE68A', icon: Clock };
    }
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
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" translucent={false} />
      {/* --- Premium Header & Breadcrumb Bar --- */}
      <View style={styles.headerContainer}>
        {/* Mobile Breadcrumb */}
        <View style={styles.breadcrumbBar}>
          <TouchableOpacity 
            style={styles.breadcrumbItem} 
            onPress={() => navigation.navigate('Home')}
            activeOpacity={0.7}
          >
            <Home size={13} color="#94A3B8" />
            <Text style={styles.breadcrumbText}>Home</Text>
          </TouchableOpacity>
          
          <ChevronRight size={12} color="#CBD5E1" style={styles.breadcrumbSeparator} />
          
          <View style={styles.breadcrumbItem}>
            <Text style={styles.breadcrumbText}>ESS</Text>
          </View>
          
          <ChevronRight size={12} color="#CBD5E1" style={styles.breadcrumbSeparator} />
          
          <View style={[styles.breadcrumbItem, styles.breadcrumbActiveChip]}>
            <Sparkles size={11} color="#E25E3E" />
            <Text style={styles.breadcrumbActiveText}>
              {mainTab === 'timesheets' ? 'Timesheets' : mainTab === 'holidays' ? 'Holidays' : 'Leave Portal'}
            </Text>
          </View>
        </View>

        {/* Title Area */}
        <View style={styles.headerTitleRow}>
          <View>
            <Text style={styles.headerTitle}>Attendance & Leave</Text>
            <Text style={styles.headerSubtitle}>Manage your time, view logs, and request leaves</Text>
          </View>
        </View>
      </View>

      <ScrollView 
        style={styles.content}
        contentContainerStyle={styles.scrollContentContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={fetchLeaveData} colors={['#E25E3E']} />}
      >
        {/* --- Main Navigation Tabs --- */}
        <View style={styles.mainTabsContainer}>
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
            style={[styles.mainTabButton, mainTab === 'holidays' && styles.mainTabActive]}
            onPress={() => setMainTab('holidays')}
          >
            <Text style={[styles.mainTabText, mainTab === 'holidays' && styles.mainTabTextActive]}>Holidays</Text>
          </TouchableOpacity>
        </View>

        {mainTab === 'timesheets' && (
          <TimesheetTab />
        )}

        {mainTab === 'holidays' && (
          <HolidaysTab />
        )}

        {mainTab === 'leaves' && (
          <View>
        {/* --- Leave Balances Section --- */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Leave Balances</Text>
          <Text style={styles.sectionBadge}>{balances.length} Available</Text>
        </View>

        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          contentContainerStyle={styles.balancesScroll}
        >
          {isLoading && balances.length === 0 ? (
            <>
              <PulseSkeleton style={[styles.balanceCard, { height: 130, width: 155, borderColor: 'transparent' }]} />
              <PulseSkeleton style={[styles.balanceCard, { height: 130, width: 155, marginLeft: 10, borderColor: 'transparent' }]} />
            </>
          ) : balances.length === 0 ? (
            <View style={styles.emptyBalanceCard}>
              <Info size={20} color="#94A3B8" />
              <Text style={styles.emptyText}>No balances</Text>
            </View>
          ) : (
            balances.map((balance) => {
              const remaining = balance.allocated - balance.used;
              const theme = getLeaveTypeTheme(balance.leaveType.name);
              const IconComp = theme.icon;
              const usedPercentage = Math.min(100, Math.max(0, (balance.used / balance.allocated) * 100));

              return (
                <View key={balance.id} style={[styles.balanceCard, { backgroundColor: theme.gradientStart }]}>
                  <View style={styles.balanceCardHeader}>
                    <View style={[styles.balanceIconBox, { backgroundColor: theme.bg }]}>
                      <IconComp size={15} color={theme.accent} />
                    </View>
                    <View style={[styles.leaveBadgePill, { backgroundColor: theme.badgeBg }]}>
                      <Text style={[styles.leaveBadgeText, { color: theme.accent }]}>{balance.allocated} Alloc</Text>
                    </View>
                  </View>

                  <Text style={styles.balanceTypeName} numberOfLines={1}>{balance.leaveType.name}</Text>
                  
                  <View style={styles.balanceCountRow}>
                    <Text style={styles.balanceRemaining}>{remaining}</Text>
                    <Text style={styles.balanceSubtext}>days left</Text>
                  </View>

                  {/* Custom Progress Bar */}
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${usedPercentage}%`, backgroundColor: theme.accent }]} />
                  </View>

                  <View style={styles.balanceFooter}>
                    <Text style={styles.balanceFooterText}><Text style={{ fontWeight: '700', color: '#334155' }}>{balance.used}</Text> used</Text>
                    <Text style={styles.balanceFooterText}><Text style={{ fontWeight: '700', color: '#334155' }}>{remaining}</Text> avail</Text>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>

        {/* --- Premium Floating Segmented Control --- */}
        <View style={styles.segmentedWrapper}>
          <View style={styles.segmentedControl}>
            <TouchableOpacity 
              style={[styles.segmentButton, activeTab === 'requests' && styles.segmentActive]} 
              onPress={() => setActiveTab('requests')}
              activeOpacity={0.85}
            >
              <FileText size={16} color={activeTab === 'requests' ? '#E25E3E' : '#64748B'} />
              <Text style={[styles.segmentText, activeTab === 'requests' && styles.segmentTextActive]}>My Requests</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.segmentButton, activeTab === 'apply' && styles.segmentActive]} 
              onPress={() => setActiveTab('apply')}
              activeOpacity={0.85}
            >
              <Calendar size={16} color={activeTab === 'apply' ? '#E25E3E' : '#64748B'} />
              <Text style={[styles.segmentText, activeTab === 'apply' && styles.segmentTextActive]}>Apply for Leave</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* --- Tab Content --- */}
        {activeTab === 'requests' ? (
          <View style={styles.requestsContainer}>
            {isLoading && requests.length === 0 ? (
              <>
                <PulseSkeleton style={[styles.requestCard, { height: 140, borderColor: 'transparent' }]} />
                <PulseSkeleton style={[styles.requestCard, { height: 140, borderColor: 'transparent' }]} />
                <PulseSkeleton style={[styles.requestCard, { height: 140, borderColor: 'transparent' }]} />
              </>
            ) : requests.length === 0 ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyIconCircle}>
                  <FileText size={32} color="#94A3B8" />
                </View>
                <Text style={styles.emptyStateTitle}>No Leave Requests</Text>
                <Text style={styles.emptyStateSub}>You haven't submitted any time off applications yet.</Text>
                <TouchableOpacity 
                  style={styles.emptyStateButton} 
                  onPress={() => setActiveTab('apply')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.emptyStateButtonText}>Apply Now</Text>
                </TouchableOpacity>
              </View>
            ) : (
              requests.map((req) => {
                const statusStyle = getStatusStyle(req.status);
                const StatusIcon = statusStyle.icon;
                const days = calculateDays(req.startDate, req.endDate);

                return (
                  <View key={req.id} style={styles.requestCard}>
                    {/* Top Status Header */}
                    <View style={styles.requestHeaderRow}>
                      <View style={styles.requestTypeGroup}>
                        <Text style={styles.requestTypeTitle}>{req.leaveType.name}</Text>
                        {days && (
                          <View style={styles.durationPill}>
                            <Text style={styles.durationText}>{days} {days === 1 ? 'Day' : 'Days'}</Text>
                          </View>
                        )}
                      </View>

                      <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg, borderColor: statusStyle.border }]}>
                        <StatusIcon size={13} color={statusStyle.text} />
                        <Text style={[styles.statusText, { color: statusStyle.text }]}>{req.status}</Text>
                      </View>
                    </View>

                    {/* Date Block */}
                    <View style={styles.requestDateBox}>
                      <Calendar size={15} color="#64748B" />
                      <Text style={styles.requestDateText}>
                        {new Date(req.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {'  →  '}
                        {new Date(req.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </Text>
                    </View>

                    {/* Reason Quote */}
                    <View style={styles.reasonQuoteBox}>
                      <Text style={styles.reasonText} numberOfLines={2}>"{req.reason}"</Text>
                    </View>

                    {/* Rejection Reason Alert Box */}
                    {req.status === 'REJECTED' && (req.rejectionReason || (req as any).rejection_reason) && (
                      <View style={styles.rejectionBox}>
                        <View style={styles.rejectionHeaderRow}>
                          <AlertCircle size={14} color="#B91C1C" />
                          <Text style={styles.rejectionTitle}>Rejection Reason:</Text>
                        </View>
                        <Text style={styles.rejectionText}>
                          {req.rejectionReason || (req as any).rejection_reason}
                        </Text>
                      </View>
                    )}

                    {/* Card Footer */}
                    <View style={styles.requestFooterRow}>
                      <View style={styles.requestAppliedGroup}>
                        <Clock size={12} color="#94A3B8" />
                        <Text style={styles.requestAppliedText}>
                          Applied on {new Date(req.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </Text>
                      </View>

                      {/* Cancel Button for PENDING leaves */}
                      {req.status === 'PENDING' && (
                        <TouchableOpacity 
                          style={styles.cancelActionBtn} 
                          onPress={() => handleCancel(req.id)}
                          activeOpacity={0.7}
                        >
                          <Trash2 size={12} color="#EF4444" />
                          <Text style={styles.cancelActionText}>Cancel</Text>
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
              <Text style={styles.formSectionTitle}>1. Select Leave Type</Text>
              <View style={styles.typeGrid}>
                {balances.map((b) => {
                  const isSelected = leaveTypeId === b.leaveTypeId;
                  const theme = getLeaveTypeTheme(b.leaveType.name);
                  const Icon = theme.icon;

                  return (
                    <TouchableOpacity 
                      key={b.id} 
                      style={[
                        styles.typeChip, 
                        isSelected && { borderColor: theme.accent, backgroundColor: theme.bg }
                      ]}
                      onPress={() => setLeaveTypeId(b.leaveTypeId)}
                      activeOpacity={0.75}
                    >
                      <View style={[styles.typeChipIconBox, { backgroundColor: isSelected ? '#FFFFFF' : '#F1F5F9' }]}>
                        <Icon size={16} color={isSelected ? theme.accent : '#64748B'} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.typeChipTitle, isSelected && { color: theme.accent, fontWeight: '700' }]}>
                          {b.leaveType.name}
                        </Text>
                        <Text style={styles.typeChipSub}>
                          {b.allocated - b.used} days available
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            {/* Step 2: Choose Dates */}
            <View style={styles.formSection}>
              <View style={styles.dateSectionHeader}>
                <Text style={styles.formSectionTitle}>2. Select Dates *</Text>
                {calculatedDays && (
                  <View style={styles.calculatedDaysBadge}>
                    <Sparkles size={12} color="#E25E3E" />
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
                    <Calendar size={16} color={isDateRangeInvalid ? "#EF4444" : "#94A3B8"} style={styles.inputIcon} />
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
                        <RNCalendar
                          current={startDate || undefined}
                          onDayPress={(day: any) => {
                            setStartDate(day.dateString);
                            setOpenStartPicker(false);
                          }}
                          theme={{
                            todayTextColor: '#E25E3E',
                            selectedDayBackgroundColor: '#E25E3E',
                            arrowColor: '#E25E3E',
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
                    <Calendar size={16} color={isDateRangeInvalid ? "#EF4444" : "#94A3B8"} style={styles.inputIcon} />
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
                        <RNCalendar
                          current={endDate || startDate || undefined}
                          minDate={startDate || undefined}
                          onDayPress={(day: any) => {
                            setEndDate(day.dateString);
                            setOpenEndPicker(false);
                          }}
                          theme={{
                            todayTextColor: '#E25E3E',
                            selectedDayBackgroundColor: '#E25E3E',
                            arrowColor: '#E25E3E',
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
                  <AlertCircle size={14} color="#B91C1C" />
                  <Text style={styles.dateErrorText}>End Date cannot be earlier than Start Date</Text>
                </View>
              )}
            </View>

            {/* Step 3: Provide Reason (Optional) */}
            <View style={styles.formSection}>
              <Text style={styles.formSectionTitle}>3. Reason (Optional)</Text>
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
              <Text style={styles.formSectionTitle}>4. Attachment (Optional)</Text>
              
              {!attachedFile ? (
                <TouchableOpacity 
                  style={styles.dropzoneContainer} 
                  onPress={handlePickAttachment}
                  activeOpacity={0.75}
                  disabled={isUploading}
                >
                  <View style={styles.dropzoneIconBox}>
                    {isUploading ? <ActivityIndicator color="#E25E3E" /> : <UploadCloud size={24} color="#E25E3E" />}
                  </View>
                  <Text style={styles.dropzoneTitle}>{isUploading ? 'Uploading...' : 'Tap to upload image'}</Text>
                  <Text style={styles.dropzoneSub}>Supports JPG, PNG (Max 5MB)</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.attachmentCard}>
                  <View style={styles.attachmentIconBox}>
                    <Paperclip size={18} color="#E25E3E" />
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
        )}
      </ScrollView>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  /* --- Header & Breadcrumbs --- */
  headerContainer: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 4 : 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  breadcrumbBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  breadcrumbItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  breadcrumbText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  breadcrumbSeparator: {
    marginHorizontal: 6,
  },
  breadcrumbActiveChip: {
    backgroundColor: '#FFF1EC',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  breadcrumbActiveText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#E25E3E',
  },
  headerTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 2,
  },

  /* --- Content & Scroll Container --- */
  content: {
    flex: 1,
  },
  scrollContentContainer: {
    paddingBottom: 120, // Generous padding so elements aren't cut off by floating bottom bar
  },

  /* --- Main Tabs --- */
  mainTabsContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  mainTabButton: {
    paddingVertical: 14,
    marginRight: 24,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  mainTabActive: {
    borderBottomColor: '#E25E3E',
  },
  mainTabText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748B',
  },
  mainTabTextActive: {
    color: '#E25E3E',
    fontWeight: '700',
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
    borderLeftColor: '#E25E3E',
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
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
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
    color: '#B91C1C',
  },
  rejectionText: {
    fontSize: 12,
    color: '#7F1D1D',
    lineHeight: 16,
    fontWeight: '500',
  },
  /* Cancel Action Button */
  cancelActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    gap: 4,
  },
  cancelActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#EF4444',
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
    backgroundColor: '#E25E3E',
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
  formContainer: {
    paddingHorizontal: 20,
    gap: 20,
  },
  formSection: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  formSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 12,
  },
  typeGrid: {
    gap: 10,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    gap: 12,
  },
  typeChipIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeChipTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  typeChipSub: {
    fontSize: 11,
    color: '#94A3B8',
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
    backgroundColor: '#FFF1EC',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 4,
    marginBottom: 12,
  },
  calculatedDaysText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#E25E3E',
  },
  dateRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dateField: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
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
    backgroundColor: '#E25E3E',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    gap: 10,
    shadowColor: '#E25E3E',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
    marginTop: 4,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  /* Date Validation Error */
  inputWrapperError: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  dateErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  dateErrorText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#B91C1C',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCalendarBox: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 10,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 5,
  },

  /* Dropzone Attachment */
  dropzoneContainer: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
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
    borderRadius: 22,
    backgroundColor: '#FFF1EC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  dropzoneTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
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
    backgroundColor: '#FFF1EC',
    borderWidth: 1,
    borderColor: '#FFD8CC',
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
