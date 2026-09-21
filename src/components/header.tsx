import {
  Box,
  Avatar,
  Text,
  Menu,
  UnstyledButton,
  Burger,
  Flex,
} from '@mantine/core';
import {
  ChevronDown,
  LogOut,
  User,
  Settings,
  Bell,
  LayoutDashboard,
  Boxes,
  ShoppingCart,
  Receipt,
  Pill,
  CalendarDays,
} from 'lucide-react';
import { useAuth } from '../services/useAuth';
import { useLocation, useNavigate } from 'react-router';

interface HeaderProps {
  /** Whether the mobile navigation drawer is currently open. */
  mobileNavOpened: boolean;
  onBurgerClick: () => void;
}

/** Lucide icon shape — same `typeof IconX` pattern used by footer.tsx. */
type HeaderIcon = typeof LayoutDashboard;

interface PageMeta {
  /** Short page name shown beside the icon. */
  title: string;
  /** One-line description of what the screen is for. */
  subtitle: string;
  icon: HeaderIcon;
}

/**
 * Header identity for every protected screen. Keyed by the exact paths
 * declared in App.tsx, so a new route only needs one extra entry here.
 */
const PAGE_META: Record<string, PageMeta> = {
  '/dashboard': {
    title: 'Dashboard',
    subtitle: 'Revenue, stock alerts and today at a glance',
    icon: LayoutDashboard,
  },
  '/inventory': {
    title: 'Inventory',
    subtitle: 'Medicines, batches and expiry tracking',
    icon: Boxes,
  },
  '/billing': {
    title: 'New Billing',
    subtitle: 'Raise a GST invoice and collect payment',
    icon: ShoppingCart,
  },
  '/invoices': {
    title: 'Invoices',
    subtitle: 'Search, reprint and manage past bills',
    icon: Receipt,
  },
};

/** Shown for any path without an explicit entry. */
const FALLBACK_META: PageMeta = {
  title: 'PharmaConnect',
  subtitle: 'Pharmacy inventory & billing',
  icon: Pill,
};

/** Resolves the page identity, tolerating trailing slashes and nested paths. */
function resolvePageMeta(pathname: string): PageMeta {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (PAGE_META[clean]) return PAGE_META[clean];
  const parent = Object.keys(PAGE_META).find((path) => clean.startsWith(`${path}/`));
  return parent ? PAGE_META[parent] : FALLBACK_META;
}

export default function Header({ mobileNavOpened, onBurgerClick }: HeaderProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // "Where am I?" — the header names the current screen, which matters on
  // phones where the sidebar is only a drawer.
  const pageMeta = resolvePageMeta(location.pathname);
  const PageIcon = pageMeta.icon;

  // Evaluated per render on purpose: the header needs the day, not a ticking
  // clock, so no interval is created here.
  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  // User details come from the auth context (populated by login/profile), not
  // from cookies — the auth cookies are set on the API origin, so they are
  // never visible to `document.cookie` from this app's origin.
  const username = user?.username || 'Not Found';
  const role = user?.role || 'Unknown';
  const initials = username.slice(0, 2).toUpperCase();

  const handleClearSession = () => {
    logout();            // Triggers complete token destruction
    navigate('/');  // Immediately redirects to the login screen
  };

  return (
    <Box component="header" className="app-header">
      {/* Structural scoped styles for clean alignment */}
      <style>{`
        .app-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--mantine-spacing-sm);
          height: 100%;
          /* Horizontal padding scales with the viewport so the burger never
             crowds the profile menu on a 320px phone. */
          padding-inline: clamp(12px, 3vw, var(--mantine-spacing-xl));
          background: var(--mantine-color-white);
        }
        .header-context-zone {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }
        .context-vertical-line {
          width: 1px;
          height: 20px;
          background-color: var(--mantine-color-gray-3);
          flex-shrink: 0;
        }
        /* ---- Current-page identity (left zone) --------------------------- */
        .page-identity {
          display: flex;
          align-items: center;
          gap: 10px;
          /* min-width:0 lets the labels truncate instead of pushing the
             profile menu off-screen on narrow phones. */
          min-width: 0;
        }
        .page-identity-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          height: 38px;
          flex-shrink: 0;
          border-radius: 10px;
          color: var(--mantine-color-white);
          background: linear-gradient(
            135deg,
            var(--mantine-color-blue-6) 0%,
            var(--mantine-color-cyan-5) 100%
          );
          box-shadow: 0 4px 10px rgba(28, 126, 214, 0.22);
        }
        .page-identity-text {
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-width: 0;
        }
        /* Pharmacy work is date-driven (billing, expiry), so the header keeps
           the current day visible on wide screens only. */
        .header-date-chip {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
          padding: 6px 10px;
          border-radius: var(--mantine-radius-xl);
          border: 1px solid var(--mantine-color-gray-2);
          background-color: var(--mantine-color-gray-0);
          color: var(--mantine-color-gray-7);
          font-size: var(--mantine-font-size-xs);
          font-weight: 600;
          white-space: nowrap;
        }
        .notification-wrapper {
          position: relative;
          color: var(--mantine-color-gray-6);
          display: flex;
          align-items: center;
          justify-content: center;
          /* 40px keeps the bell a comfortable touch target. */
          width: 40px;
          height: 40px;
          border-radius: var(--mantine-radius-xl);
          transition: background-color 0.2s ease;
          flex-shrink: 0;
        }
        .notification-wrapper:hover {
          background-color: var(--mantine-color-gray-1);
        }
        .notification-dot {
          position: absolute;
          top: 8px;
          right: 9px;
          width: 8px;
          height: 8px;
          border-radius: var(--mantine-radius-xl);
          background-color: var(--mantine-color-red-filled);
        }
        .profile-trigger {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 6px 12px;
          min-height: 44px;
          border-radius: var(--mantine-radius-xl);
          transition: background-color 0.2s ease;
          max-width: 100%;
        }
        .profile-trigger:hover {
          background-color: var(--mantine-color-gray-0);
        }
        @media (max-width: 36em) {
          /* Keep the header readable on the narrowest phones: avatar only. */
          .profile-trigger { padding: 6px; gap: 0; }
          .page-identity { gap: 8px; }
          .page-identity-icon { width: 34px; height: 34px; }
        }
      `}</style>

      {/* 1. Left Side: burger (mobile) + current-page identity */}
      <div className="header-context-zone">
        <Burger
          opened={mobileNavOpened}
          onClick={onBurgerClick}
          hiddenFrom="md"
          size="sm"
          aria-label="Toggle navigation menu"
        />

        {/* Only meaningful while the burger is on screen, so it is hidden
            from `md` up — same breakpoint as the burger itself. */}
        <Box className="context-vertical-line" hiddenFrom="md" aria-hidden="true" />

        {/* Route-aware identity: the header always names the active screen,
            even when the desktop rail is collapsed to icons. */}
        <div className="page-identity">
          <div className="page-identity-icon" aria-hidden="true">
            <PageIcon size={20} />
          </div>

          <div className="page-identity-text">
            <Text size="sm" fw={600} c="gray.9" truncate>
              {pageMeta.title}
            </Text>
            {/* Second line is dropped on the narrowest phones to keep the
                single-line 60px header height. */}
            <Text size="xs" c="dimmed" mt={2} truncate visibleFrom="sm">
              {pageMeta.subtitle}
            </Text>
          </div>
        </div>

        {/* Day context — useful when raising invoices or checking expiries. */}
        <Box className="header-date-chip" visibleFrom="lg">
          <CalendarDays size={14} aria-hidden="true" />
          <span>{todayLabel}</span>
        </Box>
      </div>

      {/* 2. Right Side: notification actions & profile context */}
      {/* Flex (unlike Group) accepts a responsive `gap`, so the two controls
          tighten up on phones without touching the desktop rhythm. */}
      <Flex align="center" gap={{ base: 4, sm: 'md' }} wrap="nowrap">
        {/* System Notification Bell */}
        <UnstyledButton className="notification-wrapper" aria-label="Notifications">
          <Bell size={20} />
          <Box className="notification-dot" />
        </UnstyledButton>

        {/* Profile Dropdown Menu */}
        <Menu shadow="md" width={200} position="bottom-end" transitionProps={{ transition: 'pop-top-right' }}>
          <Menu.Target>
            <UnstyledButton className="profile-trigger" aria-label="Open account menu">
              <Avatar color="blue" radius="xl" size="md" variant="light" styles={{ placeholder: { fontWeight: 600 } }}>
                {initials}
              </Avatar>

              {/* The name/role stack is hidden below `sm` — the avatar alone
                  identifies the account and the menu carries the full details. */}
              <Box visibleFrom="sm" style={{ minWidth: 0 }}>
                <Text size="sm" fw={600} c="gray.8" truncate style={{ lineHeight: 1 }}>
                  {username}
                </Text>
                <Text size="xs" c="dimmed" mt={3} truncate>
                  {role}
                </Text>
              </Box>

              <ChevronDown size={14} color="var(--mantine-color-gray-5)" />
            </UnstyledButton>
          </Menu.Target>

          <Menu.Dropdown>
            <Menu.Label>
              {username} · {role}
            </Menu.Label>
            <Menu.Item leftSection={<User size={14} />}>My Profile</Menu.Item>
            <Menu.Item leftSection={<Settings size={14} />}>System Settings</Menu.Item>
            <Menu.Divider />
            <Menu.Item color="red" leftSection={<LogOut size={14} />} onClick={handleClearSession}>
              Logout Account
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Flex>
    </Box>
  );
}
