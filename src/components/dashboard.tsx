import RevenueChart from './revenueChart';
import { Flex } from '@mantine/core';

export default function Dashboard() {
  // No padding wrapper here on purpose: the AppShell layout already owns the
  // responsive page gutters (16px on phones → 32px on desktop). Flex (rather
  // than Stack) is used because its `gap` accepts breakpoint objects.
  return (
    <Flex direction="column" gap={{ base: 'md', md: 'xl' }}>
      {/* REVENUE ANALYTICS — live billing revenue trends (daily / monthly / weekly / custom) */}
      <RevenueChart />
    </Flex>
  );
}
