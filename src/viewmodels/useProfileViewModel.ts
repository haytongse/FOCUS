import { useState, useCallback } from 'react';
import { User } from '../models/User';

interface ProfileViewModel {
  user: User | null;
  loading: boolean;
  editing: boolean;
  editableUser: Partial<User>;
  setEditing: (val: boolean) => void;
  updateField: (field: keyof User, value: string) => void;
  saveProfile: () => Promise<void>;
}

export const useProfileViewModel = (user: User | null): ProfileViewModel => {
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editableUser, setEditableUser] = useState<Partial<User>>(user ?? {});

  const updateField = useCallback((field: keyof User, value: string) => {
    setEditableUser(prev => ({ ...prev, [field]: value }));
  }, []);

  const saveProfile = useCallback(async () => {
    setLoading(true);
    await new Promise<void>(resolve => setTimeout(() => resolve(), 800));
    setLoading(false);
    setEditing(false);
  }, []);

  return {
    user,
    loading,
    editing,
    editableUser,
    setEditing,
    updateField,
    saveProfile,
  };
};
