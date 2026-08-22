import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { UserCheck, ShieldCheck } from 'lucide-react-native';

interface PersonInfo {
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  designation?: { name: string };
}

interface OrgChartMiniProps {
  manager: PersonInfo | null;
  currentEmployee: PersonInfo;
  directReports: PersonInfo[];
}

const Avatar: React.FC<{ url?: string; initials: string; isYou?: boolean }> = ({ url, initials, isYou }) => (
  <View style={[styles.avatarContainer, isYou && styles.avatarYou]}>
    {url ? (
      <Image source={{ uri: url }} style={styles.avatar} />
    ) : (
      <View style={[styles.avatar, styles.placeholder, isYou && styles.placeholderYou]}>
        <Text style={[styles.initials, isYou && styles.initialsYou]}>{initials}</Text>
      </View>
    )}
  </View>
);

const Node: React.FC<{ person: PersonInfo; isYou?: boolean; label?: string }> = ({ person, isYou, label }) => {
  const initials = `${person.firstName?.charAt(0) || ''}${person.lastName?.charAt(0) || ''}`;
  const name = `${person.firstName || 'Unknown'} ${person.lastName || ''}`.trim();
  const role = person.designation?.name || 'Employee';

  return (
    <View style={[styles.nodeCard, isYou && styles.nodeCardYou]}>
      <Avatar url={person.avatarUrl} initials={initials} isYou={isYou} />
      <View style={styles.nodeInfo}>
        <View style={styles.nameRow}>
          <Text style={[styles.nodeName, isYou && styles.nodeNameYou]} numberOfLines={1}>{name}</Text>
          {isYou ? (
            <View style={styles.youBadge}>
              <Text style={styles.youText}>YOU</Text>
            </View>
          ) : label ? (
            <View style={styles.roleLabelBadge}>
              <Text style={styles.roleLabelText}>{label}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.nodeRole} numberOfLines={1}>{role}</Text>
      </View>
    </View>
  );
};

const OrgChartMini: React.FC<OrgChartMiniProps> = ({ manager, currentEmployee, directReports = [] }) => {
  return (
    <View style={styles.container}>
      <View style={styles.tree}>
        {/* Manager Level */}
        {manager ? (
          <View style={styles.branch}>
            <Node person={manager} label="Manager" />
            <View style={styles.connectorLine} />
          </View>
        ) : null}

        {/* You Level */}
        <View style={styles.branch}>
          <Node person={currentEmployee} isYou />
          {directReports?.length > 0 && <View style={styles.connectorLine} />}
        </View>

        {/* Direct Reports Level */}
        {directReports?.length > 0 && (
          <View style={styles.reportsContainer}>
            {directReports.map((report, index) => (
              <View key={index} style={styles.reportBranch}>
                <View style={styles.horizontalConnector} />
                <Node person={report} label="Report" />
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 6,
  },
  tree: {
    paddingLeft: 4,
  },
  branch: {
    position: 'relative',
    alignItems: 'flex-start',
  },
  connectorLine: {
    width: 2,
    height: 20,
    backgroundColor: '#CBD5E1',
    marginLeft: 28,
    marginVertical: 2,
  },
  reportsContainer: {
    marginLeft: 28,
    borderLeftWidth: 2,
    borderColor: '#CBD5E1',
    paddingLeft: 16,
  },
  reportBranch: {
    position: 'relative',
    marginBottom: 10,
  },
  horizontalConnector: {
    position: 'absolute',
    left: -16,
    top: 24,
    width: 16,
    height: 2,
    backgroundColor: '#CBD5E1',
  },
  nodeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    minWidth: '85%',
  },
  nodeCardYou: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
    borderWidth: 1.5,
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  avatarContainer: {
    padding: 2,
    borderRadius: 22,
    marginRight: 12,
  },
  avatarYou: {
    backgroundColor: '#EA580C',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  placeholder: {
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  placeholderYou: {
    backgroundColor: '#EA580C',
  },
  initials: {
    fontSize: 13,
    fontWeight: '800',
    color: '#64748B',
  },
  initialsYou: {
    color: '#FFFFFF',
  },
  nodeInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  nodeName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    flexShrink: 1,
  },
  nodeNameYou: {
    color: '#9A3412',
    fontWeight: '800',
  },
  youBadge: {
    backgroundColor: '#EA580C',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  youText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  roleLabelBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  roleLabelText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
  },
  nodeRole: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
});

export default OrgChartMini;
