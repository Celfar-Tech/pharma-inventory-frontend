import RevenueChart from './revenueChart';
import {
  Container,
  Box
} from '@mantine/core';

export default function Dashboard() {


  return (
    <Container size="xl" px="lg">
   

      {/* REVENUE ANALYTICS — live billing revenue trends (daily / monthly / weekly / custom) */}
      <Box mb="32px">
        <RevenueChart />
      </Box>

     
    </Container>
  );
}