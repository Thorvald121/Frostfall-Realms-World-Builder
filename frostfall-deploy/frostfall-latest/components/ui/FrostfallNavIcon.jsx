"use client";
import {
  LayoutDashboard, Castle, BookOpen, Crown, UsersRound, UserRound,
  Hourglass, MapPinned, Landmark, Gem, WandSparkles, Languages, Leaf,
  Scale, CalendarRange, Network, Link2, GitFork, BookText, Dices,
  NotebookPen, ShieldCheck, Archive, FileInput, ClipboardList, Settings2,
  StickyNote, Handshake, LifeBuoy, Heart, Shield,
} from "lucide-react";

const icons = {
  dashboard: LayoutDashboard, world_home: Castle, codex: BookOpen,
  deity: Crown, race: UsersRound, character: UserRound,
  event: Hourglass, location: MapPinned, organization: Landmark,
  item: Gem, magic: WandSparkles, language: Languages,
  flora_fauna: Leaf, laws_customs: Scale, timeline: CalendarRange,
  graph: Network, cross_refs: Link2, family_tree: GitFork,
  novel: BookText, generator: Dices, sessions: NotebookPen,
  integrity: ShieldCheck, archives: Archive, ai_import: FileInput,
  staging: ClipboardList, settings: Settings2, scratchpad: StickyNote,
  collaboration: Handshake, support_page: LifeBuoy, donate: Heart,
  admin: Shield, canon_studio: Scale,
};

export function FrostfallNavIcon({ id, size = 19 }) {
  const Component = icons[id] || BookOpen;
  return <Component size={size} strokeWidth={1.85} aria-hidden="true" focusable="false" />;
}
