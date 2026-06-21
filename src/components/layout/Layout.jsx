import React from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

/**
 * Main app shell layout: sidebar + main content area
 */
export default function Layout({ title, subtitle, actions, onChangeStation, children }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-wrapper">
        <TopBar
          title={title}
          subtitle={subtitle}
          actions={actions}
          onChangeStation={onChangeStation}
        />
        <main className="main-content animate-fade-in">
          {children}
        </main>
      </div>
    </div>
  );
}
