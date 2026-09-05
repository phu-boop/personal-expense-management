import React, { createContext, useContext, useMemo, useState } from 'react';

export type ExportQueueItem = {
  id: number;
  fileName: string;
  status: 'processing' | 'done' | 'error';
  step: string;
  progress: number;
};

type ExportQueueContextValue = {
  exportQueue: ExportQueueItem[];
  addExportQueueTask: (fileName: string, step: string, progress: number) => number;
  updateExportQueueTask: (taskId: number, updates: Partial<ExportQueueItem>) => void;
  removeExportQueueTask: (taskId: number) => void;
};

const ExportQueueContext = createContext<ExportQueueContextValue | undefined>(undefined);

export const ExportQueueProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [exportQueue, setExportQueue] = useState<ExportQueueItem[]>([]);

  const addExportQueueTask = (fileName: string, step: string, progress: number) => {
    const taskId = Date.now() + Math.random();
    const task: ExportQueueItem = {
      id: taskId,
      fileName,
      status: 'processing',
      step,
      progress,
    };

    setExportQueue((previous) => [task, ...previous].slice(0, 3));
    return taskId;
  };

  const updateExportQueueTask = (taskId: number, updates: Partial<ExportQueueItem>) => {
    setExportQueue((previous) => previous.map((task) => (task.id === taskId ? { ...task, ...updates } : task)));
  };

  const removeExportQueueTask = (taskId: number) => {
    setExportQueue((previous) => previous.filter((task) => task.id !== taskId));
  };

  const value = useMemo<ExportQueueContextValue>(() => ({
    exportQueue,
    addExportQueueTask,
    updateExportQueueTask,
    removeExportQueueTask,
  }), [exportQueue]);

  return (
    <ExportQueueContext.Provider value={value}>
      {children}
    </ExportQueueContext.Provider>
  );
};

export const useExportQueue = () => {
  const context = useContext(ExportQueueContext);
  if (!context) {
    throw new Error('useExportQueue must be used inside ExportQueueProvider');
  }
  return context;
};
