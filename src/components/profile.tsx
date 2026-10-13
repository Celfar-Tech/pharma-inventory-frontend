import { useEffect, useState } from 'react';
import {
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Collapse,
  Group,
  Loader,
  PasswordInput,
  Progress,
  RingProgress,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import '@mantine/dates/styles.css';
import { DatePickerInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import {
  ArrowRight,
  AtSign,
  BriefcaseMedical,
  Building2,
  CalendarDays,
  ClipboardList,
  FileText,
  KeyRound,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { IconAlertCircle, IconCircleCheck, IconCircleX } from '@tabler/icons-react';
import { Link } from 'react-router';
import { useAuth } from '../services/useAuth';
import { getUserDetails, updateUserDetails, type UpdateUserDetailsPayload } from '../services/user';
import { PASSWORD_POLICY, getPasswordPolicyError, getPasswordStrength } from '../utils/passwordPolicy';
import styles from './profile.module.css';

/** Gender values accepted by the API (it expects the lowercase form). */
const GENDER_OPTIONS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
  // Mirrors the backend allowlist so a stored value always has a matching label.
  { value: 'prefer not to say', label: 'Prefer not to say' },
];

/** Normalises a stored gender so the Select can match it against its options. */
const normalizeGender = (value?: string | null) => (value ?? '').trim().toLowerCase();

/**
 * Select options for the gender field.
 *
 * An unrecognised stored value is appended verbatim: without it the Select
 * would render empty and the next save would silently blank a field the
 * database already holds.
 */
const buildGenderOptions = (current?: string | null) => {
  const normalized = normalizeGender(current);
  if (!normalized || GENDER_OPTIONS.some((option) => option.value === normalized)) {
    return GENDER_OPTIONS;
  }
  return [...GENDER_OPTIONS, { value: normalized, label: (current ?? '').trim() }];
};

/**
 * Normalises any stored timestamp to a plain `YYYY-MM-DD` date, which is the
 * format both the `GET /user/get-user-details` response and the update payload use.
 *
 * `new Date(value).toISOString()` is deliberately avoided: it shifts a
 * local-midnight date back one day in +offset timezones such as IST.
 *
 * Postgres `DATE` columns are serialised by the API as local-midnight instants,
 * so the 12th in IST arrives as `1990-05-11T18:30:00.000Z`. Slicing that string
 * would show the 11th, hence the two cases below:
 *  - exactly midnight UTC: the instant already encodes the calendar date;
 *  - otherwise the offset came from the server's time zone, so the components
 *    are read back in the viewer's zone.
 */
const toIsoDateOnly = (value?: string | null) => {
  if (!value) return null;

  const text = value.trim();
  const match = /^\d{4}-\d{2}-\d{2}/.exec(text);
  if (!match) return null;

  // A bare `YYYY-MM-DD` is already timezone-free — return it untouched.
  if (match[0].length === text.length) return match[0];

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return match[0];

  const pad = (part: number) => String(part).padStart(2, '0');
  const atUtcMidnight =
    parsed.getUTCHours() === 0 &&
    parsed.getUTCMinutes() === 0 &&
    parsed.getUTCSeconds() === 0 &&
    parsed.getUTCMilliseconds() === 0;

  return atUtcMidnight
    ? `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())}`
    : `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
};

/** Single funnel for update failures so every caller reports them the same way. */
const showUpdateError = (error: unknown, fallback: string) => {
  notifications.show({
    title: 'Update failed',
    message: error instanceof Error ? error.message : fallback,
    color: 'red',
    icon: <IconAlertCircle size={18} />,
  });
};

/** Live strength meter plus a per-rule checklist, driven by the shared policy. */
function PasswordPolicyChecklist({ password }: { password: string }) {
  if (!password) return null;
  const strength = getPasswordStrength(password);

  return (
    <Box className={styles.policyBox}>
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
              {met ? <IconCircleCheck size={13} color="#0d9488" /> : <IconCircleX size={13} color="#e11d48" />}
              <Text size="xs" c={met ? 'teal.7' : 'red.6'}>{rule.label}</Text>
            </Group>
          );
        })}
      </Stack>
    </Box>
  );
}

interface ProfileFormValues {
  first_name: string;
  email: string;
  phone_number: string;
  date_of_birth: string | null;
  gender: string;
  license_number: string;
}

/**
 * Editable personal details, wired to `PUT /user/update-user-details`.
 *
 * The parent mounts this with `key={user.email}` so switching accounts (or a
 * fresh login) re-seeds the inputs declaratively instead of through an effect
 * that writes to form state.
 *
 * The email field is read-only: the API identifies the account *by email*, so
 * editing it locally would target a record that does not exist yet.
 */
function PersonalDetailsCard() {
  const { user, updateUser } = useAuth();
  const [saving, setSaving] = useState(false);
  const genderOptions = buildGenderOptions(user?.gender);

  const form = useForm<ProfileFormValues>({
    initialValues: {
      first_name: user?.first_name ?? '',
      email: user?.email ?? '',
      phone_number: user?.phone_number ?? '',
      date_of_birth: toIsoDateOnly(user?.date_of_birth),
      gender: normalizeGender(user?.gender),
      license_number: user?.license_number ?? '',
    },
    validate: {
      first_name: (value) => (value.trim().length < 2 ? 'Enter your first name' : null),
      email: (value) => (/^\S+@\S+\.\S+$/.test(value.trim()) ? null : 'Enter a valid email address'),
      phone_number: (value) =>
        value.trim() && !/^\+?[0-9][0-9\s-]{6,17}$/.test(value.trim())
          ? 'Enter a valid phone number, e.g. +919876543210'
          : null,
      license_number: (value) =>
        value.trim() && value.trim().length < 3 ? 'Enter a valid license number' : null,
    },
  });

  const handleSubmit = form.onSubmit(async (values) => {
    if (!user?.email) {
      showUpdateError(
        new Error('Your account email could not be resolved. Please refresh the page and try again.'),
        'Missing account email',
      );
      return;
    }

    setSaving(true);
    try {
      const payload: UpdateUserDetailsPayload = {
        email: user.email,
        first_name: values.first_name.trim() || null,
        phone_number: values.phone_number.trim() || null,
        date_of_birth: values.date_of_birth || null,
        gender: values.gender || null,
        license_number: values.license_number.trim() || null,
      };

      const response = await updateUserDetails(payload);

      // Prefer the server's copy of the account. When the API only acknowledges
      // the write, merge what we sent so the UI never disagrees with the values
      // the backend accepted.
      
      updateUser(
        response.user ?? {
          first_name: payload.first_name,
          phone_number: payload.phone_number,
          date_of_birth: payload.date_of_birth,
          gender: payload.gender,
          license_number: payload.license_number,
        },
      );

      notifications.show({
        title: 'Profile updated',
        message: response.message || 'Your details have been saved.',
        color: 'teal',
        icon: <IconCircleCheck size={18} />,
      });
    } catch (error) {
      showUpdateError(error, 'Something went wrong while saving your details. Please try again.');
    } finally {
      setSaving(false);
    }
  });

  return (
    <Card className={styles.panel} radius="xl" padding="lg">
      <Group gap="sm" mb="md">
        <ThemeIcon variant="light" color="blue" radius="md" size={40}>
          <UserRound size={19} />
        </ThemeIcon>
        <Box>
          <Title order={3} className={styles.panelTitle}>Personal details</Title>
          <Text size="xs" c="dimmed" mt={2}>Update the information associated with your account</Text>
        </Box>
      </Group>

      <form onSubmit={handleSubmit} noValidate>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <TextInput
            className={styles.field}
            label="First name"
            placeholder="Jane"
            leftSection={<UserRound size={16} />}
            autoComplete="given-name"
            value={form.values.first_name}
            onChange={(event) => form.setFieldValue('first_name', event.currentTarget.value)}
            onBlur={() => form.validateField('first_name')}
            error={form.errors.first_name}
            required
          />
          <TextInput
            className={styles.field}
            label="Email address"
            description="Identifies your account"
            leftSection={<Mail size={16} />}
            type="email"
            readOnly
            value={form.values.email}
            error={form.errors.email}
          />
          <TextInput
            className={styles.field}
            label="Phone number"
            placeholder="+919876543210"
            leftSection={<Phone size={16} />}
            autoComplete="tel"
            value={form.values.phone_number}
            onChange={(event) => form.setFieldValue('phone_number', event.currentTarget.value)}
            onBlur={() => form.validateField('phone_number')}
            error={form.errors.phone_number}
          />
          <DatePickerInput
            className={styles.field}
            label="Date of birth"
            placeholder="Pick a date"
            leftSection={<CalendarDays size={16} />}
            value={form.values.date_of_birth}
            onChange={(value) => form.setFieldValue('date_of_birth', value)}
            maxDate={new Date()}
            clearable
          />
          <Select
            className={styles.field}
            label="Gender"
            placeholder="Select gender"
            data={genderOptions}
            clearable
            value={form.values.gender || null}
            onChange={(value) => form.setFieldValue('gender', value ?? '')}
          />
          <TextInput
            className={styles.field}
            label="Pharmacy license number"
            placeholder="MH-12345"
            leftSection={<MapPin size={16} />}
            value={form.values.license_number}
            onChange={(event) => form.setFieldValue('license_number', event.currentTarget.value)}
            onBlur={() => form.validateField('license_number')}
            error={form.errors.license_number}
          />
        </SimpleGrid>

        <Group justify="flex-end" mt="md">
          <Button
            type="submit"
            color="blue"
            radius="xl"
            loading={saving}
            h={{ base: 44, sm: 36 }}
            leftSection={<IconCircleCheck size={16} />}
          >
            Save changes
          </Button>
        </Group>
      </form>
    </Card>
  );
}

interface PasswordFormValues {
  new_password: string;
  confirm_password: string;
}

/**
 * Password rotation, wired to the same `PUT /user/update-user-details`
 * endpoint.
 *
 * The account is still identified by email; the payload re-sends the current
 * profile fields unchanged and adds `password`, so the documented request shape
 * is always satisfied. `password` is omitted entirely from the details form
 * above, which is what stops an untouched field from clearing the credential.
 */
function PasswordCard() {
  const { user, updateUser } = useAuth();
  const [saving, setSaving] = useState(false);
  // The card leads with a "Change password" call to action and only asks for
  // the new credentials once the user opts in, so the form is collapsed here.
  const [revealing, setRevealing] = useState(false);

  const form = useForm<PasswordFormValues>({
    initialValues: { new_password: '', confirm_password: '' },
    validate: {
      // Same rules as registration and reset, from the shared policy module.
      new_password: (value) => getPasswordPolicyError(value),
      confirm_password: (value, values) =>
        value !== values.new_password ? 'Passwords do not match' : null,
    },
  });

  const closeForm = () => {
    form.reset();
    setRevealing(false);
  };

  const handleSubmit = form.onSubmit(async (values) => {
    if (!user?.email) {
      showUpdateError(
        new Error('Your account email could not be resolved. Please refresh the page and try again.'),
        'Missing account email',
      );
      return;
    }

    setSaving(true);
    try {
      const payload: UpdateUserDetailsPayload = {
        email: user.email,
        first_name: user.first_name ?? null,
        phone_number: user.phone_number ?? null,
        date_of_birth: toIsoDateOnly(user.date_of_birth),
        gender: user.gender ?? null,
        license_number: user.license_number ?? null,
        password: values.new_password,
      };

      const response = await updateUserDetails(payload);
      if (response.user) updateUser(response.user);
      form.reset();
      // Fold the form away again so the card returns to its resting state.
      setRevealing(false);

      notifications.show({
        title: 'Password updated',
        message: response.message || 'Use your new password the next time you sign in.',
        color: 'teal',
        icon: <IconCircleCheck size={18} />,
      });
    } catch (error) {
      showUpdateError(error, 'Something went wrong while updating your password. Please try again.');
    } finally {
      setSaving(false);
    }
  });

  return (
    <Card
      className={`${styles.panel} ${styles.securityCard}`}
      radius="xl"
      padding="lg"
      data-revealed={revealing ? 'true' : undefined}
    >
      <span className={styles.securityBeam} aria-hidden="true" />

      <Group gap="sm" mb="md" wrap="nowrap">
        <ThemeIcon
          className={styles.vaultIcon}
          variant="gradient"
          gradient={{ from: 'blue', to: 'cyan', deg: 135 }}
          radius="md"
          size={44}
        >
          <KeyRound size={20} />
        </ThemeIcon>
        <Box style={{ minWidth: 0 }}>
          <Title order={3} className={styles.panelTitle}>Password &amp; security</Title>
          <Text size="xs" c="dimmed" mt={2}>Rotate your password whenever you need to</Text>
        </Box>
      </Group>

      <Collapse expanded={!revealing} transitionDuration={220} keepMounted={false}>
        <Box className={styles.vaultPrompt}>
          <Box className={styles.vaultArt} aria-hidden="true">
            <span className={styles.vaultRing} />
            <span className={styles.vaultCore}>
              <ShieldCheck size={20} />
            </span>
          </Box>
          <Box className={styles.vaultCopy}>
            <Text fw={600} c="gray.8">Your password stays private</Text>
            <Text size="xs" c="dimmed" mt={4} lh={1.6}>
              Pick something at least 8 characters long, mixing upper case letters, numbers and symbols.
            </Text>
            <Button
              className={styles.vaultCta}
              variant="gradient"
              gradient={{ from: 'blue', to: 'cyan', deg: 118 }}
              mt="sm"
              radius="xl"
              h={{ base: 44, sm: 38 }}
              leftSection={<KeyRound size={16} />}
              onClick={() => setRevealing(true)}
            >
              Change password
            </Button>
          </Box>
        </Box>
      </Collapse>

      <Collapse
        expanded={revealing}
        transitionDuration={320}
        transitionTimingFunction="cubic-bezier(0.22, 1, 0.36, 1)"
        keepMounted={false}
      >
        <Box className={styles.vaultForm}>
          <form onSubmit={handleSubmit} noValidate>
            <Stack gap="sm">
              <div className={styles.revealStep}>
                <PasswordInput
                  className={styles.field}
                  label="New password"
                  placeholder="Enter a new password"
                  leftSection={<KeyRound size={16} />}
                  autoComplete="new-password"
                  value={form.values.new_password}
                  onChange={(event) => {
                    form.setFieldValue('new_password', event.currentTarget.value);
                    // Keep the confirmation in sync: it is validated against this value.
                    if (form.values.confirm_password) form.validateField('confirm_password');
                  }}
                  onBlur={() => form.validateField('new_password')}
                  error={form.errors.new_password}
                  required
                />
              </div>

              {form.values.new_password ? (
                <div className={`${styles.revealStep} ${styles.revealStep2}`}>
                  <PasswordPolicyChecklist password={form.values.new_password} />
                </div>
              ) : null}

              <div className={`${styles.revealStep} ${styles.revealStep3}`}>
                <PasswordInput
                  className={styles.field}
                  label="Confirm new password"
                  placeholder="Re-enter the new password"
                  leftSection={<ShieldCheck size={16} />}
                  autoComplete="new-password"
                  value={form.values.confirm_password}
                  onChange={(event) => form.setFieldValue('confirm_password', event.currentTarget.value)}
                  onBlur={() => form.validateField('confirm_password')}
                  error={form.errors.confirm_password}
                  required
                />
              </div>

              <Group justify="space-between" gap="sm" wrap="wrap">
                <Button
                  type="button"
                  variant="subtle"
                  color="gray"
                  radius="xl"
                  h={{ base: 44, sm: 36 }}
                  w={{ base: '100%', sm: 'auto' }}
                  onClick={closeForm}
                  disabled={saving}
                >
                  Keep current password
                </Button>
                <Button
                  type="submit"
                  color="blue"
                  radius="xl"
                  loading={saving}
                  h={{ base: 44, sm: 36 }}
                  w={{ base: '100%', sm: 'auto' }}
                  leftSection={<ShieldCheck size={16} />}
                >
                  Update password
                </Button>
              </Group>
            </Stack>
          </form>
        </Box>
      </Collapse>
    </Card>
  );
}

export default function Profile() {
  const { user, updateUser } = useAuth();
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const refreshProfile = async () => {
      try {
        const profile = await getUserDetails();
        if (active) updateUser(profile);
      } catch (error) {
        if (active) {
          notifications.show({
            title: 'Profile could not be refreshed',
            message: error instanceof Error ? error.message : 'Please try again later.',
            color: 'red',
            icon: <IconAlertCircle size={18} />,
          });
        }
      } finally {
        if (active) setProfileLoading(false);
      }
    };

    void refreshProfile();
    return () => {
      active = false;
    };
  }, [updateUser]);

  const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || 'Your profile';
  const username = user?.username || 'user';
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  const status = user?.status?.trim() || 'Unknown';
  const isActive = status.toLowerCase() === 'active';

  // The same fields the personal-details card can fill in, so the hero can
  // show how much of the profile is actually complete.
  const completenessFields = [
    user?.first_name,
    user?.phone_number,
    user?.date_of_birth,
    user?.gender,
    user?.license_number,
  ];
  const completedCount = completenessFields.filter((value) => Boolean(value && String(value).trim())).length;
  const completeness = Math.round((completedCount / completenessFields.length) * 100);

  // Re-seeds the editable cards when the signed-in account changes. Using the
  // email (the API's lookup key) means an update that only touches other fields
  // does not blow away what the user is currently typing.
  const profileKey = user?.email ?? 'anonymous';

  return (
    <Stack gap="lg" className={styles.page}>
      <Group justify="space-between" align="flex-end" gap="md" wrap="wrap">
        <Box>
          <Text className={styles.eyebrow}>ACCOUNT CENTER</Text>
          <Title order={1} className={styles.pageTitle}>Your profile</Title>
          <Text c="dimmed" mt={5} size="sm">
            Your identity and account details, all in one place.
          </Text>
        </Box>
        <Button
          component={Link}
          to="/dashboard"
          variant="light"
          color="blue"
          radius="xl"
          rightSection={<ArrowRight size={16} />}
        >
          Back to dashboard
        </Button>
      </Group>

      <Card className={styles.hero} padding={0} radius="xl">
        <Box className={styles.cover}>
          <div className={styles.coverOrb} aria-hidden="true" />
          <div className={styles.coverLines} aria-hidden="true" />
          <Group className={styles.coverLabel} gap={8}>
            <BriefcaseMedical size={15} />
            <Text size="xs" fw={700} tt="uppercase">Your PharmaConnect workspace</Text>
          </Group>
          <Badge
            className={styles.statusBadge}
            color={isActive ? 'teal' : 'gray'}
            variant="light"
            leftSection={
              <span className={`${styles.statusDot} ${isActive ? styles.statusActiveDot : ''}`} />
            }
          >
            {status}
          </Badge>
        </Box>

        <Group className={styles.heroIdentity} align="flex-end" justify="space-between" wrap="wrap">
          <Avatar
            className={styles.avatar}
            size={104}
            radius={30}
            color="blue"
            variant="light"
          >
            {initials || <UserRound size={38} />}
          </Avatar>
          <Box className={styles.identityCopy}>
            <Group gap="xs" align="center" wrap="wrap">
              <Title order={2} className={styles.displayName}>{displayName}</Title>
              <Badge color="blue" variant="light" radius="xl" leftSection={<BriefcaseMedical size={13} />}>
                {user?.role || 'Team member'}
              </Badge>
            </Group>
            <Group gap={7} mt={5} c="dimmed">
              <AtSign size={15} />
              <Text size="sm">{username}</Text>
              <span className={styles.identityDivider} aria-hidden="true" />
              <Mail size={15} />
              <Text size="sm" className={styles.emailText}>{user?.email || 'Email not provided'}</Text>
            </Group>
          </Box>

          <Box className={styles.completeness} visibleFrom="md">
            <RingProgress
              size={52}
              thickness={5}
              roundCaps
              sections={[{ value: completeness, color: 'cyan' }]}
              label={
                <Text ta="center" fz={11} fw={800} c="blue.8">
                  {completeness}%
                </Text>
              }
            />
            <Box style={{ minWidth: 0 }}>
              <Text size="xs" fw={700} c="gray.7">Profile completeness</Text>
              <Text size="xs" c="dimmed">
                {completedCount} of {completenessFields.length} details added
              </Text>
            </Box>
          </Box>
        </Group>
      </Card>

      <div className={styles.contentGrid}>
        <Stack gap="lg">
          {profileLoading ? (
            <Center mih={220}>
              <Loader size="sm" aria-label="Loading profile" />
            </Center>
          ) : (
            <>
              {/* Security first: the change-password flow leads the page. */}
              <PasswordCard key={profileKey} />
              <PersonalDetailsCard key={profileKey} />
            </>
          )}

          <Card className={styles.panel} radius="xl" padding="lg">
            <Group gap="sm" mb="md">
              <ThemeIcon variant="light" color="violet" radius="md" size={40}>
                <ShieldCheck size={19} />
              </ThemeIcon>
              <Box>
                <Title order={3} className={styles.panelTitle}>Account access</Title>
                <Text size="xs" c="dimmed" mt={2}>Your role and workspace access</Text>
              </Box>
            </Group>
            <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
              <Box className={styles.accessTile}>
                <Text size="xs" c="dimmed" fw={600} tt="uppercase">Account role</Text>
                <Text fw={700} mt={6} c="gray.8">{user?.role || 'Not assigned'}</Text>
              </Box>
              <Box className={styles.accessTile}>
                <Text size="xs" c="dimmed" fw={600} tt="uppercase">Account status</Text>
                <Group gap={7} mt={6}>
                  <span className={`${styles.accessDot} ${isActive ? styles.activeDot : ''}`} />
                  <Text fw={700} c="gray.8">{status}</Text>
                </Group>
              </Box>
            </SimpleGrid>
          </Card>
        </Stack>

        <Card className={styles.panel} radius="xl" padding="lg">
          <Group gap="sm" mb="md">
            <ThemeIcon variant="light" color="teal" radius="md" size={40}>
              <Building2 size={19} />
            </ThemeIcon>
            <Box>
              <Title order={3} className={styles.panelTitle}>Your workspace</Title>
              <Text size="xs" c="dimmed" mt={2}>Pick up where your pharmacy needs you</Text>
            </Box>
          </Group>

          <Stack gap="sm">
            <Button
              component={Link}
              to="/inventory"
              variant="default"
              color="gray"
              className={styles.shortcut}
              rightSection={<ArrowRight size={16} />}
              leftSection={<ClipboardList size={18} />}
              justify="space-between"
            >
              Manage inventory
            </Button>
            <Button
              component={Link}
              to="/book"
              variant="default"
              color="gray"
              className={styles.shortcut}
              rightSection={<ArrowRight size={16} />}
              leftSection={<BriefcaseMedical size={18} />}
              justify="space-between"
            >
              Open order book
            </Button>
            <Button
              component={Link}
              to="/invoices"
              variant="default"
              color="gray"
              className={styles.shortcut}
              rightSection={<ArrowRight size={16} />}
              leftSection={<FileText size={18} />}
              justify="space-between"
            >
              View invoices
            </Button>
          </Stack>

          <Box className={styles.workspaceNote} mt="xl">
            <Text size="sm" fw={600} c="blue.9">A better day at the counter starts here.</Text>
            <Text size="xs" c="blue.8" mt={5} lh={1.6}>
              Keep stock, orders and billing close at hand with your PharmaConnect workspace.
            </Text>
          </Box>
        </Card>
      </div>
    </Stack>
  );
}
