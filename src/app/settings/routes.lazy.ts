import SettingsPage from './SettingsPage';
import { ReactStateDeclaration } from '@uirouter/react';
import { settingsReady } from './settings';
import GDriveRevisions from '../storage/GDriveRevisions';
import AuditLog from './AuditLog';

export const states: ReactStateDeclaration[] = [
  {
    name: 'settings',
    url: '/settings?gdrive',
    component: SettingsPage,
    resolve: {
      settings: () => settingsReady
    }
  },
  {
    name: 'gdrive-revisions',
    component: GDriveRevisions,
    url: '/settings/gdrive-revisions'
  },
  {
    name: 'audit',
    component: AuditLog,
    url: '/settings/audit'
  }
];
