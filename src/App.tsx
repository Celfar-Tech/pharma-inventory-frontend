import { MantineProvider, Flex, Box } from '@mantine/core';
import { Routes, Route, Outlet } from 'react-router';
import { GoogleOAuthProvider } from '@react-oauth/google';

import { LoginPage } from './components/login';
import Header from './components/header';
import Footer from './components/footer';
import Sidebar from './components/sidebar';
import Dashboard from './components/dashboard';
import AddInventory from './components/addmedicine';
import Inventory from './components/inventory';
import NotFoundPage from './components/notfound';
import Billing from './components/billing';
import Invoices from './components/Invoices';

// 🌟 Ensure your Auth imports are correct based on your file paths
import ProtectedRoute from './services/ProtectedRoute';
import { AuthProvider } from './services/authcontext'; 

// 1. Create a Layout wrapper for your authenticated pages
function AppLayout() {
  return (
    <Flex h="100vh" w="100vw" style={{ overflow: 'hidden' }}>
      <Sidebar />
      <Flex direction="column" style={{ flexGrow: 1, overflow: 'hidden' }}>
        <Header />
        <Box 
          component="main" 
          style={{ 
            flexGrow: 1, 
            overflowY: 'auto', 
            backgroundColor: '#f1f5f9' 
          }}
        >
          {/* 🌟 Outlet acts as a portal. The dashboard or inventory page injects here! */}
          <Box p="xl">
            <Outlet />
          </Box>

          {/* 🎨 Celfar Tech creative footer — placed at the END of the scrollable
              content, so it is no longer pinned to the viewport bottom and can
              be reached by scrolling down the page */}
          <Footer />
        </Box>
      </Flex>
    </Flex>
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
                <Route path="/addmedicine" element={<AddInventory />} />
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