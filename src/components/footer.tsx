import { ActionIcon, Box, Group, Text, Tooltip } from '@mantine/core';
import { ArrowUp } from 'lucide-react';
import {
    IconBrandGithub,
    IconBrandInstagram,
    IconBrandLinkedin,
    IconBrandX,
    IconBrandYoutube,
} from '@tabler/icons-react';

type TablerIcon = typeof IconBrandX;

/* ---------------------------------- content ---------------------------------- */

const SOCIALS: { label: string; icon: TablerIcon }[] = [
    { label: 'GitHub', icon: IconBrandGithub },
    { label: 'LinkedIn', icon: IconBrandLinkedin },
    { label: 'X (Twitter)', icon: IconBrandX },
    { label: 'Instagram', icon: IconBrandInstagram },
    { label: 'YouTube', icon: IconBrandYoutube },
];

/* ---------------------------------- helpers ---------------------------------- */

function SocialButton({ label, icon: Icon }: { label: string; icon: TablerIcon }) {
    return (
        <Tooltip label={label} withArrow position="top" openDelay={250}>
            <ActionIcon
                component="a"
                href="#"
                variant="subtle"
                color="gray"
                size="md"
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

    const scrollToTop = () => {
        const scrollable = document.querySelector('main');
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
          flex-shrink: 0;
          min-height: 68px;
          padding: 10px var(--mantine-spacing-xl);
          background: var(--mantine-color-white);
          /* soft layered shadow — casts up onto the content above so the
             footer reads as the natural end of the scrollable page */
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

        /* small uppercase tagline under the brand */
        .pt-tagline {
          font-size: 10px;
          letter-spacing: 1.4px;
          text-transform: uppercase;
          color: var(--mantine-color-gray-5);
        }

        @media (max-width: 720px) {
          .pt-footer-inner { justify-content: center; }
        }
      `}</style>

            <div className="pt-footer-inner">
                {/* brand — mirrors the PharmaTrack sidebar identity */}
                <Group gap="xs" wrap="nowrap">

                    <Box>
                        <Text size="sm" fw={800} c="gray.9" style={{ letterSpacing: '0.3px', lineHeight: 1.2 }}>
                            <span style={{ color: 'var(--mantine-color-blue-filled)' }}>CelFar</span>-Tech
                        </Text>

                    </Box>
                </Group>

                {/* copyright */}
                <Text size="xs" c="gray.6" ta="center">
                    © {year} PharmaTrack · All rights reserved.
                </Text>

                {/* socials + back to top */}
                <Group gap={4}>
                    {SOCIALS.map((social) => (
                        <SocialButton key={social.label} {...social} />
                    ))}
                    <Tooltip label="Back to top" withArrow position="top" openDelay={250}>
                        <ActionIcon
                            variant="light"
                            color="blue"
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
