import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Modal, FlatList, Platform } from 'react-native';
import { ChevronDown, MapPin, Briefcase, Calendar, FileText, X, Lock, CheckCircle2, Building, Users } from 'lucide-react-native';
import OrgChartMini from '../components/OrgChartMini';
import { useAuthStore } from '../../../store/authStore';

interface WorkTabProps {
  profileData: any;
  onFormChange: (data: any) => void;
  masterData: { employees: any[]; departments: any[]; designations: any[]; branches: any[] };
  refreshVersion?: number;
}

const ReadOnlyField = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.inputContainer}>
    <View style={styles.labelRow}>
      <Text style={[styles.label, { marginBottom: 0 }]}>{label}</Text>
      <View style={styles.lockedBadge}>
        <Lock size={11} color="#94A3B8" />
        <Text style={styles.lockedText}>Read only</Text>
      </View>
    </View>
    <View style={styles.readOnlyBox}>
      <Text style={styles.readOnlyText}>{value || '-'}</Text>
    </View>
  </View>
);

const DropdownPicker = ({ 
  label, 
  value, 
  options, 
  onSelect,
  placeholder = 'Select...',
  disabled = false
}: { 
  label: string; 
  value: string | number; 
  options: { label: string; value: any }[]; 
  onSelect: (v: any) => void;
  placeholder?: string;
  disabled?: boolean;
}) => {
  const [modalVisible, setModalVisible] = useState(false);
  const selectedOption = options.find(o => String(o.value) === String(value));

  if (disabled) {
    const displayValue = selectedOption ? selectedOption.label : '-';
    return <ReadOnlyField label={label} value={displayValue === 'Unspecified' ? '-' : displayValue} />;
  }

  return (
    <View style={styles.inputContainer}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity 
        activeOpacity={0.7}
        style={[styles.dropdownButton, selectedOption && styles.dropdownButtonSelected]} 
        onPress={() => setModalVisible(true)}
      >
        <Text style={[styles.dropdownText, (!selectedOption || selectedOption.label === 'Unspecified') && styles.dropdownPlaceholder]}>
          {selectedOption && selectedOption.label !== 'Unspecified' ? selectedOption.label : placeholder}
        </Text>
        <ChevronDown size={18} color={selectedOption && selectedOption.label !== 'Unspecified' ? "#E25E3E" : "#94A3B8"} />
      </TouchableOpacity>
      
      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <TouchableOpacity 
            style={styles.modalDismissArea} 
            activeOpacity={1} 
            onPress={() => setModalVisible(false)} 
          />
          <View style={styles.modalContent}>
            <View style={styles.modalDragHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select {label}</Text>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setModalVisible(false)}>
                <X size={20} color="#64748B" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={options}
              keyExtractor={(item, index) => `${item.value}-${index}`}
              contentContainerStyle={styles.optionsList}
              renderItem={({ item }) => {
                const isSelected = String(value) === String(item.value);
                return (
                  <TouchableOpacity 
                    activeOpacity={0.7}
                    style={[styles.optionItem, isSelected && styles.optionItemSelected]}
                    onPress={() => {
                      onSelect(item.value);
                      setModalVisible(false);
                    }}
                  >
                    <Text style={[styles.optionText, isSelected && styles.selectedOptionText]}>
                      {item.label}
                    </Text>
                    {isSelected && (
                      <CheckCircle2 size={18} color="#E25E3E" strokeWidth={2.5} />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default function WorkTab({ profileData, onFormChange, masterData, refreshVersion }: WorkTabProps) {
  const [formData, setFormData] = useState(profileData || {});
  const lastSyncedVersion = useRef<number | undefined>(undefined);
  const user = useAuthStore((state) => state.user);
  
  const canEditWorkDetails = user?.role === 'SUPERADMIN' || user?.role === 'HR';

  const mapToOptions = (data: any[] = [], labelKey: string, valueKey: string) => {
    return data.map(item => ({ label: item[labelKey] || 'Unnamed', value: item[valueKey] }));
  };

  const daysOfWeek = [
    { key: 'Monday', short: 'Mon' },
    { key: 'Tuesday', short: 'Tue' },
    { key: 'Wednesday', short: 'Wed' },
    { key: 'Thursday', short: 'Thu' },
    { key: 'Friday', short: 'Fri' },
    { key: 'Saturday', short: 'Sat' },
    { key: 'Sunday', short: 'Sun' }
  ];

  const locationOptions = [
    { label: 'Unspecified', value: 'unspecified' },
    { label: 'Work from Home', value: 'home' },
    ...mapToOptions(masterData.branches, 'name', 'id'),
    { label: 'Client / Field Visit', value: 'other' }
  ];

  const formatUsualWorkLocation = (val: any) => {
    if (typeof val === 'object' && val !== null) {
      const formatted = Object.entries(val)
        .filter(([_, loc]) => loc !== 'unspecified' && loc !== null && loc !== '')
        .map(([day, loc]) => {
          const locLabel = locationOptions.find(o => String(o.value) === String(loc))?.label || loc;
          return `${day.charAt(0).toUpperCase() + day.slice(1)}: ${locLabel}`;
        })
        .join('\n');
      return formatted || '-';
    }
    const strVal = String(val || '');
    return strVal.toLowerCase() === 'unspecified' || !strVal ? '-' : strVal;
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  useEffect(() => {
    if (profileData && profileData.id && refreshVersion !== lastSyncedVersion.current) {
      setFormData(profileData);
      lastSyncedVersion.current = refreshVersion;
    }
  }, [profileData, refreshVersion]);

  useEffect(() => {
    onFormChange(formData);
  }, [formData]);

  const updateField = (field: string, value: any) => {
    setFormData((prev: any) => ({ ...prev, [field]: value }));
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false} contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
      
      {/* --- Section 1: Employment Details --- */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={[styles.iconBox, { backgroundColor: '#FFF7ED' }]}>
            <Briefcase size={18} color="#EA580C" />
          </View>
          <View style={styles.headerTitles}>
            <Text style={styles.cardTitle}>JOB & POSITION</Text>
            <Text style={styles.cardSubtitle}>Department, title and reporting hierarchy</Text>
          </View>
        </View>
        
        <ReadOnlyField 
          label="Employee ID" 
          value={formData.employeeCode || formData.employeeId || 'EMP-001'} 
        />

        <DropdownPicker 
          label="Department"
          value={formData.departmentId}
          options={mapToOptions(masterData.departments, 'name', 'id')}
          onSelect={(v) => updateField('departmentId', v)}
          disabled={!canEditWorkDetails}
        />
        
        <DropdownPicker 
          label="Designation"
          value={formData.designationId}
          options={mapToOptions(masterData.designations, 'name', 'id')}
          onSelect={(v) => updateField('designationId', v)}
          disabled={!canEditWorkDetails}
        />
        
        <DropdownPicker 
          label="Reporting Manager"
          value={formData.managerId}
          options={mapToOptions(masterData.employees, 'firstName', 'id')}
          onSelect={(v) => updateField('managerId', v)}
          disabled={!canEditWorkDetails}
        />

        {!canEditWorkDetails ? (
          <ReadOnlyField label="Next Appraisal Date" value={formatDate(formData.nextAppraisalDate)} />
        ) : (
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Next Appraisal Date</Text>
            <View style={styles.inputWrapper}>
              <TextInput 
                style={styles.textInput}
                value={formData.nextAppraisalDate ? formData.nextAppraisalDate.split('T')[0] : ''}
                onChangeText={(v) => updateField('nextAppraisalDate', v)}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#94A3B8"
              />
              <Calendar size={18} color="#94A3B8" />
            </View>
          </View>
        )}
      </View>

      {/* --- Section 2: Work Location --- */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={[styles.iconBox, { backgroundColor: '#EFF6FF' }]}>
            <Building size={18} color="#2563EB" />
          </View>
          <View style={styles.headerTitles}>
            <Text style={styles.cardTitle}>OFFICE LOCATION</Text>
            <Text style={styles.cardSubtitle}>Primary branch and office assignment</Text>
          </View>
        </View>

        <DropdownPicker 
          label="Branch (Work Location)"
          value={formData.branchId}
          options={mapToOptions(masterData.branches, 'name', 'id')}
          onSelect={(v) => updateField('branchId', v)}
          disabled={!canEditWorkDetails}
        />
      </View>

      {/* --- Section 3: Employment Details --- */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={[styles.iconBox, { backgroundColor: '#F0FDF4' }]}>
            <FileText size={18} color="#16A34A" />
          </View>
          <View style={styles.headerTitles}>
            <Text style={styles.cardTitle}>EMPLOYMENT DETAILS</Text>
            <Text style={styles.cardSubtitle}>Contract type and schedule</Text>
          </View>
        </View>

        <DropdownPicker 
          label="Employment Category"
          value={formData.employmentCategory || 'PERMANENT'}
          options={[
            { label: 'Permanent', value: 'PERMANENT' },
            { label: 'Contractor', value: 'CONTRACTOR' },
            { label: 'Trainee / Intern', value: 'TRAINEE' }
          ]}
          onSelect={(v) => updateField('employmentCategory', v)}
          disabled={!canEditWorkDetails}
        />

        {!canEditWorkDetails ? (
          <ReadOnlyField label="Joining Date" value={formatDate(formData.joiningDate)} />
        ) : (
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Joining Date</Text>
            <View style={styles.inputWrapper}>
              <TextInput 
                style={styles.textInput}
                value={formData.joiningDate ? formData.joiningDate.split('T')[0] : ''}
                onChangeText={(v) => updateField('joiningDate', v)}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#94A3B8"
              />
              <Calendar size={18} color="#94A3B8" />
            </View>
          </View>
        )}

        {!canEditWorkDetails ? (
          <ReadOnlyField 
            label="Working Days" 
            value={Array.isArray(formData.workingDays) 
              ? formData.workingDays.join(', ') 
              : (typeof formData.workingDays === 'object' && formData.workingDays !== null 
                  ? JSON.stringify(formData.workingDays) 
                  : String(formData.workingDays || ''))} 
          />
        ) : (
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Working Days</Text>
            <View style={styles.daysGrid}>
              {daysOfWeek.map(day => {
                const currentWorkingDays = Array.isArray(formData.workingDays) ? formData.workingDays : [];
                const isActive = currentWorkingDays.includes(day.key);
                return (
                  <TouchableOpacity
                    key={day.key}
                    activeOpacity={0.7}
                    style={[styles.dayChip, isActive && styles.dayChipActive]}
                    onPress={() => {
                      updateField(
                        'workingDays',
                        isActive ? currentWorkingDays.filter((d: string) => d !== day.key) : [...currentWorkingDays, day.key]
                      );
                    }}
                  >
                    <Text style={[styles.dayText, isActive && styles.dayTextActive]}>{day.short}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
      </View>

      {/* --- Section 4: Weekly Work Pattern --- */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={[styles.iconBox, { backgroundColor: '#F0FDF4' }]}>
            <Calendar size={18} color="#16A34A" />
          </View>
          <View style={styles.headerTitles}>
            <Text style={styles.cardTitle}>WEEKLY WORK PATTERN</Text>
            <Text style={styles.cardSubtitle}>Scheduled daily working locations</Text>
          </View>
        </View>

        <View style={styles.daysGrid}>
          {daysOfWeek.map(({ key, short }) => {
            const dayKey = key.toLowerCase();
            const currentObj = typeof formData.usualWorkLocation === 'object' && formData.usualWorkLocation !== null 
                ? formData.usualWorkLocation 
                : {};
            const currentValue = currentObj[dayKey] || formData[`location_${key}`] || 'unspecified';

            return (
              <DropdownPicker 
                key={key}
                label={key}
                value={currentValue}
                options={locationOptions}
                onSelect={(v) => {
                  const newObj = { ...currentObj, [dayKey]: v };
                  updateField('usualWorkLocation', newObj);
                }}
                disabled={!canEditWorkDetails}
              />
            );
          })}
        </View>
      </View>

      {/* --- Section 5: Notes --- */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={[styles.iconBox, { backgroundColor: '#FAF5FF' }]}>
            <FileText size={18} color="#9333EA" />
          </View>
          <View style={styles.headerTitles}>
            <Text style={styles.cardTitle}>WORK NOTES</Text>
            <Text style={styles.cardSubtitle}>Additional role instructions and remarks</Text>
          </View>
        </View>

        {!canEditWorkDetails ? (
          <ReadOnlyField label="Notes" value={formData.workNotes || formData.notes} />
        ) : (
          <TextInput 
            style={styles.textArea}
            multiline
            numberOfLines={4}
            value={formData.workNotes || formData.notes || ''}
            onChangeText={(v) => updateField('workNotes', v)}
            placeholder="Add any specific work arrangements or remarks here..."
            placeholderTextColor="#94A3B8"
            textAlignVertical="top"
          />
        )}
      </View>
      
      {/* --- Section 6: Organization Tree --- */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={[styles.iconBox, { backgroundColor: '#FFF7ED' }]}>
            <Users size={18} color="#EA580C" />
          </View>
          <View style={styles.headerTitles}>
            <Text style={styles.cardTitle}>TEAM HIERARCHY</Text>
            <Text style={styles.cardSubtitle}>Reporting structure in your organization</Text>
          </View>
        </View>

        <OrgChartMini 
          currentEmployee={profileData || { firstName: 'You', lastName: '' }}
          manager={masterData.employees?.find(e => e.id === formData.managerId) || null}
          directReports={masterData.employees?.filter(e => e.managerId === profileData?.id) || []}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  contentContainer: {
    paddingBottom: 40,
    gap: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitles: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  cardSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94A3B8',
    marginTop: 2,
  },
  inputContainer: {
    marginBottom: 14,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  lockedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  lockedText: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '600',
  },
  readOnlyBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  readOnlyText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '600',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  textInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '500',
  },
  textArea: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 14,
    fontSize: 14,
    color: '#0F172A',
    minHeight: 110,
    fontWeight: '500',
  },
  dropdownButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dropdownButtonSelected: {
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
  },
  dropdownText: {
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '600',
  },
  dropdownPlaceholder: {
    color: '#94A3B8',
    fontWeight: '500',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  dayChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    marginRight: 6,
    marginBottom: 6,
  },
  dayChipActive: {
    backgroundColor: '#E25E3E',
  },
  dayText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  dayTextActive: {
    color: '#FFFFFF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  modalDismissArea: {
    flex: 1,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '75%',
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  modalDragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
    alignSelf: 'center',
    marginTop: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionsList: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  optionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginVertical: 2,
  },
  optionItemSelected: {
    backgroundColor: '#FFF7ED',
  },
  optionText: {
    fontSize: 15,
    color: '#334155',
    fontWeight: '600',
  },
  selectedOptionText: {
    color: '#EA580C',
    fontWeight: '800',
  },
});
