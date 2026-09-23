import { Navigate, Outlet } from 'react-router';
import { Center, Loader } from '@mantine/core';
import { useAuth } from '../services/useAuth';

const ProtectedRoute = () => {
  const { status } = useAuth();

  // The session is restored from an httpOnly cookie, so the first render cannot
  // know yet whether someone is signed in. Waiting here avoids mounting the
  // protected pages (and firing their API calls) before that check resolves,
  // which otherwise produces a burst of `401` responses on every page load.
  if (status === 'loading') {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;