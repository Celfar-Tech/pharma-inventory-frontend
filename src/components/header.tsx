import { Box, Group, Avatar, Text, Menu, UnstyledButton } from '@mantine/core';
import { ChevronDown, LogOut, User, Settings, Bell } from 'lucide-react';
import { useAuth } from '../services/useAuth';
import { useNavigate } from 'react-router';

export default function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // User details come from the auth context (populated by login/profile), not
  // from cookies — the auth cookies are set on the API origin, so they are
  // never visible to `document.cookie` from this app's origin.
  const username = user?.username || 'Not Found';
  const role = user?.role || 'Unknown';

  const handleClearSession = () => {
    logout();            // Triggers complete token destruction
    navigate('/');  // Immediately redirects to the login screen
  };
  return (
    <Box component="header" h={70} px="xl" bg="white" className="app-header">
      {/* Structural scoped styles for clean alignment */}
      <style>{`
        .app-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
          border-bottom: 1px solid var(--mantine-color-gray-2);
        }
        .header-context-zone {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .context-vertical-line {
          width: 1px;
          height: 20px;
          background-color: var(--mantine-color-gray-3);
        }
        .notification-wrapper {
          position: relative;
          color: var(--mantine-color-gray-6);
          display: flex;
          align-items: center;
          padding: 8px;
          border-radius: var(--mantine-radius-xl);
          transition: background-color 0.2s ease;
        }
        .notification-wrapper:hover {
          background-color: var(--mantine-color-gray-1);
        }
        .notification-dot {
          position: absolute;
          top: 6px;
          right: 8px;
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
          border-radius: var(--mantine-radius-xl);
          transition: background-color 0.2s ease;
        }
        .profile-trigger:hover {
          background-color: var(--mantine-color-gray-0);
        }
      `}</style>

      {/* 1. Left Side: High-End Architecture & Scope Tracking */}
      <div className="header-context-zone">
        <Text size="sm" fw={700} c="gray.9" style={{ letterSpacing: '0.5px' }}>
          INVENTORY MANAGEMENT
        </Text>

        <div className="context-vertical-line" />

        <Text size="xs" fw={600} c="blue.6" style={{ letterSpacing: '0.5px', textTransform: 'uppercase' }}>
          Central Hub
        </Text>
      </div>

      {/* 2. Right Side: Standard Notification Actions & Profile Context */}
      <Group gap="lg">
        {/* System Notification Bell */}
        <UnstyledButton className="notification-wrapper">
          <Bell size={20} />
          <Box className="notification-dot" />
        </UnstyledButton>

        {/* Profile Dropdown Menu */}
        <Menu shadow="md" width={200} position="bottom-end" transitionProps={{ transition: 'pop-top-right' }}>
          <Menu.Target>
            <UnstyledButton className="profile-trigger">
              <Avatar color="blue" radius="xl" size="md" variant="light" styles={{ placeholder: { fontWeight: 600 } }}>
                AD
              </Avatar>

              <Box style={{ display: 'block' }}>
                <Text size="sm" fw={600} c="gray.8" style={{ lineHeight: 1 }}>
                  {username}
                </Text>
                <Text size="xs" c="dimmed" mt={3}>
                  {role}
                </Text>
              </Box>

              <ChevronDown size={14} color="var(--mantine-color-gray-5)" />
            </UnstyledButton>
          </Menu.Target>

          <Menu.Dropdown>
            <Menu.Label>Application Settings</Menu.Label>
            <Menu.Item leftSection={<User size={14} />}>My Profile</Menu.Item>
            <Menu.Item leftSection={<Settings size={14} />}>System Settings</Menu.Item>
            <Menu.Divider />
            <Menu.Item color="red" leftSection={<LogOut size={14} />} onClick={handleClearSession}>
              Logout Account
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Box>
  );
}
