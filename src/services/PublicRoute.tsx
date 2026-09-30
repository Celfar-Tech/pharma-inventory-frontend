import { Navigate, Outlet } from 'react-router';
import { Center, Loader } from '@mantine/core';
import { useAuth } from './useAuth';

/**
 * Where an authenticated user belongs. Shared with `login.tsx` so the
 * post-login navigation and the "already signed in" redirect cannot drift
 * apart if the landing route ever changes.
 */
export const AUTHENTICATED_HOME = '/dashboard';

/**
 * Guest-only guard for public routes such as the login/register screen.
 *
 * The session is an httpOnly cookie shared by every tab in the browser session,
 * so a signed-in user who opens the app in a new tab (or navigates back to `/`)
 * must land on the dashboard rather than be asked to sign in again.
 *
 * `status` starts as `loading` while `AuthProvider` restores the session from
 * the API. Rendering a loader until that resolves is what prevents the login
 * form from flashing on screen before the redirect happens — without it, a
 * logged-in user would briefly see the sign-in page on every hard refresh.
 *
 * Because this guard swaps the whole page for a loader, `status` must only ever
 * mean "the session has not been resolved yet" — never "a login request is in
 * flight" (see the note on `login()` in `authcontext.tsx`). Otherwise submitting
 * the form would unmount it and discard its errors.
 */
const PublicRoute = () => {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  if (status === 'authenticated') {
    return <Navigate to={AUTHENTICATED_HOME} replace />;
  }

  return <Outlet />;
};

export default PublicRoute;
