import RevenueChart from './revenueChart';
import TopSellingMedicines from './topSellingMedicines';
import styles from './dashboard.module.css';

/**
 * The dashboard shows both analytics widgets on one screen:
 *
 *   * Revenue      — billing revenue trends (daily / monthly / weekly / custom)
 *   * Top sellers  — best-selling medicine per day / week / month period
 *
 * They are heavy, self-fetching widgets that each own their own filters, so they
 * simply sit side by side. The responsive grid in `dashboard.module.css` puts the
 * chart on the left and the leaderboard on the right at `md` and above, and
 * stacks them in a single column on phones. No padding wrapper here on purpose:
 * the AppShell layout already owns the responsive page gutters.
 */
export default function Dashboard() {
  return (
    <div className={styles.layout}>
      <RevenueChart />
      <TopSellingMedicines />
    </div>
  );
}
