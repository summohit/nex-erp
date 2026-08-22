import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  LayoutAnimation,
  Platform,
  UIManager,
  Modal,
  FlatList,
} from 'react-native';
import {
  User,
  Phone,
  Briefcase,
  MapPin,
  Users,
  BookOpen,
  Heart,
  ChevronDown,
  ChevronUp,
  Calendar,
  Lock,
  X,
  CheckCircle2,
  Search,
} from 'lucide-react-native';
import DateTimePickerModal from 'react-native-modal-datetime-picker';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Static option lists matching the CRM web ──────────────────────────────

const SALUTATIONS = [
  { label: 'Mr.', value: 'Mr' },
  { label: 'Mrs.', value: 'Mrs' },
  { label: 'Ms.', value: 'Ms' },
  { label: 'Dr.', value: 'Dr' },
];

const GENDERS = [
  { label: 'Male', value: 'Male' },
  { label: 'Female', value: 'Female' },
  { label: 'Other', value: 'Other' },
];

const MARITAL_STATUSES = [
  { label: 'Single', value: 'Single' },
  { label: 'Married', value: 'Married' },
  { label: 'Divorced', value: 'Divorced' },
  { label: 'Widowed', value: 'Widowed' },
];

const EDUCATION_LEVELS = [
  { label: 'High School', value: 'High School' },
  { label: 'Diploma', value: 'Diploma' },
  { label: "Bachelor's Degree", value: 'Bachelor' },
  { label: "Master's Degree", value: 'Master' },
  { label: 'Doctorate / PhD', value: 'Doctorate' },
  { label: 'Other', value: 'Other' },
];

const LANGUAGES = [
  { label: 'English', value: 'English' },
  { label: 'Hindi', value: 'Hindi' },
  { label: 'Spanish', value: 'Spanish' },
  { label: 'French', value: 'French' },
  { label: 'German', value: 'German' },
  { label: 'Arabic', value: 'Arabic' },
  { label: 'Chinese', value: 'Chinese' },
  { label: 'Portuguese', value: 'Portuguese' },
  { label: 'Russian', value: 'Russian' },
  { label: 'Japanese', value: 'Japanese' },
  { label: 'Korean', value: 'Korean' },
  { label: 'Italian', value: 'Italian' },
];

const COUNTRIES = [
  'Afghanistan','Albania','Algeria','Argentina','Australia','Austria','Azerbaijan',
  'Bangladesh','Belgium','Brazil','Cambodia','Canada','Chile','China','Colombia',
  'Croatia','Czech Republic','Denmark','Egypt','Ethiopia','Finland','France',
  'Germany','Ghana','Greece','Hungary','India','Indonesia','Iran','Iraq','Ireland',
  'Israel','Italy','Japan','Jordan','Kazakhstan','Kenya','South Korea','Kuwait',
  'Lebanon','Malaysia','Mexico','Morocco','Myanmar','Nepal','Netherlands',
  'New Zealand','Nigeria','Norway','Pakistan','Philippines','Poland','Portugal',
  'Qatar','Romania','Russia','Saudi Arabia','Singapore','South Africa','Spain',
  'Sri Lanka','Sweden','Switzerland','Tanzania','Thailand','Turkey','Uganda',
  'Ukraine','United Arab Emirates','United Kingdom','United States','Vietnam',
  'Zimbabwe',
].map(c => ({ label: c, value: c }));

// ─── DropdownPicker ─────────────────────────────────────────────────────────

interface DropdownPickerProps {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onSelect: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
}

const DropdownPicker: React.FC<DropdownPickerProps> = ({
  label,
  value,
  options,
  onSelect,
  placeholder = 'Select...',
  disabled = false,
  searchable = false,
}) => {
  const [modalVisible, setModalVisible] = useState(false);
  const [query, setQuery] = useState('');

  const selectedOption = options.find(o => o.value === value);

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, query, searchable]);

  const handleOpen = () => {
    if (!disabled) {
      setQuery('');
      setModalVisible(true);
    }
  };

  return (
    <View style={styles.inputContainer}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        activeOpacity={0.7}
        style={[
          styles.dropdownButton,
          selectedOption && styles.dropdownButtonSelected,
          disabled && styles.dropdownDisabled,
        ]}
        onPress={handleOpen}
        disabled={disabled}
      >
        <Text
          style={[
            styles.dropdownText,
            !selectedOption && styles.dropdownPlaceholder,
            disabled && styles.dropdownDisabledText,
          ]}
          numberOfLines={1}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </Text>
        <ChevronDown size={17} color={selectedOption ? '#E25E3E' : '#94A3B8'} />
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalDismissArea} activeOpacity={1} onPress={() => setModalVisible(false)} />
          <View style={styles.modalContent}>
            <View style={styles.modalDragHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select {label}</Text>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setModalVisible(false)}>
                <X size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            {searchable && (
              <View style={styles.searchRow}>
                <Search size={16} color="#94A3B8" />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={`Search ${label.toLowerCase()}...`}
                  placeholderTextColor="#94A3B8"
                  autoFocus
                />
                {query.length > 0 && (
                  <TouchableOpacity onPress={() => setQuery('')}>
                    <X size={15} color="#94A3B8" />
                  </TouchableOpacity>
                )}
              </View>
            )}

            <FlatList
              data={filtered}
              keyExtractor={(item, i) => `${item.value}-${i}`}
              contentContainerStyle={styles.optionsList}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const isSelected = item.value === value;
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
                    {isSelected && <CheckCircle2 size={18} color="#E25E3E" strokeWidth={2.5} />}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No results for "{query}"</Text>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

// ─── CollapsibleSection ─────────────────────────────────────────────────────

const CollapsibleSection = ({
  title,
  subtitle,
  icon: Icon,
  iconBg,
  iconColor,
  children,
  initiallyExpanded = false,
}: any) => {
  const [expanded, setExpanded] = useState(initiallyExpanded);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((v: boolean) => !v);
  };

  return (
    <View style={styles.card}>
      <TouchableOpacity activeOpacity={0.7} style={styles.cardHeader} onPress={toggle}>
        <View style={styles.headerLeft}>
          <View style={[styles.iconBox, { backgroundColor: iconBg || '#FFF7ED' }]}>
            <Icon size={18} color={iconColor || '#EA580C'} />
          </View>
          <View style={styles.headerTitles}>
            <Text style={styles.cardTitle}>{title}</Text>
            {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
          </View>
        </View>
        <View style={styles.chevronBox}>
          {expanded ? <ChevronUp size={18} color="#64748B" /> : <ChevronDown size={18} color="#64748B" />}
        </View>
      </TouchableOpacity>
      {expanded && <View style={styles.cardContent}>{children}</View>}
    </View>
  );
};

// ─── Field (generic text input) ─────────────────────────────────────────────
// Hoisted to module scope: if this were declared inside PersonalTab, every
// keystroke would re-create the function and React would remount the
// TextInput (new component identity), dropping focus and hiding the keyboard.

interface FieldProps {
  label: string;
  field: string;
  value: string;
  isOwner: boolean;
  onChangeValue: (field: string, value: string) => void;
  readOnly?: boolean;
  multiline?: boolean;
  placeholder?: string;
  keyboardType?: any;
}

const Field: React.FC<FieldProps> = ({
  label,
  field,
  value,
  isOwner,
  onChangeValue,
  readOnly = false,
  multiline = false,
  placeholder = '',
  keyboardType = 'default',
}) => (
  <View style={styles.inputContainer}>
    <View style={styles.labelRow}>
      <Text style={styles.label}>{label}</Text>
      {readOnly && (
        <View style={styles.lockedBadge}>
          <Lock size={10} color="#94A3B8" />
          <Text style={styles.lockedText}>Read only</Text>
        </View>
      )}
    </View>
    <TextInput
      style={[
        styles.input,
        (!isOwner || readOnly) && styles.readOnlyInput,
        multiline && styles.textArea,
      ]}
      value={value}
      onChangeText={(v) => onChangeValue(field, v)}
      editable={isOwner && !readOnly}
      multiline={multiline}
      placeholder={placeholder || `Enter ${label.toLowerCase()}`}
      placeholderTextColor="#94A3B8"
      textAlignVertical={multiline ? 'top' : 'center'}
      keyboardType={keyboardType}
    />
  </View>
);

// ─── DateField ───────────────────────────────────────────────────────────────

interface DateFieldProps {
  label: string;
  field: string;
  currentValue: string;
  placeholderText: string;
  isOwner: boolean;
  onPress: (field: string) => void;
}

const DateField: React.FC<DateFieldProps> = ({
  label,
  field,
  currentValue,
  placeholderText,
  isOwner,
  onPress,
}) => (
  <View style={styles.inputContainer}>
    <Text style={styles.label}>{label}</Text>
    <TouchableOpacity
      activeOpacity={0.7}
      style={[styles.datePickerBtn, !isOwner && styles.readOnlyInput]}
      onPress={() => onPress(field)}
      disabled={!isOwner}
    >
      <Text style={[styles.dateText, !currentValue && styles.placeholderText]}>
        {currentValue || placeholderText}
      </Text>
      <Calendar size={18} color="#94A3B8" />
    </TouchableOpacity>
  </View>
);

// ─── PersonalTab ─────────────────────────────────────────────────────────────

interface PersonalTabProps {
  profileData: any;
  onFormChange: (data: any) => void;
  isOwner: boolean;
  refreshVersion?: number;
}

export default function PersonalTab({ profileData, onFormChange, isOwner, refreshVersion }: PersonalTabProps) {
  const [formData, setFormData] = useState(profileData || {});
  const lastSyncedVersion = useRef<number | undefined>(undefined);
  const [isDatePickerVisible, setDatePickerVisibility] = useState(false);
  const [currentDateField, setCurrentDateField] = useState('');

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
    if (isOwner) {
      setFormData((prev: any) => ({ ...prev, [field]: value }));
    }
  };

  const showDatePicker = (field: string) => {
    if (isOwner) {
      setCurrentDateField(field);
      setDatePickerVisibility(true);
    }
  };

  const handleConfirmDate = (date: Date) => {
    updateField(currentDateField, date.toISOString().split('T')[0]);
    setDatePickerVisibility(false);
  };

  const officialEmail =
    formData.email || formData.user?.email || profileData?.user?.email || profileData?.email || '';
  const dobValue = formData.dateOfBirth
    ? typeof formData.dateOfBirth === 'string'
      ? formData.dateOfBirth.split('T')[0]
      : ''
    : formData.dob || '';
  const spouseDobValue = formData.spouseBirthdate
    ? typeof formData.spouseBirthdate === 'string'
      ? formData.spouseBirthdate.split('T')[0]
      : ''
    : formData.spouseDob || '';

  const getVal = (field: string) =>
    formData[field] !== undefined && formData[field] !== null ? String(formData[field]) : '';

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      {/* 1. Contact & Banking */}
      <CollapsibleSection
        title="CONTACT & BANKING"
        subtitle="Primary phone, email, and salary payout account"
        icon={Phone}
        iconBg="#FFF7ED"
        iconColor="#EA580C"
        initiallyExpanded
      >
        <Field label="Official Email" field="email" value={officialEmail} isOwner={isOwner} onChangeValue={updateField} readOnly />
        <Field label="Mobile Phone" field="phone" value={getVal('phone')} isOwner={isOwner} onChangeValue={updateField} placeholder="+1 234 567 890" keyboardType="phone-pad" />
        <Field label="Bank Name" field="bankName" value={getVal('bankName')} isOwner={isOwner} onChangeValue={updateField} placeholder="e.g. Chase, HDFC Bank" />
        <Field label="Account Number" field="bankAccountNumber" value={getVal('bankAccountNumber')} isOwner={isOwner} onChangeValue={updateField} placeholder="XXXX-XXXX-XXXX" keyboardType="numeric" />
        <Field label="IFSC / Routing Code" field="ifscCode" value={getVal('ifscCode')} isOwner={isOwner} onChangeValue={updateField} placeholder="e.g. HDFC0001234" />
      </CollapsibleSection>

      {/* 2. Personal Details */}
      <CollapsibleSection
        title="PERSONAL DETAILS"
        subtitle="Identity, gender, and birth information"
        icon={User}
        iconBg="#EFF6FF"
        iconColor="#2563EB"
      >
        {/* Salutation → dropdown */}
        <DropdownPicker
          label="Salutation"
          value={formData.salutation || ''}
          options={SALUTATIONS}
          onSelect={(v) => updateField('salutation', v)}
          placeholder="Select salutation"
          disabled={!isOwner}
        />

        <Field label="First Name" field="firstName" value={getVal('firstName')} isOwner={isOwner} onChangeValue={updateField} />
        <Field label="Last Name" field="lastName" value={getVal('lastName')} isOwner={isOwner} onChangeValue={updateField} />

        {/* Gender → dropdown */}
        <DropdownPicker
          label="Gender"
          value={formData.gender || ''}
          options={GENDERS}
          onSelect={(v) => updateField('gender', v)}
          placeholder="Select gender"
          disabled={!isOwner}
        />

        <DateField
          label="Date of Birth"
          field="dateOfBirth"
          currentValue={dobValue}
          placeholderText="Select birth date"
          isOwner={isOwner}
          onPress={showDatePicker}
        />

        <Field label="Place of Birth (City)" field="placeOfBirthCity" value={getVal('placeOfBirthCity')} isOwner={isOwner} onChangeValue={updateField} placeholder="e.g. Mumbai, New York" />

        {/* Place of Birth Country → searchable dropdown */}
        <DropdownPicker
          label="Place of Birth (Country)"
          value={formData.placeOfBirthCountry || ''}
          options={COUNTRIES}
          onSelect={(v) => updateField('placeOfBirthCountry', v)}
          placeholder="Select country"
          disabled={!isOwner}
          searchable
        />
      </CollapsibleSection>

      {/* 3. Citizenship & Visa */}
      <CollapsibleSection
        title="CITIZENSHIP & VISA"
        subtitle="Nationality, passport, and work eligibility"
        icon={Briefcase}
        iconBg="#F0FDF4"
        iconColor="#16A34A"
      >
        {/* Nationality → searchable dropdown */}
        <DropdownPicker
          label="Nationality"
          value={formData.nationality || ''}
          options={COUNTRIES}
          onSelect={(v) => updateField('nationality', v)}
          placeholder="Select nationality"
          disabled={!isOwner}
          searchable
        />

        <Field label="National ID Number" field="identificationNo" value={getVal('identificationNo')} isOwner={isOwner} onChangeValue={updateField} placeholder="SSN / Aadhaar / PAN" />
        <Field label="Passport Number" field="passportNo" value={getVal('passportNo')} isOwner={isOwner} onChangeValue={updateField} placeholder="Passport #" />
        <Field label="Visa Type / Number" field="visaNo" value={getVal('visaNo')} isOwner={isOwner} onChangeValue={updateField} placeholder="Visa status" />
        <Field label="Work Permit Number" field="workPermitNo" value={getVal('workPermitNo')} isOwner={isOwner} onChangeValue={updateField} placeholder="Permit #" />
      </CollapsibleSection>

      {/* 4. Residential Address */}
      <CollapsibleSection
        title="RESIDENTIAL ADDRESS"
        subtitle="Home address and daily commute details"
        icon={MapPin}
        iconBg="#FEF2F2"
        iconColor="#DC2626"
      >
        {/* Country → searchable dropdown */}
        <DropdownPicker
          label="Country"
          value={formData.country || ''}
          options={COUNTRIES}
          onSelect={(v) => updateField('country', v)}
          placeholder="Select country"
          disabled={!isOwner}
          searchable
        />

        {/* State — keep as text; cascades are region-specific */}
        <Field label="State / Province" field="state" value={getVal('state')} isOwner={isOwner} onChangeValue={updateField} placeholder="e.g. California, Maharashtra" />
        <Field label="City" field="city" value={getVal('city')} isOwner={isOwner} onChangeValue={updateField} placeholder="e.g. Los Angeles, Pune" />
        <Field label="Postal / Zip Code" field="zipCode" value={getVal('zipCode')} isOwner={isOwner} onChangeValue={updateField} placeholder="e.g. 400001" keyboardType="numeric" />
        <Field label="Commute Distance (km/miles)" field="homeWorkDistanceKm" value={getVal('homeWorkDistanceKm')} isOwner={isOwner} onChangeValue={updateField} placeholder="e.g. 15 km" keyboardType="numeric" />
        <Field label="Full Residential Address" field="address" value={getVal('address')} isOwner={isOwner} onChangeValue={updateField} multiline placeholder="Street, building, area..." />
      </CollapsibleSection>

      {/* 5. Family & Dependents */}
      <CollapsibleSection
        title="FAMILY & DEPENDENTS"
        subtitle="Marital status and spouse/children details"
        icon={Users}
        iconBg="#FAF5FF"
        iconColor="#9333EA"
      >
        {/* Marital Status → dropdown */}
        <DropdownPicker
          label="Marital Status"
          value={formData.maritalStatus || ''}
          options={MARITAL_STATUSES}
          onSelect={(v) => updateField('maritalStatus', v)}
          placeholder="Select marital status"
          disabled={!isOwner}
        />

        <Field label="Spouse Name" field="spouseName" value={getVal('spouseName')} isOwner={isOwner} onChangeValue={updateField} placeholder="Full name" />

        <DateField
          label="Spouse Date of Birth"
          field="spouseBirthdate"
          currentValue={spouseDobValue}
          placeholderText="Select spouse birth date"
          isOwner={isOwner}
          onPress={showDatePicker}
        />

        <Field label="Children Count" field="childrenCount" value={getVal('childrenCount')} isOwner={isOwner} onChangeValue={updateField} placeholder="0" keyboardType="numeric" />
      </CollapsibleSection>

      {/* 6. Academic Background */}
      <CollapsibleSection
        title="ACADEMIC BACKGROUND"
        subtitle="Highest degree and field of study"
        icon={BookOpen}
        iconBg="#FFFBEB"
        iconColor="#D97706"
      >
        {/* Education Level → dropdown */}
        <DropdownPicker
          label="Education Level"
          value={formData.educationLevel || ''}
          options={EDUCATION_LEVELS}
          onSelect={(v) => updateField('educationLevel', v)}
          placeholder="Select education level"
          disabled={!isOwner}
        />

        <Field label="Field of Study" field="fieldOfStudy" value={getVal('fieldOfStudy')} isOwner={isOwner} onChangeValue={updateField} placeholder="Computer Science / Business" />
      </CollapsibleSection>

      {/* 7. Preferences & Bio */}
      <CollapsibleSection
        title="PREFERENCES & BIO"
        subtitle="Slack handle, language, and personal summary"
        icon={Heart}
        iconBg="#ECFDF5"
        iconColor="#059669"
      >
        {/* Preferred Language → dropdown */}
        <DropdownPicker
          label="Preferred Language"
          value={formData.language || ''}
          options={LANGUAGES}
          onSelect={(v) => updateField('language', v)}
          placeholder="Select language"
          disabled={!isOwner}
        />

        <Field label="Slack / Team Handle" field="slackId" value={getVal('slackId')} isOwner={isOwner} onChangeValue={updateField} placeholder="@username" />
        <Field label="About Me / Bio" field="about" value={getVal('about')} isOwner={isOwner} onChangeValue={updateField} multiline placeholder="A short bio..." />
      </CollapsibleSection>

      <DateTimePickerModal
        isVisible={isDatePickerVisible}
        mode="date"
        onConfirm={handleConfirmDate}
        onCancel={() => setDatePickerVisibility(false)}
      />
    </ScrollView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  contentContainer: { paddingBottom: 40, gap: 14 },

  // Card / collapsible
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#FFFFFF',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  iconBox: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  headerTitles: { flex: 1 },
  cardTitle: { fontSize: 14, fontWeight: '800', color: '#0F172A', letterSpacing: 0.4 },
  cardSubtitle: { fontSize: 11, fontWeight: '500', color: '#94A3B8', marginTop: 2 },
  chevronBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
  },

  // Input container & label
  inputContainer: { marginBottom: 12 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  label: { fontSize: 13, fontWeight: '700', color: '#334155', marginBottom: 4 },
  lockedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  lockedText: { fontSize: 10, color: '#94A3B8', fontWeight: '600' },

  // Text input
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
    fontWeight: '500',
  },
  readOnlyInput: { backgroundColor: '#F1F5F9', color: '#64748B', borderColor: '#E2E8F0' },
  textArea: { minHeight: 88, borderRadius: 14, paddingTop: 12 },

  // Date picker
  datePickerBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#F8FAFC',
  },
  dateText: { fontSize: 14, color: '#0F172A', fontWeight: '600' },
  placeholderText: { color: '#94A3B8', fontWeight: '500' },

  // Dropdown button
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
  dropdownButtonSelected: { borderColor: '#CBD5E1', backgroundColor: '#FFFFFF' },
  dropdownDisabled: { backgroundColor: '#F1F5F9', borderColor: '#E2E8F0' },
  dropdownText: { fontSize: 14, color: '#0F172A', fontWeight: '600', flex: 1, marginRight: 8 },
  dropdownPlaceholder: { color: '#94A3B8', fontWeight: '500' },
  dropdownDisabledText: { color: '#64748B' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)', justifyContent: 'flex-end' },
  modalDismissArea: { flex: 1 },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '78%',
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
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Search bar inside modal
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', fontWeight: '500', padding: 0 },

  // Option list
  optionsList: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  optionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginVertical: 2,
  },
  optionItemSelected: { backgroundColor: '#FFF7ED' },
  optionText: { fontSize: 15, color: '#334155', fontWeight: '600' },
  selectedOptionText: { color: '#EA580C', fontWeight: '800' },
  emptyText: { textAlign: 'center', color: '#94A3B8', fontSize: 14, paddingVertical: 24 },
});
