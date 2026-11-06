import type { ReactNode } from 'react';
import mark from '../assets/mark.svg';
import type { Filter } from '../model';
import { IconAlert, IconAll, IconCheck, IconClock, IconDown, IconPause } from './Icons';

type SidebarProps = {
  filter: Filter;
  failedCount: number;
  onFilter: (filter: Filter) => void;
};

const ITEMS: { id: Filter; label: string; icon: ReactNode }[] = [
  { id: 'all', label: 'All downloads', icon: <IconAll /> },
  { id: 'downloading', label: 'Downloading', icon: <IconDown /> },
  { id: 'queued', label: 'In line', icon: <IconClock /> },
  { id: 'paused', label: 'Paused', icon: <IconPause /> },
  { id: 'finished', label: 'Finished', icon: <IconCheck /> },
  { id: 'failed', label: 'Failed', icon: <IconAlert /> },
];

export const Sidebar = ({ filter, failedCount, onFilter }: SidebarProps) => (
  <aside className="sidebar">
    <div className="sidebar__brand">
      <img src={mark} width={28} height={28} alt="" />
      <span className="sidebar__name">fetchdeck</span>
    </div>
    <nav className="sidebar__nav" aria-label="Downloads">
      <p className="sidebar__label">Downloads</p>
      {ITEMS.map((item) => (
        <button
          key={item.id}
          className={`nav ${filter === item.id ? 'nav--active' : ''}`}
          aria-current={filter === item.id ? 'page' : undefined}
          onClick={() => onFilter(item.id)}
        >
          {item.icon}
          <span className="nav__label">{item.label}</span>
          {item.id === 'failed' && failedCount > 0 && <span className="count">{failedCount}</span>}
        </button>
      ))}
    </nav>
  </aside>
);
