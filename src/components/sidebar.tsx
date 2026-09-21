import {
  Stack,
  NavLink,
  ActionIcon,
  Tooltip,
  Box,
  Group,
  Title,
  Text,
  Avatar,
  Divider,
  ScrollArea,
  UnstyledButton,
} from '@mantine/core';
import {
  LayoutDashboard,
  Pill,
  Boxes,
  ShoppingCart,
  Receipt,
  ChevronLeft,
  ChevronRight,
  LogOut,
  X,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../services/useAuth';

interface SidebarProps {
  /** Icon-only rail mode (desktop only — the mobile drawer always shows labels). */
  collapsed?: boolean;
  /** Renders the expand/collapse control. Hidden inside the mobile drawer. */
  showCollapseToggle?: boolean;
  onToggleCollapse?: () => void;
  /** Fired after a nav link is activated — used to close the mobile drawer. */
  onNavigate?: () => void;
}

const LINKS_DATA = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { id: 'inventory', label: 'Inventory', icon: Boxes, path: '/inventory' },
  { id: 'billing', label: 'New Billing', icon: ShoppingCart, path: '/billing' },
  { id: 'invoices', label: 'Invoices', icon: Receipt, path: '/invoices' },
];

export default function Sidebar({
  collapsed = false,
  showCollapseToggle = true,
  onToggleCollapse,
  onNavigate,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const username = user?.username || 'Guest';
  const role = user?.role || 'Staff';
  const initials = username.slice(0, 2).toUpperCase();

  const handleLogout = () => {
    onNavigate?.();
    logout();       // Triggers complete token destruction
    navigate('/');  // Immediately redirects to the login screen
  };

  return (
    <Box
      h="100%"
      w="100%"
      p={collapsed ? 'sm' : 'md'}
      bg="white"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        transition: 'padding 0.2s ease',
      }}
    >
      {/* --- Brand block + collapse control ------------------------------- */}
      <Group
        justify={collapsed ? 'center' : 'space-between'}
        align="center"
        wrap="nowrap"
        mb="lg"
        mih={40}
      >
        {!collapsed && (
          <Group gap="xs" wrap="nowrap">
            <Pill size={24} color="blue" style={{ border: 'none', flexShrink: 0 }} />
            <Title order={4} c="dark.4" style={{ whiteSpace: 'nowrap' }}>
              <span style={{ color: 'var(--mantine-color-blue-filled)' }}>Pharma</span>Connect
            </Title>
          </Group>
        )}

        {showCollapseToggle ? (
          <Tooltip label={collapsed ? 'Expand menu' : 'Collapse menu'} position="right" withArrow>
            <ActionIcon
              variant="light"
              color="blue"
              radius="xl"
              size={collapsed ? 'lg' : 'md'}
              onClick={onToggleCollapse}
              aria-label={collapsed ? 'Expand navigation menu' : 'Collapse navigation menu'}
            >
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </ActionIcon>
          </Tooltip>
        ) : (
          <ActionIcon
            variant="subtle"
            color="gray"
            radius="xl"
            size="lg"
            onClick={() => onNavigate?.()}
            aria-label="Close navigation menu"
          >
            <X size={18} />
          </ActionIcon>
        )}
      </Group>

      {/* --- Navigation ---------------------------------------------------- */}
      {/* Scrolls internally so every route stays reachable in landscape. */}
      <ScrollArea
        style={{ flexGrow: 1, minHeight: 0 }}
        scrollbarSize={6}
        offsetScrollbars
        type="hover"
      >
        <Stack gap={4} pr={collapsed ? 0 : 2}>
          {LINKS_DATA.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;

            const navLink = (
              <NavLink
                key={item.id}
                component={Link}
                to={item.path}
                label={item.label}
                leftSection={<Icon size={19} />}
                active={isActive}
                color="blue"
                variant="light"
                // 46px keeps the row a comfortable touch target on phones.
                h={46}
                aria-label={collapsed ? item.label : undefined}
                onClick={onNavigate}
                styles={{
                  root: {
                    borderRadius: 'var(--mantine-radius-md)',
                    fontWeight: isActive ? 600 : 500,
                    transition: 'background-color 0.2s ease',
                    padding: collapsed ? 0 : '0 12px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                  },
                  body: {
                    // Hidden rather than unmounted so the width transition stays smooth.
                    display: collapsed ? 'none' : 'block',
                  },
                }}
              />
            );

            return collapsed ? (
              <Tooltip
                key={item.id}
                label={item.label}
                position="right"
                withArrow
                transitionProps={{ duration: 150 }}
              >
                {/* Wrapper gives the tooltip a stable anchor mid-transition */}
                <Box>{navLink}</Box>
              </Tooltip>
            ) : (
              navLink
            );
          })}
        </Stack>
      </ScrollArea>

      {/* --- Signed-in user ------------------------------------------------ */}
      {/* Mirrors the header profile menu so the account is reachable on phones,
          where the header hides the username behind an avatar only. */}
      <Divider my="sm" />
      <Group gap={collapsed ? 0 : 'xs'} wrap="nowrap" justify={collapsed ? 'center' : 'space-between'}>
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, display: collapsed ? 'none' : undefined }}>
          <Avatar color="blue" radius="xl" size="sm" variant="light">
            {initials}
          </Avatar>
          <Box style={{ minWidth: 0 }}>
            <Text size="sm" fw={600} c="gray.8" truncate style={{ lineHeight: 1.2 }}>
              {username}
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {role}
            </Text>
          </Box>
        </Group>

        <UnstyledButton
          onClick={handleLogout}
          aria-label="Logout account"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            borderRadius: 'var(--mantine-radius-md)',
            flexShrink: 0,
            color: 'var(--mantine-color-red-6)',
          }}
        >
          <LogOut size={18} />
        </UnstyledButton>
      </Group>
    </Box>
  );
}