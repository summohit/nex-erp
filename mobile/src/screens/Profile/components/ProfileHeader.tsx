import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Camera, ShieldCheck, Mail, Briefcase, Hash } from 'lucide-react-native';
import Svg, { Defs, LinearGradient, Stop, Rect, Circle } from 'react-native-svg';

interface ProfileHeaderProps {
  profileData: any;
  onAvatarPress: () => void;
}

const ProfileHeader: React.FC<ProfileHeaderProps> = ({ profileData, onAvatarPress }) => {
  const firstName = profileData?.firstName || '';
  const lastName = profileData?.lastName || '';
  const name = `${firstName} ${lastName}`.trim() || 'Employee Name';
  const designation = profileData?.designation?.name || profileData?.designation?.title || 'Software Engineer';
  const department = profileData?.department?.name || '';
  const employeeCode = profileData?.employeeCode || profileData?.employeeId || 'EMP';
  const avatarUrl = profileData?.avatarUrl;
  const email = profileData?.email || profileData?.user?.email || '';

  return (
    <View style={styles.container}>
      {/* Dynamic Background with SVG Gradient and soft ambient glow circles */}
      <View style={styles.bannerContainer}>
        <Svg height="100%" width="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="profileGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor="#EA580C" />
              <Stop offset="50%" stopColor="#E25E3E" />
              <Stop offset="100%" stopColor="#C2410C" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#profileGrad)" />
          {/* Subtle Ambient Decorative Circles */}
          <Circle cx="85%" cy="20%" r="90" fill="#FFFFFF" fillOpacity="0.08" />
          <Circle cx="15%" cy="90%" r="70" fill="#FFFFFF" fillOpacity="0.06" />
        </Svg>

        <View style={styles.headerContent}>
          {/* Avatar Section */}
          <View style={styles.avatarWrapper}>
            <TouchableOpacity 
              activeOpacity={0.85} 
              style={styles.avatarTouchable} 
              onPress={onAvatarPress}
            >
              <View style={styles.avatarRing}>
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Text style={styles.avatarInitials}>
                      {firstName.charAt(0) || 'E'}{lastName.charAt(0) || 'P'}
                    </Text>
                  </View>
                )}
              </View>
              {/* Camera Action Badge */}
              <View style={styles.cameraBadge}>
                <Camera size={14} color="#FFFFFF" strokeWidth={2.5} />
              </View>
            </TouchableOpacity>
          </View>

          {/* User Details */}
          <View style={styles.detailsWrapper}>
            <View style={styles.nameRow}>
              <Text style={styles.nameText} numberOfLines={1}>{name}</Text>
              <View style={styles.verifiedDot}>
                <ShieldCheck size={16} color="#FFFFFF" />
              </View>
            </View>

            <Text style={styles.designationText} numberOfLines={1}>
              {designation}{department ? ` • ${department}` : ''}
            </Text>

            {email ? (
              <View style={styles.emailRow}>
                <Mail size={12} color="rgba(255, 255, 255, 0.75)" />
                <Text style={styles.emailText} numberOfLines={1}>{email}</Text>
              </View>
            ) : null}

            {/* Badges Row */}
            <View style={styles.badgesRow}>
              <View style={styles.codeBadge}>
                <Hash size={11} color="#FFFFFF" opacity={0.8} />
                <Text style={styles.codeBadgeText}>{employeeCode}</Text>
              </View>
              <View style={styles.statusBadge}>
                <View style={styles.activeIndicator} />
                <Text style={styles.statusBadgeText}>Active</Text>
              </View>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  bannerContainer: {
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#E25E3E',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 6,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 18,
  },
  avatarWrapper: {
    marginRight: 16,
  },
  avatarTouchable: {
    position: 'relative',
  },
  avatarRing: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#FFFFFF',
    padding: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 40,
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    borderRadius: 40,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    fontSize: 26,
    fontWeight: '800',
    color: '#EA580C',
    letterSpacing: 1,
  },
  cameraBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#0F172A',
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  detailsWrapper: {
    flex: 1,
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  nameText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  verifiedDot: {
    opacity: 0.9,
  },
  designationText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.92)',
    marginBottom: 4,
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },
  emailText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '500',
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  codeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  codeBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  activeIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4ADE80',
  },
  statusBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
});

export default ProfileHeader;
