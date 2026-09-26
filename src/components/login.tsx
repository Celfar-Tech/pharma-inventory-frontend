import { useState, useCallback, type ChangeEvent, useEffect } from 'react';
import {
  Alert,
  TextInput,
  PasswordInput,
  Button,
  Paper,
  Title,
  Text,
  Container,
  Stack,
  SegmentedControl,
  Center,
  Box,
  ThemeIcon,
  Anchor,
  Group,
  Progress,
  Badge,
  SimpleGrid,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import {
  ShieldCheck,
  PackageCheck,
  HeartPulse,
  Activity,
  CheckCircle2,
  XCircle,
  Sparkles,
  Lock,
} from 'lucide-react';
import classes from './login.module.css';
import { useNavigate } from 'react-router';
import { useAuth } from '../services/useAuth';
import { AUTHENTICATED_HOME } from '../services/PublicRoute';

import {
  sendRegistrationOtp,
  verifyRegistrationOtp,
  requestPasswordResetOtp,
  verifyPasswordResetOtp,
  resetPassword,
} from '../services/user';

const ROLE_OPTIONS = [
  { label: 'Pharmacist', value: 'pharmacist' },
  { label: 'Doctor', value: 'doctor' },
  { label: 'Admin', value: 'admin' },
] as const;

type Role = (typeof ROLE_OPTIONS)[number]['value'];
type AuthMode = 'login' | 'register_email' | 'register_otp' | 'register_details' | 'forgot_password' | 'forgot_otp' | 'forgot_reset';

interface FormValues {
  role: Role;
  fullname: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  otp: string;
}

const PharmaIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const SLIDES = [
  {
    icon: ShieldCheck,
    accent: '#38bdf8',
    title: 'Enterprise-grade security',
    text: 'Role-based access, encrypted sessions and full audit trails keep every prescription and record protected.',
    chips: ['256-bit encryption', 'Role-based access'],
  },
  {
    icon: PackageCheck,
    accent: '#34d399',
    title: 'Real-time inventory control',
    text: 'Track stock levels, batches and suppliers live across every location — no more guesswork or stockouts.',
    chips: ['Live sync', 'Batch tracking'],
  },
  {
    icon: HeartPulse,
    accent: '#f472b6',
    title: 'Proactive expiry alerts',
    text: 'Automated expiry and low-stock alerts help you act before it costs you money or patient safety.',
    chips: ['Smart alerts', 'Patient safety'],
  },
  {
    icon: Activity,
    accent: '#fbbf24',
    title: 'Actionable analytics',
    text: 'Revenue, billing and inventory insights in one dashboard, so you can make faster, data-driven decisions.',
    chips: ['Revenue insights', 'Live dashboards'],
  },
] as const;

/**
 * Single source of truth for the password policy: the checklist, the strength
 * meter and the form validation all read from this list so they can never drift
 * apart.
 */
const PASSWORD_POLICY = [
  {
    id: 'length',
    label: 'At least 8 characters',
    requirement: 'at least 8 characters',
    test: (pw: string) => pw.length >= 8,
  },
  {
    id: 'uppercase',
    label: 'One uppercase letter (A–Z)',
    requirement: 'an uppercase letter',
    test: (pw: string) => /[A-Z]/.test(pw),
  },
  {
    id: 'number',
    label: 'One number (0–9)',
    requirement: 'a number',
    test: (pw: string) => /[0-9]/.test(pw),
  },
  {
    id: 'symbol',
    label: 'One special character (!@#$…)',
    requirement: 'a special character',
    test: (pw: string) => /[^A-Za-z0-9]/.test(pw),
  },
] as const;

const formatList = (items: string[]) =>
  items.length <= 1 ? items[0] ?? '' : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** Human-readable reason a password is rejected, or `null` when it satisfies the policy. */
const getPasswordPolicyError = (pw: string) => {
  if (!pw) return 'Password is required';
  const missing = PASSWORD_POLICY.filter((rule) => !rule.test(pw)).map((rule) => rule.requirement);
  return missing.length > 0 ? `Password is too weak — it needs ${formatList(missing)}.` : null;
};

const getPasswordStrength = (pw: string) => {
  if (!pw) return { score: 0, label: '', color: 'gray' };
  const score = PASSWORD_POLICY.reduce((acc, rule) => acc + (rule.test(pw) ? 1 : 0), 0);
  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
  const colors = ['red', 'orange', 'yellow', 'lime', 'teal'];
  return { score, label: labels[score], color: colors[score] };
};

/** Live strength meter plus a per-rule checklist so a weak password is flagged while typing. */
function PasswordFeedback({ password }: { password: string }) {
  if (!password) return null;
  const strength = getPasswordStrength(password);

  return (
    <Box mt={-6}>
      <Group justify="space-between" mb={4}>
        <Text size="xs" c="dimmed">Password strength</Text>
        <Text size="xs" fw={700} c={strength.color}>{strength.label}</Text>
      </Group>
      <Progress value={strength.score * 25} color={strength.color} size="sm" radius="xl" />
      <Stack gap={4} mt={8}>
        {PASSWORD_POLICY.map((rule) => {
          const met = rule.test(password);
          return (
            <Group key={rule.id} gap={6} wrap="nowrap">
              {met ? (
                <CheckCircle2 size={13} color="#0d9488" aria-hidden />
              ) : (
                <XCircle size={13} color="#e11d48" aria-hidden />
              )}
              <Text size="xs" c={met ? 'teal.7' : 'red.6'}>{rule.label}</Text>
            </Group>
          );
        })}
      </Stack>
    </Box>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const { register } = useAuth();
  const [type, setType] = useState<AuthMode>('login');
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  // Form-level error for failures that belong to no single field (e.g. invalid
  // credentials). Field errors stay on `form` via `setFieldError`.
  const [formError, setFormError] = useState('');
  const [countdown, setCountdown] = useState(60);
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setSlideIndex((prev) => (prev + 1) % SLIDES.length);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const form = useForm<FormValues>({
    initialValues: {
      role: 'pharmacist',
      fullname: '',
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
      otp: '',
    },
    validate: {
      email: (val) => (/^\S+@\S+$/.test(val) ? null : 'Invalid email'),
      otp: (val) => (type === 'register_otp' || type === 'forgot_otp') && val.trim().length !== 6 ? 'Please enter the 6-digit code' : null,
      fullname: (val) => type === 'register_details' && val.trim().length < 2 ? 'Full name required' : null,
      username: (val) => type === 'register_details' && val.trim().length < 3 ? 'Username required' : null,
      password: (val) => {
        // Creating or resetting a password must satisfy the full policy.
        if (type === 'register_details' || type === 'forgot_reset') {
          return getPasswordPolicyError(val);
        }
        return type === 'login' && val.length < 6 ? 'Password too short' : null;
      },
      confirmPassword: (val, values) => (type === 'register_details' || type === 'forgot_reset') && val !== values.password ? 'Passwords do not match' : null,
    },
  });

  const handlePasswordChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      form.setFieldValue('password', event.currentTarget.value);
      if ((type === 'register_details' || type === 'forgot_reset') && form.values.confirmPassword.length > 0) {
        form.validateField('confirmPassword');
      }
    },
    [form, type],
  );

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;

    if ((type === 'register_otp' || type === 'forgot_otp') && countdown > 0) {
      intervalId = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
    }

    return () => clearInterval(intervalId);
  }, [type, countdown]);

  const handleResendOtp = useCallback(async () => {
    if (countdown > 0 || loading) return;

    setLoading(true);
    try {
      const requestOtp = type === 'forgot_otp' ? requestPasswordResetOtp : sendRegistrationOtp;
      const data = await requestOtp(form.values.email);
      const payload = data && data.data ? data.data : data;

      if (payload && payload.success === false) {
        throw new Error(payload.error || 'Failed to resend OTP.');
      }

      setOtpToken(payload?.token ?? null);
      setCountdown(60);
    } catch (error: any) {
      form.setFieldError('otp', error.message || 'Failed to resend OTP.');
    } finally {
      setLoading(false);
    }
  }, [countdown, form, loading, type]);

  const handleSubmit = useCallback(
    async (values: FormValues) => {
      setLoading(true);
      setSuccessMsg('');
      setFormError('');

      try {
        if (type === 'login') {
          await login({ email: values.email, password: values.password });
          navigate(AUTHENTICATED_HOME);
        } else if (type === 'register_email') {
          const data = await sendRegistrationOtp(values.email);
          const payload = data && data.data ? data.data : data;

          if (payload && payload.success === false) {
            throw new Error(payload.error || 'Unable to send verification code.');
          }

          setOtpToken(payload.token ?? null);
          setCountdown(60);
          setType('register_otp');
        } else if (type === 'register_otp') {
          const data = await verifyRegistrationOtp(values.email, values.otp, otpToken);
          const payload = data && data.data ? data.data : data;

          if (payload && payload.success === false) {
            throw new Error(payload.error || 'Verification failed.');
          }

          setOtpToken(null);
          setType('register_details');
        } else if (type === 'register_details') {
          await register({
            role: values.role,
            fullname: values.fullname,
            username: values.username,
            email: values.email,
            password: values.password,
          });

          // `register` only creates the account on the server - it does not open a
          // session. Navigating straight to /dashboard would make ProtectedRoute
          // bounce back to the login screen, so sign in with the credentials that
          // were just created and fall back to the login step if that fails.
          try {
            await login({ email: values.email, password: values.password });
            setSuccessMsg('Account created successfully!');
            navigate(AUTHENTICATED_HOME);
          } catch {
            setSuccessMsg('Account created successfully! Please sign in to continue.');
            form.setFieldValue('password', '');
            form.setFieldValue('confirmPassword', '');
            setType('login');
          }
        } else if (type === 'forgot_password') {
          const data = await requestPasswordResetOtp(values.email);
          const payload = data && data.data ? data.data : data;

          if (payload && payload.success === false) {
            throw new Error(payload.error || 'Unable to send reset code.');
          }

          setOtpToken(payload.token ?? null);
          setCountdown(60);
          setType('forgot_otp');
        } else if (type === 'forgot_otp') {
          const data = await verifyPasswordResetOtp(values.email, values.otp, otpToken);
          const payload = data && data.data ? data.data : data;

          if (payload && payload.success === false) {
            throw new Error(payload.error || 'Verification failed.');
          }

          setOtpToken(payload.token ?? otpToken);
          setType('forgot_reset');
        } else if (type === 'forgot_reset') {
          await resetPassword({
            email: values.email,
            password: values.password,
            token: otpToken,
          });

          setOtpToken(null);
          setSuccessMsg('Password updated successfully. You can sign in with your new password.');
          form.reset();
          setType('login');
        }
      } catch (error: any) {
        const errorMessage = error.message || 'Server connection lost. Please try again.';

        // The API returns one generic message for bad credentials on purpose, so
        // it does not reveal whether the email or the password was wrong. That
        // means it cannot be attributed to a single input — show it above the
        // form. (The previous `message.includes('password')` heuristic put
        // "invalid credentials" under the *email* field.)
        if (type === 'register_otp' || type === 'forgot_otp') {
          form.setFieldError('otp', errorMessage);
        } else {
          setFormError(errorMessage);
        }
      } finally {
        setLoading(false);
      }
    },
    [form, login, navigate, otpToken, register, type],
  );

  const toggleAuthMode = useCallback(() => {
    form.reset();
    setOtpToken(null);
    setSuccessMsg('');
    setFormError('');
    setType((prev) => (prev === 'login' ? 'register_email' : 'login'));
  }, [form]);

  const goToForgotPassword = useCallback(() => {
    form.reset();
    setOtpToken(null);
    setSuccessMsg('');
    setFormError('');
    setCountdown(60);
    setType('forgot_password');
  }, [form]);

  const goBackToLogin = useCallback(() => {
    form.reset();
    setOtpToken(null);
    setSuccessMsg('');
    setFormError('');
    setCountdown(60);
    setType('login');
  }, [form]);

  return (
    <Box className={classes.page}>
      {/* ===== LEFT PANEL: BRAND + FEATURE SLIDER ===== */}
      <Box className={classes.leftPanel}>
        <Box className={classes.gridOverlay} />
        <Box className={classes.blobOne} />
        <Box className={classes.blobTwo} />

        <Group justify="space-between" align="flex-start" className={classes.brandRow}>
          <Group gap="xs">
            <ThemeIcon size={44} radius="xl" variant="gradient" gradient={{ from: '#38bdf8', to: '#0ea5e9' }} className={classes.brandIcon}>
              <PharmaIcon />
            </ThemeIcon>
            <Box>
              <Text className={classes.brandName}>PharmaConnect</Text>
              <Text className={classes.brandTag}>Smart Pharmacy Suite</Text>
            </Box>
          </Group>
          <Badge
            className={classes.badge}
            variant="light"
            color="cyan"
            style={{ background: 'rgba(255, 255, 255, 0.1)', color: '#bae6fd', border: '1px solid rgba(255, 255, 255, 0.18)' }}
          >
            <Sparkles size={12} style={{ marginRight: 4 }} />
            Trusted by 500+ pharmacies
          </Badge>
        </Group>

        <Box className={classes.sliderStage}>
          {SLIDES.map((slideItem, index) => {
            const Icon = slideItem.icon;
            return (
              <Box key={slideItem.title} className={`${classes.slide} ${index === slideIndex ? classes.slideActive : ''}`}>
                <ThemeIcon size={64} radius="xl" variant="light" style={{ color: slideItem.accent, backgroundColor: `${slideItem.accent}1f` }}>
                  <Icon size={30} />
                </ThemeIcon>
                <Title order={2} className={classes.slideTitle}>{slideItem.title}</Title>
                <Text className={classes.slideText}>{slideItem.text}</Text>
                <Group gap="xs" mt="sm">
                  {slideItem.chips.map((chip) => (
                    <Badge
                      key={chip}
                      variant="outline"
                      className={classes.chip}
                      style={{ background: 'rgba(255, 255, 255, 0.06)', color: '#e0f2fe', borderColor: 'rgba(255, 255, 255, 0.2)' }}
                    >
                      <CheckCircle2 size={12} style={{ marginRight: 4 }} />
                      {chip}
                    </Badge>
                  ))}
                </Group>
              </Box>
            );
          })}

          <Group gap={8} className={classes.dots}>
            {SLIDES.map((_, index) => (
              <button
                key={index}
                type="button"
                aria-label={`Slide ${index + 1}`}
                className={`${classes.dot} ${index === slideIndex ? classes.dotActive : ''}`}
                onClick={() => setSlideIndex(index)}
              />
            ))}
          </Group>
        </Box>

        <SimpleGrid cols={3} spacing="sm" className={classes.statsRow}>
          <Box className={classes.stat}><Text className={classes.statValue}>99.9%</Text><Text className={classes.statLabel}>Uptime</Text></Box>
          <Box className={classes.stat}><Text className={classes.statValue}>500+</Text><Text className={classes.statLabel}>Pharmacies</Text></Box>
          <Box className={classes.stat}><Text className={classes.statValue}>24/7</Text><Text className={classes.statLabel}>Support</Text></Box>
        </SimpleGrid>
      </Box>

      {/* ===== RIGHT PANEL: AUTH CARD ===== */}
      <Box className={classes.rightPanel}>
        <Container size={440} w="100%" mx="auto">
          <Center mb="xl" style={{ flexDirection: 'column' }}>
            <ThemeIcon size={54} radius="xl" variant="gradient" gradient={{ from: '#0284c7', to: '#0ea5e9' }}>
              <PharmaIcon />
            </ThemeIcon>
            <Title order={2} mt="md" fw={800}>PharmaConnect</Title>
            <Text c="dimmed" size="sm" mt={4}>
              {type === 'login' && 'Secure Portal Gateway'}
              {type === 'register_email' && 'Create Staff Account'}
              {type === 'register_otp' && 'Verify Your Email'}
              {type === 'register_details' && 'Finalize Profile'}
              {type === 'forgot_password' && 'Reset Your Password'}
              {type === 'forgot_otp' && 'Verify Recovery Code'}
              {type === 'forgot_reset' && 'Set a New Password'}
            </Text>
          </Center>

          <Paper withBorder shadow="xl" p={32} radius="lg" className={classes.authCard}>
          {successMsg && <Text c="teal" fw={600} ta="center" mb="md">{successMsg}</Text>}

          {formError && <Alert color="red" variant="light" radius="md" mb="md">{formError}</Alert>}

          <form onSubmit={form.onSubmit(handleSubmit)}>
            <Stack gap="md">

              {/* --- 1. LOGIN UI --- */}
              {type === 'login' && (
                <>
                  <TextInput label="Work Email" placeholder="name@pharmacy.com" required radius="md" {...form.getInputProps('email')} />
                  <PasswordInput label="Password" placeholder="••••••••" required radius="md" {...form.getInputProps('password')} />
                  <Anchor component="button" type="button" onClick={goToForgotPassword} size="xs" fw={500} c="blue.6" ta="right">
                    Forgot password?
                  </Anchor>
                </>
              )}

              {type === 'forgot_password' && (
                <TextInput label="Work Email" placeholder="name@pharmacy.com" required radius="md" {...form.getInputProps('email')} />
              )}

              {type === 'forgot_otp' && (
                <Box ta="center">
                  <Text size="sm" mb="md">
                    We sent a 6-digit reset code to <br />
                    <Text component="span" fw={700}>{form.values.email}</Text>
                  </Text>
                  <TextInput
                    placeholder="Enter 6-digit code"
                    maxLength={6}
                    required
                    radius="md"
                    size="lg"
                    styles={{ input: { textAlign: 'center', letterSpacing: '2px', fontSize: '18px' } }}
                    {...form.getInputProps('otp')}
                  />
                </Box>
              )}

              {type === 'forgot_reset' && (
                <>
                  <TextInput label="Work Email" disabled radius="md" value={form.values.email} description="Verified Email Address" />
                  <PasswordInput
                    label="New Password"
                    placeholder="••••••••"
                    required
                    radius="md"
                    value={form.values.password}
                    onChange={handlePasswordChange}
                    onBlur={() => form.validateField('password')}
                    error={form.errors.password}
                  />
                  <PasswordFeedback password={form.values.password} />
                  <PasswordInput label="Confirm New Password" placeholder="••••••••" required radius="md" {...form.getInputProps('confirmPassword')} />
                </>
              )}

              {/* --- 2. REGISTER EMAIL UI --- */}
              {type === 'register_email' && (
                <TextInput label="Work Email" placeholder="name@pharmacy.com" required radius="md" {...form.getInputProps('email')} />
              )}

              {/* --- 3. REGISTER OTP UI --- */}
              {type === 'register_otp' && (
                <Box ta="center">
                  <Text size="sm" mb="md">We sent a 6-digit verification code to <br /><Text component="span" fw={700}>{form.values.email}</Text></Text>
                  <TextInput placeholder="Enter 6-digit code" maxLength={6} required radius="md" size="lg" styles={{ input: { textAlign: 'center', letterSpacing: '2px', fontSize: '18px' } }} {...form.getInputProps('otp')} />
                </Box>
              )}

              {/* --- 4. REGISTER DETAILS UI --- */}
              {type === 'register_details' && (
                <>
                  <SegmentedControl fullWidth radius="md" data={[...ROLE_OPTIONS]} {...form.getInputProps('role')} />
                  <TextInput label="Work Email" disabled radius="md" value={form.values.email} description="Verified Email Address" />
                  <TextInput label="Full Name" placeholder="Dr. Alex Carter" required radius="md" {...form.getInputProps('fullname')} />
                  <TextInput label="Username" placeholder="alexcarter99" required radius="md" {...form.getInputProps('username')} />
                  <PasswordInput
                    label="Create Password"
                    placeholder="••••••••"
                    required
                    radius="md"
                    value={form.values.password}
                    onChange={handlePasswordChange}
                    onBlur={() => form.validateField('password')}
                    error={form.errors.password}
                  />
                  <PasswordFeedback password={form.values.password} />
                  <PasswordInput label="Confirm Password" placeholder="••••••••" required radius="md" {...form.getInputProps('confirmPassword')} />
                </>
              )}

              {/* --- BUTTONS --- */}
              {type === 'register_otp' || type === 'forgot_otp' ? (
                <Group grow mt="xs">
                  <Button
                    variant="default"
                    radius="md"
                    disabled={countdown > 0 || loading}
                    onClick={handleResendOtp}
                    styles={{
                      label: { fontSize: countdown > 0 ? '12px' : '14px' },
                    }}
                  >
                    {countdown > 0 ? `Regenerate after ${formatTime(countdown)}` : 'Resend OTP'}
                  </Button>

                  <Button type="submit" radius="md" loading={loading}>
                    Verify Code
                  </Button>
                </Group>
              ) : (
                <Button type="submit" fullWidth radius="md" mt="xs" loading={loading}>
                  {type === 'login'
                    ? 'Secure Sign In'
                    : type === 'register_details'
                      ? 'Register Profile'
                      : type === 'forgot_password'
                        ? 'Send Reset Code'
                        : type === 'forgot_reset'
                          ? 'Update Password'
                          : 'Send Verification Code'}
                </Button>
              )}
            </Stack>
          </form>

          {(type === 'login' || type === 'register_email' || type === 'forgot_password') && (
            <Group justify="center" mt="md">
              <Anchor component="button" type="button" onClick={type === 'login' ? toggleAuthMode : goBackToLogin} size="xs" fw={500}>
                {type === 'login'
                  ? "Don't have an account? Register here"
                  : type === 'register_email'
                    ? 'Already have an account? Sign in'
                    : 'Back to login'}
              </Anchor>
            </Group>
          )}

          {(type === 'forgot_otp' || type === 'forgot_reset') && (
            <Group justify="center" mt="md">
              <Anchor component="button" type="button" onClick={goBackToLogin} size="xs" fw={500}>
                Back to login
              </Anchor>
            </Group>
          )}
        </Paper>

        <Group justify="center" mt="lg" gap={6}>
          <Lock size={12} color="#94a3b8" />
          <Text size="xs" c="gray.5">Protected by 256-bit encryption · Your data stays private</Text>
        </Group>
      </Container>
      </Box>
    </Box>
  );
}