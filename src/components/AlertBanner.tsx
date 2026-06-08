import React from 'react';
import { AppAlert } from '../types';
import { X, AlertTriangle, Bell } from 'lucide-react';

interface AlertBannerProps {
  alerts: AppAlert[];
  onDismiss: (id: string) => void;
}

export const AlertBanner: React.FC<AlertBannerProps> = ({ alerts, onDismiss }) => {
  const visible = alerts.filter(a => !a.dismissed);
  if (visible.length === 0) return null;

  return (
    <div className="shrink-0 bg-amber-950 border-b border-amber-800 px-4 py-2 space-y-1">
      {visible.map(alert => (
        <div key={alert.id} className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs">
            {alert.type === 'low_balance'
              ? <Bell className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              : <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            }
            <span className="text-amber-200 font-mono">{alert.message}</span>
          </div>
          <button
            onClick={() => onDismiss(alert.id)}
            className="text-amber-600 hover:text-amber-300 ml-4"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
