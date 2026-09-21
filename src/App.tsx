import { useState } from 'react';
import { MantineProvider, Flex, Box, AppShell } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Routes, Route, Outlet } from 'react-router';
import { GoogleOAuthProvider } from '@react-oauth/google';

import { LoginPage } from './components/login';
import Header from './components/header';
import Footer from './components/footer';
import Sidebar from './components/sidebar';
import Dashboard from './components/dashboard';
import Inventory from './components/inventory';
import NotFoundPage from './components/notfound';
import Billing from './components/billing';
import Invoices from './components/Invoices';

// 🌟 Ensure your Auth imports are correct based on your file paths
import ProtectedRoute from './services/ProtectedRoute';
import { AuthProvider } from './services/authcontext'; 

/** Width of the desktop sidebar rail, expanded and icon-only. */
const NAVBAR_EXPANDED = 264;
const NAVBAR_COLLAPSED = 84;

/**
 * Breakpoint at which AppShell swaps the persistent sidebar for the mobile
 * overlay drawer. `md` = 992px = 62em, the same breakpoint used app-wide.
 */
const NAVBAR_BREAKPOINT = 'md';
const MOBILE_NAV_QUERY = '(max-width: 62em)';

// 1. Layout wrapper for the authenticated pages
function AppLayout() {
  // Mobile drawer (burger) state.
  const [mobileNavOpened, setMobileNavOpened] = useState(false);
  // Desktop icon-only rail state.
  const [desktopNavCollapsed, setDesktopNavCollapsed] = useState(false);

  // Below `md` AppShell renders the navbar as an overlay drawer. The sidebar
  // needs to know which mode it is in so it can show full labels inside the
  // drawer even when the desktop rail is collapsed to icons.
  const isMobileNav = useMediaQuery(MOBILE_NAV_QUERY);

  return (
    <AppShell
      // Header shrinks on phones so more of the viewport stays with the content.
      header={{ height: { base: 60, sm: 70 } }}
      navbar={{
        // Never wider than the viewport on small phones; icons-only on desktop
        // when the user collapses the rail.
        width: {
          base: 'min(84vw, 300px)',
          md: desktopNavCollapsed ? NAVBAR_COLLAPSED : NAVBAR_EXPANDED,
        },
        breakpoint: NAVBAR_BREAKPOINT,
        collapsed: { mobile: !mobileNavOpened },
      }}
      padding={0}
      withBorder={false}
      transitionDuration={220}
    >
      <AppShell.Header withBorder>
        <Header
          mobileNavOpened={mobileNavOpened}
          onBurgerClick={() => setMobileNavOpened((opened) => !opened)}
        />
      </AppShell.Header>

      <AppShell.Navbar withBorder>
        <Sidebar
          collapsed={isMobileNav ? false : desktopNavCollapsed}
          onToggleCollapse={() => setDesktopNavCollapsed((collapsed) => !collapsed)}
          onNavigate={() => setMobileNavOpened(false)}
        />
      </AppShell.Navbar>

      <AppShell.Main bg="gray.0" style={{ overflow: 'hidden' }}>
        {/* Column that fills exactly the space left below the header, so the
            document itself never scrolls — only the region below does. */}
        <Flex direction="column" className="app-shell-body">
          <Box className="app-scroll-region">
            {/* 🌟 Outlet acts as a portal. The dashboard or inventory page injects here! */}
            <Box w="100%" maw={1680} mx="auto" p={{ base: 'md', sm: 'lg', md: 'xl' }}>
              <Outlet />
            </Box>
          </Box>

          {/* 🎨 Celfar Tech creative footer — a sibling of the scroll region rather
              than a child of it, so it is pinned to the bottom of the viewport
              while the page content scrolls independently above it. */}
          <Footer />
        </Flex>
      </AppShell.Main>
    </AppShell>
  );
}

export default function App() {
  // No more useLocation() needed! The router handles it all.

  return (
    <AuthProvider>
      <GoogleOAuthProvider clientId="76787419088-nv3nspbilnd3gu6dnai2vposgf25afdd.apps.googleusercontent.com">
        <MantineProvider defaultColorScheme="light">
          
          <Routes>
            {/* 🔓 PUBLIC ROUTE */}
            <Route path="/" element={<LoginPage />} />

            {/* 🔒 PROTECTED ROUTES */}
            <Route element={<ProtectedRoute />}>
              {/* Anything inside AppLayout gets the Sidebar & Header */}
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/billing" element={<Billing />} />
                <Route path="/invoices" element={<Invoices />} />
              </Route>
            </Route>

            {/* 🛑 CATCH-ALL ROUTE */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>

        </MantineProvider>
      </GoogleOAuthProvider>
    </AuthProvider>
  );
}