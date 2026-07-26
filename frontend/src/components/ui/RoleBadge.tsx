'use client';
import { FaCertificate } from 'react-icons/fa';

interface Props {
  role?: string | null;
  size?: number;
  className?: string;
}

// SUPERADMIN is the app owner's role — the only one that gets a visible
// badge next to the name. ADMIN/MODERATOR stay unmarked in normal UI (their
// elevated access is only surfaced in the admin panel/bot), so this doesn't
// turn into general role-flair for every staff tier. Uses a distinct icon
// from the premium-tier crown (FaCrown) shown elsewhere next to names, so
// the two badges don't read as the same thing.
export function RoleBadge({ role, size = 13, className = '' }: Props) {
  if (role !== 'SUPERADMIN') return null;
  return (
    <span className={`relative inline-flex shrink-0 ${className}`} title="Владелец ROVX" aria-label="Владелец ROVX">
      <FaCertificate size={size} className="text-amber-400" />
      <FaCheckSmall size={size} />
    </span>
  );
}

function FaCheckSmall({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size * 0.55}
      height={size * 0.55}
      className="absolute inset-0 m-auto text-dark-bg"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="4 12 9 17 20 6" />
    </svg>
  );
}
