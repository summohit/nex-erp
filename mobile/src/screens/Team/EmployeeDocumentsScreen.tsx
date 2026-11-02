import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  ScrollView,
  Alert,
  Linking,
  Modal,
  Platform,
} from 'react-native';
import {
  Search,
  FileText,
  Trash2,
  Upload,
  ChevronDown,
  ChevronRight,
  X,
  Check,
  Folder,
  FolderOpen,
  LayoutGrid,
  List,
  ArrowLeft,
  ExternalLink,
  Eye,
  Image as ImageIcon,
  FileSpreadsheet,
  File,
  Filter,
  ArrowUpDown,
  Building2,
  Users,
  Sparkles,
} from 'lucide-react-native';
import AppScreen from '../../components/AppScreen';
import { apiClient } from '../../api/apiClient';
import { Avatar } from '../../components/PersonSheet';
import { theme } from '../../theme/theme';

/**
 * Google Drive-style Employee Documents Vault.
 * Features:
 * - Employee Vault Folders with employee avatars instead of generic folder icons.
 * - Drill-down folder view: tap any employee folder to view their full document archive.
 * - Drive Grid (2-column) vs List view toggle.
 * - File-type color coding (PDF red, Images indigo, Word blue, Spreadsheets green).
 * - Comprehensive filtering by Department, Document Type, and Sort order.
 * - Global file search across all employees and files.
 */
const fullName = (e: any) => `${e?.firstName || ''} ${e?.lastName || ''}`.trim();
const errMsg = (e: any) => e?.response?.data?.message || 'Please try again.';
type Pick = 'department' | 'type' | 'upload' | 'sort' | null;
type ViewLayout = 'grid' | 'list';
type SortBy = 'files_desc' | 'name_asc' | 'recent';

// Helper to determine file icon, color, and badge
const getFileTypeInfo = (fileName?: string, docType?: string) => {
  const ext = (fileName || '').split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') {
    return { label: 'PDF', bg: '#FEE2E2', color: '#DC2626', icon: FileText };
  }
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(ext)) {
    return { label: 'IMG', bg: '#EEF2FF', color: '#4F46E5', icon: ImageIcon };
  }
  if (['doc', 'docx'].includes(ext)) {
    return { label: 'DOC', bg: '#E0F2FE', color: '#0284C7', icon: FileText };
  }
  if (['xls', 'xlsx', 'csv'].includes(ext)) {
    return { label: 'XLS', bg: '#DCFCE7', color: '#16A34A', icon: FileSpreadsheet };
  }
  return { label: ext.toUpperCase().slice(0, 4) || 'FILE', bg: '#F1F5F9', color: '#64748B', icon: File };
};

export default function EmployeeDocumentsScreen() {
  const navigation = useNavigation<any>();
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [denied, setDenied] = useState(false);

  // Search & Filters
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('');
  const [type, setType] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('files_desc');
  const [viewLayout, setViewLayout] = useState<ViewLayout>('grid');

  // Folder Drilldown State: when set, user is inside this employee's folder
  const [vaultSelection, setVaultSelection] = useState<{ empId: number | null }>({ empId: null });
  const selectedEmpId = vaultSelection.empId;
  const setSelectedEmpId = (id: number | null) => setVaultSelection({ empId: id });
  const [empDocTypeFilter, setEmpDocTypeFilter] = useState<string>('All');
  const [empSearchQuery, setEmpSearchQuery] = useState<string>('');

  // Modals & Bottom Sheets
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

  // Flattened documents with employee attached
  const allDocs = useMemo(
    () => employees.flatMap((e) => (e.documents || []).map((d: any) => ({ ...d, employee: e }))),
    [employees]
  );

  const departments = useMemo(
    () => [...new Set(employees.map((e) => e.department?.name).filter(Boolean))].sort() as string[],
    [employees]
  );

  const types = useMemo(
    () => [...new Set(allDocs.map((d) => d.documentType || 'Other'))].sort() as string[],
    [allDocs]
  );

  // Filtered Employee Folders list
  const filteredFolders = useMemo(() => {
    const q = query.trim().toLowerCase();

    return employees
      .filter((e) => {
        const empDocs = e.documents || [];
        if (dept && e.department?.name !== dept) return false;

        // If doc type filter is applied, employee must have at least one doc of that type
        if (type && !empDocs.some((d: any) => (d.documentType || 'Other') === type)) {
          return false;
        }

        if (!q) return true;

        // Search matches employee name, code, dept, role OR file names inside their docs
        const empMatch = [fullName(e), e.user?.email, e.phone, e.employeeCode, e.department?.name, e.designation?.name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q);

        if (empMatch) return true;

        const fileMatch = empDocs.some(
          (d: any) =>
            (d.fileName || '').toLowerCase().includes(q) ||
            (d.documentType || '').toLowerCase().includes(q)
        );

        return fileMatch;
      })
      .sort((a, b) => {
        if (sortBy === 'files_desc') {
          return (b.documents?.length || 0) - (a.documents?.length || 0) || fullName(a).localeCompare(fullName(b));
        }
        if (sortBy === 'name_asc') {
          return fullName(a).localeCompare(fullName(b));
        }
        // recent: sort by latest document creation date
        const aLatest = a.documents?.[0]?.createdAt ? new Date(a.documents[0].createdAt).getTime() : 0;
        const bLatest = b.documents?.[0]?.createdAt ? new Date(b.documents[0].createdAt).getTime() : 0;
        return bLatest - aLatest;
      });
  }, [employees, query, dept, type, sortBy]);

  // Selected Employee object when viewing their folder
  const currentEmployee = useMemo(() => {
    if (!selectedEmpId) return null;
    return employees.find((e) => e.id === selectedEmpId) || null;
  }, [employees, selectedEmpId]);

  // Filtered documents inside the current employee folder
  const currentEmployeeDocs = useMemo(() => {
    if (!currentEmployee) return [];
    let docs = currentEmployee.documents || [];

    if (empDocTypeFilter !== 'All') {
      docs = docs.filter((d: any) => (d.documentType || 'Other') === empDocTypeFilter);
    }

    const q = empSearchQuery.trim().toLowerCase();
    if (q) {
      docs = docs.filter(
        (d: any) =>
          (d.fileName || '').toLowerCase().includes(q) ||
          (d.documentType || '').toLowerCase().includes(q)
      );
    }

    return docs;
  }, [currentEmployee, empDocTypeFilter, empSearchQuery]);

  // Doc types available for current employee
  const currentEmpTypes = useMemo(() => {
    if (!currentEmployee) return ['All'];
    const set = new Set<string>();
    (currentEmployee.documents || []).forEach((d: any) => {
      if (d.documentType) set.add(d.documentType);
    });
    return ['All', ...Array.from(set).sort()];
  }, [currentEmployee]);

  // Total docs across filtered folders
  const totalFilteredDocs = useMemo(
    () => filteredFolders.reduce((sum, e) => sum + (e.documents?.length || 0), 0),
    [filteredFolders]
  );

  const removeDoc = (d: any, emp: any) =>
    Alert.alert('Delete document?', `${d.fileName}\n${fullName(emp)}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.delete(`/employees/${emp.id}/documents/${d.id}`);
            setEmployees((list) =>
              list.map((e) =>
                e.id === emp.id
                  ? { ...e, documents: (e.documents || []).filter((x: any) => x.id !== d.id) }
                  : e
              )
            );
          } catch (e) {
            Alert.alert('Could not delete', errMsg(e));
          }
        },
      },
    ]);

  const pickOptions = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    if (picking === 'department') {
      return ['', ...departments].map((v) => ({ value: v, label: v || 'All departments' }));
    }
    if (picking === 'type') {
      return ['', ...types].map((v) => ({ value: v, label: v || 'All document types' }));
    }
    if (picking === 'sort') {
      return [
        { value: 'files_desc', label: 'Most Documents First' },
        { value: 'name_asc', label: 'Employee Name (A → Z)' },
        { value: 'recent', label: 'Recently Updated' },
      ];
    }
    if (picking === 'upload') {
      return employees
        .filter((e) => !q || `${fullName(e)} ${e.employeeCode || ''}`.toLowerCase().includes(q))
        .sort((a, b) => fullName(a).localeCompare(fullName(b)))
        .map((e) => ({
          value: String(e.id),
          label: fullName(e),
          sub: [e.designation?.name, e.employeeCode && `#${e.employeeCode}`].filter(Boolean).join(' · '),
        }));
    }
    return [];
  }, [picking, pickQuery, departments, types, employees]);

  const choose = (v: string) => {
    if (picking === 'department') setDept(v);
    if (picking === 'type') setType(v);
    if (picking === 'sort') setSortBy(v as SortBy);
    if (picking === 'upload') {
      navigation.navigate('EmployeeEdit', { employeeId: Number(v), initialTab: 'Documents' });
    }
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

  // -------------------------------------------------------------
  // RENDER 1: INSIDE AN EMPLOYEE'S FOLDER (Drilldown View)
  // -------------------------------------------------------------
  if (currentEmployee) {
    const docs = currentEmployeeDocs;
    const totalEmpDocs = currentEmployee.documents?.length || 0;

    return (
      <AppScreen
        showBack
        title="Documents"
        subtitle="Employee Vault"
        onBack={() => {
          setSelectedEmpId(null);
          setEmpDocTypeFilter('All');
          setEmpSearchQuery('');
        }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
            />
          }
        >
          {/* Breadcrumb Navigation Bar */}
          <View style={styles.breadcrumbBar}>
            <TouchableOpacity
              style={styles.backToFoldersBtn}
              onPress={() => {
                setSelectedEmpId(null);
                setEmpDocTypeFilter('All');
                setEmpSearchQuery('');
              }}
              activeOpacity={0.7}
            >
              <ArrowLeft size={16} color="#1373E5" strokeWidth={2.4} />
              <Text style={styles.backToFoldersText}>All Folders</Text>
            </TouchableOpacity>

            <View style={styles.breadcrumbPath}>
              <Text style={styles.breadcrumbSlash}>/</Text>
              <Text style={styles.breadcrumbCurrent} numberOfLines={1}>
                {fullName(currentEmployee)}
              </Text>
            </View>
          </View>

          {/* Employee Hero Card */}
          <View style={styles.empVaultCard}>
            <TouchableOpacity
              style={styles.empVaultMain}
              onPress={() =>
                navigation.navigate('EmployeeProfile', {
                  id: currentEmployee.id,
                  person: currentEmployee,
                })
              }
              activeOpacity={0.8}
            >
              <Avatar person={currentEmployee} size={50} />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.nameRow}>
                  <Text style={styles.empVaultName} numberOfLines={1}>
                    {fullName(currentEmployee)}
                  </Text>
                  {!!currentEmployee.employeeCode && (
                    <View style={styles.codeBadge}>
                      <Text style={styles.codeBadgeText}>#{currentEmployee.employeeCode}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.empVaultRole} numberOfLines={1}>
                  {[currentEmployee.designation?.name, currentEmployee.department?.name]
                    .filter(Boolean)
                    .join(' · ') || 'Employee'}
                </Text>
                <Text style={styles.empVaultLocation} numberOfLines={1}>
                  {currentEmployee.branch?.name || currentEmployee.workLocation || 'Head Office'}
                </Text>
              </View>
              <ChevronRight size={16} color="#94A3B8" />
            </TouchableOpacity>

            <View style={styles.empVaultStats}>
              <View style={styles.empVaultStatItem}>
                <Text style={styles.empVaultStatNum}>{totalEmpDocs}</Text>
                <Text style={styles.empVaultStatLabel}>Total Files</Text>
              </View>
              <View style={styles.empVaultStatDivider} />
              <View style={styles.empVaultStatItem}>
                <Text style={styles.empVaultStatNum}>{currentEmpTypes.length - 1}</Text>
                <Text style={styles.empVaultStatLabel}>Categories</Text>
              </View>
              <View style={styles.empVaultStatDivider} />
              <TouchableOpacity
                style={styles.empProfileLinkBtn}
                onPress={() =>
                  navigation.navigate('EmployeeProfile', {
                    id: currentEmployee.id,
                    person: currentEmployee,
                  })
                }
              >
                <ExternalLink size={13} color="#1373E5" />
                <Text style={styles.empProfileLinkText}>Profile</Text>
              </TouchableOpacity>
              <View style={styles.empVaultStatDivider} />
              <TouchableOpacity
                style={styles.empHeroUploadBtn}
                onPress={() =>
                  navigation.navigate('EmployeeEdit', {
                    employeeId: currentEmployee.id,
                    initialTab: 'Documents',
                  })
                }
              >
                <Upload size={13} color="#1373E5" strokeWidth={2.4} />
                <Text style={styles.empHeroUploadText}>Upload</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* In-Folder Search & Filter */}
          <View style={styles.folderSearchRow}>
            <View style={styles.inFolderSearchBox}>
              <Search size={15} color="#94A3B8" strokeWidth={2.2} />
              <TextInput
                style={styles.inFolderSearchInput}
                value={empSearchQuery}
                onChangeText={setEmpSearchQuery}
                placeholder={`Search in ${currentEmployee.firstName}'s files...`}
                placeholderTextColor="#94A3B8"
                autoCorrect={false}
              />
              {empSearchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setEmpSearchQuery('')}>
                  <X size={14} color="#64748B" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* In-Folder Doc Type Filter Chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.typeFilterScroll}
          >
            {currentEmpTypes.map((t) => {
              const count =
                t === 'All'
                  ? totalEmpDocs
                  : (currentEmployee.documents || []).filter(
                      (d: any) => (d.documentType || 'Other') === t
                    ).length;
              const isSelected = empDocTypeFilter === t;
              return (
                <TouchableOpacity
                  key={t}
                  style={[styles.typeChip, isSelected && styles.typeChipActive]}
                  onPress={() => setEmpDocTypeFilter(t)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.typeChipText, isSelected && styles.typeChipTextActive]}>
                    {t} ({count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* File Cards Section */}
          <View style={styles.filesSection}>
            <View style={styles.filesSectionHeader}>
              <View>
                <Text style={styles.filesSectionTitle}>Files ({docs.length})</Text>
                <Text style={styles.filesSectionSubtitle}>Tap file to view or open</Text>
              </View>
              <TouchableOpacity
                style={styles.drilldownUploadBtn}
                onPress={() =>
                  navigation.navigate('EmployeeEdit', {
                    employeeId: currentEmployee.id,
                    initialTab: 'Documents',
                  })
                }
                activeOpacity={0.8}
              >
                <Upload size={13} color="#FFFFFF" strokeWidth={2.4} />
                <Text style={styles.drilldownUploadBtnText}>Upload Doc</Text>
              </TouchableOpacity>
            </View>

            {docs.length === 0 ? (
              <View style={styles.emptyCard}>
                <FileText size={32} color="#CBD5E1" />
                <Text style={styles.emptyCardText}>No documents found matching criteria</Text>
              </View>
            ) : (
              docs.map((d: any) => {
                const typeInfo = getFileTypeInfo(d.fileName, d.documentType);
                const IconComponent = typeInfo.icon;
                const formattedDate = d.createdAt
                  ? new Date(d.createdAt).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })
                  : null;

                return (
                  <View key={d.id} style={styles.fileCard}>
                    <TouchableOpacity
                      style={styles.fileCardMain}
                      onPress={() => Linking.openURL(d.fileUrl)}
                      activeOpacity={0.75}
                    >
                      {/* Color-coded Icon Box */}
                      <View style={[styles.fileIconBox, { backgroundColor: typeInfo.bg }]}>
                        <IconComponent size={20} color={typeInfo.color} strokeWidth={2.2} />
                        <Text style={[styles.fileExtBadge, { color: typeInfo.color }]}>
                          {typeInfo.label}
                        </Text>
                      </View>

                      {/* File Info */}
                      <View style={styles.fileMetaCol}>
                        <Text style={styles.fileNameText} numberOfLines={2}>
                          {d.fileName}
                        </Text>

                        <View style={styles.fileTagsRow}>
                          <View style={styles.docTypeBadge}>
                            <Text style={styles.docTypeBadgeText}>
                              {d.documentType || 'Other'}
                            </Text>
                          </View>
                          {formattedDate && (
                            <Text style={styles.fileDateText}>· {formattedDate}</Text>
                          )}
                        </View>
                      </View>
                    </TouchableOpacity>

                    {/* Action Buttons */}
                    <View style={styles.fileActionsRow}>
                      <TouchableOpacity
                        style={styles.fileActionBtn}
                        onPress={() => Linking.openURL(d.fileUrl)}
                        accessibilityLabel="Open document"
                      >
                        <Eye size={16} color="#1373E5" />
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.fileActionBtn, styles.fileDeleteBtn]}
                        onPress={() => removeDoc(d, currentEmployee)}
                        accessibilityLabel="Delete document"
                      >
                        <Trash2 size={16} color="#DC2626" />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      </AppScreen>
    );
  }

  // -------------------------------------------------------------
  // RENDER 2: ROOT GOOGLE DRIVE FOLDERS VIEW (All Employees)
  // -------------------------------------------------------------
  return (
    <AppScreen
      showBack
      title="Documents"
      subtitle={`${allDocs.length} files · ${employees.length} employees`}
    >
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} size="large" />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
            />
          }
        >
          {/* Top KPI Summary Stats */}
          <View style={styles.kpiRow}>
            <View style={[styles.kpiBox, { backgroundColor: '#EEF2FF' }]}>
              <Text style={[styles.kpiNum, { color: '#4338CA' }]}>{totalFilteredDocs}</Text>
              <Text style={[styles.kpiLabel, { color: '#4338CA' }]}>Documents</Text>
            </View>
            <View style={[styles.kpiBox, { backgroundColor: '#ECFDF5' }]}>
              <Text style={[styles.kpiNum, { color: '#047857' }]}>{filteredFolders.length}</Text>
              <Text style={[styles.kpiLabel, { color: '#047857' }]}>Employees</Text>
            </View>
            <View style={[styles.kpiBox, { backgroundColor: '#FFF7ED' }]}>
              <Text style={[styles.kpiNum, { color: '#C2410C' }]}>
                {new Set(filteredFolders.map((e) => e.department?.name).filter(Boolean)).size}
              </Text>
              <Text style={[styles.kpiLabel, { color: '#C2410C' }]}>Departments</Text>
            </View>
          </View>

          {/* Search Box */}
          <View style={styles.searchBar}>
            <Search size={16} color="#94A3B8" strokeWidth={2.2} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search file, person, #code, email..."
              placeholderTextColor="#94A3B8"
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')}>
                <X size={15} color="#64748B" />
              </TouchableOpacity>
            )}
          </View>

          {/* Filter Bar with Layout Switcher */}
          <View style={styles.filtersBar}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterChipsScroll}
            >
              {/* Department Filter */}
              <TouchableOpacity
                style={[styles.chip, !!dept && styles.chipActive]}
                onPress={() => setPicking('department')}
                activeOpacity={0.75}
              >
                <Building2 size={12} color={dept ? '#FFFFFF' : '#64748B'} />
                <Text style={[styles.chipText, !!dept && styles.chipTextActive]} numberOfLines={1}>
                  {dept || 'Department'}
                </Text>
                <ChevronDown size={12} color={dept ? '#FFFFFF' : '#64748B'} />
              </TouchableOpacity>

              {/* Document Type Filter */}
              <TouchableOpacity
                style={[styles.chip, !!type && styles.chipActive]}
                onPress={() => setPicking('type')}
                activeOpacity={0.75}
              >
                <Filter size={12} color={type ? '#FFFFFF' : '#64748B'} />
                <Text style={[styles.chipText, !!type && styles.chipTextActive]} numberOfLines={1}>
                  {type || 'Doc Type'}
                </Text>
                <ChevronDown size={12} color={type ? '#FFFFFF' : '#64748B'} />
              </TouchableOpacity>

              {/* Sort Order */}
              <TouchableOpacity
                style={styles.chip}
                onPress={() => setPicking('sort')}
                activeOpacity={0.75}
              >
                <ArrowUpDown size={12} color="#64748B" />
                <Text style={styles.chipText} numberOfLines={1}>
                  {sortBy === 'files_desc' ? 'Most Files' : sortBy === 'name_asc' ? 'Name A-Z' : 'Recent'}
                </Text>
                <ChevronDown size={12} color="#64748B" />
              </TouchableOpacity>

              {/* Clear Filters */}
              {!!(dept || type || query) && (
                <TouchableOpacity
                  style={styles.clearBtn}
                  onPress={() => {
                    setDept('');
                    setType('');
                    setQuery('');
                  }}
                  activeOpacity={0.75}
                >
                  <X size={12} color="#B91C1C" />
                  <Text style={styles.clearBtnText}>Reset</Text>
                </TouchableOpacity>
              )}
            </ScrollView>

            {/* Grid vs List View Toggle */}
            <View style={styles.layoutToggle}>
              <TouchableOpacity
                style={[styles.layoutBtn, viewLayout === 'grid' && styles.layoutBtnActive]}
                onPress={() => setViewLayout('grid')}
                accessibilityLabel="Grid View"
              >
                <LayoutGrid
                  size={14}
                  color={viewLayout === 'grid' ? '#1373E5' : '#94A3B8'}
                  strokeWidth={2.4}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.layoutBtn, viewLayout === 'list' && styles.layoutBtnActive]}
                onPress={() => setViewLayout('list')}
                accessibilityLabel="List View"
              >
                <List
                  size={14}
                  color={viewLayout === 'list' ? '#1373E5' : '#94A3B8'}
                  strokeWidth={2.4}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Section Heading with Upload Action */}
          <View style={styles.sectionHeaderRow}>
            <View style={{ gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Folder size={16} color="#1373E5" strokeWidth={2.2} />
                <Text style={styles.sectionTitle}>Employee Vaults</Text>
              </View>
              <Text style={styles.sectionCountText}>
                {filteredFolders.length} folders · tap to open
              </Text>
            </View>

            <TouchableOpacity
              style={styles.rootUploadBtn}
              onPress={() => setPicking('upload')}
              activeOpacity={0.8}
            >
              <Upload size={13} color="#FFFFFF" strokeWidth={2.4} />
              <Text style={styles.rootUploadBtnText}>Upload Doc</Text>
            </TouchableOpacity>
          </View>

          {/* FOLDERS: GRID VIEW (Google Drive 2-Column Cards) */}
          {viewLayout === 'grid' ? (
            <View style={styles.gridContainer}>
              {filteredFolders.map((emp) => {
                const docCount = emp.documents?.length || 0;
                const docCategories = [
                  ...new Set((emp.documents || []).map((d: any) => d.documentType || 'Other')),
                ].slice(0, 2);

                return (
                  <TouchableOpacity
                    key={emp.id}
                    style={styles.gridFolderCard}
                    onPress={() => setSelectedEmpId(emp.id)}
                    activeOpacity={0.8}
                  >
                    {/* Top Folder Tab Stripe with User Avatar */}
                    <View style={styles.gridCardHeader}>
                      <Avatar person={emp} size={38} />
                      <View style={styles.gridDocCountPill}>
                        <FileText size={10} color="#4338CA" strokeWidth={2.4} />
                        <Text style={styles.gridDocCountText}>{docCount}</Text>
                      </View>
                    </View>

                    {/* Employee Info */}
                    <View style={styles.gridCardBody}>
                      <Text style={styles.gridEmpName} numberOfLines={1}>
                        {fullName(emp)}
                      </Text>
                      <Text style={styles.gridEmpRole} numberOfLines={1}>
                        {emp.designation?.name || 'Employee'}
                      </Text>
                      <Text style={styles.gridEmpDept} numberOfLines={1}>
                        {emp.department?.name || 'General'}
                      </Text>
                    </View>

                    {/* Bottom Preview Tags */}
                    <View style={styles.gridCardFooter}>
                      {docCategories.length > 0 ? (
                        <View style={styles.previewTagsRow}>
                          {docCategories.map((cat: any) => (
                            <View key={cat} style={styles.previewTagPill}>
                              <Text style={styles.previewTagText} numberOfLines={1}>
                                {cat}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.noDocsNotice}>Empty vault</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            /* FOLDERS: LIST VIEW (Google Drive Row Folders) */
            <View style={styles.listContainer}>
              {filteredFolders.map((emp) => {
                const docCount = emp.documents?.length || 0;
                return (
                  <TouchableOpacity
                    key={emp.id}
                    style={styles.listFolderCard}
                    onPress={() => setSelectedEmpId(emp.id)}
                    activeOpacity={0.75}
                  >
                    <Avatar person={emp} size={42} />

                    <View style={styles.listCardBody}>
                      <View style={styles.nameRow}>
                        <Text style={styles.listEmpName} numberOfLines={1}>
                          {fullName(emp)}
                        </Text>
                        {!!emp.employeeCode && (
                          <View style={styles.codeBadge}>
                            <Text style={styles.codeBadgeText}>#{emp.employeeCode}</Text>
                          </View>
                        )}
                      </View>

                      <Text style={styles.listEmpRole} numberOfLines={1}>
                        {[emp.designation?.name, emp.department?.name].filter(Boolean).join(' · ')}
                      </Text>
                    </View>

                    <View style={styles.listRightCol}>
                      <View style={styles.listDocBadge}>
                        <FileText size={11} color="#4338CA" strokeWidth={2.4} />
                        <Text style={styles.listDocBadgeText}>{docCount} files</Text>
                      </View>
                      <ChevronRight size={15} color="#CBD5E1" />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {filteredFolders.length === 0 && (
            <View style={styles.emptyCard}>
              <FolderOpen size={36} color="#CBD5E1" />
              <Text style={styles.emptyCardText}>No employee vaults match your filters</Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* FILTER & UPLOAD BOTTOM SHEET MODAL */}
      <Modal visible={!!picking} transparent animationType="slide" onRequestClose={() => setPicking(null)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setPicking(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>
                {picking === 'upload'
                  ? 'Upload for Employee'
                  : picking === 'type'
                  ? 'Select Document Type'
                  : picking === 'sort'
                  ? 'Sort Vaults By'
                  : 'Select Department'}
              </Text>
              <TouchableOpacity onPress={() => setPicking(null)}>
                <X size={20} color="#334155" />
              </TouchableOpacity>
            </View>

            {picking === 'upload' && (
              <View style={[styles.searchBar, { margin: 14 }]}>
                <Search size={16} color="#94A3B8" />
                <TextInput
                  style={styles.searchInput}
                  value={pickQuery}
                  onChangeText={setPickQuery}
                  placeholder="Find employee by name or code..."
                  placeholderTextColor="#94A3B8"
                  autoCorrect={false}
                />
              </View>
            )}

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
              {pickOptions.map((o: any) => {
                const on =
                  (picking === 'department'
                    ? dept
                    : picking === 'type'
                    ? type
                    : picking === 'sort'
                    ? sortBy
                    : null) === o.value;

                return (
                  <TouchableOpacity
                    key={o.value || 'all'}
                    style={styles.optionRow}
                    onPress={() => choose(o.value)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionText, on && styles.optionTextActive]}>
                        {o.label}
                      </Text>
                      {!!o.sub && <Text style={styles.optionSubText}>{o.sub}</Text>}
                    </View>
                    {on && <Check size={18} color="#1373E5" strokeWidth={2.4} />}
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
  scrollContent: {
    padding: 16,
    paddingBottom: 120,
    gap: 14,
  },

  // KPI Header Cards
  kpiRow: {
    flexDirection: 'row',
    gap: 8,
  },
  kpiBox: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.03)',
  },
  kpiNum: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  kpiLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
  },

  // Search Bar
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 44,
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOpacity: 0.03,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    paddingVertical: 0,
  },

  // Filter Bar
  filtersBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  filterChipsScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chipActive: {
    backgroundColor: '#1373E5',
    borderColor: '#1373E5',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FEE2E2',
  },
  clearBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B91C1C',
  },

  // Layout View Mode Toggle
  layoutToggle: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  layoutBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
  },
  layoutBtnActive: {
    backgroundColor: '#FFFFFF',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
      },
    }),
  },

  // Section Header
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  sectionCountText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  rootUploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1373E5',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#1373E5',
        shadowOpacity: 0.25,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  rootUploadBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },

  // Grid Layout (Google Drive 2-Column Folders)
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridFolderCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    gap: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOpacity: 0.04,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 2 },
      },
      android: {
        elevation: 1.5,
      },
    }),
  },
  gridCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  gridDocCountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  gridDocCountText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4338CA',
  },
  gridCardBody: {
    gap: 2,
  },
  gridEmpName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  gridEmpRole: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  gridEmpDept: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94A3B8',
  },
  gridCardFooter: {
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
    paddingTop: 8,
  },
  previewTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  previewTagPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    maxWidth: '100%',
  },
  previewTagText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#475569',
  },
  noDocsNotice: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94A3B8',
    fontStyle: 'italic',
  },

  // List Layout
  listContainer: {
    gap: 8,
  },
  listFolderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOpacity: 0.03,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 1 },
      },
    }),
  },
  listCardBody: {
    flex: 1,
    gap: 3,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  listEmpName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  codeBadge: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  codeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#4338CA',
  },
  listEmpRole: {
    fontSize: 12,
    color: '#64748B',
  },
  listRightCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  listDocBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  listDocBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4338CA',
  },

  // -------------------------------------------------------------
  // DRILLDOWN FOLDER STYLES (Inside Employee's Vault)
  // -------------------------------------------------------------
  breadcrumbBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backToFoldersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  backToFoldersText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1373E5',
  },
  breadcrumbPath: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  breadcrumbSlash: {
    fontSize: 14,
    color: '#CBD5E1',
    fontWeight: '700',
  },
  breadcrumbCurrent: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },

  empVaultCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    gap: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOpacity: 0.05,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  empVaultMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  empVaultName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  empVaultRole: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  empVaultLocation: {
    fontSize: 11,
    color: '#94A3B8',
  },
  empVaultStats: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  empVaultStatItem: {
    flex: 1,
    alignItems: 'center',
  },
  empVaultStatNum: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  empVaultStatLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
  },
  empVaultStatDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E2E8F0',
  },
  empProfileLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
  },
  empProfileLinkText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1373E5',
  },
  empHeroUploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
  },
  empHeroUploadText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1373E5',
  },

  // Folder Search & Filter
  folderSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inFolderSearchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 40,
  },
  inFolderSearchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    paddingVertical: 0,
  },
  typeFilterScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  typeChipActive: {
    backgroundColor: '#1373E5',
    borderColor: '#1373E5',
  },
  typeChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  typeChipTextActive: {
    color: '#FFFFFF',
  },

  // Files Section
  filesSection: {
    gap: 10,
  },
  filesSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  filesSectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  filesSectionSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
  },
  drilldownUploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1373E5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  drilldownUploadBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },

  // File Card
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOpacity: 0.03,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 1 },
      },
    }),
  },
  fileCardMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  fileIconBox: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  fileExtBadge: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  fileMetaCol: {
    flex: 1,
    gap: 4,
  },
  fileNameText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  fileTagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  docTypeBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  docTypeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  fileDateText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94A3B8',
  },
  fileActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  fileActionBtn: {
    padding: 10,
    borderRadius: 8,
  },
  fileDeleteBtn: {
    backgroundColor: '#FEF2F2',
  },

  // General Components
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#1373E5',
  },
  uploadText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  emptyCardText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94A3B8',
    textAlign: 'center',
  },
  empty: {
    textAlign: 'center',
    color: theme.colors.textSecondary,
    marginTop: 30,
    paddingHorizontal: 24,
  },

  // Bottom Sheet Modal
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '75%',
    paddingBottom: 30,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  optionText: {
    fontSize: 15,
    color: '#0F172A',
  },
  optionTextActive: {
    fontWeight: '800',
    color: '#1373E5',
  },
  optionSubText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
});
