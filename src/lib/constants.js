// ─── Roles ───────────────────────────────────────────────────────────────────
export const ROLES = {
  HKS: 'HKS', // House Keeping Supervisor
  SC: 'SC',   // Station Controller
  ALS: 'ALS', // Assistant Line Supervisor
};

// ─── Request Status ───────────────────────────────────────────────────────────
export const REQUEST_STATUS = {
  PENDING: 'pending',
  APPROVED_SC: 'approved_sc',
  FORWARDED_ALS: 'forwarded_als',
  APPROVED_ALS: 'approved_als',
  REJECTED: 'rejected',
  COMPLETED: 'completed',
};

export const REQUEST_STATUS_LABELS = {
  pending: 'Pending',
  approved_sc: 'Approved by SC',
  forwarded_als: 'Forwarded to ALS',
  approved_als: 'Approved by ALS',
  rejected: 'Rejected',
  completed: 'Completed',
};

export const REQUEST_STATUS_COLORS = {
  pending: 'warning',
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
  [ROLES.SC]: [
    { path: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
    { path: '/inventory', label: 'Inventory', icon: 'Package' },
    { path: '/stock-received', label: 'Stock Received', icon: 'PackagePlus' },
    { path: '/consumption', label: 'Daily Consumption', icon: 'TrendingDown' },
    { path: '/requests', label: 'Requests', icon: 'ClipboardList' },
    { path: '/approvals', label: 'Approvals', icon: 'CheckSquare' },
    { path: '/assets', label: 'Asset Lifecycle', icon: 'Boxes' },
    { path: '/reports', label: 'Reports', icon: 'BarChart2' },
  ],
  [ROLES.ALS]: [
    { path: '/dashboard', label: 'ALS Dashboard', icon: 'LayoutDashboard' },
    { path: '/inventory', label: 'All Inventory', icon: 'Package' },
    { path: '/stock-received', label: 'Stock Received', icon: 'PackagePlus' },
    { path: '/consumption', label: 'Consumption Logs', icon: 'TrendingDown' },
    { path: '/requests', label: 'All Requests', icon: 'ClipboardList' },
    { path: '/approvals', label: 'Approvals', icon: 'CheckSquare' },
    { path: '/assets', label: 'Asset Lifecycle', icon: 'Boxes' },
    { path: '/reports', label: 'Reports', icon: 'BarChart2' },
  ],
};
