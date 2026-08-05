export interface Campus {
  id: string;
  code: string;   // e.g. "CEN"
  name: string;   // e.g. "Central Campus"
  icon: string;   // MaterialIcon name
  color: string;
  orgId?: string; // customer org ID — used when creating sales orders
}

export const CAMPUSES: Campus[] = [
  { id: 'c1', code: 'CEN', name: 'Central',  icon: 'account-balance', color: '#2563EB' },
  { id: 'c2', code: 'STD', name: 'Student',  icon: 'school',          color: '#7C3AED' },
  { id: 'c3', code: 'NTH', name: 'North',    icon: 'location-city',   color: '#10B981' },
  { id: 'c4', code: 'EST', name: 'East',     icon: 'explore',         color: '#F59E0B' },
];
