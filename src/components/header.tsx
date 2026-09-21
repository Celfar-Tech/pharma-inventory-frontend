import {
  Box,
  Avatar,
  Text,
  Menu,
  UnstyledButton,
  Burger,
  Flex,
} from '@mantine/core';
import { ChevronDown, LogOut, User, Settings, Bell } from 'lucide-react';
import { useAuth } from '../services/useAuth';
import { useNavigate } from 'react-router';

interface HeaderProps {
  /** Whether the mobile navigation drawer is currently open. */
  mobileNavOpened: boolean;
  onBurgerClick: () => void;
}

export default function Header({ mobileNavOpened, onBurgerClick }: HeaderProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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
        }
      `}</style>

      {/* 1. Left Side: burger (mobile) + scope tracking */}
      <div className="header-context-zone">
        <Burger
          opened={mobileNavOpened}
          onClick={onBurgerClick}
          hiddenFrom="md"
          size="sm"
          aria-label="Toggle navigation menu"
        />

        {/* Compact brand shown instead of the long page title on phones */}
        <Text hiddenFrom="sm" size="sm" fw={800} c="gray.9" style={{ whiteSpace: 'nowrap' }}>
          <span style={{ color: 'var(--mantine-color-blue-filled)' }}>Pharma</span>Track
        </Text>

        <Flex visibleFrom="sm" align="center" gap="md" style={{ minWidth: 0 }}>
          <Text size="sm" fw={700} c="gray.9" style={{ letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>
            INVENTORY MANAGEMENT
          </Text>

          <div className="context-vertical-line" />

          <Text
            size="xs"
            fw={600}
            c="blue.6"
            visibleFrom="lg"
            style={{ letterSpacing: '0.5px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}
          >
            Central Hub
          </Text>
        </Flex>
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
