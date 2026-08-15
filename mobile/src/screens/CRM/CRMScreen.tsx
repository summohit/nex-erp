import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function CRMScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>CRM Leads</Text>
      <Text style={styles.subtitle}>Lead management coming soon...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  subtitle: {
    color: '#6B7280',
    marginTop: 8,
  },
});
