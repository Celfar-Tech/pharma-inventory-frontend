import { Box, Text } from '@mantine/core';

interface StatCellProps {
  /** Small caption above the value, e.g. "Total discount". */
  label: string;
  /** Pre-formatted value (money, counts, …) — never a raw number. */
  value: string;
  /** Optional Mantine colour token for emphasis, e.g. `red.7`. */
  tone?: string;
  /** Renders the value a step larger for the headline figure of a card. */
  emphasis?: boolean;
}

/**
 * Label/value pair used by the mobile card layouts (invoice line items and
 * invoice rows), where a `<table>` would be unreadable on a phone.
 *
 * Declared at module level rather than as a render helper inside a page: it is
 * a stable component type, so cards can be re-rendered without remounting the
 * subtree (and losing input focus) on every keystroke.
 */
export function StatCell({ label, value, tone, emphasis = false }: StatCellProps) {
  return (
    <Box style={{ minWidth: 0 }}>
      <Text size="xs" c="dimmed" style={{ lineHeight: 1.2 }}>
        {label}
      </Text>
      <Text
        size={emphasis ? 'md' : 'sm'}
        fw={emphasis ? 700 : 600}
        c={tone}
        style={{
          lineHeight: 1.35,
          // Tabular figures keep amounts from jittering as digits change.
          fontVariantNumeric: 'tabular-nums',
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </Text>
    </Box>
  );
}
