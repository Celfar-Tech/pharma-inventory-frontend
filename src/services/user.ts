// User authentication and account management API calls
import { API_BASE_URL, getHeaders, toApiError } from './apiClient';

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  role: string;
  first_name: string | null;
  last_name: string | null;
  phone_number: string | null;
  license_number: string | null;
  status: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  role: string;
  fullname: string;
  username: string;
  email: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  user?: UserProfile;
  error?: string;
  message?: string;
}

export const sendRegistrationOtp = async (email: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/user/send-otp`, {
      method: "POST",
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify({ email }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Failed to send OTP");
    return data;
  } catch (error) {
    throw toApiError(error, 'Failed to send OTP');
  }
};

export const verifyRegistrationOtp = async (email: string, otp: string, token: string | null) => {
  try {
    const response = await fetch(`${API_BASE_URL}/user/verify-otp`, {
      method: 'POST',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify({
        email,
        otp,
        token
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to send OTP');
    return data;
  } catch (error) {
    throw toApiError(error, 'Failed to verify registration OTP');
  }
};

export const requestPasswordResetOtp = async (email: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/user/forgot-password/request-otp`, {
      method: 'POST',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify({ email }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to send password reset OTP');
    return data;
  } catch (error) {
    throw toApiError(error, 'Failed to request password reset OTP');
  }
};

export const verifyPasswordResetOtp = async (email: string, otp: string, token: string | null) => {
  try {
    const response = await fetch(`${API_BASE_URL}/user/forgot-password/verify-otp`, {
      method: 'POST',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify({ email, otp, token }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to verify OTP');
    return data;
  } catch (error) {
    throw toApiError(error, 'Failed to verify password reset OTP');
  }
};

export const resetPassword = async ({
  email,
  password,
  token,
}: {
  email: string;
  password: string;
  token: string | null;
}) => {
  try {
    const response = await fetch(`${API_BASE_URL}/user/forgot-password/reset`, {
      method: 'POST',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify({ email, password, token }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to reset password');
    return data;
  } catch (error) {
    throw toApiError(error, 'Failed to reset password');
  }
};

export const logoutUser = async (): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await fetch(`${API_BASE_URL}/user/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // Sends cookie to server so server can clear it
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || 'Logout failed');
    }
    return body;
  } catch (error) {
    throw toApiError(error, 'Logout failed');
  }
};

// Step 3 of Registration: Create the actual account
export const finalizeRegistration = async (userData: any) => {
  try {
    const response = await fetch(`${API_BASE_URL}/user/register`, {
      method: "POST",
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify(userData),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Registration failed");
    return data;
  } catch (error) {
    throw toApiError(error, 'Registration failed');
  }
};

export const getProfile = async (): Promise<UserProfile> => {
  try {
    const response = await fetch(`${API_BASE_URL}/user/profile`, {
      method: 'GET',
      headers: getHeaders(),
      credentials: 'include',
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to load profile');
    return data.user as UserProfile;
  } catch (error) {
    throw toApiError(error, 'Failed to load profile');
  }
};

export const loginUser = async (data: LoginPayload): Promise<AuthResponse> => {
  try {
    const response = await fetch(`${API_BASE_URL}/user/login`, {
      method: 'POST',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify(data),
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || 'Login failed');
    }
    return body;
  } catch (error) {
    throw toApiError(error, 'Login failed');
  }
};
