import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Alert, Platform } from 'react-native';
import { Camera, Image as ImageIcon, FileText, X } from 'lucide-react-native';
import { launchCamera, launchImageLibrary, ImageLibraryOptions, CameraOptions } from 'react-native-image-picker';
import DocumentPicker from 'react-native-document-picker';

interface MediaPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onMediaSelected: (asset: { uri: string; fileName: string; type: string; fileSize?: number }) => void;
  title?: string;
  allowFiles?: boolean;
  maxSizeMB?: number;
}

const MediaPickerModal: React.FC<MediaPickerModalProps> = ({
  visible,
  onClose,
  onMediaSelected,
  title = 'Select Media',
  allowFiles = false,
  maxSizeMB,
}) => {
  const handleMediaSelection = (response: any) => {
    if (response.didCancel) return;
    if (response.errorCode) {
      Alert.alert('Error', response.errorMessage || 'An error occurred while picking media.');
      return;
    }
    
    if (response.assets && response.assets.length > 0) {
      const asset = response.assets[0];
      
      if (maxSizeMB && asset.fileSize) {
        const sizeMB = asset.fileSize / (1024 * 1024);
        if (sizeMB > maxSizeMB) {
          Alert.alert('File too large', `Please select a file smaller than ${maxSizeMB}MB.`);
          return;
        }
      }

      onMediaSelected({
        uri: asset.uri,
        fileName: asset.fileName || 'unknown',
        type: asset.type || 'unknown',
        fileSize: asset.fileSize,
      });
      onClose();
    }
  };

  const handleTakeAction = async () => {
    const options: CameraOptions = {
      mediaType: 'photo',
      quality: 0.8,
      maxWidth: 1200,
      maxHeight: 1200,
    };
    const response = await launchCamera(options);
    handleMediaSelection(response);
  };

  const handleChooseLibrary = async () => {
    const options: ImageLibraryOptions = {
      mediaType: 'photo',
      quality: 0.8,
    };
    const response = await launchImageLibrary(options);
    handleMediaSelection(response);
  };

  const handleChooseFile = async () => {
    try {
      const res = await DocumentPicker.pick({
        type: [DocumentPicker.types.pdf],
      });
      if (res && res.length > 0) {
        const asset = res[0];
        
        if (maxSizeMB && asset.size) {
          const sizeMB = asset.size / (1024 * 1024);
          if (sizeMB > maxSizeMB) {
            Alert.alert('File too large', `Please select a file smaller than ${maxSizeMB}MB.`);
            return;
          }
        }

        onMediaSelected({
          uri: asset.uri,
          fileName: asset.name || 'document.pdf',
          type: asset.type || 'application/pdf',
          fileSize: asset.size || 0,
        });
        onClose();
      }
    } catch (err) {
      if (!DocumentPicker.isCancel(err)) {
        Alert.alert('Error', 'Failed to pick document');
      }
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.bottomSheet}>
          <View style={styles.dragHandle} />
          
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X size={24} color="#64748B" />
            </TouchableOpacity>
          </View>

          <View style={styles.optionsContainer}>
            <TouchableOpacity activeOpacity={0.8} style={styles.optionCard} onPress={handleTakeAction}>
              <View style={[styles.iconContainer, { backgroundColor: '#FFF7ED' }]}>
                <Camera size={22} color="#EA580C" strokeWidth={2.5} />
              </View>
              <View style={styles.optionTextWrap}>
                <Text style={styles.optionTitle}>Take Photo</Text>
                <Text style={styles.optionSubtitle}>Capture a new image using camera</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity activeOpacity={0.8} style={styles.optionCard} onPress={handleChooseLibrary}>
              <View style={[styles.iconContainer, { backgroundColor: '#EFF6FF' }]}>
                <ImageIcon size={22} color="#2563EB" strokeWidth={2.5} />
              </View>
              <View style={styles.optionTextWrap}>
                <Text style={styles.optionTitle}>Choose from Gallery</Text>
                <Text style={styles.optionSubtitle}>Select photos from your device library</Text>
              </View>
            </TouchableOpacity>

            {allowFiles && (
              <TouchableOpacity activeOpacity={0.8} style={styles.optionCard} onPress={handleChooseFile}>
                <View style={[styles.iconContainer, { backgroundColor: '#FAF5FF' }]}>
                  <FileText size={22} color="#9333EA" strokeWidth={2.5} />
                </View>
                <View style={styles.optionTextWrap}>
                  <Text style={styles.optionTitle}>Choose Document / File</Text>
                  <Text style={styles.optionSubtitle}>Browse PDFs, scans, or other files</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  bottomSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#E2E8F0',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionsContainer: {
    gap: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  iconContainer: {
    width: 46,
    height: 46,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  optionTextWrap: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  optionSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500',
  },
});

export default MediaPickerModal;
