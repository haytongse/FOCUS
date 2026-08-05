import React, { createContext, useContext } from 'react';

interface DrawerContextType {
  openDrawer: () => void;
}

export const DrawerContext = createContext<DrawerContextType>({
  openDrawer: () => {},
});

export const useDrawer = () => useContext(DrawerContext);
