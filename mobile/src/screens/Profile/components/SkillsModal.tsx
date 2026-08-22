import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

interface SkillEntry {
  category: string;
  name: string;
  level: string;
}

interface SkillsModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (skills: SkillEntry[]) => void;
  existingSkills: SkillEntry[];
  editingSkill?: SkillEntry | null;
}

const skillsByCategory: Record<string, string[]> = {
  'Languages': ['French', 'Spanish', 'English', 'German', 'Hindi', 'Arabic', 'Mandarin Chinese', 'Japanese', 'Korean', 'Marathi'],
  'Soft Skills': ['Leadership', 'Communication', 'Problem Solving', 'Time Management', 'Teamwork', 'Negotiation'],
  'Technical Skills': ['Angular', 'React', 'TypeScript', 'Node.js', 'Python', 'PostgreSQL', 'AWS', 'Docker', 'Git'],
  'Management': ['Project Management', 'Agile / Scrum', 'Resource Planning', 'Budgeting', 'Risk Management']
};

const levelsByCategory: Record<string, string[]> = {
  'Languages': ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
  'Soft Skills': ['Beginner', 'Intermediate', 'Advanced', 'Expert'],
  'Technical Skills': ['Beginner', 'Intermediate', 'Advanced', 'Expert'],
  'Management': ['Beginner', 'Intermediate', 'Advanced', 'Expert']
};

const SkillsModal: React.FC<SkillsModalProps> = ({
  visible,
  onClose,
  onSave,
  existingSkills,
  editingSkill = null,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('Languages');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedLevel, setSelectedLevel] = useState<string>('');

  const [draftSkills, setDraftSkills] = useState<SkillEntry[]>([]);
  const insets = useSafeAreaInsets();
  const isEditing = !!editingSkill;

  useEffect(() => {
    if (visible) {
      if (editingSkill) {
        // Exclude the entry being edited up front so Save & Close replaces
        // it instead of adding a duplicate — even if category/name changes.
        setDraftSkills(
          (existingSkills || []).filter(
            (s) => !(s.category === editingSkill.category && s.name === editingSkill.name)
          )
        );
        setSelectedCategory(editingSkill.category);
        setSelectedSkills([editingSkill.name]);
        setSelectedLevel(editingSkill.level);
      } else {
        setDraftSkills(existingSkills || []);
        setSelectedCategory('Languages');
        setSelectedSkills([]);
        setSelectedLevel('');
      }
    }
  }, [visible, existingSkills, editingSkill]);

  const handleCategorySelect = (category: string) => {
    setSelectedCategory(category);
    setSelectedSkills([]);
    setSelectedLevel('');
  };

  const handleSkillToggle = (skill: string) => {
    setSelectedSkills(prev => 
      prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]
    );
  };

  const handleSaveAndNew = () => {
    if (selectedSkills.length === 0 || !selectedLevel) return;
    
    const newSkills = selectedSkills.map(skill => ({
      category: selectedCategory,
      name: skill,
      level: selectedLevel
    }));
    
    // Filter out duplicates in draft
    const updatedDraft = draftSkills.filter(
      ds => !newSkills.some(ns => ns.name === ds.name && ns.category === ds.category)
    );
    
    setDraftSkills([...updatedDraft, ...newSkills]);
    setSelectedSkills([]);
    setSelectedLevel('');
  };

  const handleSaveAndClose = () => {
    if (selectedSkills.length > 0 && selectedLevel) {
      const newSkills = selectedSkills.map(skill => ({
        category: selectedCategory,
        name: skill,
        level: selectedLevel
      }));
      
      const updatedDraft = draftSkills.filter(
        ds => !newSkills.some(ns => ns.name === ds.name && ns.category === ds.category)
      );
      
      onSave([...updatedDraft, ...newSkills]);
    } else {
      onSave(draftSkills);
    }
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{isEditing ? 'Edit Skill' : 'Add Skills'}</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <X size={24} color="#64748B" />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          <Text style={styles.sectionTitle}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
            {Object.keys(skillsByCategory).map(category => (
              <TouchableOpacity
                key={category}
                style={[styles.chip, selectedCategory === category && styles.chipActive]}
                onPress={() => handleCategorySelect(category)}
              >
                <Text style={[styles.chipText, selectedCategory === category && styles.chipTextActive]}>
                  {category}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.sectionTitle}>Skills</Text>
          <View style={styles.skillsGrid}>
            {skillsByCategory[selectedCategory]?.map(skill => {
              const isActive = selectedSkills.includes(skill);
              return (
                <TouchableOpacity
                  key={skill}
                  style={[styles.skillChip, isActive && styles.skillChipActive]}
                  onPress={() => handleSkillToggle(skill)}
                >
                  <Text style={[styles.skillChipText, isActive && styles.skillChipTextActive]}>
                    {skill}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.sectionTitle}>Level</Text>
          <View style={styles.skillsGrid}>
            {levelsByCategory[selectedCategory]?.map(level => {
              const isActive = selectedLevel === level;
              return (
                <TouchableOpacity
                  key={level}
                  style={[styles.levelChip, isActive && styles.levelChipActive]}
                  onPress={() => setSelectedLevel(level)}
                >
                  <Text style={[styles.levelChipText, isActive && styles.levelChipTextActive]}>
                    {level}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <TouchableOpacity style={styles.footerBtnLight} onPress={onClose}>
            <Text style={styles.footerBtnLightText}>Discard</Text>
          </TouchableOpacity>
          <View style={styles.footerRight}>
            {!isEditing && (
              <TouchableOpacity
                style={[styles.footerBtnLight, styles.saveNewBtn]}
                onPress={handleSaveAndNew}
              >
                <Text style={styles.saveNewBtnText}>Save & New</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.footerBtnPrimary} onPress={handleSaveAndClose}>
              <Text style={styles.footerBtnPrimaryText}>{isEditing ? 'Update' : 'Save & Close'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  closeBtn: {
    padding: 4,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 12,
    marginTop: 8,
  },
  categoryScroll: {
    flexDirection: 'row',
    marginBottom: 24,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: '#FFF7ED',
    borderColor: '#EA580C',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  chipTextActive: {
    color: '#EA580C',
    fontWeight: '800',
  },
  skillsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  skillChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  skillChipActive: {
    backgroundColor: '#E25E3E',
    borderColor: '#E25E3E',
  },
  skillChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  skillChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  levelChip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  levelChipActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  levelChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  levelChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  footerRight: {
    flexDirection: 'row',
    gap: 10,
  },
  footerBtnLight: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerBtnLightText: {
    color: '#64748B',
    fontWeight: '600',
    fontSize: 14,
  },
  saveNewBtn: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  saveNewBtnText: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 14,
  },
  footerBtnPrimary: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#E25E3E',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#E25E3E',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  footerBtnPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
});

export default SkillsModal;
