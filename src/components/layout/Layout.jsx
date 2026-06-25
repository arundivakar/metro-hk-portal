import React, { useState } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

/**
 * Main app shell layout: sidebar + main content area
 */
export default function Layout({ title, subtitle, actions, onChangeStation, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="app-shell">
      <Sidebar mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
      <div className="main-wrapper">
        <TopBar
          title={title}
          subtitle={subtitle}
          actions={actions}
          onChangeStation={onChangeStation}
          onMenuClick={() => setMobileOpen(true)}
        />
        <main className="main-content animate-fade-in">
          {children}
        </main>
      </div>
    </div>
  );
}
