// ─── Roles ───────────────────────────────────────────────────────────────────
export const ROLES = {
  HKS: 'HKS',   // House Keeping Supervisor
  HKTL: 'HKTL', // House Keeping Team Lead
  SC: 'SC',     // Station Controller
  ALS: 'ALS',   // Assistant Line Superintendent
};

// ─── Request Status ───────────────────────────────────────────────────────────
export const REQUEST_STATUS = {
  PENDING: 'pending',
  FORWARDED_SC: 'forwarded_sc',
  APPROVED_SC: 'approved_sc',
  FORWARDED_ALS: 'forwarded_als',
  APPROVED_ALS: 'approved_als',
  REJECTED: 'rejected',
  COMPLETED: 'completed',
};

export const REQUEST_STATUS_LABELS = {
  pending: 'Pending',
  forwarded_sc: 'Forwarded to SC',
  approved_sc: 'Approved by SC',
  forwarded_als: 'Forwarded to ALS',
  approved_als: 'Approved by ALS',
  rejected: 'Rejected',
  completed: 'Completed',
};

export const REQUEST_STATUS_COLORS = {
  pending: 'warning',
  forwarded_sc: 'info',
  approved_sc: 'success',
  forwarded_als: 'info',
  approved_als: 'success',
  rejected: 'danger',
  completed: 'neutral',
};

// ─── Asset Lifecycle Stages ───────────────────────────────────────────────────
export const ASSET_STATUS = {
  IN_USE: 'in_use',
  PARTIALLY_DAMAGED: 'partially_damaged',
  DISPOSED: 'disposed',
};

export const ASSET_STATUS_LABELS = {
  in_use: 'In Good Condition (In Use)',
  partially_damaged: 'Partially Damaged (Usable)',
  disposed: 'Disposed (Unusable)',
};

export const ASSET_STATUS_COLORS = {
  in_use: 'success',
  partially_damaged: 'warning',
  disposed: 'danger',
};

// Stage 1 (Not Used) = station_inventory.current_stock

// ─── Request Priority ─────────────────────────────────────────────────────────
export const PRIORITY = {
  NORMAL: 'normal',
  URGENT: 'urgent',
};

// ─── Business Rules ───────────────────────────────────────────────────────────
export const APPROVAL_THRESHOLD = 500; // Rs. per item (unit_rate × quantity)

// ─── Item Categories ──────────────────────────────────────────────────────────
export const CATEGORIES = ['Chemical', 'Consumable'];

// ─── Shifts ───────────────────────────────────────────────────────────────────
export const SHIFTS = ['Morning', 'Afternoon', 'Night'];

// ─── Approval Actions ─────────────────────────────────────────────────────────
export const APPROVAL_ACTIONS = {
  APPROVED: 'approved',
  REJECTED: 'rejected',
  FORWARDED: 'forwarded',
  COMPLETED: 'completed',
};

// ─── Navigation ───────────────────────────────────────────────────────────────
export const NAV_ITEMS = {
  [ROLES.HKS]: [
    { path: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
    { path: '/inventory', label: 'Inventory', icon: 'Package' },
    { path: '/requests', label: 'My Requests', icon: 'ClipboardList' },
    { path: '/assets', label: 'Asset Status', icon: 'Boxes' },
  ],
  [ROLES.HKTL]: [
    { path: '/dashboard', label: 'HKTL Dashboard', icon: 'LayoutDashboard' },
    { path: '/inventory', label: 'All Inventory', icon: 'Package' },
    { path: '/requests', label: 'All Requests', icon: 'ClipboardList' },
    { path: '/approvals', label: 'Approvals', icon: 'CheckSquare' },
  ],
  [ROLES.SC]: [
    { path: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
    { path: '/inventory', label: 'Inventory', icon: 'Package' },
    { path: '/stock-received', label: 'Stock Received', icon: 'PackagePlus' },
    { path: '/stock-movement', label: 'Stock Movement', icon: 'TrendingDown' },
    { path: '/requests', label: 'Requests', icon: 'ClipboardList' },
    { path: '/approvals', label: 'Approvals', icon: 'CheckSquare' },
    { path: '/assets', label: 'Asset Lifecycle', icon: 'Boxes' },
    { path: '/reports', label: 'Reports', icon: 'BarChart2' },
  ],
  [ROLES.ALS]: [
    { path: '/dashboard', label: 'ALS Dashboard', icon: 'LayoutDashboard' },
    { path: '/inventory', label: 'All Inventory', icon: 'Package' },
    { path: '/stock-received', label: 'Stock Received', icon: 'PackagePlus' },
    { path: '/stock-movement', label: 'Consumption Logs', icon: 'TrendingDown' },
    { path: '/monthly-bill', label: 'Monthly Bill', icon: 'ClipboardList' },
    { path: '/requests', label: 'All Requests', icon: 'ClipboardList' },
    { path: '/approvals', label: 'Approvals', icon: 'CheckSquare' },
    { path: '/assets', label: 'Asset Lifecycle', icon: 'Boxes' },
    { path: '/reports', label: 'Reports', icon: 'BarChart2' },
    { path: '/settings', label: 'Data Import', icon: 'Database' },
  ],
};

// ─── ALS Station Groups ───────────────────────────────────────────────────────
export const ALS_GROUPS = {
  'ALL STATIONS': null, // null means no filter
  'ALVA-KLMT': ['ALVA', 'PNCU', 'CPPY', 'AATK', 'MUTT', 'KLMT'],
  'CCUV-JLSD': ['CCUV', 'PDPM', 'EDAP', 'CGPP', 'PARV', 'JLSD'],
  'KALR-KVTR': ['KALR', 'TNHL', 'MGRD', 'MACE', 'ERSH', 'KVTR'],
  'EMKM-TPHT': ['EMKM', 'VYTA', 'TKDM', 'PETT', 'VAKK', 'SNJN', 'TPHT'],
};

// ─── Station Geographical Order (North to South) ──────────────────────────────
export const STATION_ORDER = [
  'ALVA', 'PNCU', 'CPPY', 'AATK', 'MUTT', 'KLMT', 'CCUV', 'PDPM', 'EDAP', 
  'CGPP', 'PARV', 'JLSD', 'KALR', 'TNHL', 'MGRD', 'MACE', 'ERSH', 'KVTR', 
  'EMKM', 'VYTA', 'TKDM', 'PETT', 'VAKK', 'SNJN', 'TPHT'
];
