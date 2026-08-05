import React from 'react';
import { View, StyleSheet } from 'react-native';
import AppText from '../../components/AppText';

const SearchScreen: React.FC = () => (
  <View style={styles.container}>
    <AppText variant="h4" color="textSecondary">Search</AppText>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F5F0' },
});

export default SearchScreen;
