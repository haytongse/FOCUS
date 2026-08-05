import React from 'react';
import { User } from '../models/User';
import { POSProvider } from '../contexts/POSContext';
import POSScreen from '../screens/pos/POSScreen';

interface POSNavigatorProps {
  user: User | null;
  onLogout: () => void;
}

const POSNavigator: React.FC<POSNavigatorProps> = ({ user, onLogout }) => (
  <POSProvider>
    <POSScreen user={user} onLogout={onLogout} />
  </POSProvider>
);

export default POSNavigator;
