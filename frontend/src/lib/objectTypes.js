import {
  FileText,
  User,
  CheckSquare,
  Lightbulb,
  BookOpen,
  Folder,
  Calendar,
  Sun,
  MessageSquare,
  CircleDashed,
  Shapes,
  Star,
  Heart,
  Tag,
  Bookmark,
  Music,
  Film,
  Camera,
  Coffee,
  Globe,
  Code,
  Compass,
  Flag,
  Zap,
  Leaf,
  Rocket,
  Map,
  Palette,
  Monitor,
  BrainCircuit,
} from "lucide-react";
import { getCustomTypes } from "@/lib/typeRegistry";

export const OBJECT_TYPES = [
  { key: "note", label: "Notes", singular: "Note", icon: FileText },
  { key: "person", label: "People", singular: "Person", icon: User },
  { key: "task", label: "Tasks", singular: "Task", icon: CheckSquare },
  { key: "idea", label: "Ideas", singular: "Idea", icon: Lightbulb },
  { key: "book", label: "Books", singular: "Book", icon: BookOpen },
  { key: "project", label: "Projects", singular: "Project", icon: Folder },
  { key: "meeting", label: "Meetings", singular: "Meeting", icon: Calendar },
  { key: "dailyLog", label: "Daily Logs", singular: "Daily Log", icon: Sun },
  { key: "chat", label: "Chats", singular: "Chat", icon: MessageSquare },
  { key: "activity", label: "Activity", singular: "Activity Log", icon: Monitor },
];

// Icons available when creating a custom type
export const ICON_OPTIONS = [
  { name: "Shapes", icon: Shapes },
  { name: "Star", icon: Star },
  { name: "Heart", icon: Heart },
  { name: "Tag", icon: Tag },
  { name: "Bookmark", icon: Bookmark },
  { name: "Music", icon: Music },
  { name: "Film", icon: Film },
  { name: "Camera", icon: Camera },
  { name: "Coffee", icon: Coffee },
  { name: "Globe", icon: Globe },
  { name: "Code", icon: Code },
  { name: "Compass", icon: Compass },
  { name: "Flag", icon: Flag },
  { name: "Zap", icon: Zap },
  { name: "Leaf", icon: Leaf },
  { name: "Rocket", icon: Rocket },
  { name: "Map", icon: Map },
  { name: "Palette", icon: Palette },
];

const ICON_MAP = Object.fromEntries(ICON_OPTIONS.map((o) => [o.name, o.icon]));

// Represents an item with no chosen type (type === null)
export const UNTYPED = { key: null, label: "Untyped", singular: "Untyped", icon: CircleDashed };

export function getCustomTypeMetas() {
  return getCustomTypes().map((t) => ({
    ...t,
    isCustom: true,
    icon: ICON_MAP[t.iconName] || Shapes,
  }));
}

export function getAllTypes() {
  return [...OBJECT_TYPES, ...getCustomTypeMetas()];
}

export function typeMeta(key) {
  if (key == null) return UNTYPED;
  return getAllTypes().find((t) => t.key === key) || UNTYPED;
}
