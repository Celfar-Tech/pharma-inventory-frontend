import { ActionIcon, Box, Group, Text, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { ArrowUp } from 'lucide-react';
import {
    IconBrandGithub,
    IconBrandInstagram,
    IconBrandLinkedin,
    IconBrandX,
    IconBrandYoutube,
} from '@tabler/icons-react';

type TablerIcon = typeof IconBrandX;

/** Matches the `max-width: 45em` query used by the footer's scoped styles. */
const COMPACT_QUERY = '(max-width: 45em)';

/* ---------------------------------- content ---------------------------------- */

const SOCIALS: { label: string; icon: TablerIcon }[] = [
    { label: 'GitHub', icon: IconBrandGithub },
    { label: 'LinkedIn', icon: IconBrandLinkedin },
    { label: 'X (Twitter)', icon: IconBrandX },
    { label: 'Instagram', icon: IconBrandInstagram },
    { label: 'YouTube', icon: IconBrandYoutube },
];

/* ---------------------------------- helpers ---------------------------------- */

function SocialButton({ label, icon: Icon, size }: { label: string; icon: TablerIcon; size: number }) {
    return (
        <Tooltip label={label} withArrow position="top" openDelay={250}>
            <ActionIcon
                component="a"
                href="#"
                variant="subtle"
                color="gray"
                size={size}
                radius="md"
                aria-label={label}
                onClick={(event) => event.preventDefault()}
            >
                <Icon size={17} stroke={1.8} aria-hidden="true" />
            </ActionIcon>
        </Tooltip>
    );
}

/* ---------------------------------- footer ---------------------------------- */

export default function Footer() {
    const year = new Date().getFullYear();

    // A pinned bar has to stay short on phones, so the icons shrink below 45em.
    // `getInitialValueInEffect: false` avoids a one-frame flash of the large
    // icons on first paint.
    const isCompact = useMediaQuery(COMPACT_QUERY, false, { getInitialValueInEffect: false });
    const iconSize = isCompact ? 34 : 40;

    const scrollToTop = () => {
        // The app shell scrolls `.app-scroll-region` — `main` itself is
        // `overflow: hidden`, so scrolling *it* would be a no-op.
        const scrollable =
            document.querySelector<HTMLElement>('.app-scroll-region') ??
            document.querySelector<HTMLElement>('main');
        if (scrollable) {
            scrollable.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
        <Box component="footer" className="pt-footer">
            {/* Scoped styles — same pattern as header.tsx, nothing leaks globally */}
            <style>{`
        .pt-footer {
          display: flex;
          align-items: center;
          /* The footer is a flex sibling of the scroll region: it must never be
             squashed by it, or the pinned bar would collapse on tall pages. */
          flex-shrink: 0;
          min-height: 68px;
          /* Gutters track the viewport so the footer lines up with the page
             content instead of overflowing on a 320px phone. */
          padding: 12px clamp(12px, 3vw, var(--mantine-spacing-xl));
          /* The bar now sits flush against the bottom edge of the screen, so it
             has to clear the iOS home indicator itself. */
          padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
          background: var(--mantine-color-white);
          /* soft layered shadow — casts up onto the content above so the
             pinned bar reads as a separate layer rather than a clipped card */
          box-shadow:
            0 -1px 2px rgba(0, 0, 0, 0.04),
            0 -4px 13px -2px rgba(0, 0, 0, 0.1),
            0 -8px 24px -22px rgba(0, 0, 0, 0.12)
        }

        .pt-footer-inner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 10px 24px;
          width: 100%;
        }

        /* On phones the bar is always on screen, so it has to stay short: brand
           and social controls share the first row and the copyright drops to its
           own line (~2 rows) instead of the three stacked rows used before. */
        @media (max-width: 45em) {
          .pt-footer {
            min-height: 0;
            padding: 8px clamp(10px, 3vw, 18px);
            padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
          }

          .pt-footer-inner {
            flex-direction: row;
            justify-content: center;
            text-align: center;
            gap: 4px 10px;
          }

          .pt-footer-brand {
            order: 1;
          }

          .pt-footer-socials {
            order: 2;
            flex-wrap: wrap;
            justify-content: center;
          }

          .pt-footer-copy {
            order: 3;
            flex-basis: 100%;
          }
        }
      `}</style>

            <div className="pt-footer-inner">
                {/* brand — mirrors the PharmaTrack sidebar identity */}
                <Group className="pt-footer-brand" gap="xs" wrap="nowrap">

                    <Box>
                        <Text size="sm" fw={800} c="gray.9" style={{ letterSpacing: '0.3px', lineHeight: 1.2 }}>
                            <span style={{ color: 'var(--mantine-color-blue-filled)' }}>CelFar</span>-Tech
                        </Text>

                    </Box>
                </Group>

                {/* copyright */}
                <Text className="pt-footer-copy" size="xs" c="gray.6" ta="center">
                    © {year} PharmaTrack · All rights reserved.
                </Text>

                {/* socials + back to top */}
                <Group className="pt-footer-socials" gap={4}>
                    {SOCIALS.map((social) => (
                        <SocialButton key={social.label} {...social} size={iconSize} />
                    ))}
                    <Tooltip label="Back to top" withArrow position="top" openDelay={250}>
                        <ActionIcon
                            variant="light"
                            color="blue"
                            size={iconSize}
                            radius="xl"
                            aria-label="Back to top"
                            onClick={scrollToTop}
                        >
                            <ArrowUp size={16} aria-hidden="true" />
                        </ActionIcon>
                    </Tooltip>
                </Group>
            </div>
        </Box>
    );
}
