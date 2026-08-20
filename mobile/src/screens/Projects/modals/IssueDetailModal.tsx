import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Modal, 
  TouchableOpacity, 
  ScrollView, 
  TextInput, 
  KeyboardAvoidingView, 
  Platform,
  ActivityIndicator,
  StatusBar,
  Animated
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { 
  X, 
  Clock, 
  AlertCircle, 
  AlignLeft, 
  MessageSquare, 
  Play, 
  Square, 
  ChevronDown, 
  Tag, 
  Users, 
  Paperclip, 
  Calendar,
  Send,
  Edit3,
  Check,
  Activity,
  ArrowDown,
  Minus,
  ArrowUp,
  Flame,
  Search,
  ArrowLeft,
  Plus,
  Pencil,
  Trash2
} from 'lucide-react-native';
import { projectService } from '../../../api/projectService';
import { useProjectStore } from '../../../store/projectStore';
import { useAuthStore } from '../../../store/authStore';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { launchImageLibrary } from 'react-native-image-picker';

interface IssueDetailModalProps {
  visible: boolean;
  issue: any;
  onClose: () => void;
  projectId: number;
}

// Utility to clean raw HTML tags from rich text descriptions
const stripHtml = (html?: string): string => {
  if (!html) return '';
  return html
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<p>/gi, '')
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .trim();
};

const formatTimeAgo = (dateStr: string) => {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return dateStr;
  }
};

const formatActivityText = (item: any) => {
  const action = item.action || item.type || '';
  switch (action) {
    case 'CREATED':
      return 'created this card';
    case 'STATUS_CHANGED':
      return item.detail ? `moved to ${item.detail}` : 'changed card status';
    case 'COMMENT_ADDED':
      return 'commented';
    case 'TIME_LOGGED':
      return 'logged work';
    case 'ASSIGNED':
      return 'assigned a member';
    default:
      return action.toLowerCase().replace(/_/g, ' ') || 'updated this card';
  }
};

export default function IssueDetailModal({ visible, issue, onClose, projectId }: IssueDetailModalProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { currentProject, currentBoard, updateIssueStatus } = useProjectStore();
  
  const [loading, setLoading] = useState(true);
  const [feed, setFeed] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  
  // Description states
  const [description, setDescription] = useState('');
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [savingDesc, setSavingDesc] = useState(false);
  
  // Phase 3 States
  const [checklists, setChecklists] = useState<any[]>([]);
  const [companyMembers, setCompanyMembers] = useState<any[]>([]);
  const [projectLabels, setProjectLabels] = useState<any[]>([]);
  
  // Pickers & Modals
  const [timerActive, setTimerActive] = useState(false);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [priorityPickerOpen, setPriorityPickerOpen] = useState(false);
  const [membersPickerOpen, setMembersPickerOpen] = useState(false);
  const [labelsPickerOpen, setLabelsPickerOpen] = useState(false);
  const [isDatePickerVisible, setDatePickerVisible] = useState(false);
  const [dateType, setDateType] = useState<'START' | 'DUE'>('START');
  const [attachments, setAttachments] = useState<any[]>([]);

  // Labels Picker States
  const [labelSearchQuery, setLabelSearchQuery] = useState('');
  const [loadingLabels, setLoadingLabels] = useState(false);
  const [isCreatingLabel, setIsCreatingLabel] = useState(false);
  const [editingLabel, setEditingLabel] = useState<any | null>(null);
  const [isSavingLabel, setIsSavingLabel] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#EF4444');
  const PRESET_COLORS = ['#EF4444', '#DC2626', '#F97316', '#EAB308', '#22C55E', '#10B981', '#3B82F6', '#6366F1', '#A855F7', '#EC4899', '#64748B'];

  const SkeletonPulse = ({ width, height, borderRadius = 8, style }: any) => {
    const opacity = useRef(new Animated.Value(0.35)).current;

    useEffect(() => {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 0.8,
            duration: 750,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.35,
            duration: 750,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }, [opacity]);

    return (
      <Animated.View
        style={[
          {
            width,
            height,
            borderRadius,
            backgroundColor: '#CBD5E1',
            opacity,
          },
          style,
        ]}
      />
    );
  };

  useEffect(() => {
    if (visible && issue) {
      setDescription(stripHtml(issue.description || ''));
      setIsEditingDesc(false);
      loadDetails();
    }
  }, [visible, issue]);

  const loadDetails = async () => {
    if (!issue) return;
    const activeProjectId = projectId || issue.projectId;
    if (!activeProjectId) return;
    setLoading(true);
    try {
      const [comments, activities, checklistsRes, labelsRes, membersRes] = await Promise.all([
        projectService.getIssueComments(activeProjectId, issue.id).catch(() => []),
        projectService.getIssueActivities(activeProjectId, issue.id).catch(() => []),
        projectService.getChecklists(activeProjectId, issue.id).catch(() => []),
        projectService.getProjectLabels(activeProjectId).catch(() => []),
        projectService.getCompanyMembers().catch(() => [])
      ]);
      
      const mergedFeed = [
        ...comments.map((c: any) => ({ ...c, isActivity: false })),
        ...activities.map((a: any) => ({ ...a, isActivity: true }))
      ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      
      setFeed(mergedFeed);
      setChecklists(checklistsRes);
      setProjectLabels(labelsRes);
      setCompanyMembers(membersRes);
      setAttachments(issue.attachments || []);
    } catch (error) {
      console.error('Failed to load issue details', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePostComment = async () => {
    if (!newComment.trim() || !issue) return;
    setPostingComment(true);
    try {
      await projectService.addIssueComment(projectId, issue.id, newComment.trim());
      setNewComment('');
      loadDetails();
    } catch (error) {
      console.error('Failed to post comment', error);
    } finally {
      setPostingComment(false);
    }
  };

  const handleSaveDescription = async () => {
    if (!issue) return;
    setSavingDesc(true);
    try {
      await projectService.updateIssue(projectId, issue.id, { description });
      setIsEditingDesc(false);
      issue.description = description; 
    } catch (error) {
      console.error('Failed to save description', error);
    } finally {
      setSavingDesc(false);
    }
  };

  const handleTimerToggle = async () => {
    if (!issue) return;
    try {
      if (timerActive) {
        await projectService.stopIssueTimer(projectId, issue.id);
        setTimerActive(false);
      } else {
        await projectService.startIssueTimer(projectId, issue.id);
        setTimerActive(true);
      }
    } catch (error) {
      console.error('Failed to toggle timer', error);
    }
  };

  const handleStatusSelect = async (columnId: number, statusStr: string) => {
    setStatusPickerOpen(false);
    if (!issue || issue.columnId === columnId) return;
    try {
      issue.columnId = columnId;
      issue.status = statusStr;
      const { updateIssueColumn } = useProjectStore.getState();
      await updateIssueColumn(projectId, issue.id, columnId);
      loadDetails();
    } catch (error) {
      console.error('Failed to update status', error);
    }
  };

  const handlePrioritySelect = async (newPriority: string) => {
    setPriorityPickerOpen(false);
    if (!issue || issue.priority === newPriority) return;
    try {
      issue.priority = newPriority;
      const { updateIssuePriority } = useProjectStore.getState();
      await updateIssuePriority(projectId, issue.id, newPriority);
    } catch (error) {
      console.error('Failed to update priority', error);
    }
  };

  const handleToggleMember = async (employeeId: number) => {
    try {
      await projectService.toggleIssueMember(projectId, issue.id, employeeId);
      loadDetails();
    } catch (error) {
      console.error('Failed to toggle member', error);
    }
  };

  const [renderTrigger, setRenderTrigger] = useState(0);

  const fetchProjectLabels = async () => {
    const activeProjectId = projectId || issue?.projectId;
    if (!activeProjectId) return;
    setLoadingLabels(true);
    try {
      const labelsRes = await projectService.getProjectLabels(activeProjectId);
      setProjectLabels(labelsRes || []);
    } catch (err) {
      console.error('Failed to fetch project labels', err);
    } finally {
      setLoadingLabels(false);
    }
  };

  const handleOpenLabelsPicker = () => {
    setLabelsPickerOpen(true);
    setIsCreatingLabel(false);
    setEditingLabel(null);
    setLabelSearchQuery('');
    fetchProjectLabels();
  };

  const handleToggleLabel = async (labelId: number) => {
    const activeProjectId = projectId || issue?.projectId;
    if (!activeProjectId || !issue) return;
    try {
      // Optimistic Update
      const labelObj = projectLabels.find((l: any) => l.id === labelId);
      const isAssigned = issue.labels?.some((il: any) => il.labelId === labelId || il.label?.id === labelId);
      
      if (isAssigned) {
        issue.labels = (issue.labels || []).filter((il: any) => il.labelId !== labelId && il.label?.id !== labelId);
      } else {
        issue.labels = [...(issue.labels || []), { issueId: issue.id, labelId, label: labelObj }];
      }
      
      setRenderTrigger(prev => prev + 1); // Force re-render

      await projectService.toggleIssueLabel(activeProjectId, issue.id, labelId);
      loadDetails();
    } catch (error) {
      console.error('Failed to toggle label', error);
    }
  };

  const handleSaveLabel = async () => {
    const activeProjectId = projectId || issue?.projectId;
    if (!newLabelName.trim() || !activeProjectId || !issue) return;
    setIsSavingLabel(true);
    try {
      if (editingLabel) {
        // Update label
        const updated = await projectService.updateLabel(activeProjectId, editingLabel.id, newLabelName.trim(), newLabelColor);
        setProjectLabels(prev => prev.map(l => l.id === editingLabel.id ? updated : l));
        if (issue.labels) {
          issue.labels = issue.labels.map((il: any) => 
            (il.labelId === editingLabel.id || il.label?.id === editingLabel.id) 
              ? { ...il, label: updated } 
              : il
          );
        }
      } else {
        // Create label
        const created = await projectService.createLabel(activeProjectId, newLabelName.trim(), newLabelColor);
        setProjectLabels(prev => [...prev, created]);
        issue.labels = [...(issue.labels || []), { issueId: issue.id, labelId: created.id, label: created }];
        await projectService.toggleIssueLabel(activeProjectId, issue.id, created.id);
      }
      
      setRenderTrigger(prev => prev + 1);
      setIsCreatingLabel(false);
      setEditingLabel(null);
      setLabelSearchQuery('');
      setNewLabelName('');
      loadDetails();
    } catch (error) {
      console.error('Failed to save label', error);
    } finally {
      setIsSavingLabel(false);
    }
  };

  const handleDeleteLabel = async (labelId: number) => {
    const activeProjectId = projectId || issue?.projectId;
    if (!activeProjectId || !issue) return;
    try {
      await projectService.deleteLabel(activeProjectId, labelId);
      setProjectLabels(prev => prev.filter(l => l.id !== labelId));
      if (issue.labels) {
        issue.labels = issue.labels.filter((il: any) => il.labelId !== labelId && il.label?.id !== labelId);
      }
      setRenderTrigger(prev => prev + 1);
      setIsCreatingLabel(false);
      setEditingLabel(null);
      loadDetails();
    } catch (error) {
      console.error('Failed to delete label', error);
    }
  };

  const openEditLabel = (label: any) => {
    setEditingLabel(label);
    setNewLabelName(label.name || '');
    setNewLabelColor(label.color || '#EF4444');
    setIsCreatingLabel(true);
  };

  const handleToggleChecklistItem = async (checklistId: number, itemId: number, isCompleted: boolean) => {
    try {
      // Optimistic update
      setChecklists(prev => prev.map(cl => 
        cl.id === checklistId 
          ? { ...cl, items: cl.items.map((it: any) => it.id === itemId ? { ...it, isCompleted: !isCompleted } : it) }
          : cl
      ));
      await projectService.updateChecklistItem(projectId, issue.id, checklistId, itemId, { isCompleted: !isCompleted });
    } catch (error) {
      console.error('Failed to toggle checklist item', error);
      loadDetails(); // Revert on failure
    }
  };

  const [newChecklistTitle, setNewChecklistTitle] = useState('');
  const [addingItemTo, setAddingItemTo] = useState<number | null>(null);
  const [newItemTitle, setNewItemTitle] = useState('');

  const handleCreateChecklist = async () => {
    if (!newChecklistTitle.trim()) return;
    try {
      await projectService.createChecklist(projectId, issue.id, newChecklistTitle.trim());
      setNewChecklistTitle('');
      loadDetails();
    } catch (error) {
      console.error('Failed to create checklist', error);
    }
  };

  const handleAddChecklistItem = async (checklistId: number) => {
    if (!newItemTitle.trim()) return;
    try {
      await projectService.addChecklistItem(projectId, issue.id, checklistId, newItemTitle.trim());
      setNewItemTitle('');
      setAddingItemTo(null);
      loadDetails();
    } catch (error) {
      console.error('Failed to add checklist item', error);
    }
  };

  const handleArchive = async () => {
    try {
      await projectService.toggleIssueArchive(projectId, issue.id);
      onClose(); // Close modal on archive
    } catch (error) {
      console.error('Failed to archive issue', error);
    }
  };

  const handleDateConfirm = async (date: Date) => {
    setDatePickerVisible(false);
    try {
      const field = dateType === 'START' ? 'startDate' : 'dueDate';
      await projectService.updateIssue(projectId, issue.id, { [field]: date.toISOString() });
      issue[field] = date.toISOString();
    } catch (error) {
      console.error('Failed to update date', error);
    }
  };

  const handlePickImage = async () => {
    const result = await launchImageLibrary({ mediaType: 'photo', selectionLimit: 1 });
    if (result.didCancel || !result.assets || result.assets.length === 0) return;
    
    const asset = result.assets[0];
    try {
      const formData = new FormData();
      formData.append('file', {
        uri: asset.uri,
        type: asset.type || 'image/jpeg',
        name: asset.fileName || 'upload.jpg',
      } as any);

      const newAttachment = await projectService.uploadAttachment(projectId, issue.id, formData);
      setAttachments([...attachments, newAttachment]);
    } catch (error) {
      console.error('Failed to upload image', error);
    }
  };

  const columns = useMemo(() => {
    if (currentBoard && Array.isArray(currentBoard.columns) && currentBoard.columns.length > 0) {
      return [...currentBoard.columns].sort((a: any, b: any) => a.position - b.position);
    }
    return [
      { id: 'todo', name: 'To Do', type: 'TODO', color: '#94a3b8' },
      { id: 'in_progress', name: 'In Progress', type: 'IN_PROGRESS', color: '#3b82f6' },
      { id: 'done', name: 'Done', type: 'DONE', color: '#10b981' },
    ];
  }, [currentBoard]);

  const priorities = [
    {
      id: 'LOW',
      label: 'Low',
      color: '#64748B',
      bg: '#F8FAFC',
      iconBg: '#F1F5F9',
      borderColor: '#CBD5E1',
      desc: 'Minor or non-urgent task',
      icon: ArrowDown,
    },
    {
      id: 'MEDIUM',
      label: 'Medium',
      color: '#2563EB',
      bg: '#EFF6FF',
      iconBg: '#DBEAFE',
      borderColor: '#93C5FD',
      desc: 'Standard everyday workflow',
      icon: Minus,
    },
    {
      id: 'HIGH',
      label: 'High',
      color: '#D97706',
      bg: '#FFFBEB',
      iconBg: '#FEF3C7',
      borderColor: '#FCD34D',
      desc: 'Important, requires attention',
      icon: ArrowUp,
    },
    {
      id: 'CRITICAL',
      label: 'Critical',
      color: '#DC2626',
      bg: '#FEF2F2',
      iconBg: '#FEE2E2',
      borderColor: '#FCA5A5',
      desc: 'Urgent blocker, fix immediately',
      icon: Flame,
    },
  ];

  if (!issue) return null;

  const currentColumn = columns.find((c: any) => c.id === issue.columnId) || 
                        columns.find((c: any) => c.type === issue.status || c.name.toUpperCase() === issue.status) || 
                        columns[0];
  const currentPriorityObj = priorities.find(p => p.id === (issue.priority || 'MEDIUM')) || priorities[1];
  
  const estimated = issue.estimatedHours || 0;
  const logged = issue.loggedHours || 0;
  const progressPercent = estimated > 0 ? Math.min(100, Math.round((logged / estimated) * 100)) : 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 12) }]}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

        {/* Top Header */}
        <View style={styles.header}>
          <TouchableOpacity 
            style={[styles.statusBadge, { borderColor: currentColumn?.color ? `${currentColumn.color}40` : '#E2E8F0' }]} 
            onPress={() => setStatusPickerOpen(true)}
            activeOpacity={0.7}
          >
            <View style={[styles.statusDot, { backgroundColor: currentColumn?.color || '#3B82F6' }]} />
            <Text style={styles.statusText}>{currentColumn?.name || 'Status'}</Text>
            <ChevronDown size={14} color="#64748B" />
          </TouchableOpacity>

          <View style={styles.headerRight}>
            <View style={styles.keyBadge}>
              <Text style={styles.issueKey}>{issue.key || `#${issue.id}`}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
              <X size={20} color="#334155" />
            </TouchableOpacity>
          </View>
        </View>

        <KeyboardAvoidingView 
          style={styles.flex1} 
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView 
            style={styles.scrollContent} 
            contentContainerStyle={styles.scrollInner}
            showsVerticalScrollIndicator={false}
          >
            {/* Title */}
            <Text style={styles.title}>{issue.title}</Text>
            
            {/* Action Badges Row */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.actionBadgesScroll} contentContainerStyle={styles.actionBadgesContainer}>
              {(() => {
                const PriorityIconComp = currentPriorityObj.icon || AlertCircle;
                return (
                  <TouchableOpacity 
                    style={[
                      styles.actionBadge, 
                      { 
                        backgroundColor: currentPriorityObj.bg, 
                        borderColor: `${currentPriorityObj.color}35`,
                        borderWidth: 1 
                      }
                    ]}
                    onPress={() => setPriorityPickerOpen(true)}
                    activeOpacity={0.7}
                  >
                    <PriorityIconComp size={13} color={currentPriorityObj.color} strokeWidth={2.5} />
                    <Text style={[styles.actionBadgeText, { color: currentPriorityObj.color, fontWeight: '700' }]}>
                      {currentPriorityObj.label}
                    </Text>
                  </TouchableOpacity>
                );
              })()}

              <TouchableOpacity 
                style={[
                  styles.actionBadge, 
                  issue.labels?.length > 0 && { 
                    backgroundColor: '#EFF6FF', 
                    borderColor: '#BFDBFE', 
                    borderWidth: 1 
                  }
                ]} 
                onPress={handleOpenLabelsPicker}
                activeOpacity={0.7}
              >
                <Tag size={13} color={issue.labels?.length > 0 ? '#2563EB' : '#64748B'} />
                <Text style={[styles.actionBadgeText, issue.labels?.length > 0 && { color: '#2563EB', fontWeight: '700' }]}>
                  Labels {issue.labels?.length > 0 ? `(${issue.labels.length})` : ''}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionBadge} onPress={() => { setDateType('DUE'); setDatePickerVisible(true); }}>
                <Calendar size={13} color="#64748B" />
                <Text style={styles.actionBadgeText}>Dates</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionBadge} onPress={() => setMembersPickerOpen(true)}>
                <Users size={13} color="#64748B" />
                <Text style={styles.actionBadgeText}>Members</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionBadge} onPress={handlePickImage}>
                <Paperclip size={13} color="#64748B" />
                <Text style={styles.actionBadgeText}>Attachment</Text>
              </TouchableOpacity>
            </ScrollView>

            {/* Labels Chips Summary Row (if assigned) */}
            {issue.labels && issue.labels.length > 0 && (
              <View style={styles.labelsChipContainer}>
                {issue.labels.map((l: any, idx: number) => {
                  const labelColor = l.label?.color || l.color || '#64748B';
                  const labelName = l.label?.name || l.name || 'Label';
                  const keyId = l.id || l.labelId || l.label?.id || `lbl-chip-${idx}`;
                  return (
                    <TouchableOpacity 
                      key={keyId} 
                      style={[
                        styles.labelTagPill, 
                        { 
                          backgroundColor: `${labelColor}15`, 
                          borderColor: `${labelColor}35` 
                        }
                      ]}
                      onPress={handleOpenLabelsPicker}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.labelTagDot, { backgroundColor: labelColor }]} />
                      <Text style={[styles.labelTagText, { color: labelColor }]}>{labelName}</Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity 
                  style={styles.addLabelTagBtn} 
                  onPress={handleOpenLabelsPicker}
                  activeOpacity={0.7}
                >
                  <Plus size={12} color="#64748B" strokeWidth={2.5} />
                  <Text style={styles.addLabelTagText}>Add</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Dedicated Labels Section Card */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderLeft}>
                  <Tag size={16} color="#0F172A" />
                  <Text style={styles.cardTitle}>Labels & Tags</Text>
                  {issue.labels && issue.labels.length > 0 && (
                    <View style={styles.labelCountPill}>
                      <Text style={styles.labelCountText}>{issue.labels.length}</Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity 
                  style={styles.cardHeaderAddBtn} 
                  onPress={handleOpenLabelsPicker}
                  activeOpacity={0.7}
                >
                  <Plus size={13} color="#2563EB" strokeWidth={2.5} />
                  <Text style={styles.cardHeaderAddText}>Add Label</Text>
                </TouchableOpacity>
              </View>

              {loading ? (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                  <SkeletonPulse width={85} height={32} borderRadius={8} />
                  <SkeletonPulse width={115} height={32} borderRadius={8} />
                </View>
              ) : issue.labels && issue.labels.length > 0 ? (
                <View style={styles.labelsGrid}>
                  {issue.labels.map((l: any, idx: number) => {
                    const labelColor = l.label?.color || l.color || '#64748B';
                    const labelName = l.label?.name || l.name || 'Label';
                    const targetLabelId = l.labelId || l.label?.id || l.id;
                    const keyId = l.id || l.labelId || l.label?.id || `lbl-detail-${idx}`;
                    return (
                      <View 
                        key={keyId} 
                        style={[
                          styles.labelDetailedPill, 
                          { 
                            backgroundColor: `${labelColor}12`, 
                            borderColor: `${labelColor}35` 
                          }
                        ]}
                      >
                        <View style={[styles.labelTagDot, { backgroundColor: labelColor }]} />
                        <Text style={[styles.labelDetailedText, { color: labelColor }]}>{labelName}</Text>
                        <TouchableOpacity 
                          onPress={() => handleToggleLabel(targetLabelId)} 
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={styles.labelRemoveBtn}
                        >
                          <X size={12} color={labelColor} strokeWidth={2.5} />
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <TouchableOpacity 
                  style={styles.emptyLabelsCard} 
                  onPress={handleOpenLabelsPicker}
                  activeOpacity={0.7}
                >
                  <View style={styles.emptyLabelsIconBg}>
                    <Tag size={16} color="#94A3B8" strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.emptyLabelsCardTitle}>No labels attached</Text>
                    <Text style={styles.emptyLabelsCardSubtitle}>Tap here to categorize this issue with tags</Text>
                  </View>
                  <Plus size={16} color="#2563EB" strokeWidth={2.5} />
                </TouchableOpacity>
              )}
            </View>

            {/* Time Tracking Card */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderLeft}>
                  <Clock size={16} color="#0F172A" />
                  <Text style={styles.cardTitle}>Time Tracking</Text>
                </View>
              </View>
              
              <View style={styles.timeTrackingContent}>
                <View style={styles.timeStatsRow}>
                  <View style={styles.timeStatBox}>
                    <Text style={styles.timeStatLabel}>ESTIMATED</Text>
                    <Text style={styles.timeStatValue}>{estimated} <Text style={styles.timeStatUnit}>h</Text></Text>
                  </View>

                  <View style={styles.timeStatBox}>
                    <Text style={styles.timeStatLabel}>LOGGED</Text>
                    <Text style={styles.timeStatValue}>{logged} <Text style={styles.timeStatUnit}>h</Text></Text>
                  </View>

                  <View style={[styles.timeStatBox, { flex: 2 }]}>
                    <View style={styles.progressHeader}>
                      <Text style={styles.timeStatLabel}>PROGRESS</Text>
                      <Text style={styles.progressPercentText}>{progressPercent}%</Text>
                    </View>
                    <View style={styles.progressBarBg}>
                      <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
                    </View>
                  </View>
                </View>
                
                <View style={styles.timeActionsRow}>
                  <TouchableOpacity 
                    style={[styles.timerBtn, timerActive ? styles.timerBtnActive : styles.timerBtnInactive]} 
                    onPress={handleTimerToggle}
                    activeOpacity={0.8}
                  >
                    {timerActive ? <Square size={14} color="#FFFFFF" /> : <Play size={14} color="#FFFFFF" />}
                    <Text style={styles.timerBtnText}>{timerActive ? 'Stop Timer' : 'Start Timer'}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.logWorkBtn} activeOpacity={0.8}>
                    <Clock size={14} color="#475569" />
                    <Text style={styles.logWorkText}>Log Work</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* Description Section */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderLeft}>
                  <AlignLeft size={16} color="#0F172A" />
                  <Text style={styles.cardTitle}>Description</Text>
                </View>
                {!isEditingDesc && (
                  <TouchableOpacity onPress={() => setIsEditingDesc(true)} style={styles.editDescIconBtn}>
                    <Edit3 size={15} color="#3B82F6" />
                  </TouchableOpacity>
                )}
              </View>
              
              {isEditingDesc ? (
                <View style={styles.descEditor}>
                  <TextInput
                    style={styles.descInput}
                    multiline
                    value={description}
                    onChangeText={setDescription}
                    placeholder="Add a more detailed description..."
                    placeholderTextColor="#94A3B8"
                    autoFocus
                  />
                  <View style={styles.descActions}>
                    <TouchableOpacity 
                      style={styles.saveDescBtn} 
                      onPress={handleSaveDescription}
                      disabled={savingDesc}
                    >
                      {savingDesc ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveDescText}>Save</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={styles.cancelDescBtn} 
                      onPress={() => { 
                        setIsEditingDesc(false); 
                        setDescription(stripHtml(issue.description || '')); 
                      }}
                    >
                      <Text style={styles.cancelDescText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity 
                  style={styles.descViewer} 
                  onPress={() => setIsEditingDesc(true)}
                  activeOpacity={0.7}
                >
                  {description ? (
                    <Text style={styles.descText}>{description}</Text>
                  ) : (
                    <Text style={styles.descPlaceholder}>Add a more detailed description...</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>

            {/* Attachments Section */}
            {attachments.length > 0 && (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardHeaderLeft}>
                    <Paperclip size={16} color="#0F172A" />
                    <Text style={styles.cardTitle}>Attachments</Text>
                  </View>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.attachmentsScroll} contentContainerStyle={styles.attachmentsContainer}>
                  {attachments.map((att, idx) => (
                    <View key={att.id || `att-${idx}`} style={styles.attachmentBox}>
                      <View style={styles.attachmentPlaceholder}>
                        <Text style={styles.attachmentExt} numberOfLines={1}>{(att.fileName || att.name || 'IMG').split('.').pop()?.toUpperCase()}</Text>
                      </View>
                      <Text style={styles.attachmentName} numberOfLines={1}>{att.fileName || att.name}</Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Checklists Section */}
            {checklists.map((cl, idx) => {
              const completedCount = cl.items?.filter((i: any) => i.isCompleted).length || 0;
              const totalCount = cl.items?.length || 0;
              const progress = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

              return (
                <View key={cl.id || `cl-${idx}`} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.cardHeaderLeft}>
                      <Check size={16} color="#0F172A" />
                      <Text style={styles.cardTitle}>{cl.title}</Text>
                    </View>
                    <Text style={styles.progressPercentText}>{progress}%</Text>
                  </View>
                  
                  <View style={styles.progressBarBg}>
                    <View style={[styles.progressBarFill, { width: `${progress}%` }]} />
                  </View>

                  <View style={styles.checklistItems}>
                    {cl.items?.map((item: any, itemIdx: number) => (
                      <TouchableOpacity 
                        key={item.id || `cl-item-${itemIdx}`} 
                        style={styles.checklistItem}
                        onPress={() => handleToggleChecklistItem(cl.id, item.id, item.isCompleted)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.checkbox, item.isCompleted && styles.checkboxChecked]}>
                          {item.isCompleted && <Check size={12} color="#FFFFFF" />}
                        </View>
                        <Text style={[styles.checklistItemText, item.isCompleted && styles.checklistItemTextDone]}>
                          {item.title}
                        </Text>
                      </TouchableOpacity>
                    ))}

                    {addingItemTo === cl.id ? (
                      <View style={styles.addItemForm}>
                        <TextInput
                          style={styles.addItemInput}
                          placeholder="Add an item"
                          value={newItemTitle}
                          onChangeText={setNewItemTitle}
                          autoFocus
                          onSubmitEditing={() => handleAddChecklistItem(cl.id)}
                        />
                        <View style={styles.addItemActions}>
                          <TouchableOpacity style={styles.saveDescBtn} onPress={() => handleAddChecklistItem(cl.id)}>
                            <Text style={styles.saveDescText}>Add</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.cancelDescBtn} onPress={() => setAddingItemTo(null)}>
                            <Text style={styles.cancelDescText}>Cancel</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity style={styles.addItemBtn} onPress={() => setAddingItemTo(cl.id)}>
                        <Text style={styles.addItemBtnText}>Add an item</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}

            <View style={styles.addChecklistForm}>
              <TextInput
                style={styles.addChecklistInput}
                placeholder="Add checklist..."
                value={newChecklistTitle}
                onChangeText={setNewChecklistTitle}
                onSubmitEditing={handleCreateChecklist}
              />
              {newChecklistTitle.length > 0 && (
                <TouchableOpacity style={styles.saveDescBtn} onPress={handleCreateChecklist}>
                  <Text style={styles.saveDescText}>Add</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Comments & Activity Section */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderLeft}>
                  <MessageSquare size={16} color="#0F172A" />
                  <Text style={styles.cardTitle}>Comments and activity</Text>
                </View>
                <View style={styles.feedCountPill}>
                  <Text style={styles.feedCountText}>{feed.length}</Text>
                </View>
              </View>

              {loading ? (
                <View style={styles.skeletonFeedContainer}>
                  {[1, 2, 3].map((i) => (
                    <View key={i} style={styles.skeletonFeedItem}>
                      <SkeletonPulse width={32} height={32} borderRadius={16} />
                      <View style={{ flex: 1, gap: 6, marginLeft: 10 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <SkeletonPulse width={110} height={12} borderRadius={4} />
                          <SkeletonPulse width={45} height={10} borderRadius={4} />
                        </View>
                        <SkeletonPulse width="100%" height={26} borderRadius={8} />
                      </View>
                    </View>
                  ))}
                </View>
              ) : feed.length === 0 ? (
                <View style={styles.emptyFeed}>
                  <Text style={styles.emptyFeedText}>No comments or activity yet.</Text>
                </View>
              ) : (
                <View style={styles.feedList}>
                  {feed.map((item, index) => {
                    const isAct = item.isActivity;
                    const userName = item.user?.firstName 
                      ? `${item.user.firstName} ${item.user.lastName || ''}`.trim()
                      : (item.actor?.firstName ? `${item.actor.firstName} ${item.actor.lastName || ''}`.trim() : 'User');
                    
                    const initial = (userName?.[0] || 'U').toUpperCase();

                    if (isAct) {
                      return (
                        <View key={item.id ? `act-${item.id}` : `act-${index}`} style={styles.activityItem}>
                          <View style={styles.activityDot}>
                            <Activity size={10} color="#64748B" />
                          </View>
                          <View style={styles.activityContent}>
                            <Text style={styles.activityText}>
                              <Text style={styles.activityAuthor}>{userName} </Text>
                              {formatActivityText(item)}
                            </Text>
                            <Text style={styles.activityTime}>{formatTimeAgo(item.createdAt)}</Text>
                          </View>
                        </View>
                      );
                    }

                    // Comment Item
                    if (!item.content || !item.content.trim()) return null;

                    return (
                      <View key={item.id ? `comm-${item.id}` : `comm-${index}`} style={styles.commentCard}>
                        <View style={styles.commentAvatar}>
                          <Text style={styles.commentAvatarText}>{initial}</Text>
                        </View>
                        <View style={styles.commentBody}>
                          <View style={styles.commentHeader}>
                            <Text style={styles.commentAuthor}>{userName}</Text>
                            <Text style={styles.commentTime}>{formatTimeAgo(item.createdAt)}</Text>
                          </View>
                          <View style={styles.commentBubble}>
                            <Text style={styles.commentText}>{item.content}</Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {/* Archive Button */}
            <TouchableOpacity style={styles.archiveBtn} onPress={handleArchive}>
              <Text style={styles.archiveBtnText}>Archive Issue</Text>
            </TouchableOpacity>
            
          </ScrollView>

          {/* Comment Input Footer */}
          <View style={[styles.commentFooter, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <TextInput
              style={styles.commentInput}
              placeholder="Write a comment..."
              placeholderTextColor="#94A3B8"
              value={newComment}
              onChangeText={setNewComment}
              multiline
            />
            {newComment.trim().length > 0 && (
              <TouchableOpacity 
                style={styles.sendBtn} 
                onPress={handlePostComment}
                disabled={postingComment}
                activeOpacity={0.8}
              >
                {postingComment ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Send size={16} color="#FFFFFF" />
                )}
              </TouchableOpacity>
            )}
          </View>
        </KeyboardAvoidingView>

        {/* Status Picker Bottom Sheet / Modal */}
        <Modal visible={statusPickerOpen} transparent animationType="fade" onRequestClose={() => setStatusPickerOpen(false)}>
          <View style={styles.pickerOverlay}>
            <TouchableOpacity style={styles.pickerBackdrop} onPress={() => setStatusPickerOpen(false)} />
            <View style={[styles.pickerCard, { paddingBottom: Math.max(insets.bottom, 20) }]}>
              <Text style={styles.pickerTitle}>Select Status</Text>
              {columns.map((c: any) => {
                const isSelected = c.id === currentColumn?.id;
                return (
                  <TouchableOpacity 
                    key={c.id?.toString()} 
                    style={[styles.pickerOption, isSelected && styles.pickerOptionSelected]}
                    onPress={() => handleStatusSelect(c.id, c.type)}
                  >
                    <View style={styles.pickerOptionLeft}>
                      <View style={[styles.statusDot, { backgroundColor: c.color || '#94A3B8' }]} />
                      <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected]}>{c.name}</Text>
                    </View>
                    {isSelected && <Check size={18} color="#3B82F6" />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </Modal>

        {/* Priority Picker Bottom Sheet / Modal */}
        <Modal visible={priorityPickerOpen} transparent animationType="fade" onRequestClose={() => setPriorityPickerOpen(false)}>
          <View style={styles.pickerOverlay}>
            <TouchableOpacity style={styles.pickerBackdrop} activeOpacity={1} onPress={() => setPriorityPickerOpen(false)} />
            <View style={[styles.priorityPickerCard, { paddingBottom: Math.max(insets.bottom, 24) }]}>
              {/* Drag Handle */}
              <View style={styles.sheetHandle} />

              {/* Header */}
              <View style={styles.priorityHeaderRow}>
                <View>
                  <Text style={styles.prioritySheetTitle}>Task Priority</Text>
                  <Text style={styles.prioritySheetSubtitle}>Set the urgency level for this issue</Text>
                </View>
                <TouchableOpacity 
                  style={styles.sheetCloseBtn} 
                  onPress={() => setPriorityPickerOpen(false)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <X size={18} color="#64748B" />
                </TouchableOpacity>
              </View>

              {/* Priority Options List */}
              <View style={styles.priorityList}>
                {priorities.map(p => {
                  const isSelected = p.id === (issue.priority || 'MEDIUM');
                  const IconComp = p.icon;
                  return (
                    <TouchableOpacity 
                      key={p.id} 
                      style={[
                        styles.priorityCard,
                        isSelected && {
                          backgroundColor: p.bg,
                          borderColor: p.borderColor,
                          borderWidth: 1.5,
                        }
                      ]}
                      activeOpacity={0.75}
                      onPress={() => handlePrioritySelect(p.id)}
                    >
                      <View style={styles.priorityCardLeft}>
                        <View style={[styles.priorityIconWrapper, { backgroundColor: p.iconBg }]}>
                          <IconComp size={18} color={p.color} strokeWidth={2.5} />
                        </View>
                        <View style={styles.priorityTextContainer}>
                          <View style={styles.priorityLabelRow}>
                            <Text style={[styles.priorityLabelText, isSelected && { color: p.color, fontWeight: '700' }]}>
                              {p.label}
                            </Text>
                            {isSelected && (
                              <View style={[styles.priorityCurrentTag, { backgroundColor: `${p.color}15` }]}>
                                <Text style={[styles.priorityCurrentTagText, { color: p.color }]}>Current</Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.priorityDescText}>{p.desc}</Text>
                        </View>
                      </View>

                      {isSelected ? (
                        <View style={[styles.priorityCheckCircle, { backgroundColor: p.color }]}>
                          <Check size={13} color="#FFFFFF" strokeWidth={3} />
                        </View>
                      ) : (
                        <View style={styles.priorityRadioCircle} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        </Modal>
        {/* Members Picker Bottom Sheet */}
        <Modal visible={membersPickerOpen} transparent animationType="fade" onRequestClose={() => setMembersPickerOpen(false)}>
          <View style={styles.pickerOverlay}>
            <TouchableOpacity style={styles.pickerBackdrop} onPress={() => setMembersPickerOpen(false)} />
            <View style={[styles.pickerCard, { paddingBottom: Math.max(insets.bottom, 20), maxHeight: '80%' }]}>
              <Text style={styles.pickerTitle}>Assign Members</Text>
              <ScrollView showsVerticalScrollIndicator={false}>
                {companyMembers.map((m: any) => {
                  const isAssigned = issue.assignees?.some((a: any) => a.id === m.id);
                  return (
                    <TouchableOpacity 
                      key={m.id} 
                      style={[styles.pickerOption, isAssigned && styles.pickerOptionSelected]}
                      onPress={() => handleToggleMember(m.id)}
                    >
                      <View style={styles.pickerOptionLeft}>
                        <View style={styles.memberAvatarSmall}>
                          <Text style={styles.memberAvatarTextSmall}>{(m.firstName?.[0] || 'U').toUpperCase()}</Text>
                        </View>
                        <Text style={[styles.pickerOptionText, isAssigned && styles.pickerOptionTextSelected]}>
                          {m.firstName} {m.lastName}
                        </Text>
                      </View>
                      {isAssigned && <Check size={18} color="#3B82F6" />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Labels Picker Bottom Sheet */}
        <Modal 
          visible={labelsPickerOpen} 
          transparent 
          animationType="fade" 
          onRequestClose={() => {
            setLabelsPickerOpen(false);
            setIsCreatingLabel(false);
            setEditingLabel(null);
            setLabelSearchQuery('');
          }}
        >
          <View style={styles.pickerOverlay}>
            <TouchableOpacity 
              style={styles.pickerBackdrop} 
              activeOpacity={1}
              onPress={() => {
                setLabelsPickerOpen(false);
                setIsCreatingLabel(false);
                setEditingLabel(null);
                setLabelSearchQuery('');
              }} 
            />
            <View style={[styles.labelsPickerCard, { paddingBottom: Math.max(insets.bottom, 20), minHeight: 480, maxHeight: '88%' }]}>
              {/* Drag Handle */}
              <View style={styles.sheetHandle} />

              {isCreatingLabel ? (
                <>
                  {/* Header */}
                  <View style={styles.labelsHeaderRow}>
                    <TouchableOpacity 
                      style={styles.sheetBackBtn} 
                      onPress={() => {
                        setIsCreatingLabel(false);
                        setEditingLabel(null);
                      }}
                      activeOpacity={0.7}
                    >
                      <ArrowLeft size={18} color="#0F172A" />
                    </TouchableOpacity>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.labelsSheetTitle}>
                        {editingLabel ? 'Edit Label' : 'Create Label'}
                      </Text>
                      <Text style={styles.labelsSheetSubtitle}>
                        {editingLabel ? 'Update label name or color' : 'Add a custom tag to this project'}
                      </Text>
                    </View>
                    <TouchableOpacity 
                      style={styles.sheetCloseBtn} 
                      onPress={() => {
                        setLabelsPickerOpen(false);
                        setIsCreatingLabel(false);
                        setEditingLabel(null);
                        setLabelSearchQuery('');
                      }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <X size={18} color="#64748B" />
                    </TouchableOpacity>
                  </View>

                  <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 20 }}>
                    {/* Live Preview */}
                    <View style={styles.labelPreviewSection}>
                      <Text style={styles.labelFormLabel}>Preview</Text>
                      <View style={styles.labelPreviewWrapper}>
                        <View style={[styles.crmPreviewBar, { backgroundColor: newLabelColor }]}>
                          <Text style={styles.crmPreviewText}>
                            {newLabelName.trim() || 'Label Preview'}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Label Name Input */}
                    <Text style={styles.labelFormLabel}>Label Name</Text>
                    <TextInput
                      style={styles.labelFormInput}
                      placeholder="E.g., Bug, Feature, Urgent..."
                      placeholderTextColor="#94A3B8"
                      value={newLabelName}
                      onChangeText={setNewLabelName}
                      autoFocus
                    />

                    {/* Color Palette */}
                    <Text style={styles.labelFormLabel}>Pick a Color</Text>
                    <View style={styles.colorPaletteGrid}>
                      {PRESET_COLORS.map(color => {
                        const isColorSelected = newLabelColor === color;
                        return (
                          <TouchableOpacity
                            key={color}
                            style={[
                              styles.colorCircle, 
                              { backgroundColor: color }, 
                              isColorSelected && styles.colorCircleSelected
                            ]}
                            onPress={() => setNewLabelColor(color)}
                            activeOpacity={0.8}
                          >
                            {isColorSelected && <Check size={16} color="#FFFFFF" strokeWidth={3} />}
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {/* Submit & Delete Buttons */}
                    <TouchableOpacity 
                      style={[styles.createLabelSubmitBtn, (!newLabelName.trim() || isSavingLabel) && styles.createLabelSubmitBtnDisabled]}
                      onPress={handleSaveLabel}
                      disabled={!newLabelName.trim() || isSavingLabel}
                      activeOpacity={0.8}
                    >
                      {isSavingLabel ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <>
                          <Check size={16} color="#FFFFFF" strokeWidth={2.5} />
                          <Text style={styles.createLabelSubmitText}>
                            {editingLabel ? 'Save Changes' : 'Create & Apply Label'}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>

                    {editingLabel && (
                      <TouchableOpacity 
                        style={styles.deleteLabelBtn}
                        onPress={() => handleDeleteLabel(editingLabel.id)}
                        activeOpacity={0.8}
                      >
                        <Trash2 size={16} color="#EF4444" strokeWidth={2} />
                        <Text style={styles.deleteLabelText}>Delete Label</Text>
                      </TouchableOpacity>
                    )}
                  </ScrollView>
                </>
              ) : (
                <>
                  {/* Header */}
                  <View style={styles.labelsHeaderRow}>
                    <View>
                      <Text style={styles.labelsSheetTitle}>Labels</Text>
                      <Text style={styles.labelsSheetSubtitle}>Select tags or create new ones</Text>
                    </View>
                    <TouchableOpacity 
                      style={styles.sheetCloseBtn} 
                      onPress={() => {
                        setLabelsPickerOpen(false);
                        setIsCreatingLabel(false);
                        setEditingLabel(null);
                        setLabelSearchQuery('');
                      }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <X size={18} color="#64748B" />
                    </TouchableOpacity>
                  </View>

                  {/* Search Bar */}
                  <View style={styles.searchBarContainer}>
                    <Search size={16} color="#94A3B8" />
                    <TextInput
                      style={styles.searchBarInput}
                      placeholder="Search labels..."
                      placeholderTextColor="#94A3B8"
                      value={labelSearchQuery}
                      onChangeText={setLabelSearchQuery}
                    />
                    {labelSearchQuery.length > 0 && (
                      <TouchableOpacity onPress={() => setLabelSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <X size={14} color="#94A3B8" />
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Section Title */}
                  <Text style={styles.labelsSubtitle}>Labels</Text>

                  {/* Labels List */}
                  {loadingLabels ? (
                    <View style={styles.labelsLoadingContainer}>
                      <ActivityIndicator size="small" color="#2563EB" />
                      <Text style={styles.labelsLoadingText}>Loading labels...</Text>
                    </View>
                  ) : (
                    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
                      <View style={styles.labelsListGap}>
                        {projectLabels
                          .filter(l => (l.name || '').toLowerCase().includes(labelSearchQuery.toLowerCase()))
                          .map((l: any, idx: number) => {
                            const isAssigned = issue.labels?.some((il: any) => il.labelId === l.id || il.label?.id === l.id);
                            const labelColor = l.color || '#EF4444';
                            return (
                              <View key={l.id || `pl-${idx}`} style={styles.crmLabelRow}>
                                {/* Checkbox */}
                                <TouchableOpacity 
                                  style={[styles.crmCheckbox, isAssigned && styles.crmCheckboxChecked]}
                                  onPress={() => handleToggleLabel(l.id)}
                                  activeOpacity={0.7}
                                >
                                  {isAssigned && <Check size={12} color="#FFFFFF" strokeWidth={3} />}
                                </TouchableOpacity>

                                {/* Solid Colored Bar */}
                                <TouchableOpacity 
                                  style={[styles.crmLabelBar, { backgroundColor: labelColor }]}
                                  onPress={() => handleToggleLabel(l.id)}
                                  activeOpacity={0.85}
                                >
                                  <Text style={styles.crmLabelBarText} numberOfLines={1}>
                                    {l.name}
                                  </Text>
                                </TouchableOpacity>

                                {/* Edit Pencil Button */}
                                <TouchableOpacity 
                                  style={styles.crmLabelEditBtn}
                                  onPress={() => openEditLabel(l)}
                                  activeOpacity={0.7}
                                >
                                  <Pencil size={15} color="#64748B" />
                                </TouchableOpacity>
                              </View>
                            );
                          })}
                      </View>

                      {projectLabels.filter(l => (l.name || '').toLowerCase().includes(labelSearchQuery.toLowerCase())).length === 0 && (
                        <View style={styles.emptyLabelsState}>
                          <Tag size={24} color="#CBD5E1" />
                          <Text style={styles.emptyLabelsText}>
                            {labelSearchQuery ? `No labels matching "${labelSearchQuery}"` : 'No labels found in this project.'}
                          </Text>
                        </View>
                      )}
                    </ScrollView>
                  )}

                  {/* Create New Label Button */}
                  <TouchableOpacity 
                    style={styles.crmCreateLabelBtn} 
                    onPress={() => {
                      setEditingLabel(null);
                      setNewLabelName(labelSearchQuery.trim());
                      setNewLabelColor('#EF4444');
                      setIsCreatingLabel(true);
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.crmCreateLabelBtnText}>Create a new label</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </Modal>

        <DateTimePickerModal
          isVisible={isDatePickerVisible}
          mode="date"
          onConfirm={handleDateConfirm}
          onCancel={() => setDatePickerVisible(false)}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  flex1: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  keyBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  issueKey: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    letterSpacing: 0.5,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    flex: 1,
  },
  scrollInner: {
    padding: 16,
    paddingBottom: 24,
    gap: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 25,
  },
  actionBadgesScroll: {
    marginHorizontal: -4,
  },
  actionBadgesContainer: {
    paddingHorizontal: 4,
    gap: 8,
  },
  actionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
  },
  actionBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  feedCountPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  feedCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  timeTrackingContent: {
    gap: 14,
  },
  timeStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  timeStatBox: {
    flex: 1,
  },
  timeStatLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  timeStatValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  timeStatUnit: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  progressPercentText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#3B82F6',
  },
  progressBarBg: {
    width: '100%',
    height: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 3,
  },
  timeActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  timerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  timerBtnInactive: {
    backgroundColor: '#10B981',
  },
  timerBtnActive: {
    backgroundColor: '#EF4444',
  },
  timerBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  logWorkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  logWorkText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  editDescIconBtn: {
    padding: 4,
  },
  descViewer: {
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    minHeight: 60,
  },
  descText: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 20,
  },
  descPlaceholder: {
    fontSize: 13,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  descEditor: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#3B82F6',
    borderRadius: 8,
    overflow: 'hidden',
  },
  descInput: {
    padding: 12,
    fontSize: 13,
    color: '#0F172A',
    minHeight: 90,
    textAlignVertical: 'top',
  },
  descActions: {
    flexDirection: 'row',
    padding: 8,
    backgroundColor: '#F8FAFC',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    gap: 8,
  },
  saveDescBtn: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  saveDescText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  cancelDescBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  cancelDescText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '500',
  },
  loadingFeed: {
    paddingVertical: 16,
    alignItems: 'center',
    gap: 6,
  },
  loadingFeedText: {
    fontSize: 12,
    color: '#94A3B8',
  },
  emptyFeed: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  emptyFeedText: {
    fontSize: 12,
    color: '#94A3B8',
  },
  feedList: {
    gap: 12,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 4,
  },
  activityDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  activityContent: {
    flex: 1,
  },
  activityText: {
    fontSize: 12,
    color: '#64748B',
  },
  activityAuthor: {
    fontWeight: '600',
    color: '#1E293B',
  },
  activityTime: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 2,
  },
  commentCard: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  commentAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentAvatarText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563EB',
  },
  commentBody: {
    flex: 1,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  commentAuthor: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  commentTime: {
    fontSize: 10,
    color: '#94A3B8',
  },
  commentBubble: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    borderTopLeftRadius: 2,
    padding: 10,
  },
  commentText: {
    fontSize: 13,
    color: '#1E293B',
    lineHeight: 18,
  },
  commentFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    gap: 8,
  },
  commentInput: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0F172A',
    maxHeight: 80,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 100,
  },
  pickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 16,
  },
  priorityPickerCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 20,
  },
  priorityHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  prioritySheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  prioritySheetSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  sheetCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityList: {
    gap: 10,
  },
  priorityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  priorityCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  priorityIconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  priorityTextContainer: {
    flex: 1,
  },
  priorityLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  priorityLabelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A',
  },
  priorityCurrentTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  priorityCurrentTagText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  priorityDescText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  priorityCheckCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityRadioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
  },
  pickerCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 8,
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  pickerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  labelCountPill: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  labelCountText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563EB',
  },
  cardHeaderAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  cardHeaderAddText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563EB',
  },
  labelsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  labelDetailedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  labelDetailedText: {
    fontSize: 13,
    fontWeight: '700',
  },
  labelRemoveBtn: {
    padding: 2,
    borderRadius: 4,
    marginLeft: 2,
  },
  emptyLabelsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
  },
  emptyLabelsIconBg: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyLabelsCardTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  emptyLabelsCardSubtitle: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 1,
  },
  skeletonFeedContainer: {
    gap: 14,
    marginTop: 4,
  },
  skeletonFeedItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  labelsChipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  labelTagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  labelTagDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  labelTagText: {
    fontSize: 12,
    fontWeight: '700',
  },
  addLabelTagBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    gap: 4,
  },
  addLabelTagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  labelsPickerCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 20,
    minHeight: 480,
  },
  labelsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sheetBackBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelsSheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  labelsSheetSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    gap: 8,
    marginBottom: 14,
  },
  searchBarInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    padding: 0,
  },
  labelsSubtitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  labelsLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 28,
  },
  labelsLoadingText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  labelsListGap: {
    gap: 8,
    paddingBottom: 8,
  },
  crmLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  crmCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  crmCheckboxChecked: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  crmLabelBar: {
    flex: 1,
    height: 38,
    borderRadius: 6,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  crmLabelBarText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  crmLabelEditBtn: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  crmCreateLabelBtn: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  crmCreateLabelBtnText: {
    color: '#1E293B',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyLabelsState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  emptyLabelsText: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
  },
  labelPreviewSection: {
    marginBottom: 14,
  },
  labelPreviewWrapper: {
    padding: 14,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  crmPreviewBar: {
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    paddingHorizontal: 16,
    alignItems: 'center',
    width: '100%',
  },
  crmPreviewText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  labelFormLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  labelFormInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0F172A',
    marginBottom: 16,
  },
  colorPaletteGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  colorCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorCircleSelected: {
    borderWidth: 3,
    borderColor: '#0F172A',
    transform: [{ scale: 1.08 }],
  },
  createLabelSubmitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#2563EB',
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 4,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  createLabelSubmitBtnDisabled: {
    backgroundColor: '#93C5FD',
    shadowOpacity: 0,
    elevation: 0,
  },
  createLabelSubmitText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  deleteLabelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 10,
  },
  deleteLabelText: {
    color: '#EF4444',
    fontWeight: '700',
    fontSize: 14,
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
  },
  pickerOptionSelected: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  pickerOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pickerOptionText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#334155',
  },
  pickerOptionTextSelected: {
    fontWeight: '700',
    color: '#1D4ED8',
  },
  memberAvatarSmall: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarTextSmall: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  checklistItems: {
    marginTop: 16,
    gap: 12,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  checklistItemText: {
    flex: 1,
    fontSize: 14,
    color: '#1E293B',
    lineHeight: 22,
  },
  checklistItemTextDone: {
    textDecorationLine: 'line-through',
    color: '#94A3B8',
  },
  addItemBtn: {
    paddingVertical: 8,
    paddingHorizontal: 32, // align with text
  },
  addItemBtnText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
  },
  addItemForm: {
    marginLeft: 32,
    gap: 8,
  },
  addItemInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
  },
  addItemActions: {
    flexDirection: 'row',
    gap: 8,
  },
  addChecklistForm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addChecklistInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
  },
  archiveBtn: {
    marginTop: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  archiveBtnText: {
    color: '#DC2626',
    fontWeight: '700',
    fontSize: 14,
  },
  attachmentsScroll: {
    marginHorizontal: -4,
  },
  attachmentsContainer: {
    paddingHorizontal: 4,
    gap: 12,
  },
  attachmentBox: {
    width: 100,
  },
  attachmentPlaceholder: {
    width: 100,
    height: 80,
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  attachmentExt: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
  },
  attachmentName: {
    fontSize: 11,
    color: '#334155',
    textAlign: 'center',
  },
});
