/**
 * Single source of truth for the password policy: registration, password reset
 * and profile password changes all validate against this list so the rules can
 * never drift apart.
 */
export const PASSWORD_POLICY = [
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
export const getPasswordPolicyError = (pw: string) => {
  if (!pw) return 'Password is required';
  const missing = PASSWORD_POLICY.filter((rule) => !rule.test(pw)).map((rule) => rule.requirement);
  return missing.length > 0 ? `Password is too weak — it needs ${formatList(missing)}.` : null;
};

export const getPasswordStrength = (pw: string) => {
  if (!pw) return { score: 0, label: '', color: 'gray' };
  const score = PASSWORD_POLICY.reduce((acc, rule) => acc + (rule.test(pw) ? 1 : 0), 0);
  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
  const colors = ['red', 'orange', 'yellow', 'lime', 'teal'];
  return { score, label: labels[score], color: colors[score] };
};
