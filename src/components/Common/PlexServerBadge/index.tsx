// One colour per Plex server, so a server looks the same everywhere it is
// shown. Full class names are spelled out for Tailwind.
const SERVER_COLORS = [
  'bg-indigo-500/80 border-indigo-500 !text-indigo-100',
  'bg-cyan-500/80 border-cyan-500 !text-cyan-100',
  'bg-pink-500/80 border-pink-500 !text-pink-100',
  'bg-teal-500/80 border-teal-500 !text-teal-100',
  'bg-orange-500/80 border-orange-500 !text-orange-100',
  'bg-purple-500/80 border-purple-500 !text-purple-100',
  'bg-emerald-500/80 border-emerald-500 !text-emerald-100',
  'bg-rose-500/80 border-rose-500 !text-rose-100',
];

interface PlexServerBadgeProps {
  id: number;
  name: string;
}

const PlexServerBadge = ({ id, name }: PlexServerBadgeProps) => (
  <span
    className={`inline-flex cursor-default whitespace-nowrap rounded-full border px-2 text-xs font-semibold leading-5 ${
      SERVER_COLORS[(id - 1) % SERVER_COLORS.length]
    }`}
  >
    {name}
  </span>
);

export default PlexServerBadge;
